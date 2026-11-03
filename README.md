# RoleFinder

A job search tool. It pulls open roles from company job boards (Greenhouse and Ashby
both publish free public endpoints), stores them in SQLite locally, scores them against
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
cannot come back around and tempt a duplicate application. Status is saved per browser
(and per SQLite database locally); it never reaches a server.

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

Node 22 or newer. No dependencies, no build step: it uses the built-in `node:sqlite`
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
