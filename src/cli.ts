import { AlphaInspectionError, inspectVideoAlpha } from './index.js';
import type { InspectionOptions } from './index.js';

const HELP = `video-alpha 0.1.0 — sample actual alpha values in a local video

Usage: video-alpha <file> [options]
  --json                   Write a JSON report
  --require-transparency   Exit 1 unless transparent and visible pixels are observed
  --samples 0,0.25,0.5,0.75 Fractions of reported duration in [0,1)
  --timeout-ms 60000       Total probing and decoding budget
  --max-sample-side 512    Maximum sampled long edge
  --ffmpeg <path>          FFmpeg executable (not a shell command)
  --ffprobe <path>         ffprobe executable
  --help                   Show help
  --version                Show version

Exit codes: 0 completed / condition met; 1 condition unmet; 2 error.
Requires local FFmpeg and ffprobe. No uploads; sampling is not a full-file proof.
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) { process.stdout.write(HELP); return; }
  if (args.length === 1 && args[0] === '--version') { process.stdout.write('0.1.0\n'); return; }
  let file: string | undefined;
  let json = false, requireTransparency = false, positionalOnly = false;
  const options: InspectionOptions = {};
  function fail(message: string): never { throw new AlphaInspectionError('INVALID_OPTIONS', message); }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!positionalOnly && arg === '--') { positionalOnly = true; continue; }
    if (!positionalOnly && arg === '--json') { json = true; continue; }
    if (!positionalOnly && arg === '--require-transparency') { requireTransparency = true; continue; }
    if (!positionalOnly && arg.startsWith('-')) {
      if (!['--samples', '--timeout-ms', '--max-sample-side', '--ffmpeg', '--ffprobe'].includes(arg)) fail(`Unknown option: ${arg}`);
      const value = args[++i];
      if (value === undefined || !value.trim()) fail(`Missing value for ${arg}.`);
      if (arg === '--samples') {
        const items = value.split(',');
        if (items.some(item => !item.trim())) fail('Sample fractions cannot be empty.');
        options.sampleFractions = items.map(Number);
      }
      if (arg === '--timeout-ms') options.timeoutMs = Number(value);
      if (arg === '--max-sample-side') options.maxSampleSide = Number(value);
      if (arg === '--ffmpeg') options.ffmpegPath = value;
      if (arg === '--ffprobe') options.ffprobePath = value;
    } else {
      if (file !== undefined) fail('Provide exactly one input file.');
      file = arg;
    }
  }
  if (file === undefined) fail('Provide an input file. Use --help for usage.');
  const result = await inspectVideoAlpha(file, options);
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    process.stdout.write(`${result.status}\n${result.video.codec} ${result.video.width}x${result.video.height}; alpha metadata: ${result.video.alphaMetadata}\n`);
    for (const sample of result.samples) {
      process.stdout.write(`requested ${sample.requestedTimeSeconds.toFixed(3)}s: ${sample.width}x${sample.height}, alpha ${sample.alpha.min}..${sample.alpha.max}, ${(sample.alpha.transparentFraction * 100).toFixed(2)}% transparent\n`);
    }
    process.stdout.write('Sampled frames only; unsampled frames and small features may differ.\n');
  }
  if (requireTransparency && result.status !== 'transparency-detected') process.exitCode = 1;
}
main().catch((error: unknown) => {
  const known = error instanceof AlphaInspectionError;
  process.stderr.write(`${known ? error.code : 'UNEXPECTED_ERROR'}: ${known ? error.message : 'Inspection failed.'}\n`);
  process.exitCode = 2;
});
