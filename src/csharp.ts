// Formats embedded C# by piping it through CSharpier (stdin -> stdout). On any
// failure (CSharpier missing, disabled, or a syntax it can't parse) the caller
// falls back to keeping the C# verbatim.

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

// Spawn `command args`, write `input` to stdin, resolve stdout on success or
// null on any failure (non-zero exit, spawn error such as ENOENT).
function run(
  command: string,
  args: string[],
  input: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', () => {});
    child.on('error', () => resolve(null));
    child.on('close', (code) => resolve(code === 0 ? stdout : null));
    child.stdin.on('error', () => {}); // ignore EPIPE if the child dies early
    child.stdin.end(input);
  });
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
  return run(exe, args, code);
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
