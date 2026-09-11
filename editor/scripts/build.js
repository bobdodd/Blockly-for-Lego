/**
 * Build the editor bundle, and optionally serve it.
 *
 *   node scripts/build.js            build once into dist/
 *   node scripts/build.js --serve    rebuild on change and serve on :8080
 *
 * Blockly ships its browser builds as UMD, which native ES modules cannot
 * import, so a bundling step is unavoidable. esbuild keeps it to one
 * dependency and well under a second.
 */

import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outdir = join(root, 'dist');
const serve = process.argv.includes('--serve');

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

// Blockly's icons, sounds and cursors. The workspace is injected with
// media: 'media/', so they have to sit beside index.html.
await cp(join(root, 'node_modules/blockly/media'), join(root, 'media'), {
  recursive: true,
});

const options = {
  entryPoints: [join(root, 'src/app.js')],
  outfile: join(outdir, 'app.js'),
  bundle: true,
  format: 'esm',
  target: ['chrome111', 'edge111', 'firefox115', 'safari16'],
  sourcemap: true,
  // Blockly is most of the bundle; minifying takes it from ~1.2MB to ~600KB,
  // which matters on a school connection. Skipped while serving so that stack
  // traces stay readable during development.
  minify: !serve,
  logLevel: 'info',
};

if (serve) {
  const context = await esbuild.context(options);
  await context.watch();
  const { host, port } = await context.serve({ servedir: root, port: 8080 });
  console.log(`\nEditor running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  console.log('Start the simulator in another terminal:');
  console.log('  cd ../spike-sim && python3 -m spike_sim\n');
} else {
  await esbuild.build(options);
  console.log('Built dist/app.js');
}
