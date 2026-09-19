import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from './server.js';

// MCP owns stdout. Creating/reconnecting the process never resets stored plans.
serveStdio(() => createServer());
