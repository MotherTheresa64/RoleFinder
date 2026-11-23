# RoleFinder

A job search tool. It pulls open roles from company job boards (Greenhouse, Ashby and Lever
all publish free public endpoints), stores them in SQLite locally, scores them against
a profile I control, and keeps track of which ones I have applied to.

It does not submit applications. Two questions it answers: what is out there that fits,
and where did I leave off.

## Who this is for

Me. This is a personal job search tool, not a public job board.

The postings and the application links are real and public, but the ranking comes from
`profile.json`, which describes one stack (React, TypeScript, Python, FastAPI/Flask,
PostgreSQL). Anyone who opens the deployed site sees the same jobs in *my* order, not an
order tuned to them. That is intentional, and the site says so on the first visit and
again in the footer.

The list hides anything already marked applied, interview, or rejected, so a posting
cannot come back around and tempt a duplicate application. Status is saved per browser in
the static build (`localStorage`) and in the local SQLite database when you run the Node
server; the deployed static site has no server that could receive it.

It refreshes daily at 06:17 UTC, so it is a current snapshot rather than a live feed.
Something posted this afternoon shows up on tomorrow's run.

Runs two ways from the same code:

- **Locally**, as a small Node server with SQLite. Application status is stored in the
  database.
- **Statically**, as plain files that deploy to Vercel or Firebase Hosting for free. The
  page reads a JSON snapshot and keeps status in `localStorage`.

## Live

- Vercel: https://rolefinder-xi.vercel.app
- Firebase: https://rolefinder-bcb3c.web.app

## Running locally

Node 22 or newer (the daily refresh workflow runs Node 24). No dependencies, no build step: it uses the built-in `node:sqlite`
module, the built-in fetch, and `node:http`.

```
npm run ingest     # download and score postings
npm start          # http://127.0.0.1:4321
```

Re-run `npm run ingest` whenever you want fresh listings. It upserts, so application
statuses survive. `npm run reset` wipes the jobs table for a clean pull.

To open it on a phone that is on the same wifi, bind to all interfaces:

```
HOST=0.0.0.0 npm start
```

then visit `http://<your-lan-ip>:4321`. The layout is responsive down to about 360px.

## Building the static version

```
npm run build      # writes dist/ plus snapshot/jobs.json
npm run preview    # serves dist/ at http://127.0.0.1:4322
```

`npm run build` reads SQLite if it exists and also refreshes `snapshot/jobs.json`, which
is committed. A build with no database present falls back to that snapshot, so CI never
needs network access or a database.

The only behavioural difference in static mode: application status lives in the
browser. Same browser, same device, persists across visits; it does not sync anywhere
and clearing site data resets it. The local server build keeps the same statuses in
SQLite instead.

## Deploying (free tiers)

**Vercel.** Import the repo, leave the framework preset as "Other". `vercel.json`
already sets the build command to `npm run build` and the output to `dist`. No
dependencies, no environment variables, no functions.

**Firebase Hosting.** The project needs a Firebase project id (`firebase use --add`).

```
npm run build
firebase deploy --only hosting
```

`firebase.json` points at `dist`. Both hosts serve the same files, so either one is a
preview URL you can look at on a phone.

## Keeping the deployed copy current

`.github/workflows/refresh.yml` runs daily at 06:17 UTC: it re-ingests every company and
commits `snapshot/jobs.json` if anything changed. That push triggers the Vercel deploy on
its own. Firebase needs `npm run deploy:firebase` again, or a deploy hook if you want it
fully automatic.

You can also run it by hand from the Actions tab, or with `gh workflow run refresh.yml`.

## Adding companies

Everything lives in `companies.json`:

```json
{ "name": "Linear", "provider": "ashby", "slug": "linear" }
```

`provider` is `greenhouse`, `ashby`, or `lever`. The slug is the company identifier in
the board URL:

- Greenhouse: `boards.greenhouse.io/<slug>` → `boards-api.greenhouse.io/v1/boards/<slug>/jobs`
- Ashby: `jobs.ashbyhq.com/<slug>` → `api.ashbyhq.com/posting-api/job-board/<slug>`
- Lever: `jobs.lever.co/<slug>` → `api.lever.co/v0/postings/<slug>?mode=json`

A bad slug fails that one source and prints the error; the rest of the run continues.

## Scoring

`profile.json` holds the weights. A skill that appears in the job title counts double,
because a posting called "React Engineer" is a stronger signal than the word "react"
somewhere in a requirements list. Seniority words subtract points, which keeps senior
roles from crowding out the list. Remote postings get a small bump.

Every card shows the terms that matched, so when the ranking looks wrong I can see why
instead of guessing.

## Layout

```
companies.json          which boards to pull
profile.json            skill weights and role keywords
src/sources.mjs         Greenhouse, Ashby and Lever adapters, plus HTML cleanup
src/score.mjs           keyword scoring
src/db.mjs              sqlite schema, upserts, queries
src/ingest.mjs          CLI that ties the above together
src/server.mjs          http server, json API, static files
scripts/build-static.mjs   emits dist/ and refreshes the snapshot
scripts/serve-static.mjs   static preview server
.github/workflows/refresh.yml   daily snapshot refresh
public/                 ui (plain es modules, no bundler)
```

