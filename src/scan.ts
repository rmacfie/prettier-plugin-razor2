// Scans Razor source and masks the constructs Prettier's HTML formatter can't
// handle. Block-level constructs (code/control blocks, directive lines) become
// `<div data-razor="N"></div>` placeholders; inline constructs (explicit `@(…)`
// expressions and razor comments) become `N` text tokens so they
// survive HTML formatting without forcing a line break. Originals are recorded
// for later restoration. See DESIGN.md.

import type { CSharpKind } from './csharp.ts';

/** Delimiters for inline placeholder tokens (Unicode private-use area). */
export const INLINE_OPEN = '\uE000';
export const INLINE_CLOSE = '\uE001';

/** A `@code { }`, `@functions { }` or `@{ }` block holding C#. */
export interface VerbatimBlock {
  kind: 'verbatim';
  /** The opener line, e.g. `@code {` or `@{`. */
  opener: string;
  /** The C# between the braces. */
  body: string;
  /** The C# context the body sits in. */
  csharp: CSharpKind;
  /** The whole original construct, used as a verbatim fallback. */
  raw: string;
}

/** A single-line directive such as `@page "/x"` — kept verbatim. */
export interface DirectiveLine {
  kind: 'directive';
  text: string;
}

/** One `header { body }` arm of a control construct. */
export interface ControlClause {
  /** E.g. `@if (a)`, `else if (b)`, `else`, `catch (Exception e)`. */
  header: string;
  /** Raw markup between the braces; formatted recursively. */
  body: string;
}

/** An `@if/@for/@foreach/...` control construct whose bodies are markup. */
export interface ControlBlock {
  kind: 'control';
  clauses: ControlClause[];
  /** A trailing clause with no body, e.g. `while (x);` for `@do`. */
  trailer?: string;
}

/**
 * An inline construct kept verbatim: an explicit `@(…)` expression (which may
 * contain `<`/generics that HTML parsing would mangle) or a `@* … *@` comment
 * (whose contents Prettier would otherwise reformat).
 */
export interface InlineBlock {
  kind: 'inline';
  text: string;
}

export type RazorBlock =
  VerbatimBlock | DirectiveLine | ControlBlock | InlineBlock;

export interface MaskResult {
  masked: string;
  blocks: RazorBlock[];
}

const DIRECTIVES = new Set([
  'page',
  'using',
  'inject',
  'inherits',
  'namespace',
  'implements',
  'attribute',
  'layout',
  'typeparam',
  'model',
  'rendermode',
  'addTagHelper',
  'removeTagHelper',
  'tagHelperPrefix',
  'preservewhitespace',
]);

// Keywords that open a control block. `using`/`lock` are blocks only when
// followed by `(`; otherwise `using` is a directive.
const CONTROL = new Set([
  'if',
  'for',
  'foreach',
  'while',
  'switch',
  'using',
  'lock',
  'do',
  'try',
  'section',
]);

const isWs = (c: string | undefined): boolean =>
  c === ' ' || c === '\t' || c === '\r' || c === '\n';
const isLetter = (c: string | undefined): boolean =>
  c !== undefined && /[A-Za-z]/.test(c);

function skipWs(src: string, i: number): number {
  while (i < src.length && isWs(src[i])) i++;
  return i;
}

function readIdent(src: string, i: number): string {
  let j = i;
  while (j < src.length && isLetter(src[j])) j++;
  return src.slice(i, j);
}

// Whether `i` is the first non-whitespace position on its line. Directives are
// line-level, so this distinguishes `@using X` (directive) from an `@using`
// that appears mid-text or inside an email like `foo@using.com`.
function atLineStart(src: string, i: number): boolean {
  let j = i - 1;
  while (j >= 0 && (src[j] === ' ' || src[j] === '\t')) j--;
  return j < 0 || src[j] === '\n';
}

// Index just past `needle`, starting at `from`.
function skipUntil(src: string, from: number, needle: string): number {
  const idx = src.indexOf(needle, from);
  return idx === -1 ? src.length : idx + needle.length;
}

// If `i` starts a C# string/char/comment, return the index just past it; else -1.
function skipCSharpToken(src: string, i: number): number {
  const c = src[i];
  if (c === '@' && src[i + 1] === '"') {
    let j = i + 2;
    while (j < src.length) {
      if (src[j] === '"') {
        if (src[j + 1] === '"') {
          j += 2;
          continue;
        }
        return j + 1;
      }
      j++;
    }
    return src.length;
  }
  if (c === '"' || c === "'") {
    let j = i + 1;
    while (j < src.length) {
      if (src[j] === '\\') {
        j += 2;
        continue;
      }
      if (src[j] === c) return j + 1;
      j++;
    }
    return src.length;
  }
  if (c === '/' && src[i + 1] === '/') {
    let j = i + 2;
    while (j < src.length && src[j] !== '\n') j++;
    return j;
  }
  if (c === '/' && src[i + 1] === '*') {
    return skipUntil(src, i + 2, '*/');
  }
  return -1;
}

