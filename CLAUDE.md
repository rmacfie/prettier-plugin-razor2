# CLAUDE.md

Prettier v3 plugin that formats Razor files — `.razor` (Blazor components) and
`.cshtml` (MVC views / Razor Pages). Published as a compiled ESM package;
authored in TypeScript.

## Node version

The Node version is pinned via `devEngines` in `package.json` (currently
26.4.0). If the system `node` differs from the pinned version, **always invoke
Node through the pinned version** to match what `pnpm` scripts and CI use:

    pnpm run node <args>        # e.g. pnpm run node --test "tests/**/*.test.ts"

Do not pass a `--` separator — pnpm forwards it to Node and it breaks flags.
Just append args directly (`pnpm run node -e "..."`, `pnpm run node file.ts`).

## Commands

    pnpm test           # run the test suite (node --test on the .ts sources)
    pnpm typecheck      # type-check the whole project (base config is noEmit)
    pnpm build          # compile src/ -> dist/ (ESM + .d.ts)
    pnpm format         # prettier --write .

## TypeScript / build

- Source is TypeScript in `src/`; the published artifact is `dist/`
  (gitignored).
- Relative imports use explicit `.ts` extensions. Node runs the sources directly
  via native type stripping, and `tsc` rewrites the extensions to `.js` on build
  (`rewriteRelativeImportExtensions`).
- Keep source to type-erasable syntax only (`erasableSyntaxOnly` is on) so Node
  can execute it without transpiling — no enums, no parameter properties, etc.
- `noUncheckedIndexedAccess` is on: indexed access is `T | undefined`.
- Two tsconfigs: `tsconfig.json` type-checks the whole project (src + tests,
  `noEmit`); `tsconfig.dist.json` extends it to emit `src/ -> dist/` for
  `build`.

## Architecture

The strategy: **delegate HTML to Prettier's own HTML printer and C# to
CSharpier**; this plugin owns only the Razor layer between them. Full rationale
and the mask/format/restore pipeline are in [DESIGN.md](DESIGN.md).

- `src/index.ts` — plugin shape (`languages`, parser `razor`, printer
  `razor-ast`, the `csharpierCommand` option). The parser returns a trivial root
  node; all work happens in the printer's async `embed` hook (the only place a
  plugin may `await`).
- `src/format.ts` — the pipeline: `mask` the source → format the masked markup
  with Prettier HTML (`textToDoc(..., { parser: 'html' })` + `printDocToString`)
  → `restore` the masked constructs, recursing into control-block bodies.
- `src/scan.ts` — `mask()` plus the C#/markup-aware brace matching that finds
  each construct's extent. Block constructs (`@code`/`@{}`, control-flow blocks,
  line-start directives) become `<div data-razor="N"></div>` placeholders;
  inline constructs (explicit `@(…)`, `@* *@` comments) become private-use text
  tokens so they don't force a line break.
- `src/csharp.ts` — pipes C# through CSharpier (`dotnet csharpier`), stdin →
  stdout. Every failure falls back to verbatim C#: warns once per command if
  CSharpier isn't runnable; silent if it runs but rejects the input.

Implicit expressions, razor attributes, `@@`, emails, HTML comments and
components are NOT masked — Prettier handles them. Explicit `@(…)` expressions
and razor comments ARE masked (they can contain `<`/generics or HTML that
Prettier would mangle). Directives are only masked at the start of a line.

Because the HTML goes through Prettier's own `textToDoc`, plugins that override
the `html` parser (e.g. prettier-plugin-tailwindcss) compose with this one.

## Testing

- Tests live in `tests/*.test.ts`, grouped by area (a file per construct
  category, plus `csharpier-availability` and `plugin-composition`), sharing
  `tests/support.ts` (the `format` helper, `expectIdempotent`, CSharpier
  detection). Run with the built-in `node --test` runner (no Jest).
- The tests target _our_ mechanics — correctly finding the start/end of each
  construct and integrating cleanly — not whether Prettier/CSharpier format
  correctly (assume they do). Cover content preservation, brace/boundary edge
  cases, and idempotency (`format(format(x)) === format(x)`).
- C# tests require `dotnet csharpier` (installed here as `pnpm csharpier`). They
  detect its absence and `skip` (rather than fail) — check the run summary for
  skips if you don't have it.
- Add a test for every behavior change or bug fix.
- Every construct must round-trip: `format(format(x)) === format(x)`.

## Known limitations (not bugs to "fix" incidentally)

- Templated Razor delegates (`.cshtml`): `@<tag>…</tag>` (e.g.
  `@Repeat(items, @<li>@item.Name</li>)`) isn't recognized and reflows awkwardly
  (content preserved, idempotent, just ugly).
- Control-flow conditions and inline expressions aren't run through CSharpier;
  only `@code`/`@functions`/`@{ }` block bodies are.
- A construct whose body splits an HTML element across blocks
  (`@if(x){<tr>}…{</tr>}`) can't be delegated to the HTML formatter.
- Literal `{`/`}` in bare markup text may confuse brace matching.
- Brace matching skips C# strings/comments including raw strings (`"""…"""`),
  but an interpolated non-raw string with a nested string containing an
  unbalanced brace (`$"{(b ? "{" : "x")}"`) can still miscount — needs a full C#
  lexer, deemed not worth it.
- A block construct written with no surrounding whitespace (e.g.
  `<div>@{...}</div>`) stays inline — this mirrors Prettier's HTML whitespace
  sensitivity and is intentional.
