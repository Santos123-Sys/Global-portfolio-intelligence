import { readFile } from 'node:fs/promises';
import { sql, closeStore } from '../src/lib/foundation/store';

// Ordered additive migrations. Concurrent dashboard/worker starts serialize on the lock.
const migrations = ['001_foundation.sql', '002_gpi_integration.sql', '003_document_corpus.sql', '004_portfolio_feedback.sql', '005_browser_workspace.sql', '006_browser_capacity.sql', '007_browser_runtime.sql', '008_market_history.sql'];
try {
  await sql().begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(793134765)`;
    for (const name of migrations) {
      const source = await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8');
      await tx.unsafe(source);
    }
  });
  console.log('Foundation and GPI integration schema ready. No legacy records deleted.');
} finally { await closeStore(); }
