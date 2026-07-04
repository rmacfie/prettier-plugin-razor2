// Formats embedded C# by piping it through CSharpier (stdin -> stdout). Every
// failure falls back to verbatim C# (the caller keeps the original): if the
// command isn't runnable we warn once per command; if it runs but rejects the
// input we stay silent (often legitimate — e.g. markup inside a code block).

import { spawn } from 'node:child_process';
import * as path from 'node:path';

import type { Options } from 'prettier';

/**
 * The C# context a snippet lives in. `@code`/`@functions` bodies are class
 * members (must be wrapped in a class); `@{ }` bodies are statements (valid on
 * their own as top-level statements).
 */
export type CSharpKind = 'members' | 'statements';

/** Prettier options plus this plugin's own settings. */
export interface RazorOptions extends Options {
  csharpierCommand?: string;
}

const DEFAULT_COMMAND = 'dotnet csharpier';
const WRAPPER = '__CSharpierWrapper__';

type RunResult =
  | { ok: true; stdout: string }
  // The command could not be spawned (not on PATH, not executable, …).
  | { ok: false; kind: 'unavailable' }
  // The command ran but rejected the input (non-zero exit).
  | { ok: false; kind: 'rejected' };

// Spawn `command args` and write `input` to stdin.
function run(
  command: string,
  args: string[],
  input: string,
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', () => {});
    child.on('error', () => resolve({ ok: false, kind: 'unavailable' }));
    child.on('close', (code) =>
      resolve(
        code === 0 ? { ok: true, stdout } : { ok: false, kind: 'rejected' },
      ),
    );
    child.stdin.on('error', () => {}); // ignore EPIPE if the child dies early
    child.stdin.end(input);
  });
}

// Warn at most once per distinct command that CSharpier couldn't be run, so a
// misconfiguration is visible without spamming a line per file.
const warnedCommands = new Set<string>();
function warnUnavailable(command: string): void {
  if (warnedCommands.has(command)) return;
  warnedCommands.add(command);
  console.warn(
    `[prettier-plugin-razor2] Could not run CSharpier ("${command}"); leaving ` +
      `embedded C# unformatted. Install it (\`dotnet tool install csharpier\`) ` +
      `or set the "csharpierCommand" option to "" to disable C# formatting and ` +
      `silence this warning.`,
  );
}

// The first non-empty leading-whitespace run in `text` — CSharpier's indent
// unit (it honours .editorconfig, so we mirror whatever it produced).
function detectIndentUnit(text: string): string {
  for (const line of text.split('\n')) {
    const m = /^([ \t]+)\S/.exec(line);
    if (m) return m[1]!;
  }
  return '  ';
}

async function runCSharpier(
  code: string,
  options: RazorOptions,
): Promise<string | null> {
  const command = (options.csharpierCommand ?? DEFAULT_COMMAND).trim();
  if (command === '') return null; // explicitly disabled

  const parts = command.split(/\s+/);
  const exe = parts[0]!;
  const args = [...parts.slice(1), 'format', '--write-stdout'];
  // Give CSharpier an absolute path in the file's directory so it resolves the
  // project's .editorconfig / .csharpierrc. It rejects a relative path.
  if (options.filepath) {
    const dir = path.resolve(path.dirname(options.filepath));
    args.push('--stdin-path', path.join(dir, '__csharpier__.cs'));
  }

  const result = await run(exe, args, code);
  if (result.ok) return result.stdout;
  // Not installed/runnable: warn once (a likely misconfiguration). Rejected
  // input is left silent — it's frequently legitimate (e.g. markup inside a
  // code block) and indistinguishable from a real syntax error.
  if (result.kind === 'unavailable') warnUnavailable(command);
  return null;
}

/**
 * Format a C# snippet. Returns the formatted code (indented from column zero),
 * or `null` if CSharpier is unavailable/disabled or the code can't be parsed.
 */
export async function formatCSharp(
  code: string,
  kind: CSharpKind,
  options: RazorOptions,
): Promise<string | null> {
  const trimmed = code.trim();
  if (trimmed === '') return '';

  if (kind === 'statements') {
    const out = await runCSharpier(trimmed, options);
    return out === null ? null : out.replace(/\s+$/, '');
  }

  // Members aren't a valid compilation unit on their own; wrap in a class,
  // format, then extract and dedent the class body.
  const out = await runCSharpier(
    `class ${WRAPPER}\n{\n${trimmed}\n}\n`,
    options,
  );
  if (out === null) return null;

  const lines = out.replace(/\n+$/, '').split('\n');
  const open = lines.findIndex((line, i) => i > 0 && line.trim() === '{');
  if (open === -1) return null;
  let close = lines.length - 1;
  while (close > open && lines[close]!.trim() !== '}') close--;

  const unit = detectIndentUnit(out);
  const body = lines
    .slice(open + 1, close)
    .map((line) => (line.startsWith(unit) ? line.slice(unit.length) : line));
  while (body.length && body[0]!.trim() === '') body.shift();
  while (body.length && body[body.length - 1]!.trim() === '') body.pop();

  return body.join('\n');
}
