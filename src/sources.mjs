const TIMEOUT_MS = 20000;

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'rolefinder/0.1 (personal job search)' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} for ${url}`);
  }
  return res.json();
}

/** Greenhouse publishes a public board API per company. */
export async function fetchGreenhouse(company) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${company.slug}/jobs?content=true`;
  const data = await fetchJson(url);
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];

  return jobs.map((job) => ({
    id: `greenhouse:${company.slug}:${job.id}`,
    provider: 'greenhouse',
    company: company.name,
    title: clean(job.title),
    location: clean(job.location?.name ?? ''),
    remote: /remote/i.test(job.location?.name ?? ''),
    department: clean(job.departments?.[0]?.name ?? ''),
    employment_type: '',
    url: job.absolute_url ?? '',
    posted_at: job.updated_at ?? job.first_published ?? '',
    description: stripHtml(decodeEntities(decodeEntities(job.content ?? ''))),
  }));
}

/** Ashby exposes a public posting API per organization. */
export async function fetchAshby(company) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${company.slug}`;
  const data = await fetchJson(url);
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];

  return jobs.map((job) => {
    const location = clean(
      [job.location, ...(job.secondaryLocations ?? [])].filter(Boolean).join(' · '),
    );
    const remote =
      Boolean(job.isRemote) ||
      /remote/i.test(job.workplaceType ?? '') ||
      /remote/i.test(location);

    return {
      id: `ashby:${company.slug}:${job.id}`,
      provider: 'ashby',
      company: company.name,
      title: clean(job.title),
      location,
      remote,
      department: clean(job.department ?? job.team ?? ''),
      employment_type: clean(job.employmentType ?? ''),
      url: job.jobUrl ?? job.applyUrl ?? '',
      posted_at: job.publishedAt ?? '',
      description: stripHtml(job.descriptionPlain ?? job.descriptionHtml ?? ''),
    };
  });
}

export const PROVIDERS = {
  greenhouse: fetchGreenhouse,
  ashby: fetchAshby,
};

export function stripHtml(input) {
  return String(input ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function decodeEntities(input) {
  return String(input ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}
