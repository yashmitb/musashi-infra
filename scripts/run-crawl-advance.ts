import { advanceCrawl } from '../src/jobs/crawl-advance.js';

const result = await advanceCrawl();
console.log(JSON.stringify(result, null, 2));
