# Design: HTML-delegating Razor formatter

## Goal

Reformat `.razor` files by **delegating HTML to Prettier's own HTML printer**
and **C# to [CSharpier](https://csharpier.com)**. This plugin owns only the
Razor layer that stitches the two together.

This replaces the original strategy (a bespoke regex parser + hand-rolled
printer that re-indented markup itself and never understood HTML semantics).

## Why this works

Prettier's HTML formatter already tolerates most Razor syntax as-is. Verified:

| Construct                               | Prettier `parser: "html"` result         |
| --------------------------------------- | ---------------------------------------- |
| Implicit expression `<td>@Model.X</td>` | preserved                                |
| Text + expression `Hello @Name`         | preserved, spacing correct               |
| Razor attributes `@onclick`, `@bind`    | preserved                                |
| Attribute value `value="@x"`            | preserved                                |
| `@@` escape, email `a@b.com`            | preserved                                |
| Components `<MyComponent Id="1" />`     | preserved                                |
| **Explicit expr `@(Foo<int>())`**       | **`<int>` parsed as a tag — must mask**  |
| **Razor comment `@* <p/> *@`**          | **inner markup reformatted — must mask** |
| **`@code { … }` / `@{ … }`**            | **C# collapsed/mangled — must mask**     |
| **`@if/@for/@foreach { … }`**           | **braces not structured — must mask**    |
| **Directive `@inherits Base<T>`**       | **`<T>` parsed as a tag — must mask**    |

Implicit expressions, razor attributes, `@@`, emails, HTML comments and
components ride on Prettier for free; everything in bold is masked.

## Pipeline

`format(source)` is an async, recursive, string-in/string-out transform:

1. **Mask** — walk the source and replace each construct Prettier can't handle
   with a placeholder, recording the original in a side table. Two placeholder
   shapes:
   - **Block placeholders** `<div data-razor="N"></div>` (own line): the code
     blocks `@code { }`, `@functions { }`, `@{ }`; the control blocks
     `@if / else if / else`, `@for`, `@foreach`, `@while`, `@do … while`,
     `@switch`, `@using (…) { }`, `@lock (…) { }`, `@try / catch / finally`,
     `@section Name { }`; and **directive lines** — `@page`, `@using` (no
     parens), `@inject`, `@inherits`, `@namespace`, `@implements`, `@attribute`,
     `@layout`, `@typeparam`, `@model`, `@rendermode`, `@addTagHelper`, … only
     when they start a line (so `foo@using.com` and mid-text uses are
     untouched).
   - **Inline placeholders** (a private-use text token that stays in the flow):
     explicit `@(…)` expressions and `@* … *@` razor comments.

   The scanner skips `@@` escapes and doesn't scan inside HTML comments;
   implicit expressions, razor attributes and components are **left in place** —
   Prettier handles them.

2. **Format as HTML** — run the masked source through Prettier's HTML printer
   (`textToDoc(masked, { parser: "html" })` → `printDocToString`). Block
   placeholders, being `<div>`s, land on their own lines at the correct
   indentation; inline tokens ride along as text.

3. **Restore** — replace each block placeholder (reading its indentation) and
   then each inline token:
   - _Inline token_ (`@(…)`, `@* … *@`): emitted verbatim.
   - _Code block_ (`@code`/`@functions`/`@{ }`): the C# is formatted with
     CSharpier (see below) and re-indented to match; on any failure it is kept
     verbatim.
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

## C# formatting (`src/csharp.ts`)

C# is piped through CSharpier (`dotnet csharpier format --write-stdout`, stdin →
stdout). CSharpier picks up the project's `.editorconfig` / `.csharpierrc` via
an absolute `--stdin-path` in the source file's directory.

- `@{ }` bodies are **statements** — valid C# top-level statements, formatted
  directly.
- `@code`/`@functions` bodies are **class members** — not a compilation unit on
  their own, so they are wrapped in `class __CSharpierWrapper__ { … }`,
  formatted, then the class body is extracted and dedented.

The command is the `csharpierCommand` option (default `dotnet csharpier`); set
it to `""` to disable. Formatting never throws — every failure falls back to
verbatim C#:

- **Not runnable** (not on PATH / not executable): warn once per command (a
  likely misconfiguration), then verbatim.
- **Rejected** (CSharpier ran but exited non-zero, e.g. markup inside a code
  block, or a genuine syntax error): silent verbatim — these are frequently
  legitimate and can't be told apart from real errors.
- **Disabled** (`csharpierCommand: ""`): silent verbatim, no warning.

## Brace matching

Finding a construct's closing `}` requires scanning past braces that appear
inside strings and comments:

- **C# bodies** (`@code`, `@{ }`): skip `"…"`, `@"…"`, `'…'`, `//`, `/* */`.
- **Markup bodies** (control blocks): skip `"…"`, `'…'`, `<!-- -->`, `@* *@`,
  and recurse C#-style over nested `@{ }` / `@code` / `@( )` so their inner
  braces don't miscount.

## `.razor` vs `.cshtml`

Both extensions are handled by the same parser — the Razor grammar is identical;
only the set of valid directives/features differs (`@code`/`@rendermode` in
components; `@model`/`@section`/Tag Helpers in MVC/Pages views). The scanner
covers both.

## Known limitations

- **Templated Razor delegates** (`.cshtml`): the `@<tag>…</tag>` transition
  (e.g. `@Repeat(items, @<li>@item.Name</li>)`) isn't recognized, so the markup
  is reflowed awkwardly. Content is preserved and the result is stable, just not
  pretty.
- Control-flow **conditions** (`@if (x)`) and inline expressions (`@(a+b)`) are
  not run through CSharpier — only the block bodies are.
- A construct whose body splits an HTML element across blocks
  (`@if(x){<tr>}…{</tr>}`) can't be delegated to the HTML formatter, and markup
  mixed into a `@{ }`/`@code` block makes CSharpier fall back to verbatim.
- Literal `{`/`}` in bare markup text may confuse brace matching.
- A block construct used in an inline context is promoted to its own line.
