import { google } from 'googleapis';
import { Readable } from 'stream';

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

/**
 * Create a folder inside the root TC Drive folder.
 * Returns the new folder's ID.
 */
export async function createTransactionFolder(folderName) {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });

  const res = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID],
    },
    fields: 'id, webViewLink',
  });

  return { id: res.data.id, url: res.data.webViewLink };
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
 * files: array of { originalFilename, mimetype, buffer }
 * Returns folder URL + array of uploaded file info.
 */
export async function uploadTransactionFiles(transactionLabel, files) {
  const folder = await createTransactionFolder(transactionLabel);
  const uploaded = [];

  for (const file of files) {
    if (!file?.buffer?.length) continue;
    const result = await uploadFile(
      folder.id,
      file.originalFilename || 'document',
      file.mimetype,
      file.buffer
    );
    uploaded.push(result);
  }

  return { folderUrl: folder.url, folderId: folder.id, files: uploaded };
}
