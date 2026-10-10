import { readFile } from 'node:fs/promises';
import { sql, closeStore } from '../src/lib/foundation/store';
try {
  const source = await readFile(new URL('../migrations/001_foundation.sql', import.meta.url), 'utf8');
  await sql().begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(793134765)`;
    await tx.unsafe(source);
  });
  console.log('Foundation schema ready. No legacy records deleted.');
} finally { await closeStore(); }
