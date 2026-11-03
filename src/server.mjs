import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { listJobs, getJob, setStatus, clearStatus, stats } from './db.mjs';

// Some shells export PORT=0; treat anything non-positive as "use the default".
const envPort = Number(process.env.PORT);
const PORT = Number.isInteger(envPort) && envPort > 0 ? envPort : 4321;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = resolve('public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const VALID_STATUSES = new Set(['', 'new', 'applied', 'interview', 'rejected', 'offer']);

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith('/api/')) {
      return await handleApi(req, res, url);
    }

    return await serveStatic(res, url.pathname);
  } catch (error) {
    console.error('request failed:', error);
    json(res, 500, { error: 'internal server error' });
  }
});

async function handleApi(req, res, url) {
  if (url.pathname === '/api/jobs' && req.method === 'GET') {
    const jobs = listJobs({
      q: url.searchParams.get('q') ?? '',
      remote: url.searchParams.get('remote') === '1',
      minScore: Number(url.searchParams.get('minScore') ?? 0),
      hideSenior: url.searchParams.get('hideSenior') !== '0',
      status: url.searchParams.get('status') ?? '',
      limit: Number(url.searchParams.get('limit') ?? 100),
    });
    return json(res, 200, { count: jobs.length, jobs });
  }

  if (url.pathname === '/api/stats' && req.method === 'GET') {
    return json(res, 200, stats());
  }

  const statusMatch = url.pathname.match(/^\/api\/jobs\/(.+)\/status$/);
  if (statusMatch && req.method === 'POST') {
    const jobId = decodeURIComponent(statusMatch[1]);
    const body = await readBody(req);
    const status = String(body.status ?? '');

    if (!VALID_STATUSES.has(status)) {
      return json(res, 400, { error: 'invalid status' });
    }
    if (!getJob(jobId)) {
      return json(res, 404, { error: 'unknown job' });
    }

    // "new" means no application row at all, which keeps the status filter simple.
    if (!status || status === 'new') {
      clearStatus(jobId);
    } else {
      setStatus(jobId, status);
    }

    return json(res, 200, { ok: true, id: jobId, status: status || 'new' });
  }

  if (url.pathname === '/api/health') {
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: 'not found' });
}

async function serveStatic(res, pathname) {
  const relative = normalize(decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
  const filePath = join(PUBLIC_DIR, relative);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return json(res, 403, { error: 'forbidden' });
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch {
    json(res, 404, { error: 'not found' });
  }
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 100_000) rejectBody(new Error('body too large'));
    });
    req.on('end', () => {
      try {
        resolveBody(raw ? JSON.parse(raw) : {});
      } catch {
        resolveBody({});
      }
    });
    req.on('error', rejectBody);
  });
}

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`RoleFinder listening on http://${shown}:${PORT}`);
  if (HOST === '0.0.0.0') {
    console.log('bound to all interfaces, so a phone on the same wifi can reach it');
  }
});
