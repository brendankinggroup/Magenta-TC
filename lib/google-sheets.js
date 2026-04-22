import { google } from 'googleapis';

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
    '',                                  // A: File # (auto)
    data.urgent ? 'TRUE' : '',           // B: Urgent
    'Open',                              // C: Status
    data.transactionType || '',          // D: Type
    data.agentName || '',                // E: Agent Name
    data.agentEmail || '',               // F: Agent Email
    data.agentPhone || '',               // G: Agent Phone
    data.agentBrokerage || '',           // H: Brokerage
    data.propertyAddress || '',          // I: Property Address
    data.propertyType || '',             // J: Property Type
    data.clientNames || '',              // K: Client Name(s)
    data.side || '',                     // L: Side
    data.salePrice || '',                // M: Sale Price
    data.loanType || '',                 // N: Loan Type
    data.downPayment || '',              // O: Down Payment
    data.emd || '',                      // P: EMD
    data.commission || '',               // Q: Commission
    data.docPlatform || '',              // R: Doc Platform
    data.coeDate || '',                  // S: COE Date
    data.acceptanceDate || '',           // T: Acceptance Date
    data.emdDueDate || '',               // U: EMD Due Date
    data.inspectionEndDate || '',        // V: Inspection End Date
    data.appraisalRemovalDate || '',     // W: Appraisal Removal Date
    data.loanRemovalDate || '',          // X: Loan Removal Date
    data.possessionDate || '',           // Y: Possession Date
    data.walkThroughDate || '',          // Z: Walk Through Date
    data.buyer1Name || '',               // AA: Buyer 1 Name
    data.buyer1Email || '',              // AB: Buyer 1 Email
    data.buyer1Phone || '',              // AC: Buyer 1 Phone
    data.buyer2Name || '',               // AD: Buyer 2 Name
    data.buyer2Email || '',              // AE: Buyer 2 Email
    data.buyer2Phone || '',              // AF: Buyer 2 Phone
    data.seller1Name || '',              // AG: Seller 1 Name
    data.seller1Email || '',             // AH: Seller 1 Email
    data.seller1Phone || '',             // AI: Seller 1 Phone
    data.seller2Name || '',              // AJ: Seller 2 Name
    data.seller2Email || '',             // AK: Seller 2 Email
    data.seller2Phone || '',             // AL: Seller 2 Phone
    data.otherAgentName || '',           // AM: Other Agent Name
    data.otherAgentEmail || '',          // AN: Other Agent Email
    data.escrowCompany || '',            // AO: Escrow Company
    data.escrowOfficer || '',            // AP: Escrow Officer
    data.escrowEmail || '',              // AQ: Escrow Email
    data.escrowPhone || '',              // AR: Escrow Phone
    data.lenderName || '',               // AS: Lender Name
    data.lenderCompany || '',            // AT: Lender Company
    data.lenderEmail || '',              // AU: Lender Email
    data.lenderPhone || '',              // AV: Lender Phone
    data.notes || '',                    // AW: Notes
    data.driveFolderUrl || '',           // AX: Drive Folder
    data.yearBuilt || '',                // AY: Year Built
    data.hoa || '',                      // AZ: HOA
    data.hoaCompany || '',               // BA: HOA Company
    data.occupancyStatus || '',          // BB: Occupancy Status
    data.mlsNumber || '',                // BC: MLS #
    data.sellerConcessions || '',        // BD: Seller Concessions
    data.homeWarranty || '',             // BE: Home Warranty
    data.transactionFee || '',           // BF: Transaction Fee
    data.buyerCommissionAgreement || '', // BG: Buyer Commission Agreement
    data.orderInspection || '',          // BH: Order Inspection
    data.tcAccess || '',                 // BI: TC Access
    data.buyerEntity || '',              // BJ: Buyer Entity
    data.clientLocation || '',           // BK: Client Location
    data.otherAgentPhone || '',          // BL: Other Agent Phone
    data.otherAgentBrokerage || '',      // BM: Other Agent Brokerage
    data.escrowNumber || '',             // BN: Escrow #
    data.onMarketDate || '',             // BO: On Market Date
    data.isReferral || '',               // BP: Is Referral
    data.referralInfo || '',             // BQ: Referral Info
    data.specialDateNotes || '',         // BR: Special Date Notes
    data.inspectionNotes || '',          // BS: Inspection Notes
    data.inspectorName || '',            // BT: Inspector Name
    data.inspectorCompany || '',         // BU: Inspector Company
    data.inspectorPhone || '',           // BV: Inspector Phone
    data.inspectorEmail || '',           // BW: Inspector Email
    data.warrantyCompany || '',          // BX: Warranty Company
    data.warrantyContact || '',          // BY: Warranty Contact
    data.warrantyPhone || '',            // BZ: Warranty Phone
    data.warrantyEmail || '',            // CA: Warranty Email
    data.brokerageFormsRequired || '',   // CB: Brokerage Forms Required
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: '🏠 Active Transactions!A4:CB',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

/**
 * Append a new agent row to the Agent Onboarding sheet (A:AL, 38 cols).
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
    data.agentName || '',                      // A
    data.brokerage || '',                      // B
    data.agentEmail || '',                     // C
    data.agentPhone || '',                     // D
    data.docPlatform || '',                    // E
    data.licenseNumber || '',                  // F
    new Date().toLocaleDateString('en-US'),    // G: Date Added
    data.notes || '',                          // H: Notes
    data.preferredName || '',                  // I
    data.brokerOfRecord || '',                 // J
    data.brokerPhone || '',                    // K
    data.officeAddress || '',                  // L
    data.teamName || '',                       // M
    data.additionalLicense || '',              // N
    data.complianceContact || '',              // O
    data.crm || '',                            // P
    data.esignPlatform || '',                  // Q
    data.showingPlatform || '',                // R
    data.loginNotes || '',                     // S
    data.prefEscrow || '',                     // T
    data.prefLender || '',                     // U
    data.prefInspector || '',                  // V
    data.prefOtherVendor || '',                // W
    data.transactionTypes || '',               // X
    data.txVolume || '',                       // Y
    data.commissionSplit || '',                // Z
    data.primaryMarket || '',                  // AA
    data.communicationPref || '',              // AB
    data.commEmail || '',                      // AC
    data.commPhone || '',                      // AD
    data.preferredHours || '',                 // AE
    data.workPreferences || '',                // AF
    data.billingName || '',                    // AG
    data.entityType || '',                     // AH
    data.billingEmail || '',                   // AI
    data.referralSource || '',                 // AJ
    data.referralAgent || '',                  // AK
    data.driveFolderUrl || '',                 // AL
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: '👤 Agent Onboarding!A:AL',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}
