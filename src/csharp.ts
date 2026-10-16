// Formats embedded C# by piping it through CSharpier (stdin -> stdout). Every
// failure falls back to verbatim C# (the caller keeps the original): if no
// command can launch we warn once per candidate list; if CSharpier runs but
// rejects the input we stay silent (often legitimate — e.g. markup inside a
// code block).

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
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
  /** Format embedded C# with CSharpier; when false it is kept verbatim. */
  csharpierEnabled?: boolean;
  /** Command used to invoke the CSharpier CLI. */
  csharpierCommand?: string;
}

/**
 * A command to run, split once. Never re-split later: paths may contain spaces
 * (`C:\Users\John Doe`), which string commands would tear apart.
 */
export interface Command {
  file: string;
  args: string[];
}

const DEFAULT_COMMAND: Command = { file: 'dotnet', args: ['csharpier'] };
const WRAPPER = '__CSharpierWrapper__';

// CSharpier's pipe-files protocol: requests are `path \u0003 content \u0003`
// on stdin; each response is the formatted content followed by `\u0003` on
// stdout. Rejected input yields an empty response (details go to stderr).
const EOT = '\u0003';

// A per-request safety valve so a wedged server can't hang Prettier forever.
const REQUEST_TIMEOUT_MS = 10_000;

// How many consecutive pre-answer deaths of a proven candidate (crash or
// timeout) to tolerate before treating it as a launch failure.
const PRE_ANSWER_DEATHS_TO_ESCALATE = 3;

// Kill every live pipe-files child when the process exits so no dotnet
// process is orphaned. One process-level listener; children register below.
const liveChildren = new Set<ChildProcessWithoutNullStreams>();
process.on('exit', () => {
  for (const child of liveChildren) child.kill();
});

function commandToString(command: Command): string {
  return [command.file, ...command.args].join(' ');
}

/**
 * A persistent `csharpier pipe-files` process. Spawning `dotnet csharpier`
 * costs ~200 ms (runtime + Roslyn startup); keeping one warm process reduces
 * every call after the first to a couple of milliseconds. Requests are
 * serialized (the protocol is sequential over one pipe), and the child is
 * unref'ed while idle so it never keeps the Node process alive.
 */
class CSharpierServer {
  private readonly candidates: Command[];
  /** The child's cwd — a manifest folder (see {@link resolveLaunch}). */
  private readonly cwd: string;
  private candidateIndex = 0;
  private child: ChildProcessWithoutNullStreams | null = null;
  private available = true;
  private stdoutBuf = '';
  private stderrTail = '';
  /** The most recent child was killed by our request timeout. */
  private killedByTimeout = false;
  /**
   * Candidates that have produced at least one answer from this launch context
   * (cwd + command). Proven per server, not per command string: a command that
   * launches from one manifest folder may not launch from another.
   */
  private readonly proven = new Set<string>();
  /**
   * Consecutive processes of a proven candidate that died before answering
   * (crash or our own timeout kill), reset by any answer. A proven command can
   * still go stale — e.g. a pull bumps the pinned CSharpier version and the
   * manifest now needs `dotnet tool restore`, so every new process exits before
   * answering. A streak of such deaths escalates to a launch failure instead of
   * respawning silently on every save forever.
   */
  private readonly preAnswerDeaths = new Map<string, number>();
  /** The last request's child failed to launch (the retry in `format`). */
  private lastLaunchFailed = false;
  private pendingResolve: ((payload: string | null) => void) | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(candidates: Command[], cwd: string) {
    this.candidates = candidates;
    this.cwd = cwd;
  }

  /** Format one snippet; null when unavailable or the input was rejected. */
  format(filePath: string, content: string): Promise<string | null> {
    // The retry calls `request` directly (not via the queue): it runs inside
    // the queue slot this very call occupies, so re-entering `queue` would
    // wait on the task that is waiting on the retry — a deadlock.
    const task = this.queue
      .then(() => this.request(filePath, content))
      .then((out) =>
        // A launch failure advanced to the next candidate; retry so the
        // first save isn't left unformatted.
        out === null && this.lastLaunchFailed && this.available
          ? this.request(filePath, content)
          : out,
      );
    // Keep the chain alive even if a request fails.
    this.queue = task.catch(() => null);
    return task;
  }

