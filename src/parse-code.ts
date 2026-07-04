import type { CodeNode } from './ast.ts';

/**
 * Parse a Razor token into a {@link CodeNode}. Expressions (`@Title`) and the
 * control-flow keywords (`@if`, `@for`, `else`) are standalone (`voidElement`);
 * block openers (`{`, `@{`) own the children that follow them.
 */
export function parseCode(tag: string): CodeNode {
  const node: CodeNode = {
    type: 'code',
    name: tag,
    voidElement: false,
    children: [],
  };

  const lower = tag.toLowerCase();
  if (
    (tag.startsWith('@') && !tag.includes('@{')) ||
    lower.startsWith('else') ||
    lower.startsWith('for')
  ) {
    node.voidElement = true;
  }

  return node;
}
