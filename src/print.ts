import { doc, type AstPath, type Doc } from 'prettier';

import type { AnyNode, CodeNode, TagNode } from './ast.ts';

const { indent, dedent, softline, hardline, line, join } = doc.builders;

/** The recursion callback Prettier passes to a printer's `print`. */
type Recurse = (path: AstPath<AnyNode>) => Doc;

export function print(
  path: AstPath<AnyNode>,
  _options: unknown,
  recurse: Recurse,
): Doc {
  const node = path.node;
  switch (node.type) {
    case 'root':
      return [join(hardline, path.map(recurse, 'children')), hardline];
    case 'tag':
      return printTag(path as AstPath<TagNode>, recurse);
    case 'code':
      return printCode(path as AstPath<CodeNode>, recurse);
    case 'comment':
      return [softline, node.content.trim()];
    case 'text':
      return node.content.trim();
  }
}

function printTag(path: AstPath<TagNode>, recurse: Recurse): Doc {
  const node = path.node;

  const attrs: Doc[] = [];
  for (const [key, value] of Object.entries(node.attrs)) {
    attrs.push(' ', key, '="', value, '"');
  }

  const headTag: Doc = node.voidElement
    ? ['<', node.name, attrs, ' />']
    : ['<', node.name, attrs, '>'];

  if (node.voidElement) return headTag;

  const children = node.children;
  const closeTag: Doc = ['</', node.name, '>'];
  if (children.length === 0) return [headTag, closeTag];

  let hasBlockChild = false;
  const printed = path.map((childPath, i) => {
    const child = children[i]!;
    switch (child.type) {
      case 'tag':
        hasBlockChild = true;
        return [hardline, recurse(childPath)];
      case 'code': {
        if (isBlockCode(child)) {
          hasBlockChild = true;
          return [softline, recurse(childPath)];
        }
        // An expression sits inline when it opens the element or follows text;
        // otherwise it starts its own line.
        const prev = children[i - 1];
        const inline =
          i === 0 || (prev?.type === 'text' && prev.content !== '');
        if (!inline) return [softline, recurse(childPath)];
        // Separate the expression from following inline text with a space.
        const next = children[i + 1];
        const spaceAfter = next?.type === 'text' && next.content.trim() !== '';
        return spaceAfter ? [recurse(childPath), ' '] : recurse(childPath);
      }
      case 'comment':
        hasBlockChild = true;
        return recurse(childPath);
      default: {
        // A blank-line text node (empty content) just breaks the line.
        if (child.content === '') {
          hasBlockChild = true;
          return softline;
        }
        return recurse(childPath);
      }
    }
  }, 'children');

  const inner = indent(hasBlockChild ? [printed, dedent(line)] : printed);
  return [headTag, inner, closeTag];
}

function printCode(path: AstPath<CodeNode>, recurse: Recurse): Doc {
  const node = path.node;
  const children = node.children;
  const block = isBlockCode(node);

  const printed = path.map((childPath, i) => {
    const child = children[i]!;
    switch (child.type) {
      case 'text':
        return child.content === '' ? softline : recurse(childPath);
      case 'code': {
        const prev = children[i - 1];
        const newlineAfter = i === 0 || prev?.type === 'code';
        return newlineAfter
          ? [recurse(childPath), softline]
          : recurse(childPath);
      }
      default:
        return recurse(childPath);
    }
  }, 'children');

  const name = node.name.trim();
  if (block) {
    return [name, indent([softline, printed, dedent(line)]), '}'];
  }
  const lower = name.toLowerCase();
  if (lower.startsWith('@if') || lower.startsWith('@for')) {
    return [softline, name, printed];
  }
  return [name, printed];
}

function isBlockCode(node: CodeNode): boolean {
  return node.name === '{' || node.name.includes('@{');
}
