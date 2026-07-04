// HTML void elements: they have no closing tag and no children.
// https://html.spec.whatwg.org/multipage/syntax.html#void-elements
export const voidElements: ReadonlySet<string> = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);
