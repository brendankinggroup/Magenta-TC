# Handoff — Mid-investigation on Magenta-TC

**Delete this file once the open bug is fixed and the audit wraps.**

Paste the first block below into a fresh Claude Code session on the new
machine to resume.

---

## Resume prompt

```
We're mid-investigation on Magenta-TC. Read HANDOFF.md at the repo root
for full context and then pick up exactly where the previous session
left off. Start by firing a fresh diagnostic submission and reading the
X-Debug-* response headers to find the root cause of the sheet-write
bug. Fix it, revert the TEMP debug commits, push, verify, then continue
with the remaining audit items listed at the bottom of HANDOFF.md.
```

---

## 🚨 Open bug (priority 1)

**Symptom:** `POST /api/new-file` returns `HTTP 200` but new rows rarely
land in the `🏠 Active Transactions` tab. Only one historical row
("123 TEST — please ignore") ever successfully wrote. Subsequent 5+ test
submissions all returned 200 but aren't present in the sheet.

The companion flow (`POST /api/onboarding`) DOES land rows — but most
fields come through empty. Only `agentName` (from `firstName`+`lastName`),
`agentEmail`, and the auto `Date Added` populate. Other fields like
`brokerage`, `agentPhone`, `docPlatform`, `licenseNumber` are all empty
strings on the row despite being submitted.

### What's been ruled out

- ✅ `formidable` is parsing all fields correctly. Confirmed via
  `X-Debug-Fields` response header added in commit `8a3aa4b`: 18 fields
  parse successfully from a test submission, including `agentName`,
  `agentEmail`, `agentPhone`, `agentBrokerage`.
- ✅ `GOOGLE_SHEET_ID` env var is set on production (`vercel env ls`).
- ✅ Service account has write access — the original "123 TEST" row did
  land, and the Onboarding tab currently receives rows.
- ✅ Vercel CLI logs show no errors, no 500 responses, no stderr. The
  log-drain CLI only surfaces request summaries, not lambda stdout.
- ✅ The `f()` helper and `safe()` sanitization function look correct on
  code review.

### Diagnostic in place (commits `8a3aa4b` + `886a2e7`)

Three temp response headers are exposed on `/api/new-file`:
- `X-Debug-Field-Count` — number of fields formidable parsed
- `X-Debug-Fields` — JSON sample of parsed field keys + truncated values
- `X-Debug-Data-Sample` — JSON of the 4 key `data` object values right
  before the sheet write
- `X-Debug-Sheet-ID-Set` — `true/false` for whether `GOOGLE_SHEET_ID` is set
- `X-Debug-Sheet-Append` — the Sheets API response `updates` block on
  success (shows which range was actually written to)
- `X-Debug-Sheet-Error` — the caught error message on failure

### Step-by-step resume

1. **Confirm latest deploy is ready:**
   ```bash
   vercel ls magenta-tc | head -3
   ```

2. **Fire a diagnostic submission:**
   ```bash
   curl -s -D /tmp/h.txt -o /tmp/b.txt -X POST \
     https://magenta-tc.vercel.app/api/new-file \
     -F "transactionType=Buyer Contract to Close" \
     -F "propertyAddress=HANDOFF PROBE" \
     -F "city=Las Vegas" -F "state=NV" -F "zip=89135" \
     -F "salePrice=400000" -F "emd=4000" -F "loanType=Conventional" \
     -F "acceptanceDate=2026-04-22" -F "coeDate=2026-05-22" \
     -F "escrowCompany=HEscrow" -F "escrowOfficer=HOfficer" \
     -F "escrowEmail=h@escrow.com" \
     -F "agentName=HandoffAgent" -F "agentEmail=bking@kingvegashomes.com" \
     -F "agentPhone=7025551234" -F "agentBrokerage=HBrokerage" \
     -F "docPlatform=SkySlope"
   grep -iE "^x-debug" /tmp/h.txt
   ```

3. **Interpret headers:**
   - If `X-Debug-Sheet-Error` is set → read the error, fix it (auth,
     range, quota, etc.).
   - If `X-Debug-Sheet-Append` shows `updatedRange: '🏠 Active
     Transactions!Xsomething'` → check that row in the sheet.
   - If both are absent → `GOOGLE_SHEET_ID` got unset (check env).
   - If `X-Debug-Data-Sample` shows empty strings for `agentName`/etc.
     despite `X-Debug-Fields` showing them populated → the bug is
     between formidable's `fields` and our `data` object construction.

4. **Read the sheet to confirm:**
   Use the Google Sheets MCP (reconnect if needed) to query
   `🏠 Active Transactions!I3:I100` — find the row labelled
   "HANDOFF PROBE" if it landed, else it didn't.

5. **Apply the fix** in `api/new-file.js` + `lib/google-sheets.js`.

6. **Revert the TEMP debug code:**
   ```bash
   git revert 886a2e7 8a3aa4b --no-edit
   git push
   ```
   The TEMP debug headers should be gone before real agent traffic.

7. **Verify** with a final clean submission — row should land in the
   sheet with all fields populated.

---

## Project reference

