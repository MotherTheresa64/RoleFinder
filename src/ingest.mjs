import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PROVIDERS } from './sources.mjs';
import { scoreJob } from './score.mjs';
import { upsertJob, countJobs, clearJobs } from './db.mjs';

const args = new Set(process.argv.slice(2));
const reset = args.has('--reset');
const only = [...args].find((a) => a.startsWith('--company='))?.split('=')[1];

const profile = JSON.parse(await readFile(resolve('profile.json'), 'utf8'));
const { companies } = JSON.parse(await readFile(resolve('companies.json'), 'utf8'));

if (reset) {
  clearJobs();
  console.log('Cleared existing jobs.');
}

const targets = only
  ? companies.filter((c) => c.slug === only || c.name.toLowerCase() === only.toLowerCase())
  : companies;

if (!targets.length) {
  console.error(`No companies matched "${only}".`);
  process.exit(1);
}

const fetchedAt = new Date().toISOString();
const results = [];

for (const company of targets) {
  const fetcher = PROVIDERS[company.provider];
  if (!fetcher) {
    results.push({ company: company.name, ok: false, error: `unknown provider ${company.provider}` });
    continue;
  }

  process.stdout.write(`→ ${company.name} (${company.provider}) ... `);

  try {
    const jobs = await fetcher(company);
    let stored = 0;

    for (const job of jobs) {
      if (!job.title || !job.url) continue;
      const { score, matched } = scoreJob(job, profile);
      upsertJob({ ...job, score, matched, fetched_at: fetchedAt });
      stored += 1;
    }

    console.log(`${stored} jobs`);
    results.push({ company: company.name, ok: true, count: stored });
  } catch (error) {
    console.log(`FAILED (${error.message})`);
    results.push({ company: company.name, ok: false, error: error.message });
  }
}

const ok = results.filter((r) => r.ok);
const failed = results.filter((r) => !r.ok);

console.log('\n──────── summary ────────');
console.log(`sources ok      : ${ok.length}/${results.length}`);
console.log(`jobs ingested   : ${ok.reduce((sum, r) => sum + r.count, 0)}`);
console.log(`total rows now  : ${countJobs()}`);

if (failed.length) {
  console.log('\nfailed sources:');
  for (const f of failed) console.log(`  ${f.company}: ${f.error}`);
}
