# Design: HTML-delegating Razor formatter

## Goal

Reformat `.razor` files by **delegating all HTML formatting to Prettier's own
HTML printer**, while leaving Razor/C# constructs alone. C# is _not_ formatted —
it is preserved verbatim (a future version may hand it to a C# formatter).

This replaces the previous strategy (a bespoke regex parser + hand-rolled
printer that re-indented markup itself and never understood HTML semantics).

## Why this works

Prettier's HTML formatter already tolerates most Razor syntax as-is. Verified:

| Construct                             | Prettier `parser: "html"` result      |
| ------------------------------------- | ------------------------------------- |
| Inline expression `<td>@Model.X</td>` | preserved                             |
| Text + expression `Hello @Name`       | preserved, spacing correct            |
| Razor attributes `@onclick`, `@bind`  | preserved                             |
| Attribute value `value="@x"`          | preserved                             |
| Directives `@page "/x"`, `@inject`    | preserved (unless they contain `<`)   |
| Razor comment `@* … *@`               | preserved                             |
| Components `<MyComponent Id="1" />`   | preserved                             |
| **`@code { … }` / `@{ … }`**          | **C# collapsed/mangled** — must mask  |
| **`@if/@for/@foreach { … }`**         | **braces not structured** — must mask |

So only two categories need special handling; everything else rides on
Prettier's HTML formatter for free.

## Pipeline

`format(source)` is an async, recursive, string-in/string-out transform:

1. **Mask** — walk the source and replace each construct Prettier can't handle
   with a block-level placeholder element `<div data-razor="N"></div>`,
   recording the original in a side table. Constructs masked:
   - **Verbatim blocks** (C# kept as-is): `@code { }`, `@functions { }`, `@{ }`.
   - **Control blocks** (bodies are markup, recursed): `@if / else if / else`,
     `@for`, `@foreach`, `@while`, `@do … while`, `@switch`, `@using (…) { }`,
     `@lock (…) { }`, `@try / catch / finally`, `@section Name { }`.
   - **Directive lines** (kept verbatim; masked so generics like
     `@inherits Base<T>` aren't parsed as HTML): `@page`, `@using` (no parens),
     `@inject`, `@inherits`, `@namespace`, `@implements`, `@attribute`,
     `@layout`, `@typeparam`, `@model`, `@rendermode`, `@addTagHelper`, …

   Inline expressions, razor attributes, razor/HTML comments and components are
   **left in place** — Prettier handles them.

2. **Format as HTML** — run the masked source through Prettier's HTML printer
   (`textToDoc(masked, { parser: "html" })` → `printDocToString`). Placeholders,
   being block elements, land on their own lines at the correct indentation.

3. **Restore** — for each placeholder line, read its indentation and render the
   recorded construct there:
   - _Verbatim block_: emitted as-is (C# untouched), re-based to the indent.
   - _Directive line_: emitted verbatim.
   - _Control block_: rendered in Allman style —
     ```
     @if (cond)
     {
       <body formatted by recursing step 1–3, indented one level>
     }
     else
     {
       …
     }
     ```
     The body is formatted by calling `format` recursively.

4. Normalize trailing whitespace and end with a single newline.

## Plugin integration

Prettier printers are synchronous; the only async hook is `embed`. So:

- `parse` returns a trivial root node holding the raw source.
- `printers[...].embed` returns an async function for the root that runs the
  pipeline using the `textToDoc` it is handed, and returns the resulting string
  (a plain string is a valid Doc).

## Brace matching

Finding a construct's closing `}` requires scanning past braces that appear
inside strings and comments:

- **C# bodies** (`@code`, `@{ }`): skip `"…"`, `@"…"`, `'…'`, `//`, `/* */`.
- **Markup bodies** (control blocks): skip `"…"`, `'…'`, `<!-- -->`, `@* *@`,
  and recurse C#-style over nested `@{ }` / `@code` / `@( )` so their inner
  braces don't miscount.

## Known limitations

- C# is never reformatted (by design, for now).
- A construct whose body splits an HTML element across blocks
  (`@if(x){<tr>}…{</tr>}`) can't be delegated to the HTML formatter.
- Literal `{`/`}` in bare markup text may confuse brace matching.
- A block construct used in an inline context is promoted to its own line.
