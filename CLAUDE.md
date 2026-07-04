# CLAUDE.md

Prettier v3 plugin that formats Razor / Blazor (`.razor`) files. Published as a
compiled ESM package; authored in TypeScript.

## Node version

The Node version is pinned via `devEngines` in `package.json` (currently
24.18.0). The system `node` on this machine is a different (newer) version, so
**always invoke Node through the pinned version** to match what `pnpm` scripts
and CI use:

    pnpm run node <args>        # e.g. pnpm run node --test "tests/**/*.test.ts"

Do not pass a `--` separator — pnpm forwards it to Node and it breaks flags.
Just append args directly (`pnpm run node -e "..."`, `pnpm run node file.ts`).

## Commands

    pnpm test           # run the test suite (node --test on the .ts sources)
    pnpm typecheck      # tsc --noEmit
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
  each construct's extent. Replaces `@code`/`@{}`, control-flow blocks and
  directive lines with `<div data-razor="N"></div>` placeholders.
- `src/csharp.ts` — pipes C# through CSharpier (`dotnet csharpier`), stdin →
  stdout, with a verbatim fallback on any failure.

Inline expressions, razor attributes, razor/HTML comments and components are NOT
masked — Prettier's HTML formatter handles them correctly on its own.

## Testing

- Tests live in `tests/*.test.ts`, run with the built-in `node --test` runner
  (no Jest). They assert exact formatted output (input string -> expected
  string); fixtures are in `tests/fixtures/`.
- C# tests require `dotnet csharpier` (installed here as `pnpm csharpier`). They
  detect its absence and `skip` (rather than fail) — check the run summary for
  skips if you don't have it.
- Add a test for every behavior change or bug fix.
- Every construct must round-trip: `format(format(x)) === format(x)`.

## Known limitations (not bugs to "fix" incidentally)

- Control-flow conditions and inline expressions aren't run through CSharpier;
  only `@code`/`@functions`/`@{ }` block bodies are.
- A construct whose body splits an HTML element across blocks
  (`@if(x){<tr>}…{</tr>}`) can't be delegated to the HTML formatter.
- Literal `{`/`}` in bare markup text may confuse brace matching.
- A block construct written with no surrounding whitespace (e.g.
  `<div>@{...}</div>`) stays inline — this mirrors Prettier's HTML whitespace
  sensitivity and is intentional.