  private spawnChild(): void {
    const candidate = this.candidates[this.candidateIndex]!;
    const commandKey = commandToString(candidate);
    const child = spawn(candidate.file, [...candidate.args, 'pipe-files'], {
      stdio: 'pipe',
      cwd: this.cwd,
    });
    this.child = child;
    this.stdoutBuf = '';
    this.stderrTail = ''; // fresh process: report its stderr, not the last's
    this.killedByTimeout = false;
    let responded = false; // this child produced at least one response
    let failed = false; // this child was already handled as a launch failure

    child.stdout.on('data', (chunk) => {
      this.stdoutBuf += chunk;
      const end = this.stdoutBuf.indexOf(EOT);
      if (end !== -1 && this.pendingResolve) {
        responded = true;
        // Once a candidate has answered at all, it's trusted in this launch
        // context — a later process of it dying before its first answer is a
        // transient crash (e.g. bad input), not a launch failure — and any
        // streak of such deaths is broken.
        this.proven.add(commandKey);
        this.preAnswerDeaths.delete(commandKey);
        const payload = this.stdoutBuf.slice(0, end);
        this.stdoutBuf = this.stdoutBuf.slice(end + EOT.length);
        // Empty response = CSharpier rejected the input.
        this.settle(payload === '' ? null : payload);
      }
    });
    child.stderr.on('data', (chunk) => {
      // Keep the tail: the dotnet muxer reports tool-resolution failures
      // only on stderr, and it goes into the "could not run" warning.
      this.stderrTail = (this.stderrTail + chunk.toString()).slice(-500);
    });
    child.stdin.on('error', () => {}); // EPIPE when the child dies mid-write
    const launchFailed = () => {
      if (failed) return;
      failed = true;
      if (this.child === child) this.child = null;
      liveChildren.delete(child);
      this.advanceCandidate();
      this.settle(null);
    };
    child.on('error', launchFailed);
    child.on('close', () => {
      liveChildren.delete(child);
      if (failed) return; // already handled as a launch failure
      // Exited before ever answering — not our own timeout kill, and the
      // candidate has never proven itself in this launch context: it didn't
      // launch (e.g. the muxer ran but found no tool). A proven candidate
      // that dies early is a transient crash — unless it starts happening
      // every save, see below.
      if (!responded && !this.killedByTimeout && !this.proven.has(commandKey)) {
        launchFailed();
        return;
      }
      // A process that dies before answering (crash or our own timeout kill)
      // is normally transient: fail the in-flight request; a later request
      // respawns. But a streak of them means the command went stale (e.g.
      // the manifest now needs `dotnet tool restore`), so after a few in a
      // row escalate to a launch failure instead of respawning silently
      // forever. Any answer resets the streak.
      if (!responded) {
        const deaths = (this.preAnswerDeaths.get(commandKey) ?? 0) + 1;
        if (deaths >= PRE_ANSWER_DEATHS_TO_ESCALATE) {
          launchFailed();
          return;
        }
        this.preAnswerDeaths.set(commandKey, deaths);
      }
      // Unexpected exit mid-session: fail the in-flight request; a later
      // request respawns. Never touch a newer child that has replaced us.
      if (this.child === child) {
        this.child = null;
        this.settle(null);
      }
    });

    // Never keep the Node process alive while idle.
    this.idle();
    liveChildren.add(child);
  }

  private advanceCandidate(): void {
    this.candidateIndex++;
    if (this.candidateIndex >= this.candidates.length) {
      this.available = false;
      warnUnavailable(this.candidates, this.stderrTail);
      return;
    }
    this.lastLaunchFailed = true;
  }