API, when running locally: `GET /api/jobs`, `GET /api/stats`,
`POST /api/jobs/:id/status`, `GET /api/health`.

## Known limits

- No Workable adapter yet. It publishes a public endpoint too, so it is next.
- Scoring is keyword based. It does not know that Django and Flask are similar, only the
  words in `profile.json`.
- Large company boards almost never list junior roles. Adding smaller companies matters
  more than adding more big ones.
- No cross-company dedupe. The same role posted on two boards shows up twice.
- Static mode keeps status in `localStorage`, so it does not follow you between devices.
- Statuses are keyed by the board's job id. If a company closes and relists a role, it
  gets a new id and looks like a new posting again.

## TODO

- [ ] Saved filter presets
- [ ] Draft resume bullets per posting
- [ ] Follow-up reminder for anything applied more than 10 days ago
- [ ] CSV export of application history
- [ ] Workable adapter

## Technical notes

### Architecture and data flow

```
companies.json --> src/sources.mjs (Greenhouse | Ashby | Lever adapters, normalise to one job shape)
                        |
profile.json ---> src/score.mjs (score + matched terms) --> src/db.mjs (SQLite upsert)
                                                                 |
              +--------------------------------------------------+
              |                                                  |
   src/server.mjs: JSON API + static files          scripts/build-static.mjs: dist/ + snapshot/jobs.json
   (status in SQLite `applications`)                 (status in the browser's localStorage)
```

`src/ingest.mjs` runs sources one at a time; a failing board is logged and skipped. Jobs
are upserted by `provider:slug:id`, so re-running never touches application rows.
The static build writes `dist/data/jobs.json` (without descriptions) from SQLite if present,
otherwise from the committed `snapshot/jobs.json`; the UI (`public/app.js`) probes
`/config.json` to choose server mode or static mode and filters in the browser in the latter.

### Matching and scoring (`src/score.mjs`)

Per job: each profile skill adds its weight once, doubled if it appears in the title;
role keywords count in the title (x2) or department; seniority words in the title subtract
points; remote adds 6; the result is rounded and clamped to 0-100. Matching is whole-word
(`hasTerm`, alphanumeric lookarounds with escaped terms) so "staff" does not match
"Staffing" and "git" does not match "Digital", while "c++" and "sr." still work. The same
whole-word rule hides senior titles in `listJobs` (SQL) and in the static client filter.

### Security and privacy decisions

- Job links come from third parties. Ingest drops jobs whose URL is not `http(s)://`, and
  the UI renders any other value as `#` (`safeUrl`). All interpolated text goes through `esc()`.
- CSRF-style protection: `POST /api/jobs/:id/status` requires `Content-Type: application/json`
  (else 415). A cross-site form cannot send that type, and a cross-site `fetch` would need a
  CORS preflight, which the server never grants. The server binds to 127.0.0.1 by default.
- Static files are served only if the resolved path stays under `public/` (`PUBLIC_DIR + sep`
  prefix check, after `decodeURIComponent` + `normalize`). Request bodies are capped at 100 kB.
- SQL is parameterised; the only dynamic SQL is built from a fixed term list.
- Privacy: no accounts, no analytics, no third-party scripts. Stored data is public job
  postings plus your own application statuses (local SQLite file `data/`, which is
  git-ignored, or this browser's `localStorage`). Nothing about the visitor is sent anywhere.

### Testing and CI

`npm test` runs `node --test` over `test/*.test.mjs`: 9 tests (8 scoring, 1 SQL
whole-word senior filter using an in-memory database). `tests.yml` runs them plus
`npm run check` (syntax check of every module) on push and PR using Node 22.
`refresh.yml` runs daily, checks syntax, ingests, builds, and commits the snapshot if
it changed. The HTTP server, adapters (network), and UI have no automated tests.

### Deployment

Static `dist/` on Vercel (auto-deploys on the snapshot commit) and Firebase Hosting
(manual `npm run deploy:firebase`). No server runs in production.

### Known limitations (additional)

- Malformed JSON in a status POST is parsed as `{}`, which is treated as "clear status"
  rather than rejected with 400. Local-only, but a wart.
- `scripts/serve-static.mjs` (local preview only) still uses the older `startsWith(ROOT)` path check without the separator suffix; the URL parser already strips `..` segments, but it should get the same guard as `src/server.mjs`.
- No security headers (CSP etc.) are configured on the Vercel/Firebase hosts.
- Adapters and the HTTP server are untested; adapter response shapes are assumed from
  provider docs and fixed only when a run fails (e.g. the Ashby `secondaryLocations` fix).
- Description text is not shown in the static build (it is omitted from `jobs.json`).

### Future improvements (not implemented)

Workable adapter, cross-company dedupe, adapter fixtures/tests, server tests for the 415/403
paths, CSP headers, synonym-aware scoring.
