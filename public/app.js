// Works in two modes: against the local API server, or as a static site
// reading a JSON snapshot (Vercel / Firebase hosting have no Node server).

const MODE = { server: 'server', static: 'static' };
const STATUS_KEY = 'rolefinder.statuses';
const EXCLUSIONS = [
  'senior', 'sr.', 'staff', 'principal', 'lead',
  'manager', 'director', 'head of', 'architect',
];

const list = document.getElementById('list');
const empty = document.getElementById('empty');
const statsEl = document.getElementById('stats');

const q = document.getElementById('q');
const remote = document.getElementById('remote');
const hideSenior = document.getElementById('hideSenior');
const minScore = document.getElementById('minScore');
const scoreOut = document.getElementById('scoreOut');
const status = document.getElementById('status');

const state = { mode: MODE.static, all: [], statuses: {} };
let timer = null;

/** Both builds serve /config.json, so mode detection never probes a 404 and never
 *  guesses from a 200 that is really index.html. */
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

/** Static mode has no API, so the snapshot is the only source. Both the list and
 *  the stats depend on it. The request is memoized so the two callers share one
 *  download instead of each pulling the whole file. */
let snapshotRequest = null;

async function ensureStaticData() {
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

function readStoredStatuses() {
  try {
    return JSON.parse(localStorage.getItem(STATUS_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeStoredStatuses(map) {
  try {
    localStorage.setItem(STATUS_KEY, JSON.stringify(map));
  } catch {
    /* private mode, ignore */
  }
}

function filters() {
  return {
    q: q.value.trim().toLowerCase(),
    remote: remote.checked,
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
  if (f.status) {
    const current = job.status || 'new';
    if (f.status !== current) return false;
  }
  return true;
}

async function loadJobs() {
  const f = filters();

  if (state.mode === MODE.server) {
    const params = new URLSearchParams();
    if (f.q) params.set('q', f.q);
    if (f.remote) params.set('remote', '1');
    if (!f.hideSenior) params.set('hideSenior', '0');
    if (f.minScore > 0) params.set('minScore', String(f.minScore));
    if (f.status) params.set('status', f.status);
    params.set('limit', '150');

    const res = await fetch(`/api/jobs?${params}`);
    const data = await res.json();
    render(data.jobs || []);
    return;
  }

  await ensureStaticData();

  const withStatus = state.all.map((job) => ({
    ...job,
    status: state.statuses[job.id] || job.status || '',
  }));

  render(withStatus.filter((job) => matches(job, f)).slice(0, 150));
}

function render(jobs) {
  empty.hidden = jobs.length > 0;

  list.replaceChildren(
    ...jobs.map((job) => {
      const card = document.createElement('article');
      card.className = 'card';
      const current = job.status || '';
      if (current === 'applied') card.classList.add('is-applied');
      if (current === 'interview') card.classList.add('is-interview');
      if (current === 'rejected') card.classList.add('is-rejected');

      const scoreClass = job.score >= 50 ? 'high' : job.score >= 25 ? 'mid' : 'low';

      card.innerHTML = `
        <div class="score ${scoreClass}">${job.score}</div>
        <div class="body">
          <h2>${esc(job.title)}</h2>
          <p class="meta">
            <span class="company">${esc(job.company)}</span>
            ${job.location ? `<span>· ${esc(job.location)}</span>` : ''}
            ${job.remote ? '<span class="pill remote">remote</span>' : ''}
            ${job.posted_at ? `<span>· ${esc(formatDate(job.posted_at))}</span>` : ''}
          </p>
          <p class="matched">${(job.matched || []).slice(0, 8).map((m) => `<span>${esc(m)}</span>`).join('')}</p>
        </div>
        <div class="actions">
          <select data-id="${esc(job.id)}" class="status-select" aria-label="Application status">
            ${['new', 'applied', 'interview', 'rejected', 'offer']
              .map((s) => `<option value="${s}" ${(current || 'new') === s ? 'selected' : ''}>${label(s)}</option>`)
              .join('')}
          </select>
          <a class="open" href="${esc(job.url)}" target="_blank" rel="noopener">Open posting →</a>
        </div>
      `;

      card.querySelector('.status-select').addEventListener('change', async (event) => {
        await setStatus(job.id, event.target.value);
      });

      return card;
    }),
  );
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
    writeStoredStatuses(state.statuses);
  }

  await Promise.all([loadJobs(), loadStats()]);
}

async function loadStats() {
  if (state.mode === MODE.server) {
    const res = await fetch('/api/stats');
    paintStats(await res.json());
    return;
  }

  await ensureStaticData();

  const totals = {
    total: state.all.length,
    remote: state.all.filter((j) => j.remote).length,
    strong: state.all.filter((j) => j.score >= 35).length,
    applied: state.all.filter((j) => state.statuses[j.id] === 'applied').length,
  };
  paintStats(totals);
}

function paintStats(s) {
  statsEl.innerHTML = `
    <span><b>${s.total ?? 0}</b> postings</span>
    <span><b>${s.strong ?? 0}</b> strong matches</span>
    <span><b>${s.remote ?? 0}</b> remote</span>
    <span><b>${s.applied ?? 0}</b> applied</span>
  `;
}

function label(value) {
  return {
    new: 'Not applied',
    applied: 'Applied',
    interview: 'Interview',
    rejected: 'Rejected',
    offer: 'Offer',
  }[value] || value;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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
  timer = setTimeout(loadJobs, 200);
}

for (const el of [q, remote, hideSenior, status]) {
  el.addEventListener('input', schedule);
  el.addEventListener('change', schedule);
}

minScore.addEventListener('input', () => {
  scoreOut.textContent = minScore.value;
  schedule();
});

(async function start() {
  state.mode = await detectMode();
  state.statuses = readStoredStatuses();
  document.body.dataset.mode = state.mode;
  await Promise.all([loadJobs(), loadStats()]);
})();
