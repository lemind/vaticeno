// One-off: resolve the bot handle to its numeric user ID for X_BOT_USER_ID.
import { loadConfig } from '../config.js';
import { log } from '../log.js';
import { createXClient } from '../x/client.js';

const config = loadConfig();
const user = await createXClient(config.X_BEARER_TOKEN).getUserByUsername(config.X_BOT_HANDLE);
log('info', 'bot user resolved', { handle: user.username, x_user_id: user.id });
process.stdout.write(`\nAdd to .env:\nX_BOT_USER_ID=${user.id}\n`);
