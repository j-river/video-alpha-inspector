import { analyzeAlphaPlane, AlphaInspectionError } from 'video-alpha-inspector/browser';
import type { AlphaStatistics, AlphaThresholds } from 'video-alpha-inspector/browser';
const options: AlphaThresholds = { transparentBelow: 245 };
const statistics: AlphaStatistics = analyzeAlphaPlane(Uint8Array.of(0, 128, 255), options);
const error: string = new AlphaInspectionError('INVALID_INPUT', 'empty').code;
void [statistics, error];
