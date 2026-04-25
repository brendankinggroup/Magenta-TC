// Local test harness — mounts the two Vercel API handlers under a plain
// Node http server so we can hit them with multipart POSTs offline.
// Adds the `res.status().json()` shim that Vercel injects in production.
import http from 'http';
import formidable from 'formidable';
import onboarding from '../api/onboarding.js';
import newFile from '../api/new-file.js';

async function echo(req, res) {
  const form = formidable({ multiples: true, allowEmptyFiles: true, minFileSize: 0 });
  const [fields, files] = await form.parse(req);
  const fileSummary = {};
  for (const [k, v] of Object.entries(files)) {
    fileSummary[k] = [].concat(v).map(f => ({
      name: f.originalFilename, type: f.mimetype, size: f.size,
    }));
  }
  res.status(200).json({ fields, files: fileSummary });
}

function shim(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(obj));
    return res;
  };
  return res;
}

const routes = {
  '/api/onboarding': onboarding,
  '/api/new-file': newFile,
  '/api/echo': echo,
};

const server = http.createServer(async (req, res) => {
  shim(res);
  const handler = routes[req.url];
  if (!handler) return res.status(404).json({ error: 'not found' });
  try {
    await handler(req, res);
  } catch (err) {
    console.error('[harness] unhandled:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3737;
server.listen(PORT, () => console.log(`[harness] listening on :${PORT}`));
