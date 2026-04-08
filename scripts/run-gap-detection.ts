import { runGapDetection } from '../src/jobs/gap-detection.js';

const result = await runGapDetection();
console.log(JSON.stringify(result, null, 2));
