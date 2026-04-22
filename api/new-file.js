import formidable from 'formidable';
import fs from 'fs';
import { uploadTransactionFiles } from '../lib/google-drive.js';
import { appendNewFileRow } from '../lib/google-sheets.js';
import { sendNewFileTCAlert, sendAgentConfirmation } from '../lib/email.js';
import { notifySlack, notifySMS } from '../lib/notifications.js';

export const config = { api: { bodyParser: false } };

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({ maxFileSize: 25 * 1024 * 1024, multiples: true, keepExtensions: true, allowEmptyFiles: true, minFileSize: 0 });
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

function field(fields, key) {
  const val = fields[key];
  return Array.isArray(val) ? val[0] : val || '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { fields, files } = await parseForm(req);
    const f = (key) => field(fields, key);

    const buyer1 = f('buyer1Name'), buyer2 = f('buyer2Name');
    const seller1 = f('seller1Name'), seller2 = f('seller2Name');
    const clientNames = [buyer1, buyer2, seller1, seller2].filter(Boolean).join(', ');

    const txType = (f('transactionType') || '').toUpperCase();
    const side = txType.includes('BUYER') ? 'Buyer' : txType.includes('SELLER') ? 'Seller' : '';

    const data = {
      urgent: f('urgent') === 'true' || f('urgent') === 'on',
      transactionType: f('transactionType'),
      propertyAddress: [f('propertyAddress'), f('city'), f('state'), f('zip')].filter(Boolean).join(', '),
      propertyType: f('propertyType'),
      salePrice: f('salePrice'),
      loanType: f('loanType'),
      downPayment: f('downPayment'),
      emd: f('emd'),
      acceptanceDate: f('acceptanceDate'),
      coeDate: f('coeDate'),
      emdDueDate: f('emdDueDate'),
      inspectionEndDate: f('inspectionEndDate'),
      appraisalRemovalDate: f('appraisalRemovalDate'),
      loanRemovalDate: f('loanRemovalDate'),
      possessionDate: f('possessionDate'),
      walkThroughDate: f('walkThroughDate'),
      onMarketDate: f('onMarketDate'),
      side,
      clientNames,
      buyer1Name: buyer1, buyer1Email: f('buyer1Email'), buyer1Phone: f('buyer1Phone'),
      buyer2Name: buyer2, buyer2Email: f('buyer2Email'), buyer2Phone: f('buyer2Phone'),
      buyerEntity: f('buyerEntity'),
      seller1Name: seller1, seller1Email: f('seller1Email'), seller1Phone: f('seller1Phone'),
      seller2Name: seller2, seller2Email: f('seller2Email'), seller2Phone: f('seller2Phone'),
      otherAgentName: f('otherAgentName'), otherAgentEmail: f('otherAgentEmail'),
      otherAgentPhone: f('otherAgentPhone'), otherAgentBrokerage: f('otherAgentBrokerage'),
      escrowCompany: f('escrowCompany'), escrowOfficer: f('escrowOfficer'),
      escrowEmail: f('escrowEmail'), escrowPhone: f('escrowPhone'),
      escrowNumber: f('escrowNumber'),
      lenderName: f('lenderName'), lenderEmail: f('lenderEmail'),
      lenderPhone: f('lenderPhone'), lenderCompany: f('lenderCompany'),
      agentName: f('agentName'), agentEmail: f('agentEmail'),
      agentPhone: f('agentPhone'), agentBrokerage: f('agentBrokerage'),
      docPlatform: f('docPlatform'), tcAccess: f('tcAccess'),
      commission: f('commission'),
      transactionFee: f('transactionFee'),
      buyerCommissionAgreement: f('buyerCommissionAgreement'),
      orderInspection: f('orderInspection'), clientLocation: f('clientLocation'),
      isReferral: f('isReferral'), referralInfo: f('referralInfo'),
      notes: f('notes'), specialDateNotes: f('specialDateNotes'),
      inspectionNotes: f('inspectionNotes'),
      sellerConcessions: f('sellerConcessions'), homeWarranty: f('homeWarranty'),
      yearBuilt: f('yearBuilt'), hoa: f('hoa'), hoaCompany: f('hoaCompany'),
      occupancyStatus: f('occupancyStatus'), mlsNumber: f('mlsNumber'),
    };

    const allFiles = [];
    const addFile = (fileOrArr) => {
      if (!fileOrArr) return;
      [].concat(fileOrArr).forEach(f => {
        if (f?.filepath && f?.size > 0) allFiles.push({
          originalFilename: f.originalFilename || 'document',
          mimetype: f.mimetype || 'application/octet-stream',
          buffer: fs.readFileSync(f.filepath),
        });
      });
    };
    addFile(files.contract);
    addFile(files.additionalDocs);

    let driveResult = null;
    if (allFiles.length > 0 && process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID) {
      try {
        const folderName = `${data.propertyAddress} — ${data.clientNames} — ${new Date().toLocaleDateString('en-US')}`;
        driveResult = await uploadTransactionFiles(folderName, allFiles);
        data.driveFolderUrl = driveResult.folderUrl;
      } catch (driveErr) {
        console.error('[new-file] Drive upload failed (non-fatal):', driveErr.message);
      }
    }

    if (process.env.GOOGLE_SHEET_ID) await appendNewFileRow(data);

    await Promise.allSettled([sendNewFileTCAlert(data, driveResult), sendAgentConfirmation(data)]);
    await Promise.allSettled([notifySlack(data, 'new-file'), notifySMS(data, 'new-file')]);

    return res.status(200).json({ ok: true, driveFolderUrl: driveResult?.folderUrl });

  } catch (err) {
    console.error('[new-file] Error:', err);
    return res.status(500).json({ error: 'Submission failed. Please email tc@magenta.realestate directly.' });
  }
}
