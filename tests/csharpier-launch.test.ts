// How the plugin launches CSharpier: which folder the child runs from (the
// nearest tool manifest above the file — editors themselves run formatters
// from `/`), the fallback to the global tool binary, and what counts as a
// launch failure. The fake-executable scenarios use shebang scripts in temp dirs, so
// they skip on Windows; the candidates test passes the platform in and runs
// everywhere. Each test formats files in its own manifest folder, so every
// test gets its own warm process (the servers map is per process).

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import { defaultCommandCandidates } from '../src/csharp.ts';
import { format } from './support.ts';

// The dotnet muxer's tool-resolution failure: it runs, but can't resolve the
// `csharpier` tool, and reports that only on stderr.
const MUXER_FAILURE =
  'process.stderr.write(' +
  "'Could not execute because the specified command or file was not found.\\n'" +
  ');\nprocess.exit(1);\n';

// A stand-in csharpier speaking the pipe-files protocol (`path \u0003 content
// \u0003` -> `response \u0003`). It stamps its cwd into the C# (before the
// wrapper class's closing brace, so the plugin keeps it), which proves both
// that it ran and from where. `exitAfterFirst` crashes the process after the
// first response, with a marker file written on exit.
const PIPE_FILES_FAKE = `
  const EOT = '\\u0003';
  const marker = process.env['FAKE_EXIT_MARKER'];
  let buf = '';
  let served = 0;
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    const first = buf.indexOf(EOT);
    if (first === -1) return;
    const second = buf.indexOf(EOT, first + 1);
    if (second === -1) return;
    const content = buf.slice(first + 1, second);
    buf = buf.slice(second + 1);
    const close = content.lastIndexOf('}');
    const response =
      content.slice(0, close) + '// CWD ' + process.cwd() + '\\n' +
      content.slice(close);
    served++;
    if (marker && served === 1) {
      process.on('exit', () => {
        try { require('node:fs').writeFileSync(marker, 'x'); } catch {}
      });
      // Crash after the answer, deterministically: exit once the response
      // has been flushed, never on a wall-clock timer (a slow runner could
      // kill the process before it ever answered).
      process.stdout.write(response + EOT, () => process.exit(1));
      return;
    }
    process.stdout.write(response + EOT);
  });
`;

// The shebang scripts require a POSIX shell to run.
const skipOnWindows =
  process.platform === 'win32'
    ? 'fake executables (shebang scripts) need a POSIX shell'
    : false;

// Capture console.warn for the duration of `fn`.
async function captureWarnings(fn: () => Promise<void>): Promise<string[]> {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };
  try {
    await fn();
  } finally {
    console.warn = original;
  }
  return warnings.filter((w) => w.includes('CSharpier'));
}

