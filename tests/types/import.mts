import { inspectVideoAlpha, analyzeAlphaPlane, AlphaInspectionError } from 'video-alpha-inspector';
import type { AlphaInspection, InspectionOptions, AlphaErrorCode } from 'video-alpha-inspector';
const options: InspectionOptions = { sampleFractions: [0], signal: new AbortController().signal };
const result: Promise<AlphaInspection> = inspectVideoAlpha('local.webm', options);
const stats: number = analyzeAlphaPlane(new Uint8Array([0, 255])).transparentPixels;
const error: AlphaErrorCode = new AlphaInspectionError('NO_FRAME', 'empty').code;
void [result, stats, error];
