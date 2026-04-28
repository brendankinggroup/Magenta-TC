import { google } from 'googleapis';

// Prevent formula injection — any cell starting with = + - @ gets a leading '
// so Sheets treats it as text instead of a formula.
function safe(v) {
  if (v == null) return '';
  const s = String(v);
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}

function getAuth() {
  return new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
}

/**
 * Append a new transaction row to the Active Transactions sheet (A:CO, 93 cols).
 *
 * Column order (Urgent moved to B so TCs see it immediately):
 * A: File # (auto)     B: Urgent            C: Status            D: Type
 * E: Agent Name        F: Agent Email       G: Agent Phone       H: Brokerage
 * I: Property Address  J: Property Type     K: Client Name(s)    L: Side
 * M: Sale Price        N: Loan Type         O: Down Payment      P: EMD
 * Q: Commission        R: Doc Platform      S: COE Date          T: Acceptance Date
 * U: EMD Due Date      V: Inspection End    W: Appraisal Rmvl    X: Loan Removal
 * Y: Possession Date   Z: Walk Through      AA: Buyer 1 Name     AB: Buyer 1 Email
 * AC: Buyer 1 Phone    AD: Buyer 2 Name     AE: Buyer 2 Email    AF: Buyer 2 Phone
 * AG: Seller 1 Name    AH: Seller 1 Email   AI: Seller 1 Phone   AJ: Seller 2 Name
 * AK: Seller 2 Email   AL: Seller 2 Phone   AM: Other Agent      AN: Other Agt Email
 * AO: Escrow Co        AP: Escrow Officer   AQ: Escrow Email     AR: Escrow Phone
 * AS: Lender Name      AT: Lender Company   AU: Lender Email     AV: Lender Phone
 * AW: Notes            AX: Drive Folder     AY: Year Built       AZ: HOA
 * BA: HOA Company      BB: Occupancy        BC: MLS #            BD: Seller Conc.
 * BE: Home Warranty    BF: Transaction Fee  BG: Buyer Comm Agr   BH: Order Insp.
 * BI: TC Access        BJ: Buyer Entity     BK: Client Location  BL: Other Agt Phn
 * BM: Other Agt Brk    BN: Escrow #         BO: On Market Date   BP: Is Referral
 * BQ: Referral Info    BR: Special Notes    BS: Inspect Notes    BT: Inspector Name
 * BU: Inspector Co     BV: Inspector Phone  BW: Inspector Email  BX: Warranty Co
 * BY: Warranty Contact BZ: Warranty Phone   CA: Warranty Email   CB: Brokerage Forms
 * CC: Checklist URL    CD: Buyer 3 Name     CE: Buyer 3 Email    CF: Buyer 3 Phone
 * CG: Buyer 4 Name     CH: Buyer 4 Email    CI: Buyer 4 Phone    CJ: Seller 3 Name
 * CK: Seller 3 Email   CL: Seller 3 Phone   CM: Seller 4 Name    CN: Seller 4 Email
 * CO: Seller 4 Phone
 */