// An executable node script with an absolute shebang, so it runs even with a
// gutted PATH.
function writeExecutable(dir: string, name: string, code: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!${process.execPath}\n${code}`);
  fs.chmodSync(file, 0o755);
  return file;
}

async function waitUntil(cond: () => boolean, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

// A per-test scratch root with a manifest folder (and a fake `dotnet` in
// `bin` when `withDotnet` is set) and a fake global csharpier under
// `cli-home/.dotnet/tools` when `withFallback` is set.
function scratch(
  name: string,
  opts: {
    dotnet?: 'failing' | 'working';
    fallback?: boolean;
    withManifest?: boolean;
  } = {},
): { root: string; manifestDir: string; bin: string; cliHome: string } {
  // Realpath so expected cwds match what a child's process.cwd() reports
  // (macOS's /var -> /private/var symlink).
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), `razor2-${name}-`),
  );
  const manifestDir = path.join(root, 'repo');
  fs.mkdirSync(manifestDir);
  if (opts.withManifest !== false) {
    fs.writeFileSync(
      path.join(manifestDir, 'dotnet-tools.json'),
      '{ "version": 1, "isRoot": true, "tools": {} }\n',
    );
  }
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  if (opts.dotnet === 'failing') {
    writeExecutable(bin, 'dotnet', MUXER_FAILURE);
  }
  if (opts.fallback) {
    const tools = path.join(root, 'cli-home', '.dotnet', 'tools');
    fs.mkdirSync(tools, { recursive: true });
    writeExecutable(tools, 'csharpier', PIPE_FILES_FAKE);
  }
  return {
    root,
    manifestDir,
    bin,
    cliHome: path.join(root, 'cli-home'),
  };
}

// Run `fn` with PATH, DOTNET_CLI_HOME and any extra env overridden (restored
// afterwards).
async function withLaunchEnv(
  s: { bin: string; cliHome: string },
  fn: () => Promise<void>,
  extraEnv: Record<string, string> = {},
): Promise<void> {
  const prevPath = process.env['PATH'];
  const prevHome = process.env['DOTNET_CLI_HOME'];
  const prevExtra = new Map(
    Object.keys(extraEnv).map((k) => [k, process.env[k]]),
  );
  process.env['PATH'] = s.bin;
  process.env['DOTNET_CLI_HOME'] = s.cliHome;
  for (const [k, v] of Object.entries(extraEnv)) process.env[k] = v;
  try {
    await fn();
  } finally {
    process.env['PATH'] = prevPath;
    process.env['DOTNET_CLI_HOME'] = prevHome;
    for (const [k, v] of prevExtra) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// A razor source with a C# block; `filepath` puts it in a manifest folder.
const SOURCE = '@code {\npublic int X { get; set; }\n}';

test(
  'falls back to the global tool binary when dotnet is not on PATH',
  { skip: skipOnWindows },
  async () => {
    const s = scratch('enoent-fallback', { fallback: true });
    try {
      let out = '';
      const warnings = await captureWarnings(async () => {
        await withLaunchEnv(s, async () => {
          out = await format(SOURCE, {
            filepath: path.join(s.manifestDir, 'Component.razor'),
          });
        });
      });
      // The fallback served the request (stamped) and never warned.
      assert.ok(out.includes('// CWD'), out);
      assert.equal(warnings.length, 0);
    } finally {
      fs.rmSync(s.root, { recursive: true, force: true });
    }
  },
);

test(
  'falls back when the dotnet muxer runs but cannot resolve the tool',
  { skip: skipOnWindows },
  async () => {
    const s = scratch('muxer-fallback', { dotnet: 'failing', fallback: true });
    try {
      let out = '';
      const warnings = await captureWarnings(async () => {
        await withLaunchEnv(s, async () => {
          out = await format(SOURCE, {
            filepath: path.join(s.manifestDir, 'Component.razor'),
          });
        });
      });
      assert.ok(out.includes('// CWD'), out);
      assert.equal(warnings.length, 0);
    } finally {
      fs.rmSync(s.root, { recursive: true, force: true });
    }
  },
);

test(
  'warns once, with stderr, when every candidate fails',
  { skip: skipOnWindows },
  async () => {
    // No fallback installed (cliHome doesn't exist): only the default runs,
    // and the fake muxer can't resolve the tool.
    const s = scratch('all-fail', { dotnet: 'failing' });
    try {
      let out = '';
      const warnings = await captureWarnings(async () => {
        await withLaunchEnv(s, async () => {
          out = await format(SOURCE, {
            filepath: path.join(s.manifestDir, 'Component.razor'),
          });
          await format(SOURCE, {
            filepath: path.join(s.manifestDir, 'Other.razor'),
          });
        });
      });
      // C# left verbatim; one warning carrying the muxer's stderr.
      assert.equal(out, SOURCE + '\n');
      assert.equal(warnings.length, 1);
      assert.match(warnings[0]!, /Could not run CSharpier/);
      assert.match(warnings[0]!, /Could not execute/);
    } finally {
      fs.rmSync(s.root, { recursive: true, force: true });
    }
  },
);

test(
  'a user-specified command gets no fallback',
  { skip: skipOnWindows },
  async () => {
    // A fallback exists but must not be used for a custom command.
    const s = scratch('custom', { fallback: true });
    try {
      let out = '';
      const warnings = await captureWarnings(async () => {
        await withLaunchEnv(s, async () => {
          out = await format(SOURCE, {
            filepath: path.join(s.manifestDir, 'Component.razor'),
            csharpierCommand: 'no-such-dotnet-xyz',
          });
        });
      });
      assert.equal(out, SOURCE + '\n');
      assert.equal(warnings.length, 1);
      assert.match(warnings[0]!, /no-such-dotnet-xyz/);
    } finally {
      fs.rmSync(s.root, { recursive: true, force: true });
    }
  },
);

test(
  'a file in a manifest folder is formatted from that folder',
  { skip: skipOnWindows },
  async () => {
    // A working fake `dotnet` stamps its cwd into the response: it must be
    // the manifest folder, not the editor's cwd.
    const s = scratch('manifest');
    writeExecutable(s.bin, 'dotnet', PIPE_FILES_FAKE);
    try {
      let out = '';
      await withLaunchEnv(s, async () => {
        out = await format(SOURCE, {
          filepath: path.join(s.manifestDir, 'Component.razor'),
        });
      });
      assert.ok(out.includes('// CWD ' + s.manifestDir), out);
    } finally {
      fs.rmSync(s.root, { recursive: true, force: true });
    }
  },
);

test(
  'two manifest folders each use their own process',
  { skip: skipOnWindows },
  async () => {
    const s = scratch('two-manifests');
    const otherDir = path.join(s.root, 'repo-b');
    fs.mkdirSync(otherDir);
    fs.writeFileSync(
      path.join(otherDir, 'dotnet-tools.json'),
      '{ "version": 1, "isRoot": true, "tools": {} }\n',
    );
    writeExecutable(s.bin, 'dotnet', PIPE_FILES_FAKE);
    try {
      let outA = '';
      let outB = '';
      await withLaunchEnv(s, async () => {
        outA = await format(SOURCE, {
          filepath: path.join(s.manifestDir, 'A.razor'),
        });
        outB = await format(SOURCE, {
          filepath: path.join(otherDir, 'B.razor'),
        });
      });
      // Each file was served by a process running in its own manifest
      // folder (one warm process per manifest, not one for both).
      assert.ok(outA.includes('// CWD ' + s.manifestDir), outA);
      assert.ok(outB.includes('// CWD ' + otherDir), outB);
    } finally {
      fs.rmSync(s.root, { recursive: true, force: true });
    }
  },
);

test(
  'a missing directory does not disable C# formatting',
  { skip: skipOnWindows },
  async () => {
    // Untitled/virtual documents have a filepath in a directory that doesn't
    // exist; a spawn from there would fail and disable formatting. With no
    // manifest to anchor on, the child runs from the process cwd — which
    // always exists.
    const s = scratch('missing-dir', { withManifest: false });
    writeExecutable(s.bin, 'dotnet', PIPE_FILES_FAKE);
    try {
      let out = '';
      await withLaunchEnv(s, async () => {
        out = await format(SOURCE, {
          filepath: path.join(s.root, 'missing', 'Component.razor'),
        });
      });
      assert.ok(out.includes('// CWD ' + process.cwd()), out);
    } finally {
      fs.rmSync(s.root, { recursive: true, force: true });
    }
  },
);

test(
  'a fallback path containing a space works',
  { skip: skipOnWindows },
  async () => {
    // Commands are { file, args }, never re-split strings: a DOTNET_CLI_HOME
    // with a space must still spawn the fallback binary.
    const s = scratch('space');
    const tools = path.join(s.root, 'My Home', '.dotnet', 'tools');
    fs.mkdirSync(tools, { recursive: true });
    writeExecutable(tools, 'csharpier', PIPE_FILES_FAKE);
    try {
      let out = '';
      const warnings = await captureWarnings(async () => {
        await withLaunchEnv(
          { bin: s.bin, cliHome: path.join(s.root, 'My Home') },
          async () => {
            out = await format(SOURCE, {
              filepath: path.join(s.manifestDir, 'Component.razor'),
            });
          },
        );
      });
      assert.ok(out.includes('// CWD'), out);
      assert.equal(warnings.length, 0);
    } finally {
      fs.rmSync(s.root, { recursive: true, force: true });
    }
  },
);

test(
  'a crash after answering does not disable C# formatting',
  { skip: skipOnWindows },
  async () => {
    const s = scratch('crash', { fallback: true });
    const marker = path.join(s.root, 'crashed');
    try {
      let out1 = '';
      let out2 = '';
      const warnings = await captureWarnings(async () => {
        await withLaunchEnv(
          { bin: s.bin, cliHome: s.cliHome },
          async () => {
            out1 = await format(SOURCE, {
              filepath: path.join(s.manifestDir, 'Component.razor'),
            });
            // Wait for the fake to crash after its first answer.
            await waitUntil(() => fs.existsSync(marker));
            out2 = await format(SOURCE, {
              filepath: path.join(s.manifestDir, 'Other.razor'),
            });
          },
          { FAKE_EXIT_MARKER: marker },
        );
      });
      // Both requests were served (the second by a fresh process) and no
      // launch-failure warning fired: a crash after answering respawns.
      assert.ok(out1.includes('// CWD'), out1);
      assert.ok(out2.includes('// CWD'), out2);
      assert.equal(warnings.length, 0);
    } finally {
      fs.rmSync(s.root, { recursive: true, force: true });
    }
  },
);

test(
  'a proven command whose next process crashes before answering is not a launch failure',
  { skip: skipOnWindows },
  async () => {
    // Invocation 1 answers then exits; invocation 2 crashes before ever
    // answering. The command proved itself with the first answer, so the
    // second process's death is a transient crash — the same command is
    // respawned for the third request. Were it counted as a launch failure,
    // the candidate list would advance and (with no fallback) C# formatting
    // would be off for the rest of the session, with a warning.
    const s = scratch('crash-before-answering');
    const counter = path.join(s.root, 'counter');
    const exitMarker = path.join(s.root, 'first-process-exited');
    writeExecutable(
      s.bin,
      'dotnet',
      `
  const EOT = '\\u0003';
  const fs = require('node:fs');
  let n = 0;
  try { n = Number(fs.readFileSync(${JSON.stringify(counter)}, 'utf8')) || 0; } catch {}
  fs.writeFileSync(${JSON.stringify(counter)}, String(n + 1));
  if (n === 1) {
    process.stderr.write('crashing before answering\\n');
    process.exit(1);
  }
  if (n === 0) {
    process.on('exit', () => {
      try { fs.writeFileSync(${JSON.stringify(exitMarker)}, 'x'); } catch {}
    });
  }
  let served = 0;
  let buf = '';
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    const first = buf.indexOf(EOT);
    if (first === -1) return;
    const second = buf.indexOf(EOT, first + 1);
    if (second === -1) return;
    const content = buf.slice(first + 1, second);
    buf = buf.slice(second + 1);
    const close = content.lastIndexOf('}');
    const response =
      content.slice(0, close) + '// CWD ' + process.cwd() + '\\n' +
      content.slice(close);
    served++;
    // Invocation 0 crashes after its answer, deterministically: exit once
    // the response is flushed, never on a wall-clock timer (a slow runner
    // could kill the process before it ever answered).
    if (n === 0 && served === 1) {
      process.stdout.write(response + EOT, () => process.exit(1));
      return;
    }
    process.stdout.write(response + EOT);
  });
