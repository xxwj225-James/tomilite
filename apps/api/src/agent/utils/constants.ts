import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_PROJECT_ID = 'proj-default';
export const MAX_ITERATIONS = 10;

const DATA_DIR = process.env.TL_USER_DATA || join(homedir(), '.tomilite');
export const LOG_DIR = DATA_DIR;
export const LOG_FILE = join(LOG_DIR, 'agent.log');
export const DEBUG_FLAG = join(LOG_DIR, 'debug.flag');
