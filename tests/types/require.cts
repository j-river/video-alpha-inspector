import api = require('video-alpha-inspector');
const result: Promise<api.AlphaInspection> = api.inspectVideoAlpha('local.mov');
const stats: api.AlphaStatistics = api.analyzeAlphaPlane(new Uint8Array([255]));
void [result, stats];
