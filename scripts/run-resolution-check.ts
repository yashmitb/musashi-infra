import { runResolutionCheck } from '../src/jobs/resolution-check.js';

const result = await runResolutionCheck();
console.log(JSON.stringify(result, null, 2));