export async function appendNewFileRow(data) {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const row = [
    '',                                  // A: File # — filled in below (YY-NNN, year-scoped sequential)
    data.urgent ? 'TRUE' : '',           // B: Urgent
    'Open',                              // C: Status
    safe(data.transactionType),          // D: Type
    safe(data.agentName),                // E: Agent Name
    safe(data.agentEmail),               // F: Agent Email
    safe(data.agentPhone),               // G: Agent Phone
    safe(data.agentBrokerage),           // H: Brokerage
    safe(data.propertyAddress),          // I: Property Address
    safe(data.propertyType),             // J: Property Type
    safe(data.clientNames),              // K: Client Name(s)
    safe(data.side),                     // L: Side
    safe(data.salePrice),                // M: Sale Price
    safe(data.loanType),                 // N: Loan Type
    safe(data.downPayment),              // O: Down Payment
    safe(data.emd),                      // P: EMD
    safe(data.commission),               // Q: Commission
    safe(data.docPlatform),              // R: Doc Platform
    safe(data.coeDate),                  // S: COE Date
    safe(data.acceptanceDate),           // T: Acceptance Date
    safe(data.emdDueDate),               // U: EMD Due Date
    safe(data.inspectionEndDate),        // V: Inspection End Date
    safe(data.appraisalRemovalDate),     // W: Appraisal Removal Date
    safe(data.loanRemovalDate),          // X: Loan Removal Date
    safe(data.possessionDate),           // Y: Possession Date
    safe(data.walkThroughDate),          // Z: Walk Through Date
    safe(data.buyer1Name),               // AA: Buyer 1 Name
    safe(data.buyer1Email),              // AB: Buyer 1 Email
    safe(data.buyer1Phone),              // AC: Buyer 1 Phone
    safe(data.buyer2Name),               // AD: Buyer 2 Name
    safe(data.buyer2Email),              // AE: Buyer 2 Email
    safe(data.buyer2Phone),              // AF: Buyer 2 Phone
    safe(data.seller1Name),              // AG: Seller 1 Name
    safe(data.seller1Email),             // AH: Seller 1 Email
    safe(data.seller1Phone),             // AI: Seller 1 Phone
    safe(data.seller2Name),              // AJ: Seller 2 Name
    safe(data.seller2Email),             // AK: Seller 2 Email
    safe(data.seller2Phone),             // AL: Seller 2 Phone
    safe(data.otherAgentName),           // AM: Other Agent Name
    safe(data.otherAgentEmail),          // AN: Other Agent Email
    safe(data.escrowCompany),            // AO: Escrow Company
    safe(data.escrowOfficer),            // AP: Escrow Officer
    safe(data.escrowEmail),              // AQ: Escrow Email
    safe(data.escrowPhone),              // AR: Escrow Phone
    safe(data.lenderName),               // AS: Lender Name
    safe(data.lenderCompany),            // AT: Lender Company
    safe(data.lenderEmail),              // AU: Lender Email
    safe(data.lenderPhone),              // AV: Lender Phone
    safe(data.notes),                    // AW: Notes
    safe(data.driveFolderUrl),           // AX: Drive Folder
    safe(data.yearBuilt),                // AY: Year Built
    safe(data.hoa),                      // AZ: HOA
    safe(data.hoaCompany),               // BA: HOA Company
    safe(data.occupancyStatus),          // BB: Occupancy Status
    safe(data.mlsNumber),                // BC: MLS #
    safe(data.sellerConcessions),        // BD: Seller Concessions
    safe(data.homeWarranty),             // BE: Home Warranty
    safe(data.transactionFee),           // BF: Transaction Fee
    safe(data.buyerCommissionAgreement), // BG: Buyer Commission Agreement
    safe(data.orderInspection),          // BH: Order Inspection
    safe(data.tcAccess),                 // BI: TC Access
    safe(data.buyerEntity),              // BJ: Buyer Entity
    safe(data.clientLocation),           // BK: Client Location
    safe(data.otherAgentPhone),          // BL: Other Agent Phone
    safe(data.otherAgentBrokerage),      // BM: Other Agent Brokerage
    safe(data.escrowNumber),             // BN: Escrow #
    safe(data.onMarketDate),             // BO: On Market Date
    safe(data.isReferral),               // BP: Is Referral
    safe(data.referralInfo),             // BQ: Referral Info
    safe(data.specialDateNotes),         // BR: Special Date Notes
    safe(data.inspectionNotes),          // BS: Inspection Notes
    safe(data.inspectorName),            // BT: Inspector Name
    safe(data.inspectorCompany),         // BU: Inspector Company
    safe(data.inspectorPhone),           // BV: Inspector Phone
    safe(data.inspectorEmail),           // BW: Inspector Email
    safe(data.warrantyCompany),          // BX: Warranty Company
    safe(data.warrantyContact),          // BY: Warranty Contact
    safe(data.warrantyPhone),            // BZ: Warranty Phone
    safe(data.warrantyEmail),            // CA: Warranty Email
    safe(data.brokerageFormsRequired),   // CB: Brokerage Forms Required
    '',                                  // CC: Checklist URL — written separately by setActiveTransactionChecklistUrl after creation
    safe(data.buyer3Name),               // CD: Buyer 3 Name
    safe(data.buyer3Email),              // CE: Buyer 3 Email
    safe(data.buyer3Phone),              // CF: Buyer 3 Phone
    safe(data.buyer4Name),               // CG: Buyer 4 Name
    safe(data.buyer4Email),              // CH: Buyer 4 Email
    safe(data.buyer4Phone),              // CI: Buyer 4 Phone
    safe(data.seller3Name),              // CJ: Seller 3 Name
    safe(data.seller3Email),             // CK: Seller 3 Email
    safe(data.seller3Phone),             // CL: Seller 3 Phone
    safe(data.seller4Name),              // CM: Seller 4 Name
    safe(data.seller4Email),             // CN: Seller 4 Email
    safe(data.seller4Phone),             // CO: Seller 4 Phone
  ];

  // Find the next empty row (col C always has "Open") AND the next
  // sequential File # (scan col A for existing F-NNN values, take max + 1).
  // Done in parallel to avoid a second round-trip.
  const [probeC, probeA] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: '🏠 Active Transactions!C3:C',
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: '🏠 Active Transactions!A3:A',
    }),
  ]);
  const existing = probeC.data.values || [];
  const nextRow = 3 + existing.length;

  // File # format: YY-NNN (e.g. 26-001). The counter resets each year, so
  // we only look at existing IDs whose YY prefix matches the current year.
  const currentYY = String(new Date().getFullYear()).slice(-2);
  let maxFileNum = 0;
  for (const r of probeA.data.values || []) {
    const v = (r && r[0]) || '';
    const m = String(v).match(/^(\d{2})-(\d+)$/);
    if (m && m[1] === currentYY) {
      const n = parseInt(m[2], 10);
      if (n > maxFileNum) maxFileNum = n;
    }
  }
  const nextFileNum = maxFileNum + 1;
  const fileNum = `${currentYY}-${String(nextFileNum).padStart(3, '0')}`;
  row[0] = fileNum; // A: File # (YY-NNN, counter resets yearly)

  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `🏠 Active Transactions!A${nextRow}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });

  return { fileNum, rowNumber: nextRow };
}

/**
 * Update the Checklist URL cell (col CC, idx 80) for a previously-written
 * Active Transactions row. Used after the per-file checklist is created so
 * the row links straight to the live checklist.
 */
export async function setActiveTransactionChecklistUrl(rowNumber, url) {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `🏠 Active Transactions!CC${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[url]] },
  });
}

