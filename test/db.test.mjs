import assert from 'node:assert/strict';
import test from 'node:test';

process.env.ROLEFINDER_DB = ':memory:';
const { upsertJob, listJobs } = await import('../src/db.mjs');

const job = (id, title) => ({
  id, provider: 'greenhouse', company: 'Acme', title, location: 'Remote', remote: true,
  department: '', url: `https://example.com/${id}`, posted_at: null, score: 50, matched: [],
  description: '', fetched_at: new Date().toISOString(),
});

test('hideSenior excludes senior titles by whole word only', () => {
  upsertJob(job('a', 'Staff Engineer'));
  upsertJob(job('b', 'Staffing Platform Engineer'));
  upsertJob(job('c', 'Leadership Program Associate'));
  upsertJob(job('d', 'Sr. Developer'));
  upsertJob(job('e', 'Engineer (Lead)'));
  const titles = listJobs({ hideSenior: true, hideApplied: false }).map((j) => j.title).sort();
  assert.deepEqual(titles, ['Leadership Program Associate', 'Staffing Platform Engineer']);
});
