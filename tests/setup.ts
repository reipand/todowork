// Shared test environment setup.
//
// IndexedDB does not exist in jsdom, but Dexie requires it at module load. `fake-indexeddb`
// provides an in-memory implementation, and assigning it to the global scope here means any test
// that imports the database layer works without repeating this boilerplate.

import 'fake-indexeddb/auto';