/**
 * Append a new agent row to the Agent Onboarding sheet (A:AX, 50 cols).
 *
 * A: Agent Name       B: Brokerage        C: Email            D: Phone
 * E: Doc Platform     F: License #        G: Date Added       H: Notes
 * I: Preferred Name   J: Broker of Rec.   K: Broker Phone     L: Office Addr
 * M: Team Name        N: Add'l License    O: Compliance       P: CRM
 * Q: E-Sign           R: Showing          S: Login Notes      T: Pref Escrow
 * U: Pref Lender Name V: Pref Inspector   W: Pref Other Vdr   X: Tx Types
 * Y: Tx Volume        Z: Comm Split       AA: Primary Market  AB: Comm Pref
 * AC: Comm Email      AD: Comm Phone      AE: Pref Hours      AF: Work Prefs
 * AG: Billing Name    AH: Entity Type     AI: Billing Email   AJ: Referral Src
 * AK: Referral Agent  AL: Drive Folder    AM: Pref Escr Phone AN: Pref Escr Email
 * AO: Pref Lndr Phone AP: Pref Lndr Email AQ: Pref Insp Phone AR: Pref Insp Email
 * AS: Pref Lndr Co    AT: Pref Sign Co    AU: Pref Sign Phone AV: Pref Sign Email
 * AW: Collects BCF    AX: BCF Amount
 */
