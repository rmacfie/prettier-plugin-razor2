# prettier-plugin-razor2

## Table of Contents

- [Getting Started](#getting-started)
- [Known limitations](#known-limitations)
- [Composing with other plugins](#composing-with-other-plugins)
- [Configuration](#configuration)
- [Development](#development)

## Description

A plugin for [Prettier](https://prettier.io) that adds support for Razor files —
`.razor` (Blazor components) and `.cshtml` (MVC views and Razor Pages).

It formats the HTML in a Razor file by delegating to Prettier's own HTML
formatter, and the C# in `@code`/`@functions`/`@{ }` blocks by delegating to
[CSharpier](https://csharpier.com). Control-flow blocks (`@if`, `@foreach`, …)
are re-indented in Allman style. Please try it out and provide feedback.

# Getting Started

Install the plugin and Prettier itself.

```sh
npm install --save-dev prettier prettier-plugin-razor2
```

Add to your Prettier config file:

```json
{
  "plugins": ["prettier-plugin-razor2"]
}
```

Optionally, disable the CSharpier integration to only format the HTML parts.

```json
{
  "plugins": ["prettier-plugin-razor2"],
  "csharpierEnabled": false
}
```

## C# formatting

C# formatting requires the [CSharpier](https://csharpier.com) CLI on your `PATH`
(`dotnet tool install csharpier`, invoked as `dotnet csharpier`). If it is not
available, C# is left untouched and a one-time warning is printed. Set
`csharpierEnabled: false` to disable C# formatting (and silence the warning), or
override the command with `csharpierCommand`.

# Known limitations

- `@switch` blocks with several cases: the bare `case X:` / `break;` lines are
  plain text to the HTML formatter, so consecutive arms can end up glued onto
  one line (`break; case Y:`). The output is stable and nothing is lost — it
  just isn't pretty yet.
- Templated Razor delegates (`.cshtml`), e.g.
  `@Repeat(items, @<li>@item.Name</li>)`, are preserved but not reformatted.

# Composing with other plugins

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
documented [here](https://prettier.io/docs/en/configuration.html). It adds two
options:

| Option             | Default              | Description                                                           |
| ------------------ | -------------------- | --------------------------------------------------------------------- |
| `csharpierEnabled` | `true`               | Format embedded C# with CSharpier. When `false`, C# is kept verbatim. |
| `csharpierCommand` | `"dotnet csharpier"` | Command used to invoke the CSharpier CLI.                             |

# Development

The plugin is written in TypeScript in `src/` and published as a single
[tsdown](https://tsdown.dev)-bundled file in `dist/`.

    pnpm install        # install dependencies
    pnpm test           # run the test suite (node --test)
    pnpm typecheck      # type-check without emitting
    pnpm build          # bundle src/ to dist/ with tsdown

Tests run the TypeScript sources directly via Node's native type stripping, so
no build step is required to develop or test. The C# tests need the CSharpier
CLI (`dotnet tool restore`); they skip automatically when it isn't available.

Releases: bump `version` in package.json, commit, tag `vX.Y.Z`, and
`git push --follow-tags` — GitHub Actions runs the checks and publishes to npm.

> **Fork notice** This project started as a fork of
> [prettier-plugin-razor](https://github.com/KristinaPlusPlus/prettier-plugin-razor),
> but has since been mostly rewritten.
