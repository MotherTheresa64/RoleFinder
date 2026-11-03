// Two ways to run: against the local API server, or as a static site reading
// a JSON snapshot (Vercel / Firebase have no Node server).

const MODE = { server: 'server', static: 'static' };
const STATUS_KEY = 'rolefinder.statuses';
const INTRO_KEY = 'rolefinder.introDismissed';
const LIMIT = 200;

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

// Strong = the number in the hero. Sections follow the same thresholds so the
// counts on screen never disagree with each other.
const TIERS = [
  { min: 35, label: 'Strong matches' },
  { min: 20, label: 'Worth a look' },
  { min: 0, label: 'Long shots' },
];

const el = (id) => document.getElementById(id);
const list = el('list');
const skeleton = el('skeleton');
const empty = el('empty');
const resultCount = el('resultCount');
const heroStrong = el('heroStrong');
const heroSub = el('heroSub');
const freshnessLabel = el('freshnessLabel');
const intro = el('intro');

const q = el('q');
const remote = el('remote');
const hideApplied = el('hideApplied');
const hideSenior = el('hideSenior');
const minScore = el('minScore');
const scoreOut = el('scoreOut');
const status = el('status');
const resetFilters = el('resetFilters');

const state = { mode: MODE.static, all: [], meta: null, statuses: {} };
let timer = null;
let firstRender = true;

/* ---------- mode ---------- */