export async function appendAgentRow(data) {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const row = [
    safe(data.agentName),                      // A
    safe(data.brokerage),                      // B
    safe(data.agentEmail),                     // C
    safe(data.agentPhone),                     // D
    safe(data.docPlatform),                    // E
    safe(data.licenseNumber),                  // F
    new Date().toLocaleDateString('en-US'),    // G: Date Added
    safe(data.notes),                          // H: Notes
    safe(data.preferredName),                  // I
    safe(data.brokerOfRecord),                 // J
    safe(data.brokerPhone),                    // K
    safe(data.officeAddress),                  // L
    safe(data.teamName),                       // M
    safe(data.additionalLicense),              // N
    safe(data.complianceContact),              // O
    safe(data.crm),                            // P
    safe(data.esignPlatform),                  // Q
    safe(data.showingPlatform),                // R
    safe(data.loginNotes),                     // S
    safe(data.prefEscrow),                     // T
    safe(data.prefLenderName),                 // U
    safe(data.prefInspector),                  // V
    safe(data.prefOtherVendor),                // W
    safe(data.transactionTypes),               // X
    safe(data.txVolume),                       // Y
    safe(data.commissionSplit),                // Z
    safe(data.primaryMarket),                  // AA
    safe(data.communicationPref),              // AB
    safe(data.commEmail),                      // AC
    safe(data.commPhone),                      // AD
    safe(data.preferredHours),                 // AE
    safe(data.workPreferences),                // AF
    safe(data.billingName),                    // AG
    safe(data.entityType),                     // AH
    safe(data.billingEmail),                   // AI
    safe(data.referralSource),                 // AJ
    safe(data.referralAgent),                  // AK
    safe(data.driveFolderUrl),                 // AL
    safe(data.prefEscrowPhone),                // AM
    safe(data.prefEscrowEmail),                // AN
    safe(data.prefLenderPhone),                // AO
    safe(data.prefLenderEmail),                // AP
    safe(data.prefInspectorPhone),             // AQ
    safe(data.prefInspectorEmail),             // AR
    safe(data.prefLenderCompany),              // AS
    safe(data.prefSignCompany),                // AT
    safe(data.prefSignCompanyPhone),           // AU
    safe(data.prefSignCompanyEmail),           // AV
    safe(data.collectsBrokerCompFee),          // AW
    safe(data.brokerCompFeeAmount),            // AX
  ];

  // Same pattern as appendNewFileRow — probe col A to find next empty row
  // and do an explicit values.update instead of values.append.
  const probe = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: '👤 Agent Onboarding!A4:A',
  });
  const existing = probe.data.values || [];
  const nextRow = 4 + existing.length;

  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `👤 Agent Onboarding!A${nextRow}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });
}

/**
 * Walk Active Transactions and return one entry per row that has both a File #
 * (col A) and a Checklist URL (col CC). Used by the daily cron to know which
 * per-file checklist Sheets to refresh.
 *
 * Returns: [{ fileNum, side, propertyAddress, agentName, checklistSheetId }, ...]
 */
export async function getActiveTransactionsChecklistMap() {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: '🏠 Active Transactions!A4:CC',  // data starts at row 4 (rows 1-2 banner, row 3 headers)
  });
  const rows = res.data.values || [];

  // Column indexes (0-based) per Active Transactions schema:
  //   A=0  File #             D=3  Type ('Buyer' / 'Seller')
  //   E=4  Agent Name         I=8  Property Address
  //   CC=80 Checklist URL
  const out = [];
  for (const row of rows) {
    const fileNum = (row[0] || '').toString().trim();
    const checklistUrl = (row[80] || '').toString().trim();
    if (!fileNum || !checklistUrl) continue;
    const m = checklistUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (!m) continue;
    const side = (row[3] || '').toString().trim().toLowerCase().startsWith('seller') ? 'Seller' : 'Buyer';
    out.push({
      fileNum,
      side,
      agentName: (row[4] || '').toString(),
      propertyAddress: (row[8] || '').toString(),
      checklistSheetId: m[1],
    });
  }
  return out;
}

/* ─── Per-file checklist rollup ─────────────────────────────────────────── */

const TEMPLATE_TABS = {
  Buyer:  '✅ Buyer Checklist (Template)',
  Seller: '📋 Seller Checklist (Template)',
};
const MASTER_TABS = {
  Buyer:  '✅ Buyer TC Tasks',
  Seller: '📋 Seller TC Tasks',
};

/**
 * Read the buyer or seller template tab and append one row per task to the
 * matching master TC tasks tab. Preserves the original template order;
 * for the Seller template, the two phase-header rows ("PHASE 1: …",
 * "PHASE 2: …") are written as bolded separator rows so the workflow
 * boundary is visible.
 *
 * Master row schema (11 cols A:K):
 *   A File #  B Property  C Agent  D Phase  E Task #  F Task
 *   G Status (default 'Pending')  H Due Date  I Date Completed
 *   J Notes  K Assigned To
 *
 * Returns: { count, firstRow, lastRow } so the caller can do follow-up work
 * if needed.
 */
export async function appendChecklistRowsToMaster({ fileNum, propertyAddress, agentName, side }) {
  if (side !== 'Buyer' && side !== 'Seller') {
    throw new Error(`appendChecklistRowsToMaster: invalid side ${JSON.stringify(side)}`);
  }
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const templateTab = TEMPLATE_TABS[side];
  const masterTab = MASTER_TABS[side];

  // Pull template rows starting at row 13 (where tasks begin) through 200.
  // Cols A=Task#, B=Task, F=Assigned To (E in 1-indexed terms is DATE COMPLETED — skip).
  const tplRes = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `'${templateTab}'!A13:F200`,
  });
  const tplRows = tplRes.data.values || [];

  // Walk and classify each row:
  //   - Phase header: col A holds the "PHASE X: …" label (col B empty).
  //                   Seen only on the Seller template at rows 13 and 34.
  //   - Task row:     col A is numeric (task #), col B is the task text.
  //   - Skip:         everything else (blank rows, separators).
  let currentPhase = '';
  const masterRows = [];
  for (const r of tplRows) {
    const colA = (r[0] || '').toString().trim();
    const colB = (r[1] || '').toString().trim();
    const assigned = (r[5] || '').toString().trim();
    if (/^PHASE\s/i.test(colA)) {
      currentPhase = colA;
      masterRows.push([
        safe(fileNum),
        safe(propertyAddress),
        safe(agentName),
        safe(currentPhase),       // D: Phase
        '',                        // E: Task #
        `— ${currentPhase} —`,    // F: Task (visual separator)
        '',                        // G: Status
        '',                        // H: Due Date
        '',                        // I: Date Completed
        '',                        // J: Notes
        '',                        // K: Assigned To
      ]);
      continue;
    }
    const taskNum = colA;
    const task = colB;
    if (!taskNum || !task) continue;
    if (!/^\d+$/.test(taskNum)) continue; // Skip non-numeric leading cells
    masterRows.push([
      safe(fileNum),
      safe(propertyAddress),
      safe(agentName),
      safe(currentPhase),    // D: Phase ('' for buyer; PHASE 1/2 for seller)
      safe(taskNum),         // E: Task #
      safe(task),            // F: Task
      'Pending',             // G: Status
      '',                    // H: Due Date (manual)
      '',                    // I: Date Completed
      '',                    // J: Notes
      safe(assigned),        // K: Assigned To (passes through template value)
    ]);
  }

  if (masterRows.length === 0) return { count: 0, firstRow: null, lastRow: null };

  // Find next empty row in master tab (probe col A from row 3 onward;
  // rows 1-2 are banner + header).
  const probe = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `'${masterTab}'!A3:A`,
  });
  const existing = probe.data.values || [];
  const firstRow = 3 + existing.length;
  const lastRow = firstRow + masterRows.length - 1;

  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `'${masterTab}'!A${firstRow}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: masterRows },
  });

  return { count: masterRows.length, firstRow, lastRow };
}
