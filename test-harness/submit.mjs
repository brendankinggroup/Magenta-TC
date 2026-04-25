// Build & POST a multipart/form-data request to one of the local handlers.
// Uses Node 18+ FormData/Blob (no extra deps).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'fixtures');
const PORT = process.env.PORT || 3737;
const target = process.argv[2]; // 'onboarding' | 'new-file'

if (!['onboarding', 'new-file'].includes(target)) {
  console.error('usage: node submit.mjs <onboarding|new-file>');
  process.exit(1);
}

function file(name, mime) {
  const buf = fs.readFileSync(path.join(fixtures, name));
  return new File([buf], name, { type: mime });
}

const form = new FormData();

if (target === 'onboarding') {
  // Required fields per agent-onboarding.html
  form.set('firstName', 'Testy');
  form.set('lastName', 'McTestface');
  form.set('agentEmail', 'testy@example.com');
  form.set('agentPhone', '555-555-0100');
  form.set('brokerage', 'Test Realty Group');
  form.set('docPlatform', 'reZEN');
  form.set('commPref', 'Email');
  form.set('commEmail', 'testy@example.com');
  form.set('billingName', 'Testy McTestface');
  // Multi-file upload: brokerForms (PDF + DOC)
  form.append('brokerForms', file('onboarding-broker-form.pdf', 'application/pdf'));
  form.append('brokerForms', file('onboarding-w9.pdf',          'application/pdf'));
  form.append('brokerForms', file('notes.doc',                   'application/msword'));
} else {
  // Required fields per start-new-file.html
  form.set('transactionType', 'Buyer Contract to Close');
  form.set('clientName',  'Buyer Test');
  form.set('clientPhone', '555-555-0200');
  form.set('clientEmail', 'buyer@example.com');
  form.set('propertyAddress', '123 Test St, Reno, NV 89501');
  form.set('agentName',  'Agent Test');
  form.set('agentPhone', '555-555-0300');
  form.set('agentEmail', 'agent@example.com');
  // All four upload sections, each with a PDF (and notes.doc on addenda)
  form.append('dutiesOwed', file('duties-owed.pdf',          'application/pdf'));
  form.append('bbra',       file('bbra.pdf',                 'application/pdf'));
  form.append('agreement',  file('purchase-agreement.pdf',   'application/pdf'));
  form.append('addenda',    file('addendum-1.pdf',           'application/pdf'));
  form.append('addenda',    file('addendum-2.pdf',           'application/pdf'));
  form.append('addenda',    file('notes.doc',                'application/msword'));
}

const route = process.env.ECHO ? 'echo' : target;
const url = `http://127.0.0.1:${PORT}/api/${route}`;
console.log(`POST ${url}`);
const t0 = Date.now();
const r = await fetch(url, { method: 'POST', body: form });
const ms = Date.now() - t0;
const text = await r.text();
console.log(`→ ${r.status} (${ms}ms)  body: ${text}`);
process.exit(r.ok ? 0 : 2);
