// Tag tokenizer originally from https://github.com/rayd/html-parse-stringify2

import type { TagNode } from './ast.ts';
import { voidElements } from './void-elements.ts';

const attrRE = /([@\w\-.]+)|=|(['"])([\s\S]*?)\2/g;

/** Parse a single opening/closing tag token into a {@link TagNode}. */
export function parseTag(tag: string): TagNode {
  const node: TagNode = {
    type: 'tag',
    name: '',
    endtag: tag.startsWith('</'),
    voidElement: false,
    attrs: {},
    children: [],
  };

  let i = 0;
  let key: string | undefined;
  // Whether the next token is a value (the tag name or an attribute value)
  // rather than a bare attribute name.
  let expectValue = true;

  tag.replace(attrRE, (match) => {
    if (match === '=') {
      expectValue = true;
      i++;
      return '';
    }

    if (!expectValue) {
      // A bare token following another bare token means the previous one was
      // a valueless boolean attribute.
      if (key) node.attrs[key] = key;
      key = match;
    } else if (i === 0) {
      node.name = match;
      if (voidElements.has(match) || tag.charAt(tag.length - 2) === '/') {
        node.voidElement = true;
      }
    } else {
      node.attrs[key!] = match.replace(/^['"]|['"]$/g, '');
      key = undefined;
    }

    i++;
    expectValue = false;
    return '';
  });

  // Flush a trailing valueless boolean attribute (e.g. `<input ... disabled>`).
  if (key) node.attrs[key] = key;

  return node;
}
