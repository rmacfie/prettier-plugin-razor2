// Formatting benchmark: formats the showcase fixtures repeatedly and reports
// per-iteration times, with C# formatting enabled (CSharpier) and disabled.
// Run: pnpm bench

import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import prettier from 'prettier';

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginPath = path.resolve(here, '..', 'src', 'index.ts');
const fixturesDir = path.resolve(here, '..', 'tests', 'fixtures');

const WARMUP = 3;
const ITERATIONS = 15;

interface Stats {
  median: number;
  mean: number;
  min: number;
  max: number;
}

function stats(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)]!,
    mean: samples.reduce((a, b) => a + b, 0) / samples.length,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
  };
}

async function bench(
  label: string,
  source: string,
  filepath: string,
  csharpierIntegration: boolean,
): Promise<Stats> {
  const options: prettier.Options & { csharpierIntegration?: boolean } = {
    parser: 'razor',
    plugins: [pluginPath],
    printWidth: 80,
    filepath,
    csharpierIntegration,
  };

  for (let i = 0; i < WARMUP; i++) await prettier.format(source, options);

  const samples: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = performance.now();
    await prettier.format(source, options);
    samples.push(performance.now() - t0);
  }

  const s = stats(samples);
  console.log(
    `${label.padEnd(38)} median ${s.median.toFixed(1).padStart(7)} ms   ` +
      `mean ${s.mean.toFixed(1).padStart(7)} ms   ` +
      `min ${s.min.toFixed(1).padStart(7)} ms   max ${s.max.toFixed(1).padStart(7)} ms`,
  );
  return s;
}

for (const name of ['example.razor', 'example.cshtml']) {
  const file = path.join(fixturesDir, name);
  const source = fs.readFileSync(file, 'utf8');
  console.log(
    `\n=== ${name} (${source.length} chars, warmup ${WARMUP}, n=${ITERATIONS}) ===`,
  );
  await bench(`${name} with CSharpier`, source, file, true);
  await bench(`${name} without CSharpier`, source, file, false);
}