`,
    );
    try {
      let out1 = '';
      let out2 = '';
      let out3 = '';
      const warnings = await captureWarnings(async () => {
        await withLaunchEnv({ bin: s.bin, cliHome: s.cliHome }, async () => {
          out1 = await format(SOURCE, {
            filepath: path.join(s.manifestDir, 'Component.razor'),
          });
          // Invocation 1 crashed after its answer.
          await waitUntil(() => fs.existsSync(exitMarker));
          // Invocation 2 crashes before answering: this request fails and
          // falls back to verbatim.
          out2 = await format(SOURCE, {
            filepath: path.join(s.manifestDir, 'Other.razor'),
          });
          // Invocation 3 respawns the same (proven) command and serves.
          out3 = await format(SOURCE, {
            filepath: path.join(s.manifestDir, 'Third.razor'),
          });
        });
      });
      assert.ok(out1.includes('// CWD'), out1);
      assert.equal(out2, SOURCE + '\n');
      assert.ok(out3.includes('// CWD'), out3);
      // No candidate advanced, nothing disabled.
      assert.equal(warnings.length, 0);
    } finally {
      fs.rmSync(s.root, { recursive: true, force: true });
    }
  },
);

test(
  'a streak of pre-answer deaths of a proven candidate escalates to the fallback',
  { skip: skipOnWindows },
  async () => {
    // Invocation 0 answers, then every later process exits before answering
    // (e.g. a pull bumped the pinned CSharpier version and the manifest now
    // needs `dotnet tool restore`). A few such deaths are treated as
    // transient crashes; a streak escalates to a launch failure, so the
    // fallback takes over instead of respawning silently on every save.
    const s = scratch('streak', { fallback: true });
    const counter = path.join(s.root, 'counter');
    const exitMarker = path.join(s.root, 'first-process-exited');
    writeExecutable(
      s.bin,
      'dotnet',
      `
  const EOT = '\\u0003';
  const fs = require('node:fs');
  let n = 0;
  try { n = Number(fs.readFileSync(${JSON.stringify(counter)}, 'utf8')) || 0; } catch {}
  fs.writeFileSync(${JSON.stringify(counter)}, String(n + 1));
  if (n >= 1) {
    process.stderr.write('stale manifest, crashing before answering\\n');
    process.exit(1);
  }
  process.on('exit', () => {
    try { fs.writeFileSync(${JSON.stringify(exitMarker)}, 'x'); } catch {}
  });
  let served = 0;
  let buf = '';
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    const first = buf.indexOf(EOT);
    if (first === -1) return;
    const second = buf.indexOf(EOT, first + 1);
    if (second === -1) return;
    const content = buf.slice(first + 1, second);
    buf = buf.slice(second + 1);
    const close = content.lastIndexOf('}');
    const response =
      content.slice(0, close) + '// CWD ' + process.cwd() + '\\n' +
      content.slice(close);
    served++;
    // Invocation 0 crashes after its answer, deterministically: exit once
    // the response is flushed, never on a wall-clock timer (a slow runner
    // could kill the process before it ever answered).
    if (served === 1) {
      process.stdout.write(response + EOT, () => process.exit(1));
      return;
    }
    process.stdout.write(response + EOT);
  });
