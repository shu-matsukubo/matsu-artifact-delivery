import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { dataDirectory, extensionsDirectory } from './config.js';
import { ExtensionStore } from './extensions.js';
import { createServer } from './server.js';
import { PlanStore } from './store.js';

// stdoutはMCP専用。起動時に依存を組み立てるだけで、初期化や回収は行わない。
serveStdio(() => createServer(new PlanStore(dataDirectory()), new ExtensionStore(() => extensionsDirectory())));
