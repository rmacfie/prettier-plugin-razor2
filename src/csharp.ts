// Formats embedded C# by piping it through CSharpier (stdin -> stdout). Every
// failure falls back to verbatim C# (the caller keeps the original): if the
// command isn't runnable we warn once per command; if it runs but rejects the
// input we stay silent (often legitimate — e.g. markup inside a code block).

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as path from 'node:path';

import type { Options } from 'prettier';

import { linesInsideCSharpStrings } from './scan.ts';

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

// CSharpier's pipe-files protocol: requests are `path \u0003 content \u0003`
// on stdin; each response is the formatted content followed by `\u0003` on
// stdout. Rejected input yields an empty response (details go to stderr).
const EOT = '\u0003';

// A per-request safety valve so a wedged server can't hang Prettier forever.
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * A persistent `csharpier pipe-files` process. Spawning `dotnet csharpier`
 * costs ~200 ms (runtime + Roslyn startup); keeping one warm process reduces
 * every call after the first to a couple of milliseconds. Requests are
 * serialized (the protocol is sequential over one pipe), and the child is
 * unref'ed while idle so it never keeps the Node process alive.
 */
class CSharpierServer {
  private readonly command: string;
  private child: ChildProcessWithoutNullStreams | null = null;
  private available = true;
  private stdoutBuf = '';
  private pendingResolve: ((payload: string | null) => void) | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(command: string) {
    this.command = command;
  }

  /** Format one snippet; null when unavailable or the input was rejected. */
  format(filePath: string, content: string): Promise<string | null> {
    const task = this.queue.then(() => this.request(filePath, content));
    // Keep the chain alive even if a request fails.
    this.queue = task.catch(() => null);
    return task;
  }

  private spawnChild(): void {
    const parts = this.command.split(/\s+/);
    const child = spawn(parts[0]!, [...parts.slice(1), 'pipe-files'], {
      stdio: 'pipe',
    });
    this.child = child;
    this.stdoutBuf = '';

    child.stdout.on('data', (chunk) => {
      this.stdoutBuf += chunk;
      const end = this.stdoutBuf.indexOf(EOT);
      if (end !== -1 && this.pendingResolve) {
        const payload = this.stdoutBuf.slice(0, end);
        this.stdoutBuf = this.stdoutBuf.slice(end + EOT.length);
        // Empty response = CSharpier rejected the input.
        this.settle(payload === '' ? null : payload);
      }
    });
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {}); // EPIPE when the child dies mid-write
    child.on('error', () => {
      // Could not spawn at all (not on PATH, …).
      this.available = false;
      this.child = null;
      warnUnavailable(this.command);
      this.settle(null);
    });
    child.on('close', () => {
      // Unexpected exit: fail the in-flight request; a later request respawns.
      this.child = null;
      this.settle(null);
    });

    // Never keep the Node process alive while idle; kill on exit so no orphan
    // dotnet process lingers.
    this.idle();
    process.on('exit', () => child.kill());
  }

  private request(filePath: string, content: string): Promise<string | null> {
    if (!this.available) return Promise.resolve(null);
    if (!this.child) this.spawnChild();
    const child = this.child;
    if (!child || !this.available) return Promise.resolve(null);

    return new Promise((resolve) => {
      this.pendingResolve = resolve;
      this.busy();
      const timeout = setTimeout(() => {
        // Wedged server: kill it (close handler fails this request); the next
        // request starts a fresh one.
        child.kill();
      }, REQUEST_TIMEOUT_MS);
      timeout.unref();
      const done = (payload: string | null) => {
        clearTimeout(timeout);
        resolve(payload);
      };
      this.pendingResolve = done;
      child.stdin.write(filePath + EOT + content + EOT);
    });
  }

  private settle(payload: string | null): void {
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    this.idle();
    if (resolve) resolve(payload);
  }

  // Hold the event loop only while a request is in flight. The stdio pipes are
  // sockets at runtime, but typed as plain streams — hence the cast.
  private setLoopHold(hold: boolean): void {
    const child = this.child;
    if (!child) return;
    const handles = [child, child.stdout, child.stdin, child.stderr] as Array<{
      ref?: () => void;
      unref?: () => void;
    }>;
    for (const handle of handles) {
      if (hold) handle.ref?.();
      else handle.unref?.();
    }
  }
  private busy(): void {
    this.setLoopHold(true);
  }
  private idle(): void {
    this.setLoopHold(false);
  }
}

// One server per distinct command string.
const servers = new Map<string, CSharpierServer>();
function serverFor(command: string): CSharpierServer {
  let server = servers.get(command);
  if (!server) {
    server = new CSharpierServer(command);
    servers.set(command, server);
  }
  return server;
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

  // An absolute path in the source file's directory so CSharpier resolves the
  // project's .editorconfig / .csharpierrc per request.
  const dir = options.filepath
    ? path.resolve(path.dirname(options.filepath))
    : process.cwd();
  return serverFor(command).format(path.join(dir, '__csharpier__.cs'), code);
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

  const trimmedOut = out.replace(/\n+$/, '');
  const lines = trimmedOut.split('\n');
  const open = lines.findIndex((line, i) => i > 0 && line.trim() === '{');
  if (open === -1) return null;
  let close = lines.length - 1;
  while (close > open && lines[close]!.trim() !== '}') close--;

  // Don't dedent lines inside multi-line string literals — their leading
  // whitespace is string content.
  const insideString = linesInsideCSharpStrings(trimmedOut);
  const unit = detectIndentUnit(out);
  const body = lines
    .slice(open + 1, close)
    .map((line, k) =>
      !insideString.has(open + 1 + k) && line.startsWith(unit)
        ? line.slice(unit.length)
        : line,
    );
  while (body.length && body[0]!.trim() === '') body.shift();
  while (body.length && body[body.length - 1]!.trim() === '') body.pop();

  return body.join('\n');
}
