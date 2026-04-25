// Generate small but valid sample files for upload tests.
// PDFs are minimal hand-crafted single-page docs; DOC/DOCX are stubs with
// believable bytes so formidable's mimetype sniff produces application/*.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'fixtures');
fs.mkdirSync(out, { recursive: true });

function makePdf(label) {
  const stream = `BT /F1 18 Tf 50 720 Td (${label}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objs.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xrefStart = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) {
    body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body, 'binary');
}

const files = [
  ['onboarding-broker-form.pdf', makePdf('Broker Required Form — TEST')],
  ['onboarding-w9.pdf',          makePdf('W-9 — TEST')],
  ['duties-owed.pdf',            makePdf('Duties Owed Disclosure — TEST')],
  ['bbra.pdf',                   makePdf('Buyer Broker Representation Agreement — TEST')],
  ['purchase-agreement.pdf',     makePdf('Purchase Agreement — TEST')],
  ['addendum-1.pdf',             makePdf('Addendum #1 — TEST')],
  ['addendum-2.pdf',             makePdf('Addendum #2 — TEST')],
  ['notes.doc',                  Buffer.from('This is a sample .doc file used for upload testing.\n')],
];

for (const [name, buf] of files) {
  fs.writeFileSync(path.join(out, name), buf);
  console.log(`wrote ${name} (${buf.length} bytes)`);
}
