// Two ways to run: against the local API server, or as a static site reading
// a JSON snapshot (Vercel / Firebase have no Node server).

const MODE = { server: 'server', static: 'static' };
const STATUS_KEY = 'rolefinder.statuses';
const INTRO_KEY = 'rolefinder.introDismissed';
const EXCLUSIONS = [
  'senior', 'sr.', 'staff', 'principal', 'lead',
  'manager', 'director', 'head of', 'architect',
];
const STATUS_LABELS = {
  new: 'Not applied',
  applied: 'Applied',
  interview: 'Interview',
  rejected: 'Rejected',
  offer: 'Offer',
};

const el = (id) => document.getElementById(id);
const list = el('list');
const empty = el('empty');
const statsEl = el('stats');
const resultCount = el('resultCount');
const intro = el('intro');

const q = el('q');
const remote = el('remote');
const hideApplied = el('hideApplied');
const hideSenior = el('hideSenior');
const minScore = el('minScore');
const scoreOut = el('scoreOut');
const status = el('status');

const state = { mode: MODE.static, all: [], statuses: {} };
let timer = null;

/** Both builds serve /config.json, so mode detection never probes a 404. */
async function detectMode() {
  try {
    const res = await fetch('/config.json', { cache: 'no-store' });
    if (!res.ok) return MODE.static;
    if (!(res.headers.get('content-type') || '').includes('application/json')) return MODE.static;
    const config = await res.json();
    return config && config.api ? MODE.server : MODE.static;
  } catch {
    return MODE.static;
  }
}

/* ---------- storage ---------- */

function readStored(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode: status just won't persist */
  }
}

/* ---------- data ---------- */

let snapshotRequest = null;

/** The snapshot is the only source in static mode. One request, shared. */
async function ensureSnapshot() {
  if (state.mode !== MODE.static || state.all.length) return;

  if (!snapshotRequest) {
    snapshotRequest = fetch('/data/jobs.json', { cache: 'no-store' })
      .then((res) => res.json())
      .then((jobs) => {
        state.all = jobs;
      })
      .catch(() => {
        state.all = [];
      });
  }

  await snapshotRequest;
}

function filters() {
  return {
    q: q.value.trim().toLowerCase(),
    remote: remote.checked,
    hideApplied: hideApplied.checked,
    hideSenior: hideSenior.checked,
    minScore: Number(minScore.value) || 0,
    status: status.value,
  };
}

function matches(job, f) {
  if (f.remote && !job.remote) return false;
  if (f.minScore > 0 && job.score < f.minScore) return false;

  if (f.hideSenior) {
    const title = job.title.toLowerCase();
    if (EXCLUSIONS.some((word) => title.includes(word))) return false;
  }

  if (f.q) {
    const haystack = `${job.title} ${job.company} ${job.department || ''}`.toLowerCase();
    if (!haystack.includes(f.q)) return false;
  }

  const current = job.status || 'new';
  if (f.status) return current === f.status;
  if (f.hideApplied) return current === 'new';

  return true;
}

async function loadJobs() {
  const f = filters();

  if (state.mode === MODE.server) {
    const params = new URLSearchParams();
    if (f.q) params.set('q', f.q);
    if (f.remote) params.set('remote', '1');
    if (!f.hideSenior) params.set('hideSenior', '0');
    if (!f.hideApplied) params.set('hideApplied', '0');
    if (f.minScore > 0) params.set('minScore', String(f.minScore));
    if (f.status) params.set('status', f.status);
    params.set('limit', '200');

    const res = await fetch(`/api/jobs?${params}`);
    const data = await res.json();
    render(data.jobs || []);
    return;
  }

  await ensureSnapshot();

  const withStatus = state.all.map((job) => ({
    ...job,
    status: state.statuses[job.id] || job.status || '',
  }));

  render(withStatus.filter((job) => matches(job, f)).slice(0, 200));
}

/* ---------- rendering ---------- */

function render(jobs) {
  empty.hidden = jobs.length > 0;
  const total = state.mode === MODE.server ? null : state.all.length;
  resultCount.textContent = total
    ? `${jobs.length} shown${jobs.length === 200 ? '+' : ''} of ${total} postings`
    : `${jobs.length} matching postings`;

  list.replaceChildren(...jobs.map(card));
}