/** Both builds serve /config.json, so detection never probes a 404. */
async function detectMode() {
  try {
    const res = await fetch('/config.json', { cache: 'no-store' });
    if (!res.ok) return MODE.static;
    if (!(res.headers.get('content-type') || '').includes('json')) return MODE.static;
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

/** One request for the snapshot, shared by the list and the stats. */
async function ensureSnapshot() {
  if (state.mode !== MODE.static || state.all.length) return;

  if (!snapshotRequest) {
    snapshotRequest = Promise.all([
      fetch('/data/jobs.json', { cache: 'no-store' }).then((res) => res.json()),
      fetch('/data/meta.json', { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null),
    ])
      .then(([jobs, meta]) => {
        state.all = Array.isArray(jobs) ? jobs : [];
        state.meta = meta;
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

function isDefault(f) {
  return (
    !f.q && !f.remote && f.hideApplied && f.hideSenior && !f.minScore && !f.status
  );
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
  resetFilters.hidden = isDefault(f);

  if (state.mode === MODE.server) {
    const params = new URLSearchParams();
    if (f.q) params.set('q', f.q);
    if (f.remote) params.set('remote', '1');
    if (!f.hideSenior) params.set('hideSenior', '0');
    if (!f.hideApplied) params.set('hideApplied', '0');
    if (f.minScore > 0) params.set('minScore', String(f.minScore));
    if (f.status) params.set('status', f.status);
    params.set('limit', String(LIMIT));

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

  render(withStatus.filter((job) => matches(job, f)).slice(0, LIMIT));
}

/* ---------- rendering ---------- */

function render(jobs) {
  skeleton.hidden = true;
  empty.hidden = jobs.length > 0;

  const total = state.mode === MODE.static ? state.all.length : null;
  resultCount.textContent = total
    ? `${jobs.length}${jobs.length === LIMIT ? '+' : ''} of ${total.toLocaleString()} postings`
    : `${jobs.length} matching postings`;

  const groups = TIERS.map((tier) => ({ ...tier, items: [] }));
  for (const job of jobs) {
    const tier = groups.find((group) => job.score >= group.min) ?? groups[groups.length - 1];
    tier.items.push(job);
  }

  const nodes = [];
  let index = 0;

  for (const group of groups) {
    if (!group.items.length) continue;

    const header = document.createElement('div');
    header.className = 'tier';
    header.innerHTML = `<span>${group.label}</span><b>${group.items.length}</b>`;
    nodes.push(header);

    for (const job of group.items) nodes.push(card(job, index++));
  }

  list.replaceChildren(...nodes);

  if (firstRender) {
    list.classList.add('animate');
    firstRender = false;
  }
}

function card(job, index) {
  const article = document.createElement('article');
  article.className = 'job';
  article.style.setProperty('--i', Math.min(index, 12));

  const current = job.status || '';
  if (current) article.classList.add(`is-${current}`);

  const match = matchInfo(job.score);
  const tags = job.matched || [];
  const shownTags = tags.slice(0, 4);
  const extraTags = tags.slice(4);
  const days = ageInDays(job.posted_at);

  article.innerHTML = `
    <div class="tile" style="--h:${hue(job.company)}" aria-hidden="true">${monogram(job.company)}</div>
    <div class="job-body">
      <div class="job-head">
        <h2>${esc(job.title)}</h2>
        ${days !== null && days <= 7 ? '<span class="new">New</span>' : ''}
      </div>
      <p class="meta">
        <span class="co">${esc(job.company)}</span>
        ${job.location ? `<span class="sep"></span><span>${esc(job.location)}</span>` : ''}
        ${days !== null ? `<span class="sep"></span><span>${relativeDate(days)}</span>` : ''}
        ${job.remote ? '<span class="sep"></span><span class="remote">Remote</span>' : ''}
      </p>
      <div class="tags">
        ${shownTags.map((tag) => `<span class="tag">${esc(tag)}</span>`).join('')}
        ${
          extraTags.length
            ? `<details class="why">
                 <summary>+${extraTags.length}</summary>
                 <div class="why-body">${extraTags
                   .map((tag) => `<span class="tag">${esc(tag)}</span>`)
                   .join('')}</div>
               </details>`
            : ''
        }
      </div>
    </div>
    <div class="job-side">
      <span class="match ${match.tone}">${match.label}</span>
      <div class="actions">
        <select class="status-select" data-id="${esc(job.id)}" aria-label="Application status for ${esc(job.title)}">
          ${Object.entries(STATUS_LABELS)
            .map(
              ([value, label]) =>
                `<option value="${value}" ${(current || 'new') === value ? 'selected' : ''}>${label}</option>`,
            )
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
    const stats = await (await fetch('/api/stats')).json();
    paintHero(stats);
    paintFreshness(stats.updated);
    return;
  }

  await ensureSnapshot();

  const meta = state.meta || {};
  paintHero({
    total: meta.total ?? state.all.length,
    remote: meta.remote ?? state.all.filter((job) => job.remote).length,
    strong: meta.strong ?? state.all.filter((job) => job.score >= 35).length,
    applied: Object.values(state.statuses).filter((value) => value === 'applied').length,
  });
  paintFreshness(meta.builtAt);
}

function paintHero(stats) {
  heroStrong.textContent = (stats.strong ?? 0).toLocaleString();
  heroSub.innerHTML = `of <b>${num(stats.total)}</b> open roles · <b>${num(
    stats.remote,
  )}</b> remote · <b>${num(stats.applied)}</b> applied`;
}

function paintFreshness(value) {
  if (!value) {
    freshnessLabel.textContent = 'Updated daily';
    return;
  }

  const then = new Date(value).getTime();
  if (Number.isNaN(then)) {
    freshnessLabel.textContent = 'Updated daily';
    return;
  }

  const hours = (Date.now() - then) / 3_600_000;
  if (hours < 1) freshnessLabel.textContent = 'Updated just now';
  else if (hours < 24) freshnessLabel.textContent = `Updated ${Math.floor(hours)}h ago`;
  else freshnessLabel.textContent = `Updated ${Math.floor(hours / 24)}d ago`;
}

/* ---------- helpers ---------- */

function matchInfo(score) {
  if (score >= 55) return { label: 'Top match', tone: 'top' };
  if (score >= 35) return { label: 'Strong match', tone: 'strong' };
  if (score >= 20) return { label: 'Worth a look', tone: 'fair' };
  return { label: 'Long shot', tone: 'low' };
}

function num(value) {
  return (value ?? 0).toLocaleString();
}

function monogram(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return `${parts[0]?.[0] ?? '?'}${parts[1]?.[0] ?? ''}`.toUpperCase();
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
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
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

function syncRange() {
  const value = Number(minScore.value);
  const max = Number(minScore.max);
  minScore.style.setProperty('--fill', `${(value / max) * 100}%`);
  scoreOut.textContent = value === 0 ? 'Any' : `${value}+`;
}

minScore.addEventListener('input', () => {
  syncRange();
  schedule();
});

resetFilters.addEventListener('click', () => {
  q.value = '';
  remote.checked = false;
  hideApplied.checked = true;
  hideSenior.checked = true;
  minScore.value = '0';
  status.value = '';
  syncRange();
  loadJobs();
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

  syncRange();
  await Promise.all([loadJobs(), loadStats()]);

  if (!readStored(INTRO_KEY, false)) openIntro();
})();
