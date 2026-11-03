# RoleFinder

A local job search tool. It pulls open roles from company job boards (Greenhouse and
Ashby both publish free public endpoints), stores them in SQLite, scores them against a
profile I control, and keeps track of which ones I have applied to.

It does not submit applications. Two questions it answers: what is out there that fits,
and where did I leave off.

## Running it

Node 22 or newer. No dependencies, no build step — it uses the built-in `node:sqlite`
module, the built-in fetch, and `node:http`.

```
npm run ingest     # download and score postings
npm start          # http://127.0.0.1:4321
```

Re-run `npm run ingest` whenever you want fresh listings. It upserts, so application
statuses survive. `npm run reset` wipes the jobs table for a clean pull.

To open it on a phone that is on the same network, bind to all interfaces:

```
HOST=0.0.0.0 npm start
```

then visit `http://<your-lan-ip>:4321` on the phone. The layout is responsive down to
about 360px wide.

## Adding companies

Everything lives in `companies.json`:

```json
{ "name": "Linear", "provider": "ashby", "slug": "linear" }
```

`provider` is `greenhouse` or `ashby`. The slug is the company identifier in the board
URL:

- Greenhouse: `boards.greenhouse.io/<slug>` → `boards-api.greenhouse.io/v1/boards/<slug>/jobs`
- Ashby: `jobs.ashbyhq.com/<slug>` → `api.ashbyhq.com/posting-api/job-board/<slug>`

A bad slug fails that one source and prints the error, the rest of the run continues.

## Scoring

`profile.json` holds the weights. A skill that appears in the job title counts double,
because a posting called "React Engineer" is a stronger signal than the word "react"
somewhere in a requirements list. Seniority words subtract points, which keeps senior
roles from crowding out the list. Remote postings get a small bump.

Every card shows the terms that matched, so when the ranking looks wrong I can see why
instead of guessing.

## Layout

```
companies.json      which boards to pull
profile.json        skill weights and role keywords
src/sources.mjs     Greenhouse and Ashby adapters, plus HTML cleanup
src/score.mjs       keyword scoring
src/db.mjs          sqlite schema, upserts, queries
src/ingest.mjs      CLI that ties the above together
src/server.mjs      http server, json API, static files
public/             ui (plain es modules, no bundler)
```

Endpoints: `GET /api/jobs`, `GET /api/stats`, `POST /api/jobs/:id/status`,
`GET /api/health`.

## Known limits

- No Lever or Workable adapter yet. Both publish public endpoints too, so they are next.
- Scoring is keyword based. It does not understand that "Django" and "Flask" are similar,
  it only knows the words in `profile.json`.
- Large company boards almost never list junior roles. Adding smaller companies matters
  more than adding more big ones.
- Nothing is deduplicated across companies. The same role posted by two boards shows up
  twice.

## TODO

- [ ] Lever adapter
- [ ] Saved filter presets
- [ ] Draft resume bullets per posting
- [ ] Follow-up reminder for anything applied more than 10 days ago
- [ ] CSV export of application history
