import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  platform: 'node',
  dts: true,
  // Keep the emitted syntax within the engines floor declared in package.json.
  target: 'node20',
  // The package is `"type": "module"`, so plain .js/.d.ts are unambiguous.
  fixedExtension: false,
});
