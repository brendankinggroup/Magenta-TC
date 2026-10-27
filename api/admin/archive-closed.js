import { archiveClosedFiles } from '../../lib/google-sheets.js';

export const maxDuration = 60;

/**
 * Admin archive endpoint — one-shot migration of Closed/Cancelled files out of
 * the live 🏠 Active Transactions tab and into 🗄️ Archived Transactions, plus
 * their associated task rows from ✅ Buyer TC Tasks / 📋 Seller TC Tasks into
 * the matching 🗄️ Archived Buyer/Seller Tasks tabs.
 *
 * Mirrors the manual copy-verify-delete pattern used in the 2026-07-29 run.
 *
 * Usage:
 *   # Dry-run (default): returns the plan without touching the sheet
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://www.magenta.realestate/api/admin/archive-closed?dryRun=1"
 *
 *   # Live run: performs the moves
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://www.magenta.realestate/api/admin/archive-closed?dryRun=0"
 *
 * Optional query params:
 *   ?dryRun=0           — perform destructive moves (default '1' = dry-run)
 *   ?statuses=Closed,Cancelled  — comma-separated status values to archive
 */
export default async function handler(req, res) {
  // Auth: same Bearer token pattern as the cron + replay endpoints.
  const authHeader = req.headers.authorization || '';
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed; use POST' });
  }

  const dryRunParam = (req.query.dryRun ?? '1').toString();
  const dryRun = dryRunParam !== '0';
  const statusesParam = (req.query.statuses ?? 'Closed,Cancelled').toString();
  const statuses = statusesParam
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  console.log(`[admin/archive-closed] starting dryRun=${dryRun} statuses=${JSON.stringify(statuses)}`);

  try {
    const result = await archiveClosedFiles({ dryRun, statuses });
    console.log(`[admin/archive-closed] done dryRun=${dryRun} totalFiles=${result.totalFiles} elapsed=${result.elapsed}ms`);
    return res.status(200).json(result);
  } catch (err) {
    console.error('[admin/archive-closed] failed:', err?.message || err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
}
