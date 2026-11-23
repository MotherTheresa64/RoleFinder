/**
 * Scores a normalized job against a profile of weighted skills and role keywords.
 * Title matches count double — a posting titled "React Engineer" is a better
 * signal than the word "react" buried in a requirements list.
 */
export function scoreJob(job, profile) {
  const title = String(job.title ?? '').toLowerCase();
  const body = String(job.description ?? '').toLowerCase();
  const dept = String(job.department ?? '').toLowerCase();
  const full = `${title} ${dept} ${body}`;

  const matched = new Set();
  let score = 0;

  for (const [skill, weight] of Object.entries(profile.skills ?? {})) {
    if (hasTerm(title, skill)) {
      score += weight * 2;
      matched.add(skill);
    } else if (hasTerm(full, skill)) {
      score += weight;
      matched.add(skill);
    }
  }

  for (const [keyword, weight] of Object.entries(profile.roleKeywords ?? {})) {
    if (hasTerm(title, keyword)) {
      score += weight * 2;
      matched.add(keyword);
    } else if (hasTerm(dept, keyword)) {
      score += weight;
      matched.add(keyword);
    }
  }

  for (const [term, penalty] of Object.entries(profile.seniorityPenalty ?? {})) {
    if (hasTerm(title, term)) score += penalty;
  }

  // Reward postings that look remote-friendly when the body says so.
  if (job.remote) score += 6;

  return {
    score: clamp(Math.round(score), 0, 100),
    matched: [...matched].slice(0, 12),
  };
}

/**
 * Whole-word match: "staff" must not hit "Staffing", nor "git" hit "Digital".
 * Uses alphanumeric lookarounds instead of \b so terms like "c++" and "sr." still work.
 */
export function hasTerm(text, term) {
  const escaped = term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(text);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
