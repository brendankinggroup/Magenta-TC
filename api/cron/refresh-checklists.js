import { getActiveTransactionsChecklistMap } from '../../lib/google-sheets.js';
import { refreshPerFileChecklist } from '../../lib/google-drive.js';

export const maxDuration = 60;

/**
 * Daily cron — re-pulls every per-file checklist Sheet from the master TC tab.
 *
 * Triggered automatically by Vercel cron at 01:00 UTC daily (= 6 PM PDT /
 * 5 PM PST). Vercel sends Authorization: Bearer ${CRON_SECRET} on every
 * scheduled invocation; this handler rejects anything else.
 *
 * Manual trigger (handy for ad-hoc refresh):
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     https://magenta-tc.vercel.app/api/cron/refresh-checklists
 */
export default async function handler(req, res) {
  // Authentication: Vercel cron sends `Authorization: Bearer <CRON_SECRET>`.
  const authHeader = req.headers.authorization || '';
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const startedAt = new Date().toISOString();
  console.log(`[cron/refresh-checklists] started at ${startedAt}`);

  let entries;
  try {
    entries = await getActiveTransactionsChecklistMap();
  } catch (err) {
    console.error('[cron/refresh-checklists] failed to read Active Transactions:', err.message);
    return res.status(500).json({ error: 'failed to read checklist map', details: err.message });
  }

  console.log(`[cron/refresh-checklists] ${entries.length} per-file checklist(s) to refresh`);

  const results = { total: entries.length, refreshed: 0, errors: 0, errorDetails: [] };

  // Run sequentially to keep memory usage predictable and to surface ordered
  // log lines in Vercel's log viewer. With ~1s per refresh, 50 active files
  // still fit comfortably in the 60s function budget.
  for (const entry of entries) {
    try {
      const out = await refreshPerFileChecklist({
        checklistSheetId: entry.checklistSheetId,
        fileNum:          entry.fileNum,
        side:             entry.side,
        propertyAddress:  entry.propertyAddress,
        agentName:        entry.agentName,
      });
      results.refreshed++;
      console.log(`[cron/refresh-checklists] ✓ ${entry.fileNum} (${entry.side}) — ${out.taskCount} task rows`);
    } catch (err) {
      results.errors++;
      results.errorDetails.push({ fileNum: entry.fileNum, message: err?.message || String(err) });
      console.error(`[cron/refresh-checklists] ✗ ${entry.fileNum}:`, err?.message || err);
    }
  }

  const finishedAt = new Date().toISOString();
  console.log(`[cron/refresh-checklists] done — refreshed=${results.refreshed} errors=${results.errors} total=${results.total}`);

  return res.status(200).json({ ...results, startedAt, finishedAt });
}
