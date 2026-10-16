import { nowIso } from '@/lib/utils/date';
import { newId, newIdempotencyKey } from '@/lib/utils';

/**
 * Local-database helpers.
 *
 * This module exists to break a circular import. `src/lib/utils/index.ts` is a general-purpose
 * utility module with no database knowledge, and `src/lib/db/*` needs a few of its primitives.
 * Importing the util directly from every db module is fine, but re-exporting the two that the
 * db layer uses keeps the db modules' import lists short and gives one place to note why each is
 * safe to use here.
 *
 * No Dexie import in this file, deliberately: it must stay importable from a test environment
 * that has not set up `fake-indexeddb`.
 */

/** Timestamp for local row bookkeeping. */
export { nowIso as nowIsoSafe };

/** Entity id generation. Safe offline; ids exist before any server contact. */
export { newId };

/** Mutation idempotency key generation. */
export { newIdempotencyKey };
