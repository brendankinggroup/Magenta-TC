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
 * Append a new transaction row to the Active Transactions sheet (A:BS, 71 cols).
 *
 * A: File #          B: Status          C: Type            D: Agent Name
 * E: Agent Email     F: Agent Phone     G: Brokerage       H: Property Address
 * I: Property Type   J: Client Name(s)  K: Side            L: Sale Price
 * M: Loan Type       N: Down Payment    O: EMD             P: Commission
 * Q: Doc Platform    R: COE Date        S: Acceptance Date T: EMD Due Date
 * U: Inspection End  V: Appraisal Rmvl  W: Loan Removal    X: Possession Date
 * Y: Walk Through    Z: Buyer 1 Name    AA: Buyer 1 Email  AB: Buyer 1 Phone
 * AC: Buyer 2 Name   AD: Buyer 2 Email  AE: Buyer 2 Phone  AF: Seller 1 Name
 * AG: Seller 1 Email AH: Seller 1 Phone AI: Seller 2 Name  AJ: Seller 2 Email
 * AK: Seller 2 Phone AL: Other Agent    AM: Other Agnt Eml AN: Escrow Co
 * AO: Escrow Officer AP: Escrow Email   AQ: Escrow Phone   AR: Lender Name
 * AS: Lender Company AT: Lender Email   AU: Lender Phone   AV: Notes
 * AW: Drive Folder   AX: Year Built     AY: HOA            AZ: HOA Company
 * BA: Occupancy      BB: MLS #          BC: Seller Conc.   BD: Home Warranty
 * BE: Transaction Fee BF: Buyer Comm Agr BG: Order Insp.   BH: TC Access
 * BI: Buyer Entity   BJ: Client Loc.    BK: Other Agt Phn  BL: Other Agt Brk
 * BM: Escrow #       BN: On Market Date BO: Is Referral    BP: Referral Info
 * BQ: Special Notes  BR: Inspect Notes  BS: Urgent
 */
export async function appendNewFileRow(data) {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const row = [
    '',                                  // A: File # — auto-generated
    'Open',                              // B: Status
    data.transactionType || '',          // C: Type
    data.agentName || '',                // D: Agent Name
    data.agentEmail || '',               // E: Agent Email
    data.agentPhone || '',               // F: Agent Phone
    data.agentBrokerage || '',           // G: Brokerage
    data.propertyAddress || '',          // H: Property Address
    data.propertyType || '',             // I: Property Type
    data.clientNames || '',              // J: Client Name(s)
    data.side || '',                     // K: Side (Buyer/Seller)
    data.salePrice || '',                // L: Sale Price
    data.loanType || '',                 // M: Loan Type
    data.downPayment || '',              // N: Down Payment
    data.emd || '',                      // O: EMD
    data.commission || '',               // P: Commission
    data.docPlatform || '',              // Q: Doc Platform
    data.coeDate || '',                  // R: COE Date
    data.acceptanceDate || '',           // S: Acceptance Date
    data.emdDueDate || '',               // T: EMD Due Date
    data.inspectionEndDate || '',        // U: Inspection End Date
    data.appraisalRemovalDate || '',     // V: Appraisal Removal Date
    data.loanRemovalDate || '',          // W: Loan Removal Date
    data.possessionDate || '',           // X: Possession Date
    data.walkThroughDate || '',          // Y: Walk Through Date
    data.buyer1Name || '',               // Z: Buyer 1 Name
    data.buyer1Email || '',              // AA: Buyer 1 Email
    data.buyer1Phone || '',              // AB: Buyer 1 Phone
    data.buyer2Name || '',               // AC: Buyer 2 Name
    data.buyer2Email || '',              // AD: Buyer 2 Email
    data.buyer2Phone || '',              // AE: Buyer 2 Phone
    data.seller1Name || '',              // AF: Seller 1 Name
    data.seller1Email || '',             // AG: Seller 1 Email
    data.seller1Phone || '',             // AH: Seller 1 Phone
    data.seller2Name || '',              // AI: Seller 2 Name
    data.seller2Email || '',             // AJ: Seller 2 Email
    data.seller2Phone || '',             // AK: Seller 2 Phone
    data.otherAgentName || '',           // AL: Other Agent Name
    data.otherAgentEmail || '',          // AM: Other Agent Email
    data.escrowCompany || '',            // AN: Escrow Company
    data.escrowOfficer || '',            // AO: Escrow Officer
    data.escrowEmail || '',              // AP: Escrow Email
    data.escrowPhone || '',              // AQ: Escrow Phone
    data.lenderName || '',               // AR: Lender Name
    data.lenderCompany || '',            // AS: Lender Company
    data.lenderEmail || '',              // AT: Lender Email
    data.lenderPhone || '',              // AU: Lender Phone
    data.notes || '',                    // AV: Notes
    data.driveFolderUrl || '',           // AW: Drive Folder Link
    data.yearBuilt || '',                // AX: Year Built
    data.hoa || '',                      // AY: HOA
    data.hoaCompany || '',               // AZ: HOA Company
    data.occupancyStatus || '',          // BA: Occupancy Status
    data.mlsNumber || '',                // BB: MLS #
    data.sellerConcessions || '',        // BC: Seller Concessions
    data.homeWarranty || '',             // BD: Home Warranty
    data.transactionFee || '',           // BE: Transaction Fee
    data.buyerCommissionAgreement || '', // BF: Buyer Commission Agreement
    data.orderInspection || '',          // BG: Order Inspection
    data.tcAccess || '',                 // BH: TC Access
    data.buyerEntity || '',              // BI: Buyer Entity
    data.clientLocation || '',           // BJ: Client Location
    data.otherAgentPhone || '',          // BK: Other Agent Phone
    data.otherAgentBrokerage || '',      // BL: Other Agent Brokerage
    data.escrowNumber || '',             // BM: Escrow #
    data.onMarketDate || '',             // BN: On Market Date
    data.isReferral || '',               // BO: Is Referral
    data.referralInfo || '',             // BP: Referral Info
    data.specialDateNotes || '',         // BQ: Special Date Notes
    data.inspectionNotes || '',          // BR: Inspection Notes
    data.urgent ? 'TRUE' : '',           // BS: Urgent
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: '🏠 Active Transactions!A4:BS',
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