// `i` at `{`; return index just past the matching `}`, skipping C# tokens.
function matchBraceCSharp(src: string, i: number): number {
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const skipped = skipCSharpToken(src, j);
    if (skipped !== -1) {
      j = skipped;
      continue;
    }
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return j + 1;
    j++;
  }
  return src.length;
}

// `i` at `(`; return index just past the matching `)`, skipping C# tokens.
function matchParen(src: string, i: number): number {
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const skipped = skipCSharpToken(src, j);
    if (skipped !== -1) {
      j = skipped;
      continue;
    }
    const c = src[j];
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return j + 1;
    j++;
  }
  return src.length;
}

// `i` at a quote; return index just past the closing quote (markup rules: no
// backslash escaping).
function skipMarkupQuote(src: string, i: number): number {
  const q = src[i];
  let j = i + 1;
  while (j < src.length && src[j] !== q) j++;
  return j < src.length ? j + 1 : src.length;
}

// `i` at `{`; return index just past the matching `}` for a markup body,
// stepping over comments, quoted strings and nested C# regions.
function matchBraceMarkup(src: string, i: number): number {
  let depth = 0;
  let j = i;
  while (j < src.length) {
    if (src[j] === '@' && src[j + 1] === '*') {
      j = skipUntil(src, j + 2, '*@');
      continue;
    }
    if (src.startsWith('<!--', j)) {
      j = skipUntil(src, j + 4, '-->');
      continue;
    }
    if (src[j] === '@' && src[j + 1] === '{') {
      j = matchBraceCSharp(src, j + 1);
      continue;
    }
    if (src[j] === '@' && src[j + 1] === '(') {
      j = matchParen(src, j + 1);
      continue;
    }
    if (src[j] === '"' || src[j] === "'") {
      j = skipMarkupQuote(src, j);
      continue;
    }
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return j + 1;
    j++;
  }
  return src.length;
}

// Parse one `header { body }` arm starting at `pos` (the char after the
// keyword). `hasCondition` controls whether a `(...)` is consumed.
function parseClause(
  src: string,
  headerStart: number,
  afterKeyword: number,
  hasCondition: boolean,
  requireCondition: boolean,
): { clause: ControlClause; end: number } | null {
  let pos = skipWs(src, afterKeyword);
  if (hasCondition) {
    if (src[pos] !== '(') {
      if (requireCondition) return null;
    } else {
      pos = matchParen(src, pos);
      pos = skipWs(src, pos);
    }
  }
  if (src[pos] !== '{') return null;
  const bodyEnd = matchBraceMarkup(src, pos);
  return {
    clause: {
      header: src.slice(headerStart, pos).trimEnd(),
      body: src.slice(pos + 1, bodyEnd - 1),
    },
    end: bodyEnd,
  };
}

// Parse a control construct beginning at `at` (the `@`). Returns null if the
// token isn't actually a well-formed control block (e.g. `@using System`).
function parseControl(
  src: string,
  at: number,
  keyword: string,
): { block: ControlBlock; end: number } | null {
  const afterKw = at + 1 + keyword.length;

  if (keyword === 'section') {
    // `@section Name { ... }`
    let pos = skipWs(src, afterKw);
    pos += readIdent(src, pos).length;
    pos = skipWs(src, pos);
    if (src[pos] !== '{') return null;
    const bodyEnd = matchBraceMarkup(src, pos);
    return {
      block: {
        kind: 'control',
        clauses: [
          {
            header: src.slice(at, pos).trimEnd(),
            body: src.slice(pos + 1, bodyEnd - 1),
          },
        ],
      },
      end: bodyEnd,
    };
  }

  const hasCondition = keyword !== 'do' && keyword !== 'try';
  const requireCondition = keyword !== 'using' && keyword !== 'lock';
  const first = parseClause(src, at, afterKw, hasCondition, requireCondition);
  if (!first) return null;

  const clauses: ControlClause[] = [first.clause];
  let end = first.end;

  if (keyword === 'do') {
    // `@do { } while (cond);`
    let pos = skipWs(src, end);
    if (readIdent(src, pos) === 'while') {
      pos = skipWs(src, pos + 5);
      if (src[pos] === '(') {
        pos = matchParen(src, pos);
        let trailer = src.slice(skipWs(src, first.end), pos);
        if (src[pos] === ';') {
          pos++;
          trailer += ';';
        }
        return { block: { kind: 'control', clauses, trailer }, end: pos };
      }
    }
    return { block: { kind: 'control', clauses }, end };
  }

  // if/else-if/else and try/catch/finally chains.
  const chained =
    keyword === 'if' ? ['else'] : keyword === 'try' ? ['catch', 'finally'] : [];
  for (;;) {
    const pos = skipWs(src, end);
    const next = readIdent(src, pos);
    if (!chained.includes(next)) break;

    if (next === 'else') {
      const afterElse = skipWs(src, pos + 4);
      if (readIdent(src, afterElse) === 'if') {
        // else if (cond) { }
        const arm = parseClause(src, pos, afterElse + 2, true, true);
        if (!arm) break;
        clauses.push(arm.clause);
        end = arm.end;
        continue;
      }
      // plain else { }
      const arm = parseClause(src, pos, pos + 4, false, false);
      if (!arm) break;
      clauses.push(arm.clause);
      end = arm.end;
      break; // nothing follows a plain else
    }

    // catch (…) { } or finally { }
    const arm = parseClause(
      src,
      pos,
      pos + next.length,
      next === 'catch',
      false,
    );
    if (!arm) break;
    clauses.push(arm.clause);
    end = arm.end;
  }

  return { block: { kind: 'control', clauses }, end };
}

