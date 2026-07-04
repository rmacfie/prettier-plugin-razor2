// The HTML is formatted via Prettier's own `textToDoc(..., { parser: 'html' })`,
// so other plugins that override the html parser (e.g. prettier-plugin-tailwindcss
// sorting class="" attributes) compose with this one — including inside control
// blocks, which are formatted by recursing the same pipeline.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import prettier from 'prettier';

import { fixturesDir, pluginPath } from './support.ts';

// Stand-in for an html-hooking plugin like prettier-plugin-tailwindcss.
const sortClassPlugin = path.join(fixturesDir, 'sort-class-plugin.mjs');

const source =
  '<div class="z-10 flex mx-auto">\n@if (a)\n{\n<span class="c b a">x</span>\n}\n</div>';

test('an html-overriding plugin processes the markup (top level and in blocks)', async () => {
  const out = await prettier.format(source, {
    parser: 'razor',
    plugins: [pluginPath, sortClassPlugin],
    printWidth: 80,
  });
  assert.match(out, /<div class="flex mx-auto z-10">/);
  assert.match(out, /<span class="a b c">x<\/span>/);
});

test('classes are untouched without such a plugin', async () => {
  const out = await prettier.format(source, {
    parser: 'razor',
    plugins: [pluginPath],
    printWidth: 80,
  });
  assert.match(out, /<div class="z-10 flex mx-auto">/);
  assert.match(out, /<span class="c b a">x<\/span>/);
});
