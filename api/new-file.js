import formidable from 'formidable';
import fs from 'fs';
import { waitUntil } from '@vercel/functions';
import { uploadTransactionFiles, createPerFileChecklist } from '../lib/google-drive.js';
import { appendNewFileRow, appendChecklistRowsToMaster, setActiveTransactionChecklistUrl } from '../lib/google-sheets.js';
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

    // The form posts client1Name / client1Email / client1Phone … client4Name etc.
    // We route those to buyer1-4 or seller1-4 depending on transactionType.
    // Legacy paths supported:
    //   - Old minimal form sent clientName/clientEmail/clientPhone (single client) →
    //     treated as client1.
    //   - Older full form sent buyer1Name / seller2Email / etc. directly → still honored.
    const legacyClientName  = f('clientName');
    const legacyClientEmail = f('clientEmail');
    const legacyClientPhone = f('clientPhone');

    const clientFor = (n, key) =>
      f(`client${n}${key}`) || (n === 1 ? ({ Name: legacyClientName, Email: legacyClientEmail, Phone: legacyClientPhone })[key] : '');

    const cN = (n) => clientFor(n, 'Name');
    const cE = (n) => clientFor(n, 'Email');
    const cP = (n) => clientFor(n, 'Phone');

    // Side-aware routing: when transactionType is Buyer, client1-4 land in buyer1-4
    // and seller slots stay empty (vice versa for Seller side). Direct buyer*/seller*
    // submissions (older form path) take precedence so we don't break callers.
    const isBuyer = side === 'Buyer';
    const isSeller = side === 'Seller';

    const buyer1      = f('buyer1Name')  || (isBuyer  ? cN(1) : '');
    const buyer1Email = f('buyer1Email') || (isBuyer  ? cE(1) : '');
    const buyer1Phone = f('buyer1Phone') || (isBuyer  ? cP(1) : '');
    const buyer2      = f('buyer2Name')  || (isBuyer  ? cN(2) : '');
    const buyer2Email = f('buyer2Email') || (isBuyer  ? cE(2) : '');
    const buyer2Phone = f('buyer2Phone') || (isBuyer  ? cP(2) : '');
    const buyer3      = f('buyer3Name')  || (isBuyer  ? cN(3) : '');
    const buyer3Email = f('buyer3Email') || (isBuyer  ? cE(3) : '');
    const buyer3Phone = f('buyer3Phone') || (isBuyer  ? cP(3) : '');
    const buyer4      = f('buyer4Name')  || (isBuyer  ? cN(4) : '');
    const buyer4Email = f('buyer4Email') || (isBuyer  ? cE(4) : '');
    const buyer4Phone = f('buyer4Phone') || (isBuyer  ? cP(4) : '');

    const seller1      = f('seller1Name')  || (isSeller ? cN(1) : '');
    const seller1Email = f('seller1Email') || (isSeller ? cE(1) : '');
    const seller1Phone = f('seller1Phone') || (isSeller ? cP(1) : '');
    const seller2      = f('seller2Name')  || (isSeller ? cN(2) : '');
    const seller2Email = f('seller2Email') || (isSeller ? cE(2) : '');
    const seller2Phone = f('seller2Phone') || (isSeller ? cP(2) : '');
    const seller3      = f('seller3Name')  || (isSeller ? cN(3) : '');
    const seller3Email = f('seller3Email') || (isSeller ? cE(3) : '');
    const seller3Phone = f('seller3Phone') || (isSeller ? cP(3) : '');
    const seller4      = f('seller4Name')  || (isSeller ? cN(4) : '');
    const seller4Email = f('seller4Email') || (isSeller ? cE(4) : '');
    const seller4Phone = f('seller4Phone') || (isSeller ? cP(4) : '');

    const clientNames = [buyer1, buyer2, buyer3, buyer4, seller1, seller2, seller3, seller4]
      .filter(Boolean).join(', ');

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
      buyer2Name: buyer2, buyer2Email: buyer2Email, buyer2Phone: buyer2Phone,
      buyer3Name: buyer3, buyer3Email: buyer3Email, buyer3Phone: buyer3Phone,
      buyer4Name: buyer4, buyer4Email: buyer4Email, buyer4Phone: buyer4Phone,
      buyerEntity: f('buyerEntity'),
      seller1Name: seller1, seller1Email: seller1Email, seller1Phone: seller1Phone,
      seller2Name: seller2, seller2Email: seller2Email, seller2Phone: seller2Phone,
      seller3Name: seller3, seller3Email: seller3Email, seller3Phone: seller3Phone,
      seller4Name: seller4, seller4Email: seller4Email, seller4Phone: seller4Phone,
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

    const transactionsParent =
      process.env.GOOGLE_DRIVE_TRANSACTIONS_FOLDER_ID
      || process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;

    // ─── FOREGROUND (agent waits for these) ─────────────────────────────────
    // Three independent calls run concurrently to minimize the time the
    // agent stares at a "Processing…" spinner:
    //   1. sendSubmissionBackup — disaster-recovery email + raw files to
    //      info@kingvegashomes.com (independent of Google APIs)
    //   2. uploadTransactionFiles — creates Drive folder + 6 subfolders
    //      (parallel) + uploads all files (parallel)
    //   3. appendNewFileRow — writes the row to Active Transactions, returns
    //      File # + row number for downstream work
    // Was sequential (~10s), now parallel (~3-5s).
    const folderName = `${data.propertyAddress} — ${data.clientNames} — ${new Date().toLocaleDateString('en-US')}`;

    const [, driveResult, sheetResult] = await Promise.all([
      sendSubmissionBackup('new-file', data, allFiles)
        .catch(err => { console.error('[backup] FAILED (non-fatal):', err.message); return null; }),
      transactionsParent
        ? uploadTransactionFiles(folderName, allFiles, { parentFolderId: transactionsParent })
            .catch(err => { console.error('[new-file] Drive upload failed (non-fatal):', err.message); return null; })
        : Promise.resolve(null),
      process.env.GOOGLE_SHEET_ID
        ? appendNewFileRow(data)
            .catch(err => { console.error('[new-file] Sheet append failed (non-fatal):', err?.message || err); return null; })
        : Promise.resolve(null),
    ]);

    if (driveResult?.folderUrl) data.driveFolderUrl = driveResult.folderUrl;
    if (sheetResult?.fileNum) data.fileNum = sheetResult.fileNum;

    // ─── BACKGROUND (agent has already seen success page) ──────────────────
    // Vercel keeps the function alive past the response while waitUntil()
    // promises resolve. Failures here log but don't affect the agent's UX.
    // If something fails here, /api/admin/replay?fileNum=XX-XXX can re-run
    // these steps for a specific file.
    waitUntil((async () => {
      try {
        // 1. Per-file checklist: spawn task rows in master + create the
        //    live-mirror Sheet inside the Drive folder.
        if (side && data.fileNum && process.env.GOOGLE_SHEET_ID) {
          await appendChecklistRowsToMaster({
            fileNum: data.fileNum,
            propertyAddress: data.propertyAddress,
            agentName: data.agentName,
            side,
          }).catch(err => console.error('[new-file:bg] master tasks append failed:', err?.message || err));

          if (driveResult?.folderId) {
            try {
              const checklist = await createPerFileChecklist({
                fileNum: data.fileNum,
                propertyAddress: data.propertyAddress,
                agentName: data.agentName,
                side,
                parentFolderId: driveResult.folderId,
              });
              data.checklistUrl = checklist.url;
              if (sheetResult?.rowNumber) {
                await setActiveTransactionChecklistUrl(sheetResult.rowNumber, checklist.url)
                  .catch(err => console.error('[new-file:bg] checklist URL stamp failed:', err.message));
              }
            } catch (chErr) {
              console.error('[new-file:bg] per-file checklist creation failed:', chErr?.message || chErr);
            }
          }
        }

        // 2. Notification fan-out — TC alert email, agent confirmation, Slack, SMS.
        //    All independent; run in parallel.
        await Promise.allSettled([
          sendNewFileTCAlert(data, driveResult),
          sendAgentConfirmation(data, driveResult),
          notifySlack(data, 'new-file'),
          notifySMS(data, 'new-file'),
        ]);
      } catch (bgErr) {
        console.error('[new-file:bg] background block failed:', bgErr?.message || bgErr);
      }
    })());

    return res.status(200).json({
      ok: true,
      driveFolderUrl: driveResult?.folderUrl,
      fileNum: data.fileNum,
    });

  } catch (err) {
    console.error('[new-file] Error:', err);
    return res.status(500).json({ error: 'Submission failed. Please email tc@magenta.realestate directly.' });
  }
}
