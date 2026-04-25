import { Resend } from 'resend';

const TC_EMAIL_RAW = process.env.TC_EMAIL || 'tc@magenta.realestate';
const FROM = process.env.EMAIL_FROM || 'Magenta TC <tc@magenta.realestate>';
const BACKUP_EMAIL_RAW = process.env.BACKUP_EMAIL || TC_EMAIL_RAW;

// Parse a comma-separated env value into a clean array of recipients.
// Resend accepts an array in the `to` field.
function parseRecipients(value) {
  return String(value || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

const TC_EMAIL = parseRecipients(TC_EMAIL_RAW);
const BACKUP_EMAIL = parseRecipients(BACKUP_EMAIL_RAW);

// Resend's per-email size cap is 40MB; stay under that to leave room for
// JSON + email chrome. Above this threshold we split files across emails.
const MAX_FILE_BATCH_BYTES = 35 * 1024 * 1024;

function getResend() {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
}

// ─── BACKUP: Raw submission → email (runs before any Google write) ──────────

/**
 * Emails a backup of the raw submission to BACKUP_EMAIL.
 * - Email 1: JSON payload (always sends; tiny).
 * - Email 2: uploaded files as attachments (best-effort; splits across
 *   multiple emails if total size would exceed Resend's cap).
 *
 * files: array of { originalFilename, mimetype, buffer } — same shape used
 * by the Drive upload path.
 */
export async function sendSubmissionBackup(type, data, files = []) {
  const r = getResend();
  if (!r) return;

  const timestamp = new Date().toISOString();
  const label = backupLabel(type, data);
  const jsonPayload = JSON.stringify({ timestamp, type, data }, null, 2);
  const jsonFilename = `submission-${timestamp.replace(/[:.]/g, '-')}.json`;

  // Email 1 — JSON backup. Small, always sends.
  const email1 = r.emails.send({
    from: FROM,
    to: BACKUP_EMAIL,
    subject: `[BACKUP] ${type} — ${label}`,
    html: `<pre style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;white-space:pre-wrap;background:#F4F3F2;padding:16px;border-radius:4px;">${escapeHtml(jsonPayload)}</pre>`,
    attachments: [{
      filename: jsonFilename,
      content: Buffer.from(jsonPayload).toString('base64'),
    }],
  });

  // Email 2+ — file backups, grouped to stay under the per-email cap.
  const fileEmails = [];
  const batches = batchFilesBySize(files, MAX_FILE_BATCH_BYTES);
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const partLabel = batches.length > 1 ? ` (part ${i + 1}/${batches.length})` : '';
    fileEmails.push(r.emails.send({
      from: FROM,
      to: BACKUP_EMAIL,
      subject: `[BACKUP-FILES] ${type} — ${label}${partLabel}`,
      html: `<p style="font-family:Arial,sans-serif;font-size:13px;">Files from submission at ${timestamp}:</p><ul style="font-family:Arial,sans-serif;font-size:13px;">${batch.map(f => `<li>${escapeHtml(f.originalFilename || 'document')} (${Math.round((f.buffer?.length || 0) / 1024)} KB)</li>`).join('')}</ul>`,
      attachments: batch.map(f => ({
        filename: f.originalFilename || 'document',
        content: (f.buffer || Buffer.alloc(0)).toString('base64'),
      })),
    }));
  }

  await Promise.allSettled([email1, ...fileEmails]);
}

function backupLabel(type, data) {
  if (type === 'new-file') {
    return [data.propertyAddress, data.agentName].filter(Boolean).join(' — ') || 'untitled';
  }
  return [data.agentName, data.brokerage].filter(Boolean).join(' — ') || 'untitled';
}

function batchFilesBySize(files, maxBytes) {
  const usable = files.filter(f => f?.buffer?.length > 0);
  if (usable.length === 0) return [];
  const batches = [];
  let current = [];
  let currentSize = 0;
  for (const f of usable) {
    const size = f.buffer.length;
    // A single file bigger than the cap still ships alone — Resend will
    // reject if truly over, but the JSON backup (email 1) already succeeded.
    if (current.length > 0 && currentSize + size > maxBytes) {
      batches.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(f);
    currentSize += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── FULL DETAILS renderer ──────────────────────────────────────────────────

// Section definitions for the full-details table. Each section lists the
// (data key, display label) tuples we want rendered, in order. Empty
// values are skipped automatically; sections with no non-empty values
// are hidden entirely.
const DETAIL_SECTIONS = {
  'new-file': [
    { title: 'Transaction', fields: [
      ['transactionType', 'Type'],
      ['side', 'Side'],
      ['urgent', 'Urgent'],
      ['docPlatform', 'Doc Platform'],
      ['tcAccess', 'TC Access'],
    ]},
    { title: 'Property', fields: [
      ['propertyAddress', 'Address'],
      ['propertyType', 'Property Type'],
      ['yearBuilt', 'Year Built'],
      ['hoa', 'HOA'],
      ['hoaCompany', 'HOA Company'],
      ['occupancyStatus', 'Occupancy'],
      ['mlsNumber', 'MLS #'],
      ['onMarketDate', 'On Market Date'],
    ]},
    { title: 'Pricing', fields: [
      ['salePrice', 'Sale Price'],
      ['loanType', 'Loan Type'],
      ['downPayment', 'Down Payment'],
      ['emd', 'EMD'],
      ['commission', 'Commission'],
      ['transactionFee', 'Transaction Fee'],
      ['buyerCommissionAgreement', 'Buyer Commission Agreement'],
      ['sellerConcessions', 'Seller Concessions'],
      ['homeWarranty', 'Home Warranty'],
    ]},
    { title: 'Key Dates', fields: [
      ['acceptanceDate', 'Acceptance'],
      ['coeDate', 'COE'],
      ['emdDueDate', 'EMD Due'],
      ['inspectionEndDate', 'Inspection End'],
      ['appraisalRemovalDate', 'Appraisal Removal'],
      ['loanRemovalDate', 'Loan Removal'],
      ['possessionDate', 'Possession'],
      ['walkThroughDate', 'Walk Through'],
      ['specialDateNotes', 'Special Date Notes'],
    ]},
    { title: 'Buyer(s)', fields: [
      ['buyer1Name', 'Buyer 1 Name'],
      ['buyer1Email', 'Buyer 1 Email'],
      ['buyer1Phone', 'Buyer 1 Phone'],
      ['buyer2Name', 'Buyer 2 Name'],
      ['buyer2Email', 'Buyer 2 Email'],
      ['buyer2Phone', 'Buyer 2 Phone'],
      ['buyerEntity', 'Buyer Entity'],
      ['clientLocation', 'Client Location'],
    ]},
    { title: 'Seller(s)', fields: [
      ['seller1Name', 'Seller 1 Name'],
      ['seller1Email', 'Seller 1 Email'],
      ['seller1Phone', 'Seller 1 Phone'],
      ['seller2Name', 'Seller 2 Name'],
      ['seller2Email', 'Seller 2 Email'],
      ['seller2Phone', 'Seller 2 Phone'],
    ]},
    { title: 'Other Agent', fields: [
      ['otherAgentName', 'Name'],
      ['otherAgentBrokerage', 'Brokerage'],
      ['otherAgentEmail', 'Email'],
      ['otherAgentPhone', 'Phone'],
    ]},
    { title: 'Escrow', fields: [
      ['escrowCompany', 'Company'],
      ['escrowOfficer', 'Officer'],
      ['escrowEmail', 'Email'],
      ['escrowPhone', 'Phone'],
      ['escrowNumber', 'Escrow #'],
    ]},
    { title: 'Lender', fields: [
      ['lenderName', 'Name'],
      ['lenderCompany', 'Company'],
      ['lenderEmail', 'Email'],
      ['lenderPhone', 'Phone'],
    ]},
    { title: 'Home Inspector', fields: [
      ['inspectorName', 'Name'],
      ['inspectorCompany', 'Company'],
      ['inspectorEmail', 'Email'],
      ['inspectorPhone', 'Phone'],
    ]},
    { title: 'Home Warranty Vendor', fields: [
      ['warrantyCompany', 'Company'],
      ['warrantyContact', 'Contact'],
      ['warrantyEmail', 'Email'],
      ['warrantyPhone', 'Phone'],
    ]},
    { title: 'Submitting Agent', fields: [
      ['agentName', 'Name'],
      ['agentEmail', 'Email'],
      ['agentPhone', 'Phone'],
      ['agentBrokerage', 'Brokerage'],
    ]},
    { title: 'Logistics', fields: [
      ['orderInspection', 'Order Inspection'],
      ['isReferral', 'Is Referral'],
      ['referralInfo', 'Referral Info'],
      ['brokerageFormsRequired', 'Brokerage Forms'],
    ]},
    { title: 'Notes', fields: [
      ['notes', 'Special Instructions'],
      ['inspectionNotes', 'Inspection Notes'],
    ]},
  ],
  'onboarding': [
    { title: 'Agent', fields: [
      ['agentName', 'Name'],
      ['preferredName', 'Preferred Name'],
      ['agentEmail', 'Email'],
      ['agentPhone', 'Phone'],
      ['licenseNumber', 'License #'],
      ['additionalLicense', 'Additional License'],
    ]},
    { title: 'Brokerage', fields: [
      ['brokerage', 'Brokerage'],
      ['brokerOfRecord', 'Broker of Record'],
      ['brokerPhone', 'Broker Phone'],
      ['officeAddress', 'Office Address'],
      ['teamName', 'Team Name'],
      ['complianceContact', 'Compliance Contact'],
    ]},
    { title: 'Platforms', fields: [
      ['docPlatform', 'Doc Platform'],
      ['crm', 'CRM'],
      ['esignPlatform', 'E-Sign'],
      ['showingPlatform', 'Showing'],
      ['loginNotes', 'Login/Access Notes'],
    ]},
    { title: 'Preferred Vendors', fields: [
      ['prefEscrow', 'Escrow'],
      ['prefEscrowPhone', 'Escrow Phone'],
      ['prefEscrowEmail', 'Escrow Email'],
      ['prefLenderName', 'Lender Name'],
      ['prefLenderCompany', 'Lender Company'],
      ['prefLenderPhone', 'Lender Phone'],
      ['prefLenderEmail', 'Lender Email'],
      ['prefInspector', 'Inspector Company'],
      ['prefInspectorPhone', 'Inspector Phone'],
      ['prefInspectorEmail', 'Inspector Email'],
      ['prefSignCompany', 'Sign Company'],
      ['prefSignCompanyPhone', 'Sign Phone'],
      ['prefSignCompanyEmail', 'Sign Email'],
      ['prefOtherVendor', 'Other'],
    ]},
    { title: 'Services & Volume', fields: [
      ['transactionTypes', 'Services Needed'],
      ['txVolume', 'Monthly Volume'],
      ['commissionSplit', 'Commission Split'],
      ['primaryMarket', 'Primary Market'],
      ['collectsBrokerCompFee', 'Collects Broker Comp Fee'],
      ['brokerCompFeeAmount', 'Broker Comp Fee Amount'],
    ]},
    { title: 'Communication', fields: [
      ['communicationPref', 'Preference'],
      ['commEmail', 'Email'],
      ['commPhone', 'Phone'],
      ['preferredHours', 'Preferred Hours'],
      ['workPreferences', 'Work Preferences'],
    ]},
    { title: 'Billing', fields: [
      ['billingName', 'Name'],
      ['entityType', 'Entity Type'],
      ['billingEmail', 'Email'],
    ]},
    { title: 'Referral', fields: [
      ['referralSource', 'Source'],
      ['referralAgent', 'Referring Agent'],
    ]},
    { title: 'Notes', fields: [
      ['notes', 'Additional Notes'],
    ]},
  ],
};

function formatFieldValue(key, value) {
  if (value == null || value === '') return '<span style="color:#C0B5BC;">—</span>';
  if (typeof value === 'boolean') return value ? 'Yes' : '<span style="color:#C0B5BC;">—</span>';
  const s = String(value).trim();
  if (!s) return '<span style="color:#C0B5BC;">—</span>';
  // Preserve line breaks in long free-text fields.
  return escapeHtml(s).replace(/\n/g, '<br>');
}

function renderFullDetails(type, data) {
  const sections = DETAIL_SECTIONS[type];
  if (!sections) return '';
  const blocks = sections.map(section => {
    const rows = section.fields.map(([key, label]) => {
      const v = formatFieldValue(key, data[key]);
      return `<tr><td style="padding:6px 12px;background:#FAF8F7;border:1px solid #E0D5DC;font-weight:700;color:#4D0D30;font-size:11px;text-transform:uppercase;width:38%;letter-spacing:0.5px;">${escapeHtml(label)}</td><td style="padding:6px 12px;background:#fff;border:1px solid #E0D5DC;font-size:13px;color:#333;">${v}</td></tr>`;
    }).join('');
    return `
      <h3 style="margin:22px 0 6px;font-size:12px;font-weight:700;letter-spacing:2px;color:#B32D7F;text-transform:uppercase;">${escapeHtml(section.title)}</h3>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>
    `;
  }).join('');
  return `
    <div style="margin-top:28px;padding-top:24px;border-top:2px solid #E0D5DC;">
      <h2 style="margin:0 0 4px;font-size:14px;font-weight:700;letter-spacing:2px;color:#4D0D30;text-transform:uppercase;">Full Submission Details</h2>
      <p style="margin:0 0 14px;font-size:11px;color:#897D76;font-style:italic;">Every field from the form. "—" means the agent left it blank.</p>
      ${blocks}
    </div>
  `;
}

// ─── NEW FILE: Alert to TC team ──────────────────────────────────────────────

export async function sendNewFileTCAlert(data, driveResult) {
  const fileLinks = driveResult?.files?.map(f =>
    `<li><a href="${f.url}">${f.name}</a></li>`
  ).join('') || '<li>No files uploaded</li>';

  const html = `
  <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;">
    <div style="background:#4D0D30;padding:24px 32px;">
      <h1 style="color:#fff;margin:0;font-size:22px;letter-spacing:2px;">NEW FILE SUBMITTED</h1>
      <p style="color:#D4AFC0;margin:6px 0 0;font-size:13px;">Magenta TC — Transaction Intake</p>
    </div>
    <div style="background:#F4F3F2;padding:28px 32px;">

      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <tr><td style="padding:8px 12px;background:#fff;border:1px solid #E0D5DC;font-weight:700;color:#4D0D30;font-size:12px;text-transform:uppercase;width:36%;">Property</td>
            <td style="padding:8px 12px;background:#fff;border:1px solid #E0D5DC;font-size:13px;">${data.propertyAddress || '—'}</td></tr>
        <tr><td style="padding:8px 12px;background:#FAF8F7;border:1px solid #E0D5DC;font-weight:700;color:#4D0D30;font-size:12px;text-transform:uppercase;">Transaction Type</td>
            <td style="padding:8px 12px;background:#FAF8F7;border:1px solid #E0D5DC;font-size:13px;">${data.transactionType || '—'}</td></tr>
        <tr><td style="padding:8px 12px;background:#fff;border:1px solid #E0D5DC;font-weight:700;color:#4D0D30;font-size:12px;text-transform:uppercase;">Agent</td>
            <td style="padding:8px 12px;background:#fff;border:1px solid #E0D5DC;font-size:13px;">${data.agentName || '—'} — ${data.agentEmail || '—'} — ${data.agentPhone || '—'}</td></tr>
        <tr><td style="padding:8px 12px;background:#FAF8F7;border:1px solid #E0D5DC;font-weight:700;color:#4D0D30;font-size:12px;text-transform:uppercase;">Client(s)</td>
            <td style="padding:8px 12px;background:#FAF8F7;border:1px solid #E0D5DC;font-size:13px;">${data.clientNames || '—'}</td></tr>
        <tr><td style="padding:8px 12px;background:#fff;border:1px solid #E0D5DC;font-weight:700;color:#4D0D30;font-size:12px;text-transform:uppercase;">Sale Price</td>
            <td style="padding:8px 12px;background:#fff;border:1px solid #E0D5DC;font-size:13px;">${data.salePrice || '—'}</td></tr>
        <tr><td style="padding:8px 12px;background:#FAF8F7;border:1px solid #E0D5DC;font-weight:700;color:#4D0D30;font-size:12px;text-transform:uppercase;">COE Date</td>
            <td style="padding:8px 12px;background:#FAF8F7;border:1px solid #E0D5DC;font-size:13px;">${data.coeDate || '—'}</td></tr>
        <tr><td style="padding:8px 12px;background:#fff;border:1px solid #E0D5DC;font-weight:700;color:#4D0D30;font-size:12px;text-transform:uppercase;">Loan Type</td>
            <td style="padding:8px 12px;background:#fff;border:1px solid #E0D5DC;font-size:13px;">${data.loanType || '—'}</td></tr>
        <tr><td style="padding:8px 12px;background:#FAF8F7;border:1px solid #E0D5DC;font-weight:700;color:#4D0D30;font-size:12px;text-transform:uppercase;">Escrow</td>
            <td style="padding:8px 12px;background:#FAF8F7;border:1px solid #E0D5DC;font-size:13px;">${data.escrowCompany || '—'} — ${data.escrowOfficer || '—'}</td></tr>
        <tr><td style="padding:8px 12px;background:#fff;border:1px solid #E0D5DC;font-weight:700;color:#4D0D30;font-size:12px;text-transform:uppercase;">Lender</td>
            <td style="padding:8px 12px;background:#fff;border:1px solid #E0D5DC;font-size:13px;">${data.lenderName || '—'} — ${data.lenderEmail || '—'}</td></tr>
        <tr><td style="padding:8px 12px;background:#FAF8F7;border:1px solid #E0D5DC;font-weight:700;color:#4D0D30;font-size:12px;text-transform:uppercase;">Doc Platform</td>
            <td style="padding:8px 12px;background:#FAF8F7;border:1px solid #E0D5DC;font-size:13px;">${data.docPlatform || '—'}</td></tr>
        ${data.urgent ? `<tr><td colspan="2" style="padding:10px 12px;background:#FFF8E1;border:1px solid #FFB300;font-weight:700;color:#7B4F00;font-size:13px;">🚨 URGENT FILE — Priority processing required</td></tr>` : ''}
      </table>

      ${data.notes ? `<div style="background:#fff;border-left:4px solid #B32D7F;padding:12px 16px;margin-bottom:24px;font-size:13px;color:#444;"><strong style="color:#4D0D30;">Special Instructions:</strong><br>${data.notes}</div>` : ''}

      ${data.checklistUrl ? `
      <div style="background:#FAF0F5;border:2px solid #B32D7F;padding:14px 16px;border-radius:4px;margin-bottom:18px;text-align:center;">
        <p style="margin:0 0 4px;font-weight:700;color:#4D0D30;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Live TC Checklist</p>
        <p style="margin:0;"><a href="${data.checklistUrl}" style="color:#B32D7F;font-weight:700;font-size:14px;">✅ Open ${data.fileNum || ''} Checklist →</a></p>
        <p style="margin:6px 0 0;font-size:11px;color:#897D76;font-style:italic;">Mirrors the master TC task list • Auto-refreshes</p>
      </div>` : ''}

      ${driveResult?.folderUrl ? `
      <div style="background:#fff;border:1px solid #E0D5DC;padding:16px;border-radius:4px;margin-bottom:24px;">
        <p style="margin:0 0 8px;font-weight:700;color:#4D0D30;font-size:12px;text-transform:uppercase;">Documents</p>
        <p style="margin:0 0 8px;"><a href="${driveResult.folderUrl}" style="color:#B32D7F;font-weight:700;">📁 Open Drive Folder</a></p>
        <ul style="margin:0;padding-left:20px;font-size:13px;">${fileLinks}</ul>
      </div>` : ''}

      ${renderFullDetails('new-file', data)}

    </div>
    <div style="background:#4D0D30;padding:16px 32px;text-align:center;">
      <p style="color:#897D76;font-size:11px;margin:0;">Magenta TC &nbsp;•&nbsp; tc@magenta.realestate</p>
    </div>
  </div>`;

  const subject = `${data.urgent ? '🚨 URGENT — ' : ''}${data.fileNum ? `[${data.fileNum}] ` : ''}New File: ${data.propertyAddress || 'Unknown Property'} — ${data.transactionType || ''}`;

  const r = getResend(); if (!r) return; return r.emails.send({
    from: FROM,
    to: TC_EMAIL,
    reply_to: data.agentEmail || undefined,
    subject,
    html,
  });
}

// ─── NEW FILE: Confirmation to agent ─────────────────────────────────────────

export async function sendAgentConfirmation(data) {
  if (!data.agentEmail) return;

  const html = `
  <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;">
    <div style="background:#4D0D30;padding:24px 32px;">
      <h1 style="color:#fff;margin:0;font-size:20px;letter-spacing:2px;">FILE RECEIVED</h1>
      <p style="color:#D4AFC0;margin:6px 0 0;font-size:13px;">Magenta TC — Confirmation</p>
    </div>
    <div style="padding:28px 32px;background:#fff;">
      <p style="font-size:15px;color:#222;">Hi ${data.agentName?.split(' ')[0] || 'there'},</p>
      <p style="font-size:13px;color:#555;line-height:1.7;">We've received your new file for <strong style="color:#4D0D30;">${data.propertyAddress || 'your property'}</strong>. Your TC will be in touch within 12 hours with a confirmation and TC intro to all parties.</p>

      <table style="width:100%;border-collapse:collapse;margin:20px 0;">
        ${data.fileNum ? `<tr><td style="padding:8px 12px;background:#F4F3F2;border:1px solid #E0D5DC;font-weight:700;color:#4D0D30;font-size:11px;text-transform:uppercase;width:40%;">File #</td>
            <td style="padding:8px 12px;border:1px solid #E0D5DC;font-size:13px;">${data.fileNum}</td></tr>` : ''}
        <tr><td style="padding:8px 12px;background:#F4F3F2;border:1px solid #E0D5DC;font-weight:700;color:#4D0D30;font-size:11px;text-transform:uppercase;width:40%;">Property</td>
            <td style="padding:8px 12px;border:1px solid #E0D5DC;font-size:13px;">${data.propertyAddress || '—'}</td></tr>
        <tr><td style="padding:8px 12px;background:#F4F3F2;border:1px solid #E0D5DC;font-weight:700;color:#4D0D30;font-size:11px;text-transform:uppercase;">Type</td>
            <td style="padding:8px 12px;border:1px solid #E0D5DC;font-size:13px;">${data.transactionType || '—'}</td></tr>
        <tr><td style="padding:8px 12px;background:#F4F3F2;border:1px solid #E0D5DC;font-weight:700;color:#4D0D30;font-size:11px;text-transform:uppercase;">COE Date</td>
            <td style="padding:8px 12px;border:1px solid #E0D5DC;font-size:13px;">${data.coeDate || '—'}</td></tr>
      </table>

      ${data.checklistUrl ? `
      <div style="background:#FAF0F5;border:2px solid #B32D7F;padding:14px 16px;border-radius:4px;margin:18px 0;text-align:center;">
        <p style="margin:0 0 4px;font-weight:700;color:#4D0D30;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Track this file's progress</p>
        <p style="margin:0;"><a href="${data.checklistUrl}" style="color:#B32D7F;font-weight:700;font-size:14px;">✅ View live checklist →</a></p>
      </div>` : ''}

      <p style="font-size:13px;color:#555;line-height:1.7;">Questions? Reply to this email or reach us at <a href="mailto:tc@magenta.realestate" style="color:#B32D7F;">tc@magenta.realestate</a>.</p>
      <p style="font-size:13px;color:#555;margin-bottom:0;">— The Magenta TC Team</p>

      ${renderFullDetails('new-file', data)}
    </div>
    <div style="background:#4D0D30;padding:16px 32px;text-align:center;">
      <p style="color:#897D76;font-size:11px;margin:0;">Magenta TC &nbsp;•&nbsp; tc@magenta.realestate</p>
    </div>
  </div>`;

  const r = getResend(); if (!r) return; return r.emails.send({
    from: FROM,
    to: data.agentEmail,
    subject: `${data.fileNum ? `[${data.fileNum}] ` : ''}File Received — ${data.propertyAddress || 'Your Transaction'} | Magenta TC`,
    html,
  });
}

// ─── ONBOARDING: Alert to TC team ────────────────────────────────────────────

export async function sendOnboardingTCAlert(data) {
  const html = `
  <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;">
    <div style="background:#4D0D30;padding:24px 32px;">
      <h1 style="color:#fff;margin:0;font-size:20px;letter-spacing:2px;">NEW AGENT ONBOARDING</h1>
      <p style="color:#D4AFC0;margin:6px 0 0;font-size:13px;">Magenta TC — Agent Setup</p>
    </div>
    <div style="padding:28px 32px;background:#F4F3F2;">
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:8px 12px;background:#fff;border:1px solid #E0D5DC;font-weight:700;color:#4D0D30;font-size:12px;text-transform:uppercase;width:36%;">Agent</td>
            <td style="padding:8px 12px;background:#fff;border:1px solid #E0D5DC;font-size:13px;">${data.agentName || '—'}</td></tr>
        <tr><td style="padding:8px 12px;background:#FAF8F7;border:1px solid #E0D5DC;font-weight:700;color:#4D0D30;font-size:12px;text-transform:uppercase;">Email</td>
            <td style="padding:8px 12px;background:#FAF8F7;border:1px solid #E0D5DC;font-size:13px;">${data.agentEmail || '—'}</td></tr>
        <tr><td style="padding:8px 12px;background:#fff;border:1px solid #E0D5DC;font-weight:700;color:#4D0D30;font-size:12px;text-transform:uppercase;">Phone</td>
            <td style="padding:8px 12px;background:#fff;border:1px solid #E0D5DC;font-size:13px;">${data.agentPhone || '—'}</td></tr>
        <tr><td style="padding:8px 12px;background:#FAF8F7;border:1px solid #E0D5DC;font-weight:700;color:#4D0D30;font-size:12px;text-transform:uppercase;">Brokerage</td>
            <td style="padding:8px 12px;background:#FAF8F7;border:1px solid #E0D5DC;font-size:13px;">${data.brokerage || '—'}</td></tr>
        <tr><td style="padding:8px 12px;background:#fff;border:1px solid #E0D5DC;font-weight:700;color:#4D0D30;font-size:12px;text-transform:uppercase;">Doc Platform</td>
            <td style="padding:8px 12px;background:#fff;border:1px solid #E0D5DC;font-size:13px;">${data.docPlatform || '—'}</td></tr>
        <tr><td style="padding:8px 12px;background:#FAF8F7;border:1px solid #E0D5DC;font-weight:700;color:#4D0D30;font-size:12px;text-transform:uppercase;">License #</td>
            <td style="padding:8px 12px;background:#FAF8F7;border:1px solid #E0D5DC;font-size:13px;">${data.licenseNumber || '—'}</td></tr>
      </table>

      ${renderFullDetails('onboarding', data)}
    </div>
    <div style="background:#4D0D30;padding:16px 32px;text-align:center;">
      <p style="color:#897D76;font-size:11px;margin:0;">Magenta TC &nbsp;•&nbsp; tc@magenta.realestate</p>
    </div>
  </div>`;

  const r = getResend(); if (!r) return; return r.emails.send({
    from: FROM,
    to: TC_EMAIL,
    reply_to: data.agentEmail || undefined,
    subject: `New Agent Onboarding: ${data.agentName || 'Unknown'} — ${data.brokerage || ''}`,
    html,
  });
}

// ─── ONBOARDING: Welcome to agent ────────────────────────────────────────────

export async function sendAgentWelcome(data) {
  if (!data.agentEmail) return;

  const html = `
  <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;">
    <div style="background:#4D0D30;padding:24px 32px;">
      <h1 style="color:#fff;margin:0;font-size:20px;letter-spacing:2px;">WELCOME TO MAGENTA TC</h1>
      <p style="color:#D4AFC0;margin:6px 0 0;font-size:13px;">Your onboarding is complete</p>
    </div>
    <div style="padding:28px 32px;background:#fff;">
      <p style="font-size:15px;color:#222;">Hi ${data.agentName?.split(' ')[0] || 'there'},</p>
      <p style="font-size:13px;color:#555;line-height:1.7;">Thanks for onboarding with Magenta TC! We've received your setup information and our team will reach out within one business day to confirm everything and answer any questions.</p>
      <p style="font-size:13px;color:#555;line-height:1.7;">When you're ready to submit your first transaction, use the <strong>Start a New File</strong> form:</p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${process.env.NEXT_PUBLIC_SITE_URL || 'https://magenta-tc.vercel.app'}/start-new-file.html"
           style="background:#4D0D30;color:#fff;padding:14px 36px;text-decoration:none;font-weight:700;letter-spacing:1.5px;font-size:13px;border-radius:3px;text-transform:uppercase;">
          Start a New File →
        </a>
      </div>
      <p style="font-size:13px;color:#555;">Questions? <a href="mailto:tc@magenta.realestate" style="color:#B32D7F;">tc@magenta.realestate</a></p>
      <p style="font-size:13px;color:#555;margin-bottom:0;">— The Magenta TC Team</p>

      ${renderFullDetails('onboarding', data)}
    </div>
    <div style="background:#4D0D30;padding:16px 32px;text-align:center;">
      <p style="color:#897D76;font-size:11px;margin:0;">Magenta TC &nbsp;•&nbsp; tc@magenta.realestate &nbsp;•&nbsp; Las Vegas, NV</p>
    </div>
  </div>`;

  const r = getResend(); if (!r) return; return r.emails.send({
    from: FROM,
    to: data.agentEmail,
    subject: 'Welcome to Magenta TC — You\'re All Set!',
    html,
  });
}
