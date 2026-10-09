import { build } from 'esbuild';
await build({ entryPoints: ['scripts/foundation-worker.ts'], outfile: 'dist/foundation-worker.mjs', bundle: true,
  platform: 'node', format: 'esm', target: 'node22', packages: 'external' });
