# Magenta TC

Transaction coordination intake site for Magenta Real Estate. Deployed at
[magenta-tc.vercel.app](https://magenta-tc.vercel.app/).

## What's here

- `index.html` — marketing homepage (services, pricing, ROI, testimonials)
- `start-new-file.html` — agent submits a new transaction file
- `agent-onboarding.html` — new agent signs up for the service
- `api/new-file.js` — handles new-file submissions
- `api/onboarding.js` — handles onboarding submissions
- `lib/google-sheets.js` — appends rows to the TC spreadsheet
- `lib/google-drive.js` — creates a per-transaction folder and uploads files
- `lib/email.js` — sends TC alerts and agent confirmations via Resend
- `lib/notifications.js` — optional Slack webhook + Twilio SMS alerts

## Stack

Static HTML + Vercel serverless functions (Node, ESM). No build step.

- `formidable` — multipart form parsing
- `googleapis` — Sheets + Drive
- `resend` — transactional email
- `twilio` — SMS (optional)

## Integrations

| What | Where |
|---|---|
| Source spreadsheet | [Magenta_TC_Transaction_Management](https://docs.google.com/spreadsheets/d/1IM079HRCfL5W2dCf_CFDcoLVikBYsrGnzhD8JDc6eJU/) |
| Drive root folder | `1zJ-Jfk1zOOfNUq4vcZTo0n5jKhKfElvf` (subfolder per transaction) |
| TC alerts | `tc@magenta.realestate` (Resend) |
| Live deploy | Vercel, `main` branch |

## Environment variables

Copy `.env.example` to `.env` and fill in:

| Var | Required | Purpose |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | ✓ | Service account for Sheets + Drive |
| `GOOGLE_PRIVATE_KEY` | ✓ | Service account private key (escaped newlines) |
| `GOOGLE_SHEET_ID` | ✓ | Target spreadsheet ID |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | ✓ | Parent Drive folder for per-transaction folders |
| `RESEND_API_KEY` | ✓ | Transactional email |
| `TC_EMAIL` | | Defaults to `tc@magenta.realestate` |
| `EMAIL_FROM` | | Sender line for outbound email |
| `BACKUP_EMAIL` | | Receives raw-data `[BACKUP]` + `[BACKUP-FILES]` emails. Falls back to `TC_EMAIL`. |
| `NEXT_PUBLIC_SITE_URL` | | Used in email links |
| `SLACK_WEBHOOK_URL` | optional | Posts to `#tc` channel |
| `TWILIO_*` | optional | SMS alerts (SID, auth token, from, to) |

The service account needs **Editor** access on the sheet and the Drive root
folder. Enabled scopes in code: `spreadsheets`, `drive`.

## Local dev

```bash
# Install
npm install

# Vercel CLI runs the serverless functions locally
npx vercel dev
```

## Deploy

Pushes to `main` auto-deploy via Vercel. No CI.

## Spreadsheet layout

- **🏠 Active Transactions** — 80 cols (A:CB). New rows appended at row 4 via
  `appendNewFileRow`. Column B is **Urgent** — rows with Urgent = TRUE get a
  yellow highlight via conditional format.
- **👤 Agent Onboarding** — 38 cols (A:AL). New rows appended via
  `appendAgentRow`.
- **📊 Dashboard** — pipeline counts (formulas against Active Transactions).
- Other tabs: Buyer Checklist, Seller Checklist, Email Templates, Fee
  Tracker, Contacts, How to Use — maintained manually.

Column-order changes in `lib/google-sheets.js` must stay in sync with the
sheet's header row. If headers are renamed in the sheet, update the comments
in `google-sheets.js` too.

## Known gaps / roadmap

See the audit issues in the repo. High-impact items still open:
- No rate limiting / honeypot on the public endpoints
- No deadline-reminder cron (scan Active Transactions daily, Slack the TC)
- Buyer/Seller Checklists are static — should link to File #
- No attachments on TC alert email
- No error observability (Sentry or Slack-piped logs)
- No README for the sheet's `📘 How to Use` tab — worth filling in

## Contact

Operations: `tc@magenta.realestate` · 702.904.8895