`,
    );
    try {
      const outs: string[] = [];
      const warnings = await captureWarnings(async () => {
        await withLaunchEnv({ bin: s.bin, cliHome: s.cliHome }, async () => {
          outs.push(
            await format(SOURCE, {
              filepath: path.join(s.manifestDir, 'A.razor'),
            }),
          );
          // Invocation 0 crashed after its answer.
          await waitUntil(() => fs.existsSync(exitMarker));
          // Invocations 1 and 2 crash before answering: transient crashes,
          // each request falls back to verbatim.
          outs.push(
            await format(SOURCE, {
              filepath: path.join(s.manifestDir, 'B.razor'),
            }),
          );
          outs.push(
            await format(SOURCE, {
              filepath: path.join(s.manifestDir, 'C.razor'),
            }),
          );
          // Invocation 3 crashes before answering: the streak escalates to
          // a launch failure within this very request, and the retry is
          // served by the fallback binary.
          outs.push(
            await format(SOURCE, {
              filepath: path.join(s.manifestDir, 'D.razor'),
            }),
          );
          // The fallback keeps serving.
          outs.push(
            await format(SOURCE, {
              filepath: path.join(s.manifestDir, 'E.razor'),
            }),
          );
        });
      });
      const [out1, out2, out3, out4, out5] = outs;
      assert.ok(out1!.includes('// CWD'), 'first save not formatted');
      assert.equal(out2, SOURCE + '\n');
      assert.equal(out3, SOURCE + '\n');
      assert.ok(out4!.includes('// CWD'), 'escalated save not formatted');
      assert.ok(out5!.includes('// CWD'), 'fifth save not formatted');
      // The escalation moved to the fallback; nothing was disabled.
      assert.equal(warnings.length, 0);
    } finally {
      fs.rmSync(s.root, { recursive: true, force: true });
    }
  },
);

test('default candidates: .exe on Windows, DOTNET_CLI_HOME respected', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'razor2-candidates-'));
  const cliHome = path.join(root, 'cli-home');
  const tools = path.join(cliHome, '.dotnet', 'tools');
  fs.mkdirSync(tools, { recursive: true });
  fs.writeFileSync(path.join(tools, 'csharpier.exe'), '');
  fs.writeFileSync(path.join(tools, 'csharpier'), '');
  const primary = { file: 'dotnet', args: ['csharpier'] };
  try {
    const prevHome = process.env['DOTNET_CLI_HOME'];
    process.env['DOTNET_CLI_HOME'] = cliHome;
    try {
      assert.deepEqual(defaultCommandCandidates('win32'), [
        primary,
        { file: path.join(tools, 'csharpier.exe'), args: [] },
      ]);
      assert.deepEqual(defaultCommandCandidates('linux'), [
        primary,
        { file: path.join(tools, 'csharpier'), args: [] },
      ]);
      // A missing global install means no fallback candidate.
      process.env['DOTNET_CLI_HOME'] = path.join(root, 'nowhere');
      assert.deepEqual(defaultCommandCandidates('linux'), [primary]);
    } finally {
      process.env['DOTNET_CLI_HOME'] = prevHome;
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
