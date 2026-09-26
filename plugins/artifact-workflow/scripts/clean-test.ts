import { rm } from 'node:fs/promises';

// This fixed path is always the compiler output under the plugin root.
await rm(new URL('../.test-build/', import.meta.url), { recursive: true, force: true });
