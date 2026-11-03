import { mkdir, cp, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DIST = resolve('dist');
const SNAPSHOT = resolve('snapshot/jobs.json');
const DB_PATH = process.env.ROLEFINDER_DB || resolve('data/rolefinder.db');

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
await cp(resolve('public'), DIST, { recursive: true });

let jobs = [];
let source = 'none';

if (existsSync(DB_PATH)) {
  process.env.ROLEFINDER_DB = DB_PATH;
  const { db } = await import('../src/db.mjs');

  const rows = db
    .prepare(`
      SELECT j.id, j.provider, j.company, j.title, j.location, j.remote,
             j.department, j.url, j.posted_at, j.score, j.matched, a.status
      FROM jobs j
      LEFT JOIN applications a ON a.job_id = j.id
      ORDER BY j.score DESC, j.posted_at DESC, j.id ASC
    `)
    .all();

  jobs = rows.map((row) => ({
    ...row,
    remote: Boolean(row.remote),
    matched: parse(row.matched),
  }));
  source = 'sqlite';

  // Keep a committed snapshot so CI builds never need a network call or a database.
  await mkdir(resolve('snapshot'), { recursive: true });
  await writeFile(SNAPSHOT, JSON.stringify(jobs));
} else if (existsSync(SNAPSHOT)) {
  jobs = JSON.parse(await readFile(SNAPSHOT, 'utf8'));
  source = 'snapshot';
}

await mkdir(resolve(DIST, 'data'), { recursive: true });
await writeFile(resolve(DIST, 'data', 'jobs.json'), JSON.stringify(jobs));

const stats = {
  total: jobs.length,
  remote: jobs.filter((j) => j.remote).length,
  strong: jobs.filter((j) => j.score >= 35).length,
  applied: jobs.filter((j) => j.status === 'applied').length,
  generated: new Date().toISOString(),
};

await writeFile(resolve(DIST, 'data', 'stats.json'), JSON.stringify(stats));

// The client uses this for the hero line and the "Updated 3h ago" stamp.
const meta = {
  builtAt: stats.generated,
  total: stats.total,
  remote: stats.remote,
  strong: stats.strong,
  boards: new Set(jobs.map((job) => job.company)).size,
};
await writeFile(resolve(DIST, 'data', 'meta.json'), JSON.stringify(meta));

// Tells the client there is no API behind this build.
await writeFile(resolve(DIST, 'config.json'), JSON.stringify({ api: false }));

console.log(`source: ${source}`);
console.log(`jobs written: ${jobs.length} (${stats.remote} remote)`);
console.log('output: dist/');

function parse(json) {
  try {
    return JSON.parse(json ?? '[]');
  } catch {
    return [];
  }
}
