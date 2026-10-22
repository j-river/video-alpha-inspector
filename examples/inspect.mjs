import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inspectVideoAlpha } from '../dist/index.js';
import { createFixtures } from '../tests/helpers/fixtures.mjs';

const file = process.argv[2];
if (file) {
  console.log(JSON.stringify(await inspectVideoAlpha(file), null, 2));
} else {
  const directory = await mkdtemp(join(tmpdir(), 'alpha-demo-'));
  try {
    const fixtures = await createFixtures(directory);
    for (const kind of ['transparent', 'alphaOpaque', 'empty', 'vp8', 'prores', 'mp4']) {
      const report = await inspectVideoAlpha(fixtures[kind]);
      console.log(`${kind}: ${report.status} (metadata=${report.video.alphaMetadata}, samples=${report.samples.length})`);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
}
