/**
 * The build script's ordering.
 *
 * One test, about one mistake, because the mistake took the site down.
 *
 * `npm test` runs the build script with `--generate-only` to write
 * src/generated/ before the tests import it. The script used to empty dist/
 * as its very first act, so that run wiped the bundle and exited before
 * writing anything back — leaving a dist/ that existed, contained nothing,
 * and looked like a build. Deploying is `rsync --delete-after` over that
 * directory, so the next deploy removed every script from the server and the
 * live editor served 404s for its own code.
 *
 * Read from the source rather than run, because running it would empty the
 * dist/ of whoever is running the tests, which is the very thing being
 * guarded against.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  fileURLToPath(new URL('../scripts/build.js', import.meta.url)),
  'utf8',
);
const packaged = JSON.parse(readFileSync(
  fileURLToPath(new URL('../package.json', import.meta.url)),
  'utf8',
));

describe('the build script never empties dist without refilling it', () => {
  it('leaves dist alone until after the generate-only exit', () => {
    const exit = source.indexOf('if (generateOnly) process.exit(0)');
    const clean = source.indexOf('rm(outdir');

    assert.notEqual(exit, -1, 'the --generate-only exit has moved or gone');
    assert.notEqual(clean, -1, 'nothing clears dist any more; this test needs rewriting');
    assert.ok(
      clean > exit,
      'dist is emptied before the generate-only exit, so `npm test` leaves an '
        + 'empty bundle behind and the next deploy takes the site down',
    );
  });

  it('empties dist exactly once', () => {
    // A second clean somewhere below would be back in front of the exit as
    // far as anyone reading is concerned.
    const cleans = source.match(/rm\(outdir/g) ?? [];
    assert.equal(cleans.length, 1);
  });

  it('is what pretest actually runs', () => {
    // The whole hazard exists because `npm test` runs this script. If that
    // stops being true the test above is guarding nothing.
    assert.match(packaged.scripts.pretest, /generate/);
    assert.match(packaged.scripts.generate, /--generate-only/);
  });
});
