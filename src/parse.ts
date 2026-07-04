// Parser originally from https://github.com/rayd/html-parse-stringify2,
// adapted for Razor markup.

import type { CodeNode, RazorNode, RootNode, TagNode } from './ast.ts';
import { parseCode } from './parse-code.ts';
import { parseTag } from './parse-tag.ts';

// The `^@[^{\r\n]+` alternative must stop before `{` so that a same-line block
// opener (K&R `@foreach (...) {`) is tokenized as a separate `{` block rather
// than swallowed into the expression (which dropped the matching `}`).
const tagRE =
  /(?:@\*.+\*@|(?:^@[^{\r\n]+|(?<!")@[^{\r\n<]+|else[^{\r\n<]*|for[^{\r\n<]*)|<[^<|"]*(("[^"]*")[^>|"]*)*>|[@]*\{|\})/gim;
const codeRE = /@code\s*{/i;
const wsRE = /^\s*$/;

/** A node that can contain children. */
type ParentNode = TagNode | CodeNode;

// Only tags and code nodes carry `voidElement`.
function isVoid(node: RazorNode): boolean {
  return (node.type === 'tag' || node.type === 'code') && node.voidElement;
}

// Find the offset of the next tag at or after `start`. Note: on no match this
// returns `start - 1` (String.search yields -1), a quirk the callers rely on.
function getNext(source: string, start = 0): number {
  const rest = source.slice(start);
  return start + rest.search(tagRE);
}

// Push a text node onto `list`, collapsing whitespace-only runs per the HTML
// spec: https://www.w3.org/TR/html4/struct/text.html#h-9.1
function pushTextNode(
  list: RazorNode[],
  source: string,
  level: number,
  start: number,
): void {
  // Slice to the next tag, or to the end when there is none.
  const end = getNext(source, start);
  let content = source.slice(start, end === -1 ? undefined : end);

  if (wsRE.test(content)) {
    // Preserve a blank line (encoded as empty content) but collapse other
    // whitespace runs to a single space.
    content = content.includes('\r\n\r\n') ? '' : ' ';
  }

  // Skip trailing/leading whitespace-only nodes.
  if (end > -1 && level + list.length >= 0 && content !== ' ') {
    list.push({ type: 'text', content });
  }
}

/** Parse Razor source into an AST rooted at a {@link RootNode}. */
export function parse(razor: string): RootNode {
  const result: RazorNode[] = [];
  const stack: ParentNode[] = [];
  let current: RazorNode | undefined;
  let level = -1;

  // Everything from `@code {` to the end is preserved verbatim; C# is outside
  // this plugin's remit. Parse only the markup that precedes it.
  const codeMatch = razor.search(codeRE);
  const codeSecIndex = codeMatch === -1 ? razor.length : codeMatch;
  const codeSection = razor.slice(codeSecIndex);
  const markup = razor.slice(0, codeSecIndex);

  // Emit any non-whitespace text that precedes the first tag.
  const matchIndex = markup.search(tagRE);
  if (matchIndex !== 0 && markup.substring(0, matchIndex).trim().length !== 0) {
    pushTextNode(result, markup, 0, 0);
  }

  markup.replace(
    tagRE,
    (tag: string, _p1: string, _p2: string, index: number) => {
      const isOpen = tag.charAt(1) !== '/' && tag.charAt(0) !== '}';
      const isComment = tag.indexOf('<!--') === 0 || tag.indexOf('@*') === 0;
      const lower = tag.toLowerCase();
      const isScriptCode =
        tag.startsWith('@') ||
        tag.startsWith('{') ||
        tag.startsWith('}') ||
        lower.startsWith('else') ||
        lower.startsWith('for');
      const start = index + tag.length;
      let parent: RazorNode[];

      if (!isComment && isOpen) {
        level++;

        current = isScriptCode ? parseCode(tag) : parseTag(tag);

        if (!current.voidElement && getNext(markup, start) !== start) {
          pushTextNode(current.children, markup, level, start);
        }

        // Attach to the root, or to the enclosing element.
        parent = level <= 0 ? result : stack[level - 1]!.children;
        parent.push(current);
        stack[level] = current as ParentNode;
      }

      if (isComment || !isOpen || (current !== undefined && isVoid(current))) {
        if (!isComment) level--;

        parent = level <= -1 ? result : stack[level]!.children;

        if (isComment) {
          current = { type: 'comment', content: tag };
          parent.push(current);
        }
        if (getNext(markup, start) !== start) {
          pushTextNode(parent, markup, level, start);
        }
      }

      return '';
    },
  );

  // If the input wasn't markup at all, keep it as a single text node.
  if (!result.length && markup.length) {
    pushTextNode(result, markup, 0, 0);
  }

  // Append the verbatim code section, if any.
  if (codeSection) {
    result.push({ type: 'text', content: codeSection });
  }

  return { type: 'root', children: result };
}
