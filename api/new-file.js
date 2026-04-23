import formidable from 'formidable';
import fs from 'fs';
import { uploadTransactionFiles } from '../lib/google-drive.js';
import { appendNewFileRow } from '../lib/google-sheets.js';
import { sendNewFileTCAlert, sendAgentConfirmation, sendSubmissionBackup } from '../lib/email.js';
import { notifySlack, notifySMS } from '../lib/notifications.js';

export const config = { api: { bodyParser: false } };
export const maxDuration = 60;

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

    // Honeypot — if a bot filled the hidden website_url field, silently
    // accept the request but don't process anything. Returning 200 avoids
    // tipping off the bot that we rejected.
    if (f('website_url')) {
      console.warn('[new-file] honeypot triggered — dropping submission');
      return res.status(200).json({ ok: true });
    }

    const txType = (f('transactionType') || '').toUpperCase();
    const side = txType.includes('BUYER') ? 'Buyer' : txType.includes('SELLER') ? 'Seller' : '';

    // Minimal form uses a single `client*` field; legacy form still sends
    // buyer1*/seller1* directly. Route the minimal-form client to the
    // right side based on transactionType.
    const minimalClientName = f('clientName');
    const minimalClientEmail = f('clientEmail');
    const minimalClientPhone = f('clientPhone');

    const buyer1 = f('buyer1Name') || (side === 'Buyer' ? minimalClientName : '');
    const buyer1Email = f('buyer1Email') || (side === 'Buyer' ? minimalClientEmail : '');
    const buyer1Phone = f('buyer1Phone') || (side === 'Buyer' ? minimalClientPhone : '');
    const seller1 = f('seller1Name') || (side === 'Seller' ? minimalClientName : '');
    const seller1Email = f('seller1Email') || (side === 'Seller' ? minimalClientEmail : '');
    const seller1Phone = f('seller1Phone') || (side === 'Seller' ? minimalClientPhone : '');
    const buyer2 = f('buyer2Name');
    const seller2 = f('seller2Name');
    const clientNames = [buyer1, buyer2, seller1, seller2].filter(Boolean).join(', ');

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
      buyer1Name: buyer1, buyer1Email: buyer1Email, buyer1Phone: buyer1Phone,
      buyer2Name: buyer2, buyer2Email: f('buyer2Email'), buyer2Phone: f('buyer2Phone'),
      buyerEntity: f('buyerEntity'),
      seller1Name: seller1, seller1Email: seller1Email, seller1Phone: seller1Phone,
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
      inspectorName: f('inspectorName'), inspectorCompany: f('inspectorCompany'),
      inspectorPhone: f('inspectorPhone'), inspectorEmail: f('inspectorEmail'),
      warrantyCompany: f('warrantyCompany'), warrantyContact: f('warrantyContact'),
      warrantyPhone: f('warrantyPhone'), warrantyEmail: f('warrantyEmail'),
      brokerageFormsRequired: f('brokerageFormsRequired'),
    };

    const allFiles = [];
    const addFile = (fileOrArr, targetSubfolder) => {
      if (!fileOrArr) return;
      [].concat(fileOrArr).forEach(f => {
        if (f?.filepath && f?.size > 0) allFiles.push({
          originalFilename: f.originalFilename || 'document',
          mimetype: f.mimetype || 'application/octet-stream',
          buffer: fs.readFileSync(f.filepath),
          targetSubfolder,
        });
      });
    };
    // Legacy field names (kept for back-compat with any older form)
    addFile(files.contract, '01-Contract');
    addFile(files.additionalDocs);
    // Minimal-form named uploads
    addFile(files.agreement, '01-Contract');        // Purchase or Listing Agreement
    addFile(files.bbra, '01-Contract');             // Buyer Broker Agreement
    addFile(files.dutiesOwed, '02-Disclosures');    // Duties Owed (+ Supplemental if any)
    addFile(files.addenda, '04-Addenda');           // Addendums / Counteroffers

    // Backup FIRST — before any Google API call so a provider outage
    // can't lose the submission.
    await sendSubmissionBackup('new-file', data, allFiles)
      .catch(err => console.error('[backup] FAILED (non-fatal):', err.message));

    const transactionsParent =
      process.env.GOOGLE_DRIVE_TRANSACTIONS_FOLDER_ID
      || process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;

    let driveResult = null;
    if (allFiles.length > 0 && transactionsParent) {
      try {
        const folderName = `${data.propertyAddress} — ${data.clientNames} — ${new Date().toLocaleDateString('en-US')}`;
        driveResult = await uploadTransactionFiles(folderName, allFiles, { parentFolderId: transactionsParent });
        data.driveFolderUrl = driveResult.folderUrl;
      } catch (driveErr) {
        console.error('[new-file] Drive upload failed (non-fatal):', driveErr.message);
      }
    }

    if (process.env.GOOGLE_SHEET_ID) {
      try {
        await appendNewFileRow(data);
      } catch (sErr) {
        console.error('[new-file] Sheet append failed (non-fatal):', sErr?.message || sErr);
      }
    }

    await Promise.allSettled([sendNewFileTCAlert(data, driveResult), sendAgentConfirmation(data)]);
    await Promise.allSettled([notifySlack(data, 'new-file'), notifySMS(data, 'new-file')]);

    return res.status(200).json({ ok: true, driveFolderUrl: driveResult?.folderUrl });

  } catch (err) {
    console.error('[new-file] Error:', err);
    return res.status(500).json({ error: 'Submission failed. Please email tc@magenta.realestate directly.' });
  }
}
