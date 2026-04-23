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
 * Append a new transaction row to the Active Transactions sheet (A:CB, 80 cols).
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
  row[0] = `${currentYY}-${String(nextFileNum).padStart(3, '0')}`; // A: File # (YY-NNN, counter resets yearly)

  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `🏠 Active Transactions!A${nextRow}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });
}

/**
 * Append a new agent row to the Agent Onboarding sheet (A:AR, 44 cols).
 *
 * A: Agent Name       B: Brokerage        C: Email            D: Phone
 * E: Doc Platform     F: License #        G: Date Added       H: Notes
 * I: Preferred Name   J: Broker of Rec.   K: Broker Phone     L: Office Addr
 * M: Team Name        N: Add'l License    O: Compliance       P: CRM
 * Q: E-Sign           R: Showing          S: Login Notes      T: Pref Escrow
 * U: Pref Lender      V: Pref Inspector   W: Pref Other Vdr   X: Tx Types
 * Y: Tx Volume        Z: Comm Split       AA: Primary Market  AB: Comm Pref
 * AC: Comm Email      AD: Comm Phone      AE: Pref Hours      AF: Work Prefs
 * AG: Billing Name    AH: Entity Type     AI: Billing Email   AJ: Referral Src
 * AK: Referral Agent  AL: Drive Folder
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
    safe(data.prefLender),                     // U
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