/** Replace Razor block constructs with placeholders; see {@link MaskResult}. */
export function mask(src: string): MaskResult {
  const blocks: RazorBlock[] = [];
  // Block placeholder: its own line, indent-aware on restore.
  const blockPlaceholder = (block: RazorBlock): string =>
    `<div data-razor="${blocks.push(block) - 1}"></div>`;
  // Inline placeholder: a text token that stays in the flow.
  const inlinePlaceholder = (block: RazorBlock): string =>
    `${INLINE_OPEN}${blocks.push(block) - 1}${INLINE_CLOSE}`;

  let out = '';
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i]!;

    // `@* … *@` razor comment — mask inline so its (possibly HTML-like)
    // contents aren't reformatted.
    if (c === '@' && src[i + 1] === '*') {
      const end = skipUntil(src, i + 2, '*@');
      out += inlinePlaceholder({ kind: 'inline', text: src.slice(i, end) });
      i = end;
      continue;
    }
    // HTML comment — Prettier preserves it; pass through and don't scan inside.
    if (src.startsWith('<!--', i)) {
      const end = skipUntil(src, i + 4, '-->');
      out += src.slice(i, end);
      i = end;
      continue;
    }

    if (c !== '@') {
      out += c;
      i++;
      continue;
    }

    // `@@` escape.
    if (src[i + 1] === '@') {
      out += '@@';
      i += 2;
      continue;
    }

    // `@( … )` explicit expression — mask inline; it may contain generics or
    // `<` that HTML parsing would mangle.
    if (src[i + 1] === '(') {
      const end = matchParen(src, i + 1);
      out += inlinePlaceholder({ kind: 'inline', text: src.slice(i, end) });
      i = end;
      continue;
    }

    // `@{ ... }` code block (statements).
    if (src[i + 1] === '{') {
      const end = matchBraceCSharp(src, i + 1);
      out += blockPlaceholder({
        kind: 'verbatim',
        opener: '@{',
        body: src.slice(i + 2, end - 1),
        csharp: 'statements',
        raw: src.slice(i, end),
      });
      i = end;
      continue;
    }

    const kw = readIdent(src, i + 1);

    // `@code { }` / `@functions { }` (class members).
    if (kw === 'code' || kw === 'functions') {
      const bracePos = skipWs(src, i + 1 + kw.length);
      if (src[bracePos] === '{') {
        const end = matchBraceCSharp(src, bracePos);
        out += blockPlaceholder({
          kind: 'verbatim',
          opener: `@${kw} {`,
          body: src.slice(bracePos + 1, end - 1),
          csharp: 'members',
          raw: src.slice(i, end),
        });
        i = end;
        continue;
      }
    }

    // Control-flow blocks.
    if (CONTROL.has(kw)) {
      const parsed = parseControl(src, i, kw);
      if (parsed) {
        out += blockPlaceholder(parsed.block);
        i = parsed.end;
        continue;
      }
    }

    // Single-line directives — only at the start of a line, so mid-text uses
    // and emails (`foo@using.com`) aren't misread as directives.
    if (DIRECTIVES.has(kw) && atLineStart(src, i)) {
      let end = src.indexOf('\n', i);
      if (end === -1) end = n;
      out += blockPlaceholder({
        kind: 'directive',
        text: src.slice(i, end).trimEnd(),
      });
      i = end;
      continue;
    }

    // Plain inline expression — leave for the HTML formatter.
    out += c;
    i++;
  }

  return { masked: out, blocks };
}
