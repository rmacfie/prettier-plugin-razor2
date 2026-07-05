# prettier-plugin-razor2

An opinionated formatter plugin for [Prettier](https://prettier.io) that adds
support for Razor files — `.razor` (Blazor components) and `.cshtml` (MVC views
and Razor Pages).

Prettier is an opinionated code formatter. It enforces a consistent style by
parsing your code and re-printing it, taking various rules into account.

> **Fork notice** This project is a fork of
> [prettier-plugin-razor](https://github.com/KristinaPlusPlus/prettier-plugin-razor).

# Notice

This plugin is still under development. It formats the HTML in a Razor file by
delegating to Prettier's own HTML formatter, and the C# in `@code`/`@functions`/
`@{ }` blocks by delegating to [CSharpier](https://csharpier.com). Control-flow
blocks (`@if`, `@foreach`, …) are re-indented in Allman style. Please try it out
and provide feedback.

## C# formatting

C# formatting requires the [CSharpier](https://csharpier.com) CLI on your `PATH`
(`dotnet tool install csharpier`, invoked as `dotnet csharpier`). If it is not
available, C# is left untouched and a one-time warning is printed. Override the
command — or disable C# formatting entirely — with the `csharpierCommand` option
(set it to `""` to disable, which also silences the warning).

# Installation

    npm install --save-dev prettier prettier-plugin-razor2

# Usage

This plugin will be loaded automatically (if installed) by prettier to format
files ending with `.razor` (Blazor components) or `.cshtml` (MVC views / Razor
Pages). Using it is exactly the same as using prettier.

Prettier [CLI usage docs](https://prettier.io/docs/en/cli.html)<br> Prettier
[API usage docs](https://prettier.io/docs/en/api.html)

## Known limitations

- `@switch` blocks with several cases: the bare `case X:` / `break;` lines are
  plain text to the HTML formatter, so consecutive arms can end up glued onto
  one line (`break; case Y:`). The output is stable and nothing is lost — it
  just isn't pretty yet.
- Templated Razor delegates (`.cshtml`), e.g.
  `@Repeat(items, @<li>@item.Name</li>)`, are preserved but not reformatted.

## Composing with other plugins

The HTML in your Razor files is formatted by Prettier's own HTML formatter, so
other plugins that hook the `html` parser work on it too — including inside
control blocks. For example,
[prettier-plugin-tailwindcss](https://github.com/tailwindlabs/prettier-plugin-tailwindcss)
sorts `class="…"` attributes. List both plugins (Tailwind last, per its docs):

```json
{ "plugins": ["prettier-plugin-razor2", "prettier-plugin-tailwindcss"] }
```

This applies only to the HTML: classes written inside C# (a `@code`/`@{ }` block
or a dynamic `class="@GetCss()"` value) are not sorted.

# Configuration

This library follows the same configuration format as Prettier, which is
documented [here](https://prettier.io/docs/en/configuration.html). It adds one
option:

| Option             | Default              | Description                                                                             |
| ------------------ | -------------------- | --------------------------------------------------------------------------------------- |
| `csharpierCommand` | `"dotnet csharpier"` | Command used to format embedded C# via CSharpier. Set to `""` to disable C# formatting. |

# Development

The plugin is written in TypeScript in `src/` and published as compiled
JavaScript in `dist/`.

    pnpm install        # install dependencies
    pnpm test           # run the test suite (node --test)
    pnpm typecheck      # type-check without emitting
    pnpm build          # compile src/ to dist/

Tests run the TypeScript sources directly via Node's native type stripping, so
no build step is required to develop or test. The C# tests need the CSharpier
CLI (`dotnet tool restore`); they skip automatically when it isn't available.
