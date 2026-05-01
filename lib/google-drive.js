import { google } from 'googleapis';
import { Readable } from 'stream';

// Standard subfolder layout seeded inside every transaction folder.
// Listed in the order TCs typically work a file.
const STANDARD_SUBFOLDERS = [
  '01-Contract',
  '02-Disclosures',
  '03-Inspection',
  '04-Addenda',
  '05-Closing',
  '06-Broker Compliance',
];

function getAuth() {
  const credentials = {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  };
  return new google.auth.JWT(
    credentials.client_email,
    null,
    credentials.private_key,
    [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets',
    ]
  );
}

async function createFolder(drive, name, parentId) {
  const res = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id, webViewLink',
  });
  return { id: res.data.id, url: res.data.webViewLink, name };
}

/**
 * Create a folder inside a parent Drive folder. If seedSubfolders is true
 * (default), also creates the 6 standard transaction subfolders inside
 * it. Returns the root folder metadata and a name→id map for any
 * subfolders created.
 *
 * parentFolderId: Drive folder to nest the new folder under. Defaults to
 * GOOGLE_DRIVE_ROOT_FOLDER_ID for backward compatibility.
 */
export async function createTransactionFolder(folderName, { seedSubfolders = true, parentFolderId } = {}) {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });

  const parent = parentFolderId || process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  const folder = await createFolder(drive, folderName, parent);

  const subfolders = {};
  if (seedSubfolders) {
    // Create all 6 standard subfolders in parallel — Google Drive handles
    // concurrent creates fine, and serial calls were costing ~3s of latency.
    const results = await Promise.all(
      STANDARD_SUBFOLDERS.map(subName => createFolder(drive, subName, folder.id))
    );
    STANDARD_SUBFOLDERS.forEach((subName, i) => {
      subfolders[subName] = results[i].id;
    });
  }

  return { id: folder.id, url: folder.url, subfolders };
}

/**
 * Upload a file (Buffer or stream) to a specific Drive folder.
 * Returns the file's web view link.
 */
export async function uploadFile(folderId, fileName, mimeType, buffer) {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });

  const stream = Readable.from(buffer);

  const res = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType: mimeType || 'application/octet-stream',
      body: stream,
    },
    fields: 'id, webViewLink, name',
  });

  return { id: res.data.id, url: res.data.webViewLink, name: res.data.name };
}

/**
 * Upload multiple files to a transaction folder.
 * files: array of { originalFilename, mimetype, buffer, targetSubfolder? }
 * If targetSubfolder matches one of STANDARD_SUBFOLDERS, the file is
 * placed there; otherwise it lands in the transaction folder root.
 * Returns folder URL, folder id, subfolder map, and uploaded file info.
 */
export async function uploadTransactionFiles(transactionLabel, files, options = {}) {
  const folder = await createTransactionFolder(transactionLabel, options);

  // Upload all files in parallel — each upload is an independent Drive API
  // call; they don't depend on each other. Was a serial for-loop costing
  // ~500ms × N files of latency.
  const validFiles = files.filter(f => f?.buffer?.length);
  const uploaded = await Promise.all(
    validFiles.map(file => {
      const parentId = (file.targetSubfolder && folder.subfolders[file.targetSubfolder]) || folder.id;
      return uploadFile(
        parentId,
        file.originalFilename || 'document',
        file.mimetype,
        file.buffer
      );
    })
  );

  return {
    folderUrl: folder.url,
    folderId: folder.id,
    subfolders: folder.subfolders,
    files: uploaded,
  };
}

/**
 * Create a per-file checklist Google Sheet inside a transaction's Drive
 * folder. The new sheet contains a transaction-details header and a single
 * IMPORTRANGE+QUERY formula that mirrors that file's rows from the master
 * TC tasks tab — read-only, auto-refreshing.
 *
 * Because the same service account owns both the master workbook and this
 * new sheet, the cross-sheet IMPORTRANGE permission is auto-granted (no
 * "Allow access" click).
 *
 * Returns: { id, url, name }
 */
