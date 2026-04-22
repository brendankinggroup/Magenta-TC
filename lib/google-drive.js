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
    ['https://www.googleapis.com/auth/drive']
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
 * Create a folder inside the TC root. If seedSubfolders is true (default),
 * also creates the 6 standard transaction subfolders inside it. Returns
 * the root folder metadata and a name→id map for any subfolders created.
 */
export async function createTransactionFolder(folderName, { seedSubfolders = true } = {}) {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });

  const folder = await createFolder(drive, folderName, process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID);

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
