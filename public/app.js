const list = document.getElementById('list');
const empty = document.getElementById('empty');
const statsEl = document.getElementById('stats');

const q = document.getElementById('q');
const remote = document.getElementById('remote');
const hideSenior = document.getElementById('hideSenior');
const minScore = document.getElementById('minScore');
const scoreOut = document.getElementById('scoreOut');
const status = document.getElementById('status');

let timer = null;

function params() {
  const search = new URLSearchParams();
  if (q.value.trim()) search.set('q', q.value.trim());
  if (remote.checked) search.set('remote', '1');
  if (!hideSenior.checked) search.set('hideSenior', '0');
  if (Number(minScore.value) > 0) search.set('minScore', minScore.value);
  if (status.value) search.set('status', status.value);
  search.set('limit', '150');
  return search;
}

async function loadJobs() {
  const res = await fetch(`/api/jobs?${params()}`);
  const data = await res.json();
  render(data.jobs ?? []);
  empty.hidden = (data.jobs ?? []).length > 0;
}

async function loadStats() {
  const res = await fetch('/api/stats');
  const s = await res.json();
  statsEl.innerHTML = `
    <span><b>${s.total}</b> postings</span>
    <span><b>${s.strong}</b> strong matches</span>
    <span><b>${s.remote}</b> remote</span>
    <span><b>${s.applied}</b> applied</span>
  `;
}

function render(jobs) {
  list.replaceChildren(
    ...jobs.map((job) => {
      const card = document.createElement('article');
      card.className = 'card';
      if (job.status === 'applied') card.classList.add('is-applied');
      if (job.status === 'interview') card.classList.add('is-interview');
      if (job.status === 'rejected') card.classList.add('is-rejected');

      const scoreClass = job.score >= 50 ? 'high' : job.score >= 25 ? 'mid' : 'low';

      card.innerHTML = `
        <div class="score ${scoreClass}">${job.score}</div>
        <div class="body">
          <h2>${esc(job.title)}</h2>
          <p class="meta">
            <span class="company">${esc(job.company)}</span>
            ${job.location ? `<span>· ${esc(job.location)}</span>` : ''}
            ${job.remote ? '<span class="pill remote">remote</span>' : ''}
            ${job.posted_at ? `<span>· ${formatDate(job.posted_at)}</span>` : ''}
          </p>
          <p class="matched">${(job.matched ?? []).slice(0, 8).map((m) => `<span>${esc(m)}</span>`).join('')}</p>
        </div>
        <div class="actions">
          <select data-id="${esc(job.id)}" class="status-select">
            ${['new', 'applied', 'interview', 'rejected', 'offer']
              .map(
                (s) =>
                  `<option value="${s}" ${(job.status || 'new') === s ? 'selected' : ''}>${label(s)}</option>`,
              )
              .join('')}
          </select>
          <a class="open" href="${esc(job.url)}" target="_blank" rel="noopener">Open posting →</a>
        </div>
      `;

      card.querySelector('.status-select').addEventListener('change', async (event) => {
        await fetch(`/api/jobs/${encodeURIComponent(job.id)}/status`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: event.target.value }),
        });
        await Promise.all([loadJobs(), loadStats()]);
      });

      return card;
    }),
  );
}

function label(status) {
  return {
    new: 'Not applied',
    applied: 'Applied',
    interview: 'Interview',
    rejected: 'Rejected',
    offer: 'Offer',
  }[status] ?? status;
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
  timer = setTimeout(loadJobs, 220);
}

for (const el of [q, remote, hideSenior, status]) {
  el.addEventListener('input', schedule);
  el.addEventListener('change', schedule);
}

minScore.addEventListener('input', () => {
  scoreOut.textContent = minScore.value;
  schedule();
});

loadJobs();
loadStats();