  private request(filePath: string, content: string): Promise<string | null> {
    if (!this.available) return Promise.resolve(null);
    this.lastLaunchFailed = false;
    if (!this.child) this.spawnChild();
    const child = this.child;
    if (!child || !this.available) return Promise.resolve(null);

    return new Promise((resolve) => {
      this.busy();
      const timeout = setTimeout(() => {
        // Wedged server: kill it (close handler fails this request) and let
        // the next request start a fresh one. Never a launch failure — the
        // command itself may be fine, just slow or stuck.
        this.killedByTimeout = true;
        child.kill();
      }, REQUEST_TIMEOUT_MS);
      timeout.unref();
      // Only one request is ever in flight — `format` serializes via `queue`.
      this.pendingResolve = (payload: string | null) => {
        clearTimeout(timeout);
        resolve(payload);
      };
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

// One server per launch context (manifest folder) and candidate list.
const servers = new Map<string, CSharpierServer>();
function serverFor(launch: LaunchCwd, candidates: Command[]): CSharpierServer {
  const key =
    launch.key + '\u0001' + candidates.map(commandToString).join('\u0000');
  let server = servers.get(key);
  if (!server) {
    server = new CSharpierServer(candidates, launch.cwd);
    servers.set(key, server);
  }
  return server;
}

// Warn at most once per distinct candidate list that CSharpier couldn't be
// run, so a misconfiguration is visible without spamming a line per file.
const warnedCommands = new Set<string>();
function warnUnavailable(candidates: Command[], stderrTail: string): void {
  const key = candidates.map(commandToString).join('\u0000');
  if (warnedCommands.has(key)) return;
  warnedCommands.add(key);
  const tried = candidates.map((c) => `"${commandToString(c)}"`).join(', ');
  const lastLine = stderrTail.trim().split('\n').pop() ?? '';
  const detail = lastLine ? ` Last stderr: ${lastLine}` : '';
  console.warn(
    `[prettier-plugin-razor2] Could not run CSharpier (${tried}); leaving ` +
      `embedded C# unformatted.${detail} Install it ` +
      `(\`dotnet tool install csharpier\`) or set the "csharpierEnabled" ` +
      `option to false to disable C# formatting and silence this warning.`,
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

// Resolve the csharpier options to a command, or null when disabled. Only the
// user's `csharpierCommand` string is split — and it may not name a .cmd/.bat
// file, which Node cannot start without a shell.
function resolveCommand(options: RazorOptions): Command | null {
  if (options.csharpierEnabled === false) return null;
  const raw = options.csharpierCommand?.trim();
  if (raw === undefined) return DEFAULT_COMMAND;
  if (raw === '') return null; // explicitly disabled
  const parts = raw.split(/\s+/);
  return { file: parts[0]!, args: parts.slice(1) };
}

/**
 * The commands tried, in order, for the default command. A globally installed
 * CSharpier is reached only through its binary: `dotnet csharpier` resolves the
 * tool via a manifest near the cwd (or a `dotnet-csharpier` shim on the PATH),
 * neither of which editors reliably provide — they run formatters from their
 * own cwd (VS Code's Prettier extension uses `/`). The global tool binary is an
 * apphost that runs from any cwd. `platform` is a parameter so the Windows
 * `.exe` suffix is testable on any OS.
 */
export function defaultCommandCandidates(
  platform: NodeJS.Platform = process.platform,
): Command[] {
  const candidates = [DEFAULT_COMMAND];
  const cliHome = process.env['DOTNET_CLI_HOME'] || os.homedir();
  const exe = platform === 'win32' ? 'csharpier.exe' : 'csharpier';
  const file = path.join(cliHome, '.dotnet', 'tools', exe);
  if (fs.existsSync(file)) candidates.push({ file, args: [] });
  return candidates;
}

// The nearest ancestor of `dir` holding a tool manifest, or null. Deliberately
// uncached: a manifest added or moved during an editor session is picked up
// on the next format. The walk mirrors what `dotnet` itself does to resolve
// `dotnet csharpier`, so it can't disagree with the muxer.
function nearestManifestDir(dir: string): string | null {
  for (let cur = dir; ; cur = path.dirname(cur)) {
    if (
      fs.existsSync(path.join(cur, 'dotnet-tools.json')) ||
      fs.existsSync(path.join(cur, '.config', 'dotnet-tools.json'))
    ) {
      return cur;
    }
    const parent = path.dirname(cur);
    if (parent === cur) return null; // reached the filesystem root
  }
}

interface LaunchCwd {
  /** Server-identity key: one warm process per manifest folder. */
  key: string;
  cwd: string;
}

/**
 * Where the csharpier child runs: the nearest manifest folder above the file,
 * or the process cwd when there is none. Editors run formatters from their own
 * cwd (VS Code's Prettier extension uses `/`), from which the dotnet muxer's
 * upward manifest search finds nothing; running from the manifest folder
 * resolves the project's pinned tool version. Keying on the manifest folder
 * gives one warm process per project and tool-version isolation between them (a
 * shared child has a single cwd). Both candidate cwds always exist, so a file
 * in a missing directory (untitled/virtual documents) can't fail the spawn. The
 * prettier config folder is deliberately NOT used as the anchor: it marks a
 * prettier boundary, not a .NET one — a monorepo with `.prettierrc` at the root
 * and the manifest in a sub-project would resolve nothing from the root.
 */
function resolveLaunch(fileDir: string): LaunchCwd {
  const manifestDir = nearestManifestDir(fileDir);
  if (manifestDir !== null) {
    return { key: 'manifest\u0000' + manifestDir, cwd: manifestDir };
  }
  return { key: 'no-manifest', cwd: process.cwd() };
}

async function runCSharpier(
  code: string,
  options: RazorOptions,
): Promise<string | null> {
  const command = resolveCommand(options);
  if (command === null) return null; // integration disabled

  // The request path sits in the source file's directory so CSharpier
  // resolves the project's .editorconfig / .csharpierrc per request.
  const dir = options.filepath
    ? path.resolve(path.dirname(options.filepath))
    : process.cwd();
  const requestPath = path.join(dir, '__csharpier__.cs');
  // Only the default gets fallbacks: silently substituting a user-specified
  // command would hide their misconfiguration.
  const candidates =
    commandToString(command) === commandToString(DEFAULT_COMMAND)
      ? defaultCommandCandidates()
      : [command];
  const launch = resolveLaunch(dir);
  return serverFor(launch, candidates).format(requestPath, code);
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