export async function createPerFileChecklist({
  fileNum, propertyAddress, agentName, side, parentFolderId,
}) {
  if (!fileNum) throw new Error('createPerFileChecklist: fileNum required');
  if (side !== 'Buyer' && side !== 'Seller') {
    throw new Error(`createPerFileChecklist: invalid side ${JSON.stringify(side)}`);
  }
  const masterId = process.env.GOOGLE_SHEET_ID;
  if (!masterId) throw new Error('createPerFileChecklist: GOOGLE_SHEET_ID not set');

  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });
  const sheets = google.sheets({ version: 'v4', auth });

  const masterTab = side === 'Buyer' ? '✅ Buyer TC Tasks' : '📋 Seller TC Tasks';
  const sheetTitle = `${fileNum} Checklist — ${propertyAddress || side}`.slice(0, 100);

  // 1. Create the spreadsheet directly inside the file's Drive folder via
  //    Drive API. Avoids service-account quota issues that come from
  //    sheets.spreadsheets.create (which lands the file in My Drive first).
  const fileCreateRes = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: sheetTitle,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: parentFolderId ? [parentFolderId] : undefined,
    },
    fields: 'id, webViewLink, name',
  });
  const newSheetId = fileCreateRes.data.id;

  // 1b. Make the per-file Checklist Sheet readable via link so the agent
  //     can open it from the magenta CTA in the agent confirmation email
  //     without needing a Google account or "request access" friction.
  //     Anyone WITH THE LINK can view (link is in the email — not public).
  await drive.permissions.create({
    fileId: newSheetId,
    requestBody: { role: 'reader', type: 'anyone' },
    sendNotificationEmail: false,
    supportsAllDrives: true,
  });

  // 2. Fetch the auto-generated default tab's sheetId so we can target it.
  const tabMeta = await sheets.spreadsheets.get({
    spreadsheetId: newSheetId,
    fields: 'sheets.properties',
  });
  const tabId = tabMeta.data.sheets[0].properties.sheetId;

  // 2b. Resize the default tab to our schema (200 rows × 11 cols, 9 frozen).
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: newSheetId,
    requestBody: { requests: [{
      updateSheetProperties: {
        properties: {
          sheetId: tabId,
          title: 'Checklist',
          gridProperties: { rowCount: 200, columnCount: 11, frozenRowCount: 9 },
        },
        fields: 'title,gridProperties.rowCount,gridProperties.columnCount,gridProperties.frozenRowCount',
      },
    }]},
  });

  // 3. Write the snapshot content (banner, header, transaction details, task rows).
  await _writeChecklistSnapshot({
    sheets, spreadsheetId: newSheetId, tabId,
    masterId, masterTab, fileNum, side, propertyAddress, agentName,
    isInitialWrite: true,
  });

  // 4. Get web link
  const fileMeta = await drive.files.get({
    fileId: newSheetId, fields: 'id, webViewLink, name', supportsAllDrives: true,
  });

  return { id: fileMeta.data.id, url: fileMeta.data.webViewLink, name: fileMeta.data.name };
}

/**
 * Refresh an EXISTING per-file checklist Sheet — pulls latest task rows from
 * the master TC tab and rewrites the snapshot. Used by the daily Vercel cron
 * so every per-file checklist stays current.
 *
 * Idempotent: safe to call multiple times.
 *
 * Returns: { sheetId, taskCount }
 */
export async function refreshPerFileChecklist({
  checklistSheetId, fileNum, side, propertyAddress, agentName,
}) {
  if (!checklistSheetId) throw new Error('refreshPerFileChecklist: checklistSheetId required');
  if (!fileNum) throw new Error('refreshPerFileChecklist: fileNum required');
  if (side !== 'Buyer' && side !== 'Seller') {
    throw new Error(`refreshPerFileChecklist: invalid side ${JSON.stringify(side)}`);
  }
  const masterId = process.env.GOOGLE_SHEET_ID;
  if (!masterId) throw new Error('refreshPerFileChecklist: GOOGLE_SHEET_ID not set');

  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const masterTab = side === 'Buyer' ? '✅ Buyer TC Tasks' : '📋 Seller TC Tasks';

  // Find the existing tab's sheetId (the per-file Sheet has only one tab,
  // named 'Checklist').
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: checklistSheetId,
    fields: 'sheets.properties',
  });
  const tabId = meta.data.sheets[0].properties.sheetId;

  const taskCount = await _writeChecklistSnapshot({
    sheets, spreadsheetId: checklistSheetId, tabId,
    masterId, masterTab, fileNum, side, propertyAddress, agentName,
    isInitialWrite: false,
  });

  return { sheetId: checklistSheetId, taskCount };
}