function card(job) {
  const article = document.createElement('article');
  article.className = 'job';
  const current = job.status || '';

  if (current === 'applied') article.classList.add('is-applied');
  if (current === 'interview') article.classList.add('is-interview');
  if (current === 'rejected') article.classList.add('is-rejected');

  const match = matchInfo(job.score);
  const tags = (job.matched || []).slice(0, 4);
  const extra = Math.max((job.matched || []).length - tags.length, 0);
  const days = ageInDays(job.posted_at);

  article.innerHTML = `
    <div class="mono" style="--h:${hue(job.company)}" aria-hidden="true">${monogram(job.company)}</div>
    <div class="job-main">
      <div class="job-title">
        <h2>${esc(job.title)}</h2>
        ${days !== null && days <= 7 ? '<span class="fresh">New</span>' : ''}
      </div>
      <p class="job-meta">
        <span class="company">${esc(job.company)}</span>
        ${job.location ? `<span class="dot-sep"></span><span>${esc(job.location)}</span>` : ''}
        ${days !== null ? `<span class="dot-sep"></span><span>${relativeDate(days)}</span>` : ''}
        ${job.remote ? '<span class="dot-sep"></span><span>Remote</span>' : ''}
      </p>
      <div class="tags">
        ${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}
        ${extra ? `<span class="tag more">+${extra}</span>` : ''}
      </div>
    </div>
    <div class="job-side">
      <span class="match ${match.tone}">${match.label}</span>
      <div class="job-actions">
        <select class="status-select" data-id="${esc(job.id)}" aria-label="Application status for ${esc(job.title)}">
          ${Object.entries(STATUS_LABELS)
            .map(([value, label]) => `<option value="${value}" ${(current || 'new') === value ? 'selected' : ''}>${label}</option>`)
            .join('')}
        </select>
        <a class="apply" href="${esc(job.url)}" target="_blank" rel="noopener">
          Apply
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true">
            <path d="M7 17 17 7M9 7h8v8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </a>
      </div>
    </div>
  `;

  article.querySelector('.status-select').addEventListener('change', (event) => {
    setStatus(job.id, event.target.value);
  });

  return article;
}

async function setStatus(id, value) {
  if (state.mode === MODE.server) {
    await fetch(`/api/jobs/${encodeURIComponent(id)}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: value }),
    });
  } else {
    if (value === 'new') delete state.statuses[id];
    else state.statuses[id] = value;
    writeStored(STATUS_KEY, state.statuses);
  }

  await Promise.all([loadJobs(), loadStats()]);
}

async function loadStats() {
  if (state.mode === MODE.server) {
    paint(await (await fetch('/api/stats')).json());
    return;
  }

  await ensureSnapshot();

  paint({
    total: state.all.length,
    strong: state.all.filter((job) => job.score >= 35).length,
    remote: state.all.filter((job) => job.remote).length,
    applied: Object.values(state.statuses).filter((s) => s === 'applied').length,
  });
}

function paint(s) {
  statsEl.innerHTML = `
    <div class="stat"><b>${s.total ?? 0}</b><span>postings</span></div>
    <div class="stat"><b>${s.strong ?? 0}</b><span>strong matches</span></div>
    <div class="stat"><b>${s.remote ?? 0}</b><span>remote</span></div>
    <div class="stat"><b>${s.applied ?? 0}</b><span>applied</span></div>
  `;
}

/* ---------- helpers ---------- */

function matchInfo(score) {
  if (score >= 55) return { label: 'Strong match', tone: 'strong' };
  if (score >= 35) return { label: 'Good match', tone: 'good' };
  if (score >= 20) return { label: 'Worth a look', tone: 'fair' };
  return { label: 'Long shot', tone: 'low' };
}

function monogram(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '?';
  const second = parts[1]?.[0] ?? '';
  return (first + second).toUpperCase();
}

function hue(name) {
  let h = 0;
  for (const char of String(name || '')) h = (h * 31 + char.charCodeAt(0)) % 360;
  return h;
}

function ageInDays(value) {
  if (!value) return null;
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86_400_000);
}

function relativeDate(days) {
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(loadJobs, 180);
}

/* ---------- wire up ---------- */

for (const node of [q, remote, hideApplied, hideSenior, status]) {
  node.addEventListener('input', schedule);
  node.addEventListener('change', schedule);
}

minScore.addEventListener('input', () => {
  const value = Number(minScore.value);
  scoreOut.textContent = value === 0 ? 'Any' : value;
  schedule();
});

function openIntro() {
  if (typeof intro.showModal === 'function') intro.showModal();
  else intro.setAttribute('open', '');
}

function closeIntro() {
  writeStored(INTRO_KEY, true);
  intro.close?.();
  intro.removeAttribute('open');
}

el('introClose').addEventListener('click', closeIntro);
el('introGotIt').addEventListener('click', closeIntro);
el('introOpen').addEventListener('click', openIntro);
intro.addEventListener('click', (event) => {
  if (event.target === intro) closeIntro();
});

(async function start() {
  state.mode = await detectMode();
  state.statuses = readStored(STATUS_KEY, {}) || {};
  state.all = [];
  document.body.dataset.mode = state.mode;

  await Promise.all([loadJobs(), loadStats()]);

  if (!readStored(INTRO_KEY, false)) openIntro();
})();
