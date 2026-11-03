import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DB_PATH = process.env.ROLEFINDER_DB || resolve('data/rolefinder.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec(`
CREATE TABLE IF NOT EXISTS jobs (
  id              TEXT PRIMARY KEY,
  provider        TEXT NOT NULL,
  company         TEXT NOT NULL,
  title           TEXT NOT NULL,
  location        TEXT,
  remote          INTEGER NOT NULL DEFAULT 0,
  department      TEXT,
  employment_type TEXT,
  url             TEXT,
  posted_at       TEXT,
  description     TEXT,
  fetched_at      TEXT NOT NULL,
  score           INTEGER NOT NULL DEFAULT 0,
  matched         TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS applications (
  job_id     TEXT PRIMARY KEY,
  status     TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_score ON jobs(score DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_posted ON jobs(posted_at DESC);
`);

const upsertStmt = db.prepare(`
INSERT INTO jobs (id, provider, company, title, location, remote, department,
                  employment_type, url, posted_at, description, fetched_at, score, matched)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  title           = excluded.title,
  location        = excluded.location,
  remote          = excluded.remote,
  department      = excluded.department,
  employment_type = excluded.employment_type,
  url             = excluded.url,
  posted_at       = excluded.posted_at,
  description     = excluded.description,
  fetched_at      = excluded.fetched_at,
  score           = excluded.score,
  matched         = excluded.matched
`);

export function upsertJob(job) {
  upsertStmt.run(
    job.id,
    job.provider,
    job.company,
    job.title,
    job.location ?? null,
    job.remote ? 1 : 0,
    job.department ?? null,
    job.employment_type ?? null,
    job.url ?? null,
    job.posted_at ?? null,
    job.description ?? '',
    job.fetched_at,
    job.score ?? 0,
    JSON.stringify(job.matched ?? []),
  );
}

export function countJobs() {
  return db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n;
}

export function clearJobs() {
  db.exec('DELETE FROM jobs;');
}

const EXCLUSIONS = [
  'senior', 'sr.', 'staff', 'principal', 'lead',
  'manager', 'director', 'head of', 'architect',
];

export function listJobs({
  q = '',
  remote = false,
  minScore = 0,
  hideSenior = true,
  status = '',
  limit = 100,
} = {}) {
  const where = [];
  const params = [];

  if (q) {
    where.push('(j.title LIKE ? OR j.company LIKE ? OR j.department LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  if (remote) where.push('j.remote = 1');
  if (minScore > 0) {
    where.push('j.score >= ?');
    params.push(minScore);
  }
  if (hideSenior) {
    where.push(`NOT (${EXCLUSIONS.map(() => 'LOWER(j.title) LIKE ?').join(' OR ')})`);
    for (const term of EXCLUSIONS) params.push(`%${term}%`);
  }
  if (status === 'new') {
    // "new" means the job has no row in applications yet.
    where.push('a.status IS NULL');
  } else if (status) {
    where.push('a.status = ?');
    params.push(status);
  }

  const sql = `
    SELECT j.*, a.status
    FROM jobs j
    LEFT JOIN applications a ON a.job_id = j.id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY j.score DESC, j.posted_at DESC
    LIMIT ?
  `;
  params.push(Math.min(Number(limit) || 100, 500));

  return db.prepare(sql).all(...params).map((row) => ({
    ...row,
    remote: Boolean(row.remote),
    matched: safeParse(row.matched),
  }));
}

export function getJob(id) {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  if (!row) return null;
  return { ...row, remote: Boolean(row.remote), matched: safeParse(row.matched) };
}

export function setStatus(jobId, status) {
  if (!getJob(jobId)) return false;
  db.prepare(`
    INSERT INTO applications (job_id, status, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(job_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
  `).run(jobId, status, new Date().toISOString());
  return true;
}

export function clearStatus(jobId) {
  db.prepare('DELETE FROM applications WHERE job_id = ?').run(jobId);
}

export function stats() {
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN remote = 1 THEN 1 ELSE 0 END) AS remote,
      SUM(CASE WHEN score >= 35 THEN 1 ELSE 0 END) AS strong
    FROM jobs
  `).get();

  const byStatus = db.prepare(`
    SELECT status, COUNT(*) AS n FROM applications GROUP BY status
  `).all();

  const byCompany = db.prepare(`
    SELECT company, COUNT(*) AS n, MAX(score) AS best
    FROM jobs GROUP BY company ORDER BY n DESC LIMIT 12
  `).all();

  return {
    total: totals.total ?? 0,
    remote: totals.remote ?? 0,
    strong: totals.strong ?? 0,
    applied: byStatus.find((r) => r.status === 'applied')?.n ?? 0,
    byStatus,
    byCompany,
  };
}

function safeParse(json) {
  try {
    return JSON.parse(json ?? '[]');
  } catch {
    return [];
  }
}
