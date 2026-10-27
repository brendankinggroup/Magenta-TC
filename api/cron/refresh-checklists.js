import { google } from 'googleapis';
import { getActiveTransactionsChecklistMap } from '../../lib/google-sheets.js';
import { refreshPerFileChecklistLean } from '../../lib/google-drive.js';

export const maxDuration = 60;

/**
 * Twice-daily cron — re-pulls every per-file checklist Sheet from the master
 * TC tabs.
 *
 * Quota budget (service account limits: ~60 reads/min + ~60 writes/min):
 *   - Reads:  1 checklist-map read + ONE values.batchGet covering both master
 *             tabs = ~2-3 read calls per run, regardless of file count.
 *   - Writes: exactly 1 per file (values.batchUpdate in the lean refresh),
 *             paced in batches of 4 with a 4.5s gap between batch starts
 *             (≈53 writes/min). 36 files ≈ 40s — inside the 60s function cap.
 *   - Practical ceiling at this pacing: ~48 live files. At current growth
 *     that's a few months out; the app's database view replaces this cron
 *     entirely before then.
 *
 * Manual trigger:
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

  // Read BOTH master tabs in a single batchGet (one read request), then group
  // rows by File # in memory. Each per-file refresh gets its rows handed to
  // it — zero further reads, no matter how many files there are.
  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  const sheets = google.sheets({ version: 'v4', auth });
  let rowsByFile;
  try {
    const batch = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      ranges: [`'✅ Buyer TC Tasks'!A3:K`, `'📋 Seller TC Tasks'!A3:K`],
    });
    rowsByFile = new Map();
    for (const valueRange of batch.data.valueRanges || []) {
      for (const row of valueRange.values || []) {
        const fileNum = row[0];
        if (!fileNum) continue;
        if (!rowsByFile.has(fileNum)) rowsByFile.set(fileNum, []);
        rowsByFile.get(fileNum).push(row);
      }
    }
  } catch (err) {
    console.error('[cron/refresh-checklists] failed to read master tabs:', err.message);
    return res.status(500).json({ error: 'failed to read master tabs', details: err.message });
  }

  const results = { total: entries.length, refreshed: 0, errors: 0, errorDetails: [] };

  const BATCH_SIZE = 4;
  const BATCH_INTERVAL_MS = 4500; // keeps write pace ≈53/min, under the 60/min quota
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batchStart = Date.now();
    const batch = entries.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (entry) => {
      try {
        const out = await refreshPerFileChecklistLean({
          checklistSheetId: entry.checklistSheetId,
          fileNum: entry.fileNum,
          masterRowsForFile: rowsByFile.get(entry.fileNum) || [],
        });
        results.refreshed++;
        console.log(`[cron/refresh-checklists] ✓ ${entry.fileNum} (${entry.side}) — ${out.taskCount} task rows`);
      } catch (err) {
        results.errors++;
        results.errorDetails.push({ fileNum: entry.fileNum, message: err?.message || String(err) });
        console.error(`[cron/refresh-checklists] ✗ ${entry.fileNum}:`, err?.message || err);
      }
    }));
    // Pace batches so the per-minute write quota is never approached.
    const hasMore = i + BATCH_SIZE < entries.length;
    if (hasMore) {
      const elapsed = Date.now() - batchStart;
      if (elapsed < BATCH_INTERVAL_MS) {
        await new Promise(r => setTimeout(r, BATCH_INTERVAL_MS - elapsed));
      }
    }
  }

  const finishedAt = new Date().toISOString();
  console.log(`[cron/refresh-checklists] done — refreshed=${results.refreshed} errors=${results.errors} total=${results.total}`);

  return res.status(200).json({ ...results, startedAt, finishedAt });
}
