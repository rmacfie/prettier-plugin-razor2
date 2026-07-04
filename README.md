# prettier-plugin-razor2

<br>
<table>
  <tr>
    <td><img src="https://prettier.io/icon.png" alt="Prettier icon" width="128" height="128"></td>
    <td><img src="https://upload.wikimedia.org/wikipedia/commons/d/d0/Blazor.png" alt="Blazor icon" width="128" height="128"></td>
  </tr>
</table>
<br>

An opinionated formatter plugin for [Prettier](https://prettier.io) that adds
support for Razor files (Blazor code).

Prettier is an opinionated code formatter. It enforces a consistent style by
parsing your code and re-printing it, taking various rules into account.

> **Fork notice** This project is a fork of
> [prettier-plugin-razor](https://github.com/KristinaPlusPlus/prettier-plugin-razor)
> by Kristina Corrado. It is currently maintained by Robert Macfie.

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

Known limitation: templated Razor delegates (`.cshtml`), e.g.
`@Repeat(items, @<li>@item.Name</li>)`, are preserved but not reformatted.

Prettier [CLI usage docs](https://prettier.io/docs/en/cli.html)<br> Prettier
[API usage docs](https://prettier.io/docs/en/api.html)

# Configuration

This library follows the same configuration format as Prettier, which is
documented [here](https://prettier.io/docs/en/configuration.html). However, at
this time, there are no configuration options enabled.

# Development

The plugin is written in TypeScript in `src/` and published as compiled
JavaScript in `dist/`.

    pnpm install        # install dependencies
    pnpm test           # run the test suite (node --test)
    pnpm typecheck      # type-check without emitting
    pnpm build          # compile src/ to dist/

Tests run the TypeScript sources directly via Node's native type stripping, so
no build step is required to develop or test.
