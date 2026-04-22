import formidable from 'formidable';
import fs from 'fs';
import { appendAgentRow } from '../lib/google-sheets.js';
import { uploadTransactionFiles } from '../lib/google-drive.js';
import { sendOnboardingTCAlert, sendAgentWelcome } from '../lib/email.js';
import { notifySlack, notifySMS } from '../lib/notifications.js';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const form = formidable({ multiples: true, maxFileSize: 20 * 1024 * 1024, allowEmptyFiles: true, minFileSize: 0 });
    const [fields, files] = await form.parse(req);
    const f = (key) => (Array.isArray(fields[key]) ? fields[key][0] : fields[key]) || '';

    const data = {
      agentName:         `${f('firstName')} ${f('lastName')}`.trim(),
      agentEmail:        f('agentEmail'),
      agentPhone:        f('agentPhone'),
      brokerage:         f('brokerage'),
      brokerOfRecord:    f('brokerOfRecord'),
      brokerPhone:       f('brokerPhone'),
      officeAddress:     f('officeAddress'),
      teamName:          f('teamName'),
      licenseNumber:     f('licenseNumber'),
      additionalLicense: f('additionalLicense'),
      preferredName:     f('preferredName'),
      docPlatform:       f('docPlatform'),
      crm:               f('crm'),
      esignPlatform:     f('esignPlatform'),
      showingPlatform:   f('showingPlatform'),
      loginNotes:        f('loginNotes'),
      prefEscrow:        f('prefEscrow'),
      prefLender:        f('prefLender'),
      prefInspector:     f('prefInspector'),
      prefOtherVendor:   f('prefOtherVendor'),
      transactionTypes:  fields['transactionTypes']
                           ? [].concat(fields['transactionTypes']).join(', ')
                           : '',
      txVolume:          f('txVolume'),
      commissionSplit:   f('commissionSplit'),
      primaryMarket:     f('primaryMarket'),
      communicationPref: f('commPref'),
      commEmail:         f('commEmail'),
      commPhone:         f('commPhone'),
      preferredHours:    f('preferredHours'),
      billingName:       f('billingName'),
      entityType:        f('entityType'),
      billingEmail:      f('billingEmail'),
      referralSource:    f('referralSource'),
      referralAgent:     f('referralAgent'),
      notes:             f('notes'),
      workPreferences:   f('workPreferences'),
      complianceContact: f('complianceContact'),
    };

    // Upload broker-required forms to Drive if provided
    let driveResult = null;
    const brokerFiles = files.brokerForms ? [].concat(files.brokerForms) : [];
    if (brokerFiles.length > 0 && process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID) {
      const uploadList = brokerFiles.map(file => ({
        originalFilename: file.originalFilename || file.newFilename || 'document',
        mimeType: file.mimetype || 'application/octet-stream',
        buffer: fs.readFileSync(file.filepath),
      }));
      driveResult = await uploadTransactionFiles(
        `Onboarding — ${data.agentName} — ${data.brokerage}`,
        uploadList
      );
    }

    if (process.env.GOOGLE_SHEET_ID) {
      await appendAgentRow({ ...data, driveFolderUrl: driveResult?.folderUrl || '' });
    }

    await Promise.allSettled([sendOnboardingTCAlert(data), sendAgentWelcome(data)]);
    await Promise.allSettled([notifySlack(data, 'onboarding'), notifySMS(data, 'onboarding')]);

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('[onboarding] Error:', err);
    return res.status(500).json({ error: 'Submission failed. Please email tc@magenta.realestate directly.' });
  }
}
