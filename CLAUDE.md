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
    pnpm example        # format example.razor with the plugin (stdout)

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

Standard Prettier plugin shape in `src/index.ts`: `languages`, `parsers` (parser
name `razor`), `printers` (astFormat `razor-ast`).

- `src/parse.ts` — regex-based tokenizer/parser (adapted from
  html-parse-stringify2). Returns a `RootNode`. Everything from `@code {` to EOF
  is captured verbatim as a text node — C# is out of scope for this plugin.
- `src/parse-tag.ts` / `src/parse-code.ts` — tokenize a single tag / Razor
  token.
- `src/print.ts` — the printer. Recurses via `path.map` and the `print` callback
  and builds output with Prettier's Doc builders (idiomatic v3).
- `src/ast.ts` — the discriminated-union AST
  (`RootNode | TagNode | TextNode | CodeNode | CommentNode`).

## Testing

- Tests live in `tests/*.test.ts`, run with the built-in `node --test` runner
  (no Jest). They assert exact formatted output (input string -> expected
  string); fixtures are in `tests/fixtures/`.
- Add a test for every behavior change or bug fix.

## Known limitations (not bugs to "fix" incidentally)

- The parser is regex-based and fragile; it is not a full Razor grammar.
- Attribute lists are not wrapped to `printWidth`.
- A text node immediately following a block element can glue to the preceding
  close tag. Preserve existing behavior unless explicitly asked to change it.