| Thing | Value |
|---|---|
| Live site | https://magenta-tc.vercel.app |
| Repo | https://github.com/brendankinggroup/Magenta-TC |
| Spreadsheet | `1IM079HRCfL5W2dCf_CFDcoLVikBYsrGnzhD8JDc6eJU` |
| Drive root | `1zJ-Jfk1zOOfNUq4vcZTo0n5jKhKfElvf` |
| Drive Transactions | `1Uk-iflAEQeJSpFt5eq4whoy8LMOlnP_8` |
| Drive Onboarding | `1mZEoUVpGuDveJxSTEXf66wuwqPIxDTsi` |
| Vercel project | `magenta-tc` (team `brendan-kings-projects-a0c077c7`) |
| TC_EMAIL (prod) | `tc@magenta.realestate, buyertc@magenta.realestate, sellertc@magenta.realestate, bking@kingvegashomes.com` |
| BACKUP_EMAIL | unset → falls back to TC_EMAIL |

### New-machine setup

```bash
git clone https://github.com/brendankinggroup/Magenta-TC.git
cd Magenta-TC
npm install
npm i -g vercel   # if not already
vercel login
vercel link --project magenta-tc --yes
```

In Claude Code on the new machine, reconnect the **Google Sheets** and
**Google Drive** MCP connectors the first time you need them.

---

## Already-shipped today (don't redo)

- Inspector, Home Warranty Vendor, Brokerage Forms sections on the
  Start-New-File form
- Urgent flag moved to column B with conditional yellow-highlight rule
- Sheet expanded to 80 columns (A:CB); 9 new headers BT:CB with matching
  styling + borders
- File uploads rewired (`<label>` wraps input) on both forms, with
  selected-filename feedback
- Formula-injection sanitization in `lib/google-sheets.js` (`safe()`
  prefixes `=`/`+`/`-`/`@` values with `'`)
- Backup email (JSON + files) sent to `BACKUP_EMAIL` before any Google
  API call — independent-provider redundancy
- Full-details section appended to all 4 notification emails
- `TC_EMAIL` accepts comma-separated list (4 recipients currently)
- Drive: `Transactions/` and `Onboarding/` parent folders; transaction
  folders auto-seed 6 standard subfolders (`01-Contract`, `02-Disclosures`,
  `03-Inspection`, `04-Addenda`, `05-Closing`, `06-Broker Compliance`);
  contract upload auto-routed to `01-Contract`
- Communication Preference switched from 3 radio combos to 3 independent
  checkboxes
- Sheet append uses `OVERWRITE` instead of `INSERT_ROWS` so new rows
  inherit the zebra banding instead of the header styling
- First data row is row 3 (not row 4)
- Form field alignment fix (inputs align to bottom when labels wrap)
- Open Graph + Twitter Card meta + favicon + canonical URL on index
- Softened defensible-risk brag stats on the homepage
- Dashboard pipeline formulas wired live (Active Files, Closing This
  Week, Buyer/Seller Files, Avg Days to Close)
- Banded-row alternating colors on both tabs
- README.md with setup + env + layout + roadmap

---

## Still open (after the bug is fixed)

### Verification
- Confirm HANDOFF PROBE row lands fully in `🏠 Active Transactions`
- Verify an onboarding submission populates all fields
- Check the 4 TC inboxes each receive TC alert + backup emails
- Verify the existing test rows 4-7 on Onboarding look correct after the
  format reset (if not, select them and `Format → Clear formatting`)
- Walk each Drive folder structure: transaction folder has the 6
  subfolders; onboarding folder is flat

### Audit items not yet done (from earlier top-10)
- **#3 Honeypot + rate limit** on `/api/new-file` and `/api/onboarding`
  (~30 min). Users are unprotected from bot flooding.
- **#9 Deadline-reminder cron** — user wants to run this on a Mac mini
  rather than Vercel. When they're ready, offer a portable
  `deadlines.mjs` script.
- **Formatting lock decision**: user asked whether to lock the zebra
  pattern via conditional-format even if someone manually colors a cell.
  Three options given (banded range only / hard-lock all rows / compromise).
  User didn't pick. Default is "leave as-is" until they ask.

### Nice-to-haves from the audit
- Dropdown data validation on boolean-ish new columns (HOA, Urgent,
  Home Warranty, etc.)
- Date/currency formatting on the new cells (On Market Date,
  Transaction Fee)
- Widen Notes-type columns (~300px) and freeze columns A-D on Active
  Transactions
- Auto-archive for `Closed` status rows
- Buyer/Seller Checklist tabs are static templates (48 tasks) — should
  link by File # to Active Transactions; user may want a redesign
- Email alerts include critical dates (Acceptance, Inspection End,
  Appraisal Removal) in the headline summary so TCs can triage on phone
- No `reply-to` on agent confirmations
- No Sentry / Slack-piped error alerting

---

## Working style notes

- User is `bking@kingvegashomes.com`, owns brendankinggroup/Magenta-TC
- Prefers I commit + push when changes are ready rather than waiting
- Likes parallel agents when tasks are independent
- Values concise status updates over verbose recaps
- Trusts git history — always safe to push reversible changes;
  warn/confirm before destructive ones