/**
 * Internal: write the full snapshot (banner, headers, details, task rows)
 * into a per-file checklist Sheet. Used by both create + refresh paths.
 *
 * isInitialWrite: true on creation (adds banding), false on refresh
 * (pre-clears the data area to remove any prior task rows that may have
 * exceeded the new row count).
 */
async function _writeChecklistSnapshot({
  sheets, spreadsheetId, tabId,
  masterId, masterTab, fileNum, side, propertyAddress, agentName,
  isInitialWrite,
}) {
  // Pull this file's rows from the master.
  const masterPullRes = await sheets.spreadsheets.values.get({
    spreadsheetId: masterId,
    range: `'${masterTab}'!A3:K`,
  });
  const masterRows = (masterPullRes.data.values || [])
    .filter(r => r[0] === fileNum); // master col A is File #

  const BURGUNDY = { red: 0x4D/255, green: 0x0D/255, blue: 0x30/255 };
  const MAGENTA  = { red: 0xB3/255, green: 0x2D/255, blue: 0x7F/255 };
  const PINK     = { red: 0xFA/255, green: 0xF0/255, blue: 0xF5/255 };
  const WHITE    = { red: 1, green: 1, blue: 1 };

  const headerRow = ['Phase', 'Task #', 'Task', 'Status', 'Due Date', 'Date Completed', 'Notes', 'Assigned To'];

  const taskRows = masterRows.map(r => {
    const padded = r.concat(Array(11 - r.length).fill(''));
    return [
      padded[3] || '', // Phase
      padded[4] || '', // Task #
      padded[5] || '', // Task
      padded[6] || '', // Status
      padded[7] || '', // Due Date
      padded[8] || '', // Date Completed
      padded[9] || '', // Notes
      padded[10] || '', // Assigned To
    ];
  });

  // On refresh, clear the data area first (rows 10-200 cols A-H). The
  // banner/headers/details we re-write below will overwrite their cells
  // anyway. This guards against the previous snapshot having more rows
  // than the new one, which would leave stale tasks dangling.
  if (!isInitialWrite) {
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `Checklist!A10:H200`,
    });
  }

  const subtitleText = isInitialWrite
    ? 'Snapshot at file creation  •  Read-only view — refreshed twice daily by Magenta TC'
    : `Snapshot refreshed twice daily (12 PM + 6 PM Pacific)  •  Last refresh: ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}`;

  const requests = [
    // Banner row 1, merged across 8 cols (idempotent — merge of an already
    // merged range is a no-op)
    { mergeCells: { range: { sheetId: tabId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 8 }, mergeType: 'MERGE_ALL' } },
    { updateCells: {
        range: { sheetId: tabId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 },
        rows: [{ values: [{
          userEnteredValue: { stringValue: `MAGENTA TC — ${side.toUpperCase()} CHECKLIST` },
          userEnteredFormat: { backgroundColor: BURGUNDY, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
            textFormat: { foregroundColor: WHITE, fontFamily: 'Arial', fontSize: 16, bold: true } }
        }]}],
        fields: 'userEnteredValue,userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)',
    } },
    // Subtitle row 2, merged
    { mergeCells: { range: { sheetId: tabId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 8 }, mergeType: 'MERGE_ALL' } },
    { updateCells: {
        range: { sheetId: tabId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 1 },
        rows: [{ values: [{
          userEnteredValue: { stringValue: subtitleText },
          userEnteredFormat: { backgroundColor: MAGENTA, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
            textFormat: { foregroundColor: WHITE, fontFamily: 'Arial', fontSize: 11, italic: true } }
        }]}],
        fields: 'userEnteredValue,userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)',
    } },
    // Transaction details rows 3-6 (was 3-7 — dropped the master TC link
    // row; agents shouldn't see it and TCs work in the master directly)
    { updateCells: {
        range: { sheetId: tabId, startRowIndex: 2, endRowIndex: 6, startColumnIndex: 0, endColumnIndex: 2 },
        rows: [
          { values: [{ userEnteredValue: { stringValue: 'File #:' }, userEnteredFormat: { textFormat: { bold: true } } }, { userEnteredValue: { stringValue: fileNum } }] },
          { values: [{ userEnteredValue: { stringValue: 'Property:' }, userEnteredFormat: { textFormat: { bold: true } } }, { userEnteredValue: { stringValue: propertyAddress || '' } }] },
          { values: [{ userEnteredValue: { stringValue: 'Agent:' }, userEnteredFormat: { textFormat: { bold: true } } }, { userEnteredValue: { stringValue: agentName || '' } }] },
          { values: [{ userEnteredValue: { stringValue: 'Side:' }, userEnteredFormat: { textFormat: { bold: true } } }, { userEnteredValue: { stringValue: side } }] },
        ],
        fields: 'userEnteredValue,userEnteredFormat(textFormat)',
    } },
    // Clear row 7 (was the master TC link on existing per-file Sheets)
    { updateCells: {
        range: { sheetId: tabId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 0, endColumnIndex: 8 },
        fields: 'userEnteredValue,userEnteredFormat',
    } },
    // Header row at row 9 (idx 8)
    { updateCells: {
        range: { sheetId: tabId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: 0, endColumnIndex: headerRow.length },
        rows: [{ values: headerRow.map(h => ({
          userEnteredValue: { stringValue: h },
          userEnteredFormat: {
            backgroundColor: BURGUNDY, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
            textFormat: { foregroundColor: WHITE, fontFamily: 'Arial', fontSize: 11, bold: true },
          }
        }))}],
        fields: 'userEnteredValue,userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)',
    } },
    // Task rows starting at row 10 (idx 9)
    ...(taskRows.length > 0 ? [{
      updateCells: {
        range: { sheetId: tabId, startRowIndex: 9, endRowIndex: 9 + taskRows.length, startColumnIndex: 0, endColumnIndex: headerRow.length },
        rows: taskRows.map(tr => ({
          values: tr.map(v => ({
            userEnteredValue: { stringValue: String(v) },
            userEnteredFormat: { wrapStrategy: 'WRAP', verticalAlignment: 'TOP' },
          }))
        })),
        fields: 'userEnteredValue,userEnteredFormat(wrapStrategy,verticalAlignment)',
      }
    }] : []),
  ];

  // Banding + col widths only on initial write (already in place on refresh).
  if (isInitialWrite) {
    if (taskRows.length > 0) {
      requests.push({
        addBanding: {
          bandedRange: {
            range: { sheetId: tabId, startRowIndex: 8, endRowIndex: 9 + taskRows.length, startColumnIndex: 0, endColumnIndex: 8 },
            rowProperties: { headerColor: BURGUNDY, firstBandColor: WHITE, secondBandColor: PINK },
          }
        }
      });
    }
    requests.push(
      { updateDimensionProperties: { range: { sheetId: tabId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 180 }, fields: 'pixelSize' } }, // Phase
      { updateDimensionProperties: { range: { sheetId: tabId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 60 }, fields: 'pixelSize' } },  // Task #
      { updateDimensionProperties: { range: { sheetId: tabId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 480 }, fields: 'pixelSize' } }, // Task
      { updateDimensionProperties: { range: { sheetId: tabId, dimension: 'COLUMNS', startIndex: 3, endIndex: 4 }, properties: { pixelSize: 110 }, fields: 'pixelSize' } }, // Status
      { updateDimensionProperties: { range: { sheetId: tabId, dimension: 'COLUMNS', startIndex: 4, endIndex: 5 }, properties: { pixelSize: 110 }, fields: 'pixelSize' } }, // Due
      { updateDimensionProperties: { range: { sheetId: tabId, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 }, properties: { pixelSize: 110 }, fields: 'pixelSize' } }, // Done
      { updateDimensionProperties: { range: { sheetId: tabId, dimension: 'COLUMNS', startIndex: 6, endIndex: 7 }, properties: { pixelSize: 240 }, fields: 'pixelSize' } }, // Notes
      { updateDimensionProperties: { range: { sheetId: tabId, dimension: 'COLUMNS', startIndex: 7, endIndex: 8 }, properties: { pixelSize: 130 }, fields: 'pixelSize' } }, // Owner
    );
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });

  return taskRows.length;
}
