/** An HTML element, e.g. `<div class="x">...</div>` or `<br/>`. */
export interface TagNode {
  type: 'tag';
  name: string;
  /** Whether this token was a closing tag (`</div>`). */
  endtag: boolean;
  /** Whether the element has no closing tag (void elements and self-closed). */
  voidElement: boolean;
  attrs: Record<string, string>;
  children: RazorNode[];
}

/** Literal text between tags. An empty `content` marks a blank line. */
export interface TextNode {
  type: 'text';
  content: string;
}

/** A Razor construct, e.g. `@Title`, `@if (...)`, `@code { ... }`, `@{ ... }`. */
export interface CodeNode {
  type: 'code';
  /** The raw opening token, e.g. `@Title`, `@if (x)`, `{`, `@{`. */
  name: string;
  /** Whether the construct is standalone (an expression) rather than a block. */
  voidElement: boolean;
  children: RazorNode[];
}

/** An HTML comment (`<!-- -->`) or a Razor comment (`@* *@`). */
export interface CommentNode {
  type: 'comment';
  content: string;
}

export type RazorNode = TagNode | TextNode | CodeNode | CommentNode;

/** The document root returned by the parser. */
export interface RootNode {
  type: 'root';
  children: RazorNode[];
}

export type AnyNode = RootNode | RazorNode;
