import { google } from 'googleapis';
import {
  appendChecklistRowsToMaster,
  setActiveTransactionChecklistUrl,
} from '../../lib/google-sheets.js';
import { createPerFileChecklist } from '../../lib/google-drive.js';
import {
  sendNewFileTCAlert,
  sendAgentConfirmation,
} from '../../lib/email.js';

export const maxDuration = 60;

/**
 * Admin replay endpoint — re-runs the post-submission "background" steps
 * for a file that already exists in Active Transactions. Used when the
 * Vercel waitUntil() background work in /api/new-file.js fails partway
 * through (e.g., per-file Checklist Sheet didn't get created, or TC alert
 * email didn't send). Re-running is idempotent.
 *
 * Usage:
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://magenta-tc.vercel.app/api/admin/replay?fileNum=26-001"
 *
 * Optional flags:
 *   ?skipMasterTasks=1   — don't re-append to ✅/📋 TC Tasks
 *                          (use if you already have the rows)
 *   ?skipChecklist=1     — don't re-create the per-file Sheet
 *   ?skipEmails=1        — don't re-send TC alert + agent confirmation
 *
 * Reads the file's row from Active Transactions (col A = File #), uses
 * its data to re-do whatever's missing, and reports which steps ran.
 */
export default async function handler(req, res) {
  // Auth: same Bearer token pattern as the cron endpoint.
  const authHeader = req.headers.authorization || '';
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'method not allowed; use POST or GET' });
  }

  const fileNum = (req.query.fileNum || '').toString().trim();
  if (!/^\d{2}-\d{3}$/.test(fileNum)) {
    return res.status(400).json({ error: 'fileNum required (format: YY-NNN, e.g. 26-001)' });
  }

  const skipMasterTasks = !!req.query.skipMasterTasks;
  const skipChecklist = !!req.query.skipChecklist;
  const skipEmails = !!req.query.skipEmails;

  console.log(`[admin/replay] starting fileNum=${fileNum} skipMasterTasks=${skipMasterTasks} skipChecklist=${skipChecklist} skipEmails=${skipEmails}`);

  // 1. Look up the file's row in Active Transactions
  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  const sheets = google.sheets({ version: 'v4', auth });
  const sid = process.env.GOOGLE_SHEET_ID;
  if (!sid) return res.status(500).json({ error: 'GOOGLE_SHEET_ID not set' });

  const res1 = await sheets.spreadsheets.values.get({
    spreadsheetId: sid,
    range: '🏠 Active Transactions!A3:CC',
  });
  const rows = res1.data.values || [];
  let rowIndex = -1;
  let row = null;
  for (let i = 0; i < rows.length; i++) {
    if ((rows[i][0] || '').toString().trim() === fileNum) {
      rowIndex = i + 3; // sheet is 1-indexed and we started at row 3
      row = rows[i];
      break;
    }
  }
  if (rowIndex < 0 || !row) {
    return res.status(404).json({ error: `File # ${fileNum} not found in Active Transactions` });
  }

  // Pad row to full length so col indices don't OOB
  row = row.concat(Array(Math.max(0, 81 - row.length)).fill(''));

  // Extract the fields we need. Column indices (0-based):
  //   A=0 File#  D=3 Type  E=4 Agent  F=5 AgentEmail  G=6 AgentPhone
  //   I=8 PropertyAddress  K=10 ClientNames
  //   AX=49 DriveFolder    CC=80 ChecklistURL
  const fileType = (row[3] || '').toString();
  const side = fileType.toLowerCase().startsWith('seller') ? 'Seller' : 'Buyer';
  const data = {
    fileNum,
    transactionType: fileType,
    side,
    agentName: row[4] || '',
    agentEmail: row[5] || '',
    agentPhone: row[6] || '',
    propertyAddress: row[8] || '',
    clientNames: row[10] || '',
    driveFolderUrl: row[49] || '',
    checklistUrl: row[80] || '',
    notes: row[48] || '',
    coeDate: row[18] || '',
  };

  const driveFolderId = (data.driveFolderUrl.match(/\/folders\/([a-zA-Z0-9_-]+)/) || [])[1];
  const driveResult = driveFolderId ? { folderId: driveFolderId, folderUrl: data.driveFolderUrl, files: [] } : null;

  const result = { fileNum, ran: [], skipped: [], errors: [] };

  // 2. Re-append master TC tasks rows (idempotent — appendChecklistRowsToMaster
  //    appends new rows, doesn't dedupe. Caller should pass skipMasterTasks=1
  //    if rows already exist for this file num.)
  if (skipMasterTasks) {
    result.skipped.push('appendChecklistRowsToMaster');
  } else {
    try {
      const out = await appendChecklistRowsToMaster({
        fileNum: data.fileNum,
        propertyAddress: data.propertyAddress,
        agentName: data.agentName,
        side: data.side,
      });
      result.ran.push(`appendChecklistRowsToMaster (count=${out?.count ?? '?'})`);
    } catch (err) {
      result.errors.push({ step: 'appendChecklistRowsToMaster', message: err?.message || String(err) });
    }
  }

  // 3. Re-create per-file Checklist Sheet (only if folder exists + Sheet
  //    doesn't already exist).
  if (skipChecklist || data.checklistUrl) {
    result.skipped.push(data.checklistUrl ? 'createPerFileChecklist (already exists)' : 'createPerFileChecklist');
  } else if (driveResult?.folderId) {
    try {
      const checklist = await createPerFileChecklist({
        fileNum: data.fileNum,
        propertyAddress: data.propertyAddress,
        agentName: data.agentName,
        side: data.side,
        parentFolderId: driveResult.folderId,
      });
      data.checklistUrl = checklist.url;
      // Stamp it onto the row
      try {
        await setActiveTransactionChecklistUrl(rowIndex, checklist.url);
        result.ran.push(`createPerFileChecklist + URL stamp (url=${checklist.url})`);
      } catch (e) {
        result.errors.push({ step: 'setActiveTransactionChecklistUrl', message: e?.message || String(e) });
      }
    } catch (err) {
      result.errors.push({ step: 'createPerFileChecklist', message: err?.message || String(err) });
    }
  } else {
    result.skipped.push('createPerFileChecklist (no Drive folder)');
  }

  // 4. Re-send TC alert + agent confirmation
  if (skipEmails) {
    result.skipped.push('emails');
  } else {
    const emailOutcomes = await Promise.allSettled([
      sendNewFileTCAlert(data, driveResult),
      sendAgentConfirmation(data, driveResult),
    ]);
    emailOutcomes.forEach((o, i) => {
      const step = i === 0 ? 'sendNewFileTCAlert' : 'sendAgentConfirmation';
      if (o.status === 'fulfilled') result.ran.push(step);
      else result.errors.push({ step, message: o.reason?.message || String(o.reason) });
    });
  }

  console.log(`[admin/replay] done fileNum=${fileNum} ran=${result.ran.length} errors=${result.errors.length}`);
  return res.status(200).json(result);
}
