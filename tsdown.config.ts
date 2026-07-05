import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  platform: 'node',
  dts: true,
  // The package is `"type": "module"`, so plain .js/.d.ts are unambiguous.
  fixedExtension: false,
});
