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
    for (const subName of STANDARD_SUBFOLDERS) {
      const sf = await createFolder(drive, subName, folder.id);
      subfolders[subName] = sf.id;
    }
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
  const uploaded = [];

  for (const file of files) {
    if (!file?.buffer?.length) continue;
    const parentId = (file.targetSubfolder && folder.subfolders[file.targetSubfolder])
      || folder.id;
    const result = await uploadFile(
      parentId,
      file.originalFilename || 'document',
      file.mimetype,
      file.buffer
    );
    uploaded.push(result);
  }

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

  // 3. Populate header rows + IMPORTRANGE formula in a single batchUpdate.
  const BURGUNDY = { red: 0x4D/255, green: 0x0D/255, blue: 0x30/255 };
  const MAGENTA  = { red: 0xB3/255, green: 0x2D/255, blue: 0x7F/255 };
  const WHITE    = { red: 1, green: 1, blue: 1 };

  // QUERY pulls master cols A:K (11 cols) where col A == fileNum.
  // Output cols: D Phase, E #, F Task, G Status, H Due, I Done, J Notes, K Owner
  const fileNumEsc = fileNum.replace(/'/g, "''");
  const queryFormula =
    `=IFERROR(QUERY(IMPORTRANGE("${masterId}", "'${masterTab}'!A2:K"), ` +
    `"select Col4, Col5, Col6, Col7, Col8, Col9, Col10, Col11 ` +
    `where Col1 = '${fileNumEsc}' label Col4 'Phase', Col5 'Task #', Col6 'Task', ` +
    `Col7 'Status', Col8 'Due Date', Col9 'Date Completed', Col10 'Notes', Col11 'Assigned To'", 1), ` +
    `"No tasks found yet — check back after the master sheet has been populated.")`;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: newSheetId,
    requestBody: {
      requests: [
        // Banner row 1, merged
        { mergeCells: { range: { sheetId: tabId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 11 }, mergeType: 'MERGE_ALL' } },
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
        { mergeCells: { range: { sheetId: tabId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 11 }, mergeType: 'MERGE_ALL' } },
        { updateCells: {
            range: { sheetId: tabId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 1 },
            rows: [{ values: [{
              userEnteredValue: { stringValue: 'Live mirror of master TC tasks  •  TC works in the master, this view auto-refreshes' },
              userEnteredFormat: { backgroundColor: MAGENTA, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
                textFormat: { foregroundColor: WHITE, fontFamily: 'Arial', fontSize: 11, italic: true } }
            }]}],
            fields: 'userEnteredValue,userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)',
        } },
        // Transaction details rows 3-7
        { updateCells: {
            range: { sheetId: tabId, startRowIndex: 2, endRowIndex: 7, startColumnIndex: 0, endColumnIndex: 2 },
            rows: [
              { values: [{ userEnteredValue: { stringValue: 'File #:' }, userEnteredFormat: { textFormat: { bold: true } } }, { userEnteredValue: { stringValue: fileNum } }] },
              { values: [{ userEnteredValue: { stringValue: 'Property:' }, userEnteredFormat: { textFormat: { bold: true } } }, { userEnteredValue: { stringValue: propertyAddress || '' } }] },
              { values: [{ userEnteredValue: { stringValue: 'Agent:' }, userEnteredFormat: { textFormat: { bold: true } } }, { userEnteredValue: { stringValue: agentName || '' } }] },
              { values: [{ userEnteredValue: { stringValue: 'Side:' }, userEnteredFormat: { textFormat: { bold: true } } }, { userEnteredValue: { stringValue: side } }] },
              { values: [{ userEnteredValue: { stringValue: 'Source:' }, userEnteredFormat: { textFormat: { bold: true } } }, { userEnteredValue: { formulaValue: `=HYPERLINK("https://docs.google.com/spreadsheets/d/${masterId}", "Open master TC sheet ↗")` } }] },
            ],
            fields: 'userEnteredValue,userEnteredFormat(textFormat)',
        } },
        // IMPORTRANGE+QUERY formula at A9 (row index 8)
        { updateCells: {
            range: { sheetId: tabId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: 0, endColumnIndex: 1 },
            rows: [{ values: [{ userEnteredValue: { formulaValue: queryFormula } }] }],
            fields: 'userEnteredValue',
        } },
        // Column widths for the QUERY output area (8 columns starting from A after row 9)
        { updateDimensionProperties: { range: { sheetId: tabId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 180 }, fields: 'pixelSize' } }, // Phase
        { updateDimensionProperties: { range: { sheetId: tabId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 60 }, fields: 'pixelSize' } },  // Task #
        { updateDimensionProperties: { range: { sheetId: tabId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 480 }, fields: 'pixelSize' } }, // Task
        { updateDimensionProperties: { range: { sheetId: tabId, dimension: 'COLUMNS', startIndex: 3, endIndex: 4 }, properties: { pixelSize: 110 }, fields: 'pixelSize' } }, // Status
        { updateDimensionProperties: { range: { sheetId: tabId, dimension: 'COLUMNS', startIndex: 4, endIndex: 5 }, properties: { pixelSize: 110 }, fields: 'pixelSize' } }, // Due
        { updateDimensionProperties: { range: { sheetId: tabId, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 }, properties: { pixelSize: 110 }, fields: 'pixelSize' } }, // Done
        { updateDimensionProperties: { range: { sheetId: tabId, dimension: 'COLUMNS', startIndex: 6, endIndex: 7 }, properties: { pixelSize: 240 }, fields: 'pixelSize' } }, // Notes
        { updateDimensionProperties: { range: { sheetId: tabId, dimension: 'COLUMNS', startIndex: 7, endIndex: 8 }, properties: { pixelSize: 130 }, fields: 'pixelSize' } }, // Owner
      ],
    },
  });

  // 4. Get web link
  const fileMeta = await drive.files.get({
    fileId: newSheetId, fields: 'id, webViewLink, name', supportsAllDrives: true,
  });

  return { id: fileMeta.data.id, url: fileMeta.data.webViewLink, name: fileMeta.data.name };
}
