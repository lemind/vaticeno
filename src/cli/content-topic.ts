// npm run content:topic [-- --last <topic id>] — draw the next Event Radar topic (spec 005): random, in season this
// month, never the last one. For drafting; posts nothing and reads no database.
import { parseArgs } from 'node:util';
import { drawTopic } from '../content/topics.js';
import { printJson } from './run.js';

const { values } = parseArgs({ options: { last: { type: 'string' } } });
const month = new Date().getUTCMonth() + 1;
printJson(drawTopic(month, values.last));
