// The async mask -> HTML-format -> restore pipeline. See DESIGN.md.

import { doc, type Doc } from 'prettier';

import { formatCSharp, type RazorOptions } from './csharp.ts';
import {
  INLINE_CLOSE,
  INLINE_OPEN,
  blockPlaceholderRE,
  linesInsideCSharpStrings,
  mask,
  type RazorBlock,
} from './scan.ts';

type Options = RazorOptions;

/** Formats a chunk of embedded code with a given parser. */
type TextToDoc = (text: string, options: Options) => Promise<Doc>;

// Matches inline placeholder tokens; constructed fresh per call for the same
// reason as blockPlaceholderRE (restore recurses).
const inlineRE = (): RegExp =>
  new RegExp(`${INLINE_OPEN}(\\d+)${INLINE_CLOSE}`, 'g');

function indentUnit(options: Options): string {
  return options.useTabs ? '\t' : ' '.repeat(options.tabWidth ?? 2);
}

function indentLines(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => (line === '' ? '' : prefix + line))
    .join('\n');
}

// Indent C# text, leaving lines that start inside a multi-line string literal
// untouched — their leading whitespace is string content.
function indentCSharpLines(text: string, prefix: string): string {
  const insideString = linesInsideCSharpStrings(text);
  return text
    .split('\n')
    .map((line, i) =>
      line === '' || insideString.has(i) ? line : prefix + line,
    )
    .join('\n');
}

// Re-base a verbatim block (C# kept as-is) to `indent`. Top-level blocks
// (indent === '') are emitted unchanged.
function reindentVerbatim(text: string, indent: string): string {
  if (indent === '') return text;
  return indentCSharpLines(text, indent);
}

async function renderBlock(
  block: RazorBlock,
  indent: string,
  textToDoc: TextToDoc,
  options: Options,
): Promise<string> {
  switch (block.kind) {
    case 'inline': // resolved separately via resolveInline; here for safety
      return indent + block.text;
    case 'directive':
      return indent + block.text;
    case 'verbatim': {
      const formatted = await formatCSharp(block.body, block.csharp, options);
      // CSharpier unavailable/disabled or couldn't parse the C#: keep verbatim.
      if (formatted === null) return reindentVerbatim(block.raw, indent);
      if (formatted === '') return `${indent}${block.opener}\n${indent}}`;
      const body = indentCSharpLines(formatted, indent + indentUnit(options));
      return `${indent}${block.opener}\n${body}\n${indent}}`;
    }
    case 'control': {
      const inner = indent + indentUnit(options);
      const parts: string[] = [];
      for (const clause of block.clauses) {
        parts.push(indent + clause.header);
        parts.push(indent + '{');
        const body = (
          await formatDocument(clause.body, textToDoc, options)
        ).trimEnd();
        if (body !== '') parts.push(indentLines(body, inner));
        parts.push(indent + '}');
      }
      let result = parts.join('\n');
      if (block.trailer) result += '\n' + indent + block.trailer;
      return result;
    }
  }
}

async function restore(
  html: string,
  blocks: RazorBlock[],
  textToDoc: TextToDoc,
  options: Options,
): Promise<string> {
  const re = blockPlaceholderRE();
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out += html.slice(last, m.index);
    const block = blocks[Number(m[2])];
    // An id we never issued is a literal `data-razor` div in the user's
    // markup — keep it as-is.
    out += block ? await renderBlock(block, m[1]!, textToDoc, options) : m[0];
    last = m.index + m[0].length;
  }
  out += html.slice(last);
  return out;
}

/**
 * Format Razor source into a formatted string: mask the Razor constructs,
 * delegate the remaining markup to Prettier's HTML printer, then restore the
 * constructs (recursing into control-block bodies).
 */
export async function formatDocument(
  source: string,
  textToDoc: TextToDoc,
  options: Options,
): Promise<string> {
  if (source.trim() === '') return '';

  const { masked, blocks, tagAliases } = mask(source);

  const htmlDoc = await textToDoc(masked, { parser: 'html' });
  let html = doc.printer.printDocToString(htmlDoc, {
    printWidth: options.printWidth ?? 80,
    tabWidth: options.tabWidth ?? 2,
    useTabs: options.useTabs ?? false,
  }).formatted;

  if (blocks.length > 0) {
    html = await restore(html, blocks, textToDoc, options);
    html = resolveInline(html, blocks);
  }
  return restoreTagAliases(html, tagAliases);
}

// Put aliased PascalCase tag names (`<rz-N ...>`, `</rz-N>`) back. An id with
// no recorded alias is a literal `rz-N` element in the user's markup — keep it.
function restoreTagAliases(html: string, tagAliases: string[]): string {
  if (tagAliases.length === 0) return html;
  return html.replace(/(<\/?)rz-(\d+)/g, (whole, open: string, id: string) => {
    const name = tagAliases[Number(id)];
    return name === undefined ? whole : open + name;
  });
}

// Replace inline placeholder tokens with their verbatim originals.
function resolveInline(text: string, blocks: RazorBlock[]): string {
  return text.replace(inlineRE(), (whole, id: string) => {
    const block = blocks[Number(id)];
    return block?.kind === 'inline' ? block.text : whole;
  });
}
