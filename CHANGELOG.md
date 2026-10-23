# CHANGELOG

Session-to-session handoff log for `afg-geodata`. The project is worked on by
different agents (Claude Code, Codex) and different accounts, so this file —
not any agent's private memory — is the source of truth for "where are we".

## Rules for every agent / session

1. **Before starting any work**, read this file (at least "Current status" and
   the latest log entry). Do not assume the previous session's state from
   memory — a different agent or account may have made the last change. Then
   follow `AGENTS.md` (engineering rules) and, as needed, `PROJECT_MEMORY.md`
   (durable requirements and root causes) and `CONVERSATION_MEMORY.md`
   (request chronology).
2. **Before ending a session** — whether a phase finished or the session is
   stopping for any other reason (token/usage limit, account switch, etc.) —
   append a dated entry to the "Log" section (newest at the bottom) and update
   "Current status". Do this even if the current phase is not complete.
3. Each entry states: what changed (files), why, verification run and its
   result, and what's next / what is half-done.
4. Never put secrets, `.env` values, credentials, or large raw tool output here.

---

## Current status (updated 2026-10-23)

- **Update 2026-10-23 (city coordinates):** migration
  `20261023140000_fix_city_coordinates` moves Bilaspur, Bareli, Kota and
  Jabalpur to their main stations and re-maps stations and links.
  **Applied to the local DB only**; not on the server. Deparizo left as is.
  Production now needs four new migrations. See the last log entry.
- **Update 2026-10-23 (airport label):** results page shows airports as
  "Airport name (CODE)" (e.g. "Dehradun Jolly Grant Airport (DED)"), no
  repeated city. Frontend only, uncommitted. See the last log entry.
- **Update 2026-10-23 (airport names):** migration
  `20261023130000_airport_hub_names` sets 132 airport hub names from the
  SQLite export (DED "Dehra Dun" → "Dehradun Jolly Grant Airport"; VTZ
  kept). **Applied to the local DB only**; not on the server. See the last log entry.
- **Update 2026-10-23 (airport coordinates):** 43 airport hubs are stored at
  city-centre points (e.g. DED 5 km instead of ~31 km from central Dehradun).
  Migration `20261023120000_fix_airport_hub_coordinates` is **applied to the
  local DB only** (server still needs `prisma migrate deploy`; the server
  also still lacks `20261023090000_recommended_transfer_penalty`). NCR Plaza
  → DED estimate is now 31.1 km. Open: city rows (Bareli, Bilaspur, Kota,
  Jabalpur, Deparizo) are also misplaced. See the last log entry.
- **Update 2026-10-23 (duration sort):** multimodal "Duration" sort now
  collects 3× the result limit before stopping (`DURATION_SORT_COLLECTION_FACTOR`).
  Uncommitted. **Note:** the local DB gained 17 Nov flights during this
  session (5,384 active now; not imported by Claude). See the last log entry.
- **Update 2026-10-23 (flight cap):** flights are now loaded per route
  (departure → arrival airport, max 150) instead of per departure airport, so
  busy airports keep their later flights (DEL → IXE 17:30 now found from a
  06:00 search). Uncommitted; servers need rebuild + restart. Side effect
  found: multimodal "Duration" sort can miss a short late trip (see log).
- **Update 2026-10-23 (later):** train journeys that cannot keep the full
  `initial_rail_buffer_minutes` boarding wait are no longer offered (the
  short-lived "Tight connection" warning was removed at the user's request).
  Uncommitted; servers need rebuild + restart. See the last log entry.
- **Update 2026-10-23:** new **"Recommended"** sort (`sortBy=recommended`):
  rank = final arrival + transfers × `journey_routing_policies.transfer_penalty_minutes`
  (new column, default 240; migration
  `20261023090000_recommended_transfer_penalty`, applied to the **local DB
  only**). Added to the dropdown but **not the default** yet (default is still
  "Number of transfers"). **Update (same day): user reviewed the comparison
  and made Recommended the default** in the UI and both validators.
  Uncommitted; server needs `prisma migrate deploy`,
  `prisma generate`, rebuild + restart.
- **Update 2026-10-22 (departure-sort fix):** Train only + sort by departure
  no longer returns 0 for long routes (DDN → MAS: 0 → 14). Changes are in
  `journey-search.service.ts` (readyMinute includes road access in threshold
  mode) and `railway-provider.service.ts` (arrival-ordered fallback when the
  departure search truncates). Uncommitted; tests pass; servers need
  rebuild + restart. Still ~13 s for that search. See the last log entry.
- **Update 2026-10-22 (later):** Flight only / Mixed results now start at
  the real leave-home time (road access + boarding buffer moved to just
  before the first train/flight; idle pre-boarding wait dropped) in
  `multimodal-journey.service.ts`. Uncommitted; tsc clean, multimodal tests
  23/0/2; servers need restart. See the last log entry.
- **Update 2026-10-22:** commit `68d471b` deployed to the server (Node
  v20.19.6, not to be upgraded). Flight importer switched from `node:sqlite`
  to `sql.js` so it runs there; committed to `main` (not pushed). See the last
  log entry.
- **Update 2026-10-21 (later):** RAIL_ONLY ranking fix — under the default
  `sortBy=transfers`, equal-transfer trains are now ordered by earliest final
  arrival before road access / duration (`journey-search.service.ts`
  `compareJourneyOptions`, `multimodal-journey.service.ts`
  `compareMultimodalJourneyResults`). Fixes Haridwar → Kota (2026-11-05
  15:15) showing the Sunday-only 09102 on 8 Nov as option 2. Uncommitted;
  running servers need rebuild + restart. Follow-up done the same day: the
  direct pass now keeps the boarding needing least road access (12402/19020
  shown from Haridwar, not Roorkee/Jwalapur). See the two log entries.
- **Update 2026-10-21:** second export
  `flights-2026-10-21T07-21-26-867Z.sqlite` imported into the local DB:
  2,436 active FLIGHT_SQLITE flights now (71 origins → 99 destinations on
  2026-11-16; DED also on 2026-11-03..07, 11-15, 2027-01-31). Airlines S5 and
  QP added. No code changed. See the 2026-10-21 log entry.
- **Update 2026-10-17:** flight data now comes from the project's own flight
  SQLite exports instead of Aviation Edge. New migration
  `20261017120000_flight_sqlite_source` (plus the previously pending
  `20260902090000_journey_search_candidate_indexes`) is applied to the local
  DB; importer `npm run data:import-flights -- --file <export.sqlite>`
  (`src/maintenance/import-flight-sqlite.ts`); the Aviation Edge importer and
  `data:import-aviation` were removed. First export imported (35 DED
  flights, now 29 ACCEPTED-only). **All Aviation Edge flight data has been
  deleted** (migration `20261017150000_remove_aviation_edge_data`); flight
  search now only has the SQLite export's flights (DED, 2026-11-15 and
  2027-01-31). Uncommitted. See the 2026-10-17 log entry.
- **Update 2026-10-16:** explained a read-only SQLite query against
  `valid_flights`; no source code changed and no commands were run.
- **Update 2026-10-15:** line endings normalized (`.gitattributes`
  `* text=auto eol=lf`, working files converted to LF, exec bits reverted)
  and the verified work below was committed. The next two bullets describe the
  pre-commit state and are kept for history; next-step item 1 is done.
- **Branch / HEAD:** `main` @ `fe529f1` ("Added autocomplete address using
  google API", 2026-09-08). Nothing committed since (pre-2026-10-15).
- **Uncommitted work (intentional — do not discard):** real source changes in
  `src/services/journey-search.service.ts`,
  `src/services/railway-provider.service.ts`,
  `src/services/multimodal-journey.service.ts`,
  `src/services/places.service.ts` (Google autocomplete restricted to India),
  `public/journey-results.html`, `public/leaflet/journey-results.js`,
  `tests/railway-search.test.js`, plus the two memory `.md` files. These are
  the journey-search correctness fixes (CONVERSATION_MEMORY requests #19–#33)
  and frontend changes (journey-type radio buttons incl. "Mixed", loading /
  inline error states).
- **Line-ending noise:** these files show as modified only because of CRLF
  line endings + an executable-bit change (no content change):
  `collect.service.ts`, `geo.service.ts`, `journey-time.service.ts`,
  `nearby-query.service.ts`, `nearby-railway-station.service.ts`,
  `station-access.service.ts`. All 15 modified files are CRLF in the working
  tree while `HEAD` is LF. Use `git diff --ignore-cr-at-eol` to see real
  changes. Not yet normalized — waiting on user decision.
- **Verification (2026-10-10, this machine):** `npx tsc --noEmit` clean;
  `npm run build` clean; search-semaphore 8/8, rate-limiter 5/5, metrics 4/4,
  railway-search 13/13, multimodal-search 22/23.
- **Known failing test (pre-existing, deferred):** multimodal "DDN to DEL on
  2026-09-18 ranks the direct DED flight ahead of rail-only routes" — returns
  only RAIL_ONLY results. This is the documented `RAIL_TO_FLIGHT` /
  mixed-journey truncation issue under default `sortBy=transfers`; needs a
  dedicated session and explicit user authorization.
- **Pending DB migration:** none locally as of 2026-10-17 (both
  `20260902090000_journey_search_candidate_indexes` and
  `20261017120000_flight_sqlite_source` applied). Other environments still
  need `npx prisma migrate deploy` + `npm run data:import-flights`.
- **Missing file:** `docs/production-environment-variables.md` is referenced
  by the memory files but `docs/` is git-ignored, so it was not carried over to
  this account.

### Next steps (open, in suggested order)

1. User decision: normalize line endings / file mode (e.g. add
   `.gitattributes` with `* text=auto eol=lf` and/or
   `git config core.fileMode false`) and commit the current verified work.
2. ~~Apply the pending index migration~~ — done locally 2026-10-17.
3. Fix the deferred `RAIL_TO_FLIGHT` truncation under `sortBy=transfers`
   (see PROJECT_MEMORY "`journeyTypes` filter validation…").
4. Investigate 30–65 s latency for `sortBy=departure|arrival|duration` on
   long multi-transfer rail routes (e.g. DWX → SVDK) — see
   CONVERSATION_MEMORY request #33.
5. Browser check of "Show More" pagination to 20 results and the address-row
   layout on `journey-results.html` once served over HTTP.
6. Reproduce the Indore → Jammu direct-train case once the user supplies the
   exact payload.
7. (Exploratory, not started) Choose a licensed flight-schedule source for
   refreshing route/schedule data — see the 2026-10-14 log entry. Do not
   scrape MakeMyTrip.

### Environment setup on a fresh machine/account

```bash
npm ci
npx prisma generate
npx tsc --noEmit
npm run build
```

- `node_modules/` and `dist/` are not copied between accounts — run the above.
- npm 11 does not run package install scripts by default, so Prisma's
  postinstall does not generate the client; `npx prisma generate` is required.
- Verified with Node v26.8.2 / npm 11.19.1.
- Needs a local `.env` (not in git) with `DATABASE_URL` pointing at the
  PostgreSQL + PostGIS `afg_geodata` database; the DB-backed tests use it.
- Note: under Node 26 the test runner prints summaries as `ℹ pass N` /
  `✖ …` (not `# pass N`).

---

## Log

### 2026-07-13 → 2026-09-08 — Backfill (pre-CHANGELOG history)

Summarized from git history and the memory files; see `PROJECT_MEMORY.md`
and `CONVERSATION_MEMORY.md` for details.

- Commits `bec38df` … `fe529f1`: project setup, PostGIS railway/airport data,
  flight data + APIs, train timetable import, railway route search,
  multimodal journey search, server-side filters/sort, Google Places address
  autocomplete.
- Committed in `5dcf279`/`fe529f1`: journey-search candidate index migration,
  admission control (`src/utils/search-semaphore.ts`), linked-chain state
  sets (`src/utils/string-chain.ts`), rate limiter, metrics endpoint, opt-in
  clustering, and their unit tests.
- Left uncommitted after 2026-09-08 (still in working tree): journey-search
  correctness fixes for CONVERSATION_MEMORY requests #19–#33 (start-time
  clamp, upstream detour pruning, self-defeating first-leg pruning,
  infeasible-boarding rejection, sort-key alignment, direct-service fairness,
  `RAIL_TO_FLIGHT` feeder bonus) and the frontend changes listed above.
- Last recorded verification (2026-09-08): tsc clean, railway 13/13,
  multimodal 22/23 (same deferred failure as today).

### 2026-10-10 — Account switch: review + environment restore + CHANGELOG (Claude Code, Opus 5.5)

- **Why:** project moved to a new account; the user asked to confirm
  everything works before any new code changes, and to keep a durable
  changelog so Claude/Codex/account switches don't lose state.
- **Done:**
  - Read `AGENTS.md`, `PROJECT_MEMORY.md`, `CONVERSATION_MEMORY.md`,
    `CLAUDE.md`; reconciled them against git (memory said the
    semaphore/metrics/rate-limiter files were untracked — they are now
    committed in `fe529f1`/`5dcf279`).
  - Found `node_modules/` and `dist/` missing → ran `npm ci` and
    `npx prisma generate` (no `package.json`/lockfile changes).
  - Ran full verification (results in "Current status") — matches the
    previous session's recorded state exactly; no regressions from the move.
  - Ran `prisma migrate status` (read-only): one migration pending.
  - Created this `CHANGELOG.md`; added "read CHANGELOG first / append before
    ending" rules to `CLAUDE.md` and `AGENTS.md`.
- **No source code changed.**
- **Next:** see "Next steps" above — first item needs a user decision.

### 2026-10-14 — Flight data source question + account switch (Claude Code, Opus 5.5)

- **Why:** user asked whether flight schedules / city-to-city routes can be
  fetched from MakeMyTrip; then announced another account switch.
- **Answer given (no code written):** MakeMyTrip has no public schedule/route
  API (partner-only, booking-oriented) and scraping violates its ToS and is
  bot-protected — not recommended. Suggested licensed alternatives: OAG /
  Cirium (authoritative, enterprise), AeroDataBox, AviationStack, FlightAware
  AeroAPI, Amadeus for Developers (verify current availability of its
  self-service tier), Travelpayouts (price-oriented), DGCA seasonal schedules
  (India domestic, PDF/HTML), OpenFlights `routes.dat` (free but stale,
  seeding only).
- **Suggested design (not started, awaiting user choice of provider):**
  periodic schedule import into the existing flight tables (airport → airport,
  airline, flight no., days of week, dep/arr times, validity window) so
  journey search keeps querying locally; optional on-demand fare API call only
  when a user opens a specific result.
- **No source code changed, no commands executed** (repo still edit-only).
- **Next:** unchanged from "Next steps"; item 7 added.

### 2026-10-15 — Line-ending normalization + commit (Claude Code, Sonnet 5.5)

- **Why:** user approved next-step item 1.
- **Done:** re-verified (tsc clean, railway-search 13/13, multimodal-search
  22/23 — same deferred `RAIL_TO_FLIGHT` DDN→DEL failure). Added
  `.gitattributes` (`* text=auto eol=lf`), converted the 14 CRLF working files
  to LF, reverted accidental 755 exec bits to 644, committed all journey-search
  correctness/frontend work plus memory docs and this changelog. `.DS_Store`
  files left untracked.
- **Next:** items 2–7 in "Next steps" (migration, RAIL_TO_FLIGHT, latency, ...).

### 2026-10-16 — Explain a SQLite query

- **Why:** user requested an explanation of `SELECT * FROM valid_flights
  WHERE origin_code = 'DED'`.
- **Done:** explained the query's selection and filtering behavior; no source
  code changed and no commands were run.
- **Next:** unchanged from "Next steps" above.

### 2026-10-17 — Review scraped flight SQLite for import (Claude Code, Opus 5.5)

- **Why:** user asked whether `flights-2026-10-17T07-19-09-882Z.sqlite`
  (Cleartrip/MakeMyTrip scrape) is well-formed and usable by the route finder.
- **Done (analysis only):** read-only `sqlite3 -readonly` queries on the
  user's file; no source code, Prisma schema, or project DB touched.
- **Findings:** file integrity OK; 205 itineraries, all from DED, 10
  destinations, 2 dates (2026-11-15, 2027-01-31), MakeMyTrip only (Cleartrip
  session FAILED, so `confirmed_flights` is empty). Only 29 ACCEPTED + 6
  NEEDS_REVIEW (nearby-airport DXN/NMI) nonstop rows are importable; the 170
  connecting itineraries lack per-leg times. Nonstop times/UTC/duration are
  internally consistent. Data is dated instances, not a recurring schedule;
  no terminals/aircraft. Import would need mapping to
  `aviation_flight_instances` + `aviation_airlines` (`service_type =
  'scheduled'`) + existing `aviation_airports`/hubs (DXN/NMI presence in
  Postgres not verified).
- **Next:** user decision on scope/source before writing an importer.
- **Decision (user, same day):** flight data source will move from the
  Aviation Edge API to the scraped SQLite export. User instruction: do not
  change code or DB structure until explicitly asked. Impact analysis given
  in chat (airport/airline provider-ID constraints, coverage, replace-vs-merge
  of existing Aviation Edge rows); nothing implemented.
- **Read-only DB check (user-authorized, same day):** psql session forced
  `default_transaction_read_only=on`; SELECTs only, no writes. Aviation Edge
  data: 158,934 active flight instances, service dates 2026-08-31 →
  2026-12-29 (December thin: 6,462), imported 2026-08-03..07, 140 airports,
  56 airlines (150,082 instances searchable via `service_type='scheduled'`).
  6E/AI/IX exist and are `scheduled`. DED and the 9 other searched airports
  exist with active hubs; **DXN and NMI are missing** from
  `aviation_airports`/AIRPORT hubs (hub code DXN is only a railway station,
  allowed by unique `(hub_type, code)`). Aviation Edge has only 1–4 DED
  departures/day vs ~16 nonstops in the SQLite sample, with zero overlap on
  2026-11-15 and different times for shared flight numbers (e.g. 6E402
  13:40 vs 09:10) — Aviation Edge future data looks stale/incomplete.
  2027-01-31 is beyond Aviation Edge coverage.
- **Import design requested (same day, no code yet):** user asked for a
  fresh SQLite flight importer (airports seeded by migration, initial import
  + recurring update scripts, schema change keeping existing behaviour, fare
  table for future pricing). Read-only findings: SQLite has all 140 DB
  airports + 25 new (incl. DXN, NMI, GOX, HSR, HDO); 36 shared airports'
  coordinates differ >3 km from DB hubs (PAB 1159 km, BEK 301 km, DED
  19.7 km); 10 airport hubs have no `city_id`. Node v26 → built-in
  `node:sqlite` usable (no new dependency). Plan given in chat; awaiting user
  decisions (AE deactivation scope, coordinate source) before implementing.

### 2026-10-17 — Switch flight data from Aviation Edge to SQLite exports (Claude Code, Opus 5.5)

- **Why:** user asked to stop using Aviation Edge and use the project's own
  flight SQLite export as the flight source, with a new migration, a reliable
  import, and no regressions. User chose: deactivate Aviation Edge flights only
  on routes/dates the export re-collected; remove the Aviation Edge importer.
- **Finding:** the app never called the Aviation Edge API at runtime; it only
  read flights from `aviation_flight_instances`, filled by the offline
  `import-aviation-edge.ts` file importer. Search code needed no change.
- **Changed:**
  - `prisma/migrations/20261017120000_flight_sqlite_source/migration.sql`:
    `provider_airport_id`/`provider_airline_id` nullable; `data_source` on
    airports, airlines, flight instances, schedule imports (existing rows
    `AVIATION_EDGE`, new default `FLIGHT_SQLITE`); `source_provider`,
    `source_record_id`, `last_seen_at` on flight instances; route/date index;
    new `aviation_flight_fares` (stored for future pricing, not read by
    search); seeds the 165 export airports — only the 25 missing ones are
    inserted (existing airports keep hub/coords/city).
  - `prisma/schema.prisma`: matching fields + `AviationFlightFare` model.
  - `src/maintenance/import-flight-sqlite.ts` (new): validates the export
    schema; imports ACCEPTED direct flights only (user decision, see
    follow-up below); same identity key as
    existing rows (update, not duplicate); deactivates (never deletes) flights
    missing from a route/date with a COMPLETED search; stores fares; updates
    schedule-import and coverage records; skips an already-imported checksum
    (`--force` to redo, `--dry-run` to preview); links export airport hubs to
    the nearest city and transfer links (`--refresh-all-transfer-links` for
    the old full rebuild). Runs in one transaction.
  - `src/maintenance/transport-hub-links.ts` (new): full transfer-link refresh
    moved unchanged from the old importer + a hub-scoped variant.
  - Removed `src/maintenance/import-aviation-edge.ts`; `package.json`
    `data:import-aviation` → `data:import-flights`; test skip message wording.
- **Local DB run:** backup `pg_dump` of aviation/hub tables taken first
  (session scratchpad, not in repo). Import: 35 flights created, 4 Aviation
  Edge DED flights on 2026-11-15 deactivated (IX2017, 6E6344, 6E6455,
  6E7714), 39 fares, 629 new transfer links for new airports; the 9,434
  pre-existing links untouched. Re-run skips; `--force` re-run updates 35,
  creates 0, adds 0 fares.
- **Verification:** `npx tsc --noEmit` clean; railway-search 13/13;
  multimodal-search 22/23 (same pre-existing DDN→DEL 2026-09-18 failure as
  baseline before the change). Real `searchMultimodalJourneys` DED→DEL:
  2026-11-15 FLIGHT_ONLY returns 6E6530 08:55 and DXN flights from the
  export; 2027-01-31 returns AI438 (date beyond Aviation Edge data).
- **Known limits / next:** export covers only DED on 2 dates — all other
  routes still use the (stale) Aviation Edge rows until exports cover them.
  16 of the 25 new airports (incl. DXN) have no city within 60 km, so no
  station↔airport transfer links. Nothing committed. Production needs
  `prisma migrate deploy` then `npm run data:import-flights -- --file …`.
- **Follow-up (same day, user request):** importer limited to
  `validation_status = 'ACCEPTED'` (NEEDS_REVIEW nearby-airport DXN/NMI rows
  no longer imported). Local DB: `--force` re-import updated 29 and
  deactivated the 2 NMI rows (covered route); the 4 DXN rows (route not
  covered: its search was NO_RESULTS) were deactivated manually by id. Now 29
  active FLIGHT_SQLITE flights, 6 inactive (kept, not deleted). Seeded
  DXN/NMI airports remain. Re-verified: tsc clean, railway 13/13, multimodal
  22/23 (same known failure); DED→DEL search no longer shows DXN flights.
- **Follow-up 2 (same day, user request: remove Aviation Edge data):** user
  chose delete (not deactivate) for flights/bookkeeping, and keep airports +
  airlines with Aviation Edge IDs cleared. New migration
  `20261017150000_remove_aviation_edge_data`: deletes `AVIATION_EDGE` flight
  instances (158,934) and schedule imports (12,191), deletes coverage rows not
  backed by a FLIGHT_SQLITE import (12,186), sets `provider_airport_id` /
  `provider_airline_id` NULL and `data_source = 'FLIGHT_SQLITE'` on all 165
  airports and 56 airlines. Backup `pg_dump` taken first (session scratchpad).
  Importer link step now targets only airport hubs with no transfer links
  (all airports are FLIGHT_SQLITE now, so tagging no longer identifies new
  ones). That run created 179 new links for HDX and DBR, existing airports
  that had a city but had never been linked; no existing link was modified.
  Re-verified: tsc clean; railway 13/13; multimodal 21 pass / 0 fail / 2 skip
  (the DDN→DEL 2026-09-18 test and the `loadFlightInstances` window test skip
  because their hard-coded September dates have no flights now; the
  `RAIL_TO_FLIGHT`/mixed truncation bug is NOT fixed). Search DED→DEL returns
  6E6530 (2026-11-15) and AI438 (2027-01-31). Data notes: HDX (Aviation Edge)
  and HDO (SQLite) are both Hindon airport.
- **Next:** decide whether to retarget the two skipped multimodal tests to
  dates covered by SQLite exports; collect exports for more origins/dates.

### 2026-10-21 — Import second flight SQLite export (Claude Code, Opus 5.5)

- **Why:** user asked to import
  `~/Downloads/flights-2026-10-21T07-21-26-867Z.sqlite`.
- **Export:** integrity OK; Cleartrip, MakeMyTrip and Yatra sessions;
  2,722 ACCEPTED direct rows, 157 NEEDS_REVIEW and 6,673
  REJECTED_NOT_DIRECT (not imported). 71 origins on 2026-11-16, plus DED on
  2026-11-03..07, 2026-11-15 and 2027-01-31.
- **Run (local DB, no code changed):** backup `pg_dump` of aviation/hub
  tables taken first (session scratchpad, not in repo). Dry run then
  `node dist/maintenance/import-flight-sqlite.js --file …`: 2,436 unique
  flights (286 duplicate rows were the same flight from several providers),
  2,407 created, 29 updated (the earlier DED flights), 0 deactivated,
  3,174 fares, 731 covered route/dates, no unknown airports or invalid rows,
  airlines S5 (Star Air) and QP (Akasa Air) added as `scheduled`, 0 new
  transfer links. Active flights 29 → 2,436.
- **Verification:** `npm run build` clean (via `data:import-flights`);
  multimodal-search 21 pass / 0 fail / 2 skip (same skips as 2026-10-17);
  no active flight has arrival ≤ departure; BOM→DEL 2026-11-16 returns
  AI2956, 6E6045, 6E656, … in time order.
- **Note:** `pg_dump` must use the URL from `.env` parsed by Node; extracting
  it with shell `sed` produced a wrong connection string.
- **Next:** unchanged from 2026-10-17 (the two skipped multimodal tests still
  target September dates with no flights; collect exports for more dates).

### 2026-10-21 — RAIL_ONLY ranking: earliest arrival before road access (Claude Code, Opus 5.5)

- **Why:** user reported Haridwar, Uttarakhand → Kota, Rajasthan,
  2026-11-05 15:15 (default `sortBy=transfers`): option 1 (22918, 5 Nov
  16:57) correct, but option 2 was 09102 departing Sun 8 Nov 16:22.
- **Reproduced** (user-authorized: build, read-only DB queries, temporary
  script calling `searchMultimodalJourneys`, deleted after use): all 10
  results are 0-transfer. 09102 runs Sundays only (`runs_mask` 64) and
  22918 Thursdays only (8), so the dates are right; the order was wrong.
  Equal-transfer tie-break was road access → duration/practicality →
  arrival, so 09102 (27 min road, 706 min) outranked 19020 (daily, arrives
  7 Nov) and 12402 (daily, arrives 6 Nov 10:41).
- **Root cause:** `compareJourneyOptions` (`journey-search.service.ts`) and
  the RAIL_ONLY branch of `compareMultimodalJourneyResults`
  (`multimodal-journey.service.ts`) ranked road access and duration ahead of
  final arrival. Neither counts the wait for the first train, so a shorter
  trip days later beat an equally direct, earlier-arriving train.
- **Changed:** both comparators now use transfers → earliest final arrival →
  road access → duration (rest unchanged). Comments updated.
  `tests/railway-search.test.js` ranking assertion now checks arrival before
  road access; new unit test in `tests/multimodal-search.test.js` for the
  HW→KOTA case.
- **Result:** HW→KOTA order is 22918 HW, 22918 RK, 12402 RK (6 Nov),
  19020 (7 Nov) ×5, then 09102 ×2 (9 Nov) last. DWX→SVDK 2026-09-10 (the
  earlier road-access fix case) still ranks the direct Dewas 12919 first;
  only the two 09321 entries swapped (MKC→JAT arrives earlier).
- **Verification:** `npx tsc --noEmit` clean; `npm run build` clean;
  railway-search 13/13; multimodal-search 22 pass / 0 fail / 2 skip (same
  two September-date skips as before).
- **Found, not fixed (needs user OK):** the transfers-sort direct pass in
  `executeSearch` (`railway-provider.service.ts`) picks one origin per
  (destination, train), choosing the shortest in-vehicle time, i.e. the
  farthest-downstream boarding. So 12402 (HW 00:14) and 19020 (HW 13:30) to
  KOTA appear only from Roorkee/Jwalapur, not Haridwar itself.
- **Next:** decide on the boarding-retention fix above; restart servers to
  pick up the build.

### 2026-10-21 — Direct pass keeps the traveler's own boarding station (Claude Code, Opus 5.5)

- **Why:** user approved fixing the follow-up above: trains that stop at
  Haridwar must be shown boarding at Haridwar.
- **Root cause:** in `executeSearch` (`railway-provider.service.ts`), the
  transfers-sort direct pass sorted by transfers → train arrival → in-vehicle
  duration. Boardings of one train run share the arrival, so duration
  always picked the stop farthest down the line (Roorkee/Jwalapur) as
  Pass 1's single (destination, train) representative.
- **Changed:**
  - Direct-pass sort is now transfers → door-to-door arrival (train arrival
    + destination road access) → total road access → existing keys.
  - `searchRailwayProvider` takes an optional `destinationRoadAccessMinutes`
    map (only caller `journey-search.service.ts` passes
    `calculateStationAccess(...).travelMinutes` per destination station).
    The provider cache key now includes origin and destination road-access
    minutes.
  - `findDirectPaths` drops an origin's early-stop alighting of a train when
    the same train reaches a later candidate stop with no more road access
    (same rule as `pruneUpstreamAlightingDetours`), before the quotas. Needed
    because the first change alone regressed "date-only search includes the
    direct HW to LMNR train": Haridwar's one origin slot went to Dewas,
    which the prune later removed, so HW→LMNR never surfaced.
  - New DB-backed test in `tests/multimodal-search.test.js` (HW→KOTA
    2026-11-05 15:15: 12402 and 19020 board at HW; direct results ordered by
    arrival).
- **Result:** HW→KOTA: 22918 HW, 22918 RK, 12402 **HW** (6 Nov), 19020
  **HW**→KOTA, 19020 JWP→KOTA, 19020 →NKOT ×3, 09102 **HW**→KOTA (9 Nov),
  09102 RK→NKOT, then two 1-transfer options. LMNR test search: YNRK→LMNR and
  HW→LMNR are back. DWX→SVDK: Dewas 12919 still #1; 09321 now alights at
  SVDK (MKC→SVDK) instead of Jammu Tawi.
- **Verification:** `npx tsc --noEmit` clean; build clean; railway-search
  13/13; multimodal-search 23 pass / 0 fail / 2 skip (same skips).
  Temporary repro scripts deleted.
- **Known, not changed:** `searchEarliestPaths` (fills slots left after the
  direct pass) has no such alighting check, so an early-stop variant can
  still appear from there (e.g. RK→DWX in the LMNR search). Pre-existing,
  already flagged in PROJECT_MEMORY.
- **Next:** commit when the user asks; restart running servers.

### 2026-10-22 — Server deployment steps after pushing 68d471b (Claude Code, Opus 5.5)

- **Why:** user pushed `main` (`68d471b`, flight SQLite import + ranking
  fixes) and pulled it on the server; asked what to do next.
- **Answer given (no code changed, no commands run against any DB/server):**
  on the server — back up the DB (migration
  `20261017150000_remove_aviation_edge_data` deletes Aviation Edge flights),
  `npm ci`, `npx prisma generate`, `npx prisma migrate deploy`, `npm run
  build`, copy the flight exports (`data/flight-exports/` is git-ignored)
  and run `npm run data:import-flights -- --file …` (dry run first, oldest
  export first), then restart the Node process. Importer needs Node with
  `node:sqlite` (22.13+; local is v26).
- **Note:** `data/flight-exports/flights-2026-10-22T06-18-49-107Z.sqlite`
  exists locally but no log entry records importing it.
- **Next:** unchanged from "Next steps".
- **Follow-up (same day):** server runs Node v20.19.6, so the importer fails
  with `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`. Advised running the import
  with Node 22.13+/24 via nvm (app can stay on Node 20); no code changed.
  Migrations reported as not touching railway/train tables.
- **Follow-up 2:** user does not want to change the server's Node version.
  Advised running the importer from the local machine (Node 26) against the
  server DB over an SSH tunnel (`DATABASE_URL` set in the shell wins over
  `.env`, since `dotenv/config` does not override). Alternative, not done:
  switch the importer from `node:sqlite` to a Node 20-compatible package
  (needs user OK — code change).

### 2026-10-22 — Flight importer runs on Node 20 (sql.js instead of node:sqlite) (Claude Code, Opus 5.5)

- **Why:** user asked to make the importer work on the server's Node
  v20.19.6 without upgrading Node there.
- **Changed:**
  - `src/maintenance/import-flight-sqlite.ts`: reads the export with
    `sql.js` (SQLite compiled to WebAssembly; no native build, no install
    scripts, no Node version requirement) instead of `node:sqlite`.
    `readSource` is now async and takes the file bytes already read for the
    checksum; queries go through a small `queryAll` helper. Import logic,
    SQL and Postgres writes are unchanged.
  - `package.json` / `package-lock.json`: `sql.js@1.14.2` (dependency),
    `@types/sql.js@1.4.11` (dev). 1.14.2 chosen over the newest 1.15.x
    (released days ago).
- **Verification (no Postgres access):** `npx tsc --noEmit` clean;
  `npm run build` clean. A scratch script ran every importer query plus the
  schema PRAGMAs against `flights-2026-10-22T06-18-49-107Z.sqlite` with both
  `node:sqlite` and `sql.js`: all 11 result sets identical (3,432 direct
  flights, 12,482 fares, 899 covered routes). sql.js loaded and queried the
  export under Node v20.19.6 (via `npx node@20.19.6`). Importer dry run
  against a database not run. Committed to `main` on user request (not pushed).
- **Server steps:** pull, `npm ci`, `npx prisma generate`, then
  `npm run data:import-flights -- --file <export> --dry-run`, then without
  `--dry-run`.
- **Note:** `npm audit` reports 9 pre-existing vulnerabilities (sql.js has
  no dependencies); not addressed.

### 2026-10-22 — Flight/mixed journeys start at the real leave-home time (Claude Code, Opus 5.5)

- **Why:** user reported (Dehradun → Ahmedabad, 2026-11-16 01:00) that
  Flight only / Mixed cards all showed departure 01:00 (the search time),
  while Train only showed the real leave-home time (e.g. 14:35). Cause: the
  multimodal search starts every path's road access at the requested time,
  then adds the boarding buffer and a `FLIGHT_WAIT`/`RAIL_WAIT` until the
  first service; `resultFromState` took `departureAt` from that first road
  leg, so `totalJourneyMinutes` also included hours of idle airport waiting
  (inflating durations and skewing Fastest / duration ranking and access
  pruning).
- **Changed:** `src/services/multimodal-journey.service.ts` — new
  `alignOriginAccessToFirstBoarding`, applied at the start of
  `resultFromState`: shifts the origin road leg and `INITIAL_BOARDING_BUFFER`
  to end at the first RAIL/FLIGHT departure and drops the idle wait before
  it (waits between later services unchanged). Result `departureAt` and
  `totalJourneyMinutes` now use the shifted leave-home time, mirroring the
  railway-only `suggestedLeaveHomeAt`. Search/expansion logic unchanged.
  Leave-home is still >= the requested time (first boarding is never before
  requested + access + buffer).
- **Verification (user-authorized):** `npx tsc --noEmit` clean;
  `npm run test:multimodal-search` (also runs `npm run build`, so `dist/` is
  rebuilt) 23 pass / 0 fail / 2 skip (same two data-dependent skips as
  before). Live Dehradun → Ahmedabad search not re-checked.
- **Next:** restart the server and re-check that search; commit when the
  user asks.

### 2026-10-22 — Validation: DDN → MAS, 2026-10-28 16:30, every journey type × sort (Claude Code, Opus 5.5)

- **Why:** user asked to validate this search across all test cases.
- **No code changed.** Read-only DB queries and direct
  `searchMultimodalJourneys` calls from scratch scripts (outside the repo);
  `npm run test:railway-search` 13/13 pass.
- **Correct (matches timetable):** Train only / transfers, duration,
  arrival. Direct options are the CDG–MDU SF Exp (runs Mon+Fri only, so the
  first one from Saharanpur is Fri 30 Oct 10:45); the earliest arrival is
  12402 DDN 22:45 Wed → NZM, then 12652 → MS, Fri 30 Oct 16:01. Duration and
  arrival orderings are monotone. No train runs directly from within 60 km of
  DDN to MAS.
- **Correct (no data):** Flight only and Mixed return 0. The search horizon
  is 3 days (to 31 Oct), and the first flights in the DB after 28 Oct are on
  3 Nov.
- **Bug found — Train only + sort by departure returns 0 results** after
  ~12 s with `truncated: true`. For any sort except `transfers`,
  `railway-provider.service.ts` `executeSearch` skips the direct-path pass
  and relies only on `searchEarliestPaths`. In departure order, that hits
  the state limit on this ~40 h route before it completes any path. Same
  family as the `sortBy=departure` issues in PROJECT_MEMORY. Not fixed yet.
- **Observations (not bugs / data):** 90999, 20494 and 12688 are all
  "CDG MDU SF EXP" with near-identical timings (likely duplicate timetable
  rows). Total result count differs by sort (12 for transfers vs 13 for
  duration/arrival). Leave-home can be clamped to the requested time, leaving
  a <30 min boarding wait (12912 at RK, 9 min) — documented intent in
  `journey-search.service.ts`.
- **Earlier flight leave-home fix re-checked** on Dehradun → Ahmedabad
  2026-11-16 01:00: leave times now vary per itinerary (e.g. DED 6E6713
  leave 14:59, total 4h18, previously 01:00 / ~18h).
- **Next:** decide on the departure-sort fix (e.g. run the direct-path pass
  for every sort order, or fall back to the transfers result set and
  re-sort when the departure search truncates).

### 2026-10-22 — Fix: Train only + sort by departure returned 0 results (Claude Code, Opus 5.5)

- **Why:** user asked to fix the bug found in the DDN → MAS validation above.
- **Changed:**
  - `src/services/journey-search.service.ts`: in threshold mode
    (`departureAtIsTrainThreshold`, used by every RAIL_ONLY search) each
    origin's `readyMinute` is now requested time + road access instead of
    requested time alone. This matches `buildOption()`'s existing rejection
    rule, so only candidates that were already discarded are no longer
    admitted. Comment in `buildOption()` updated.
  - `src/services/railway-provider.service.ts` `executeSearch`: when the
    departure-ordered `searchEarliestPaths` truncates with open slots,
    run an arrival-ordered pass for those slots. It shares
    `resultKeys`/`trainKeys`, so nothing is duplicated. `searchComplete`
    and `truncationReason` reflect the last pass.
- **Verification (user-authorized):** `npx tsc --noEmit` clean;
  `test:railway-search` 13/13; `test:multimodal-search` 23 pass / 0 fail /
  2 skip (same data-dependent skips). DDN → MAS 2026-10-28 16:30 Train
  only:
  - departure sort: 0 → 14 results, leave times non-decreasing from 16:30
  - transfers: 12 → 14; duration and arrival: 13 → 15 (e.g. 12402 from
    Haridwar, 12470 from Saharanpur were crowded out before)
  - DWX → SVDK 2026-09-10 07:00 departure sort: 16 results, non-decreasing
    leave times 07:00 to 13:26
  - Debug logging was added only to `dist/` and removed by rebuilding.
- **Still open:** departure sort on long routes takes ~11–14 s (the
  departure pass still hits the state limit before the fallback). The known
  backtracking first-leg variants can still appear (SRE → RK, UJN → DWX).
  Duplicate timetable rows for the CDG–MDU SF Exp (90999/20494/12688) are
  untouched.
- **Next:** rebuild + restart servers; commit when the user asks.

### 2026-10-23 — "Recommended" sort with a policy-configured transfer penalty (Claude Code, Opus 5.5)

- **Why:** for DDN → MAS (2026-10-28 16:30), the default "Number of
  transfers" sort put Mon/Fri direct trains on 30 Oct above connections
  leaving on 28 Oct and arriving 34 h earlier. The user approved adding a
  "Recommended" sort as a new option, not the default, with a
  before/after review before any default switch. They also approved adding
  the DB column.
- **Changed:**
  - `prisma/schema.prisma` and new migration
    `20261023090000_recommended_transfer_penalty`: adds
    `journey_routing_policies.transfer_penalty_minutes INT NOT NULL DEFAULT
    240`, with a CHECK of 0–1440. Applied to the local DB with
    `prisma migrate deploy`, followed by `prisma generate`.
  - `src/types/journey-search.ts` and both validators: `"recommended"`
    added to `JourneySortOrder`. The default is still `"transfers"`.
  - `src/services/journey-search.service.ts`: `recommendedScoreMs` (final
    arrival + transfers × penalty), with a branch in `compareJourneyOptions`.
    The penalty is threaded through `groupJourneyOptions`.
  - `src/services/railway-provider.service.ts` `executeSearch`:
    "recommended" runs the direct-train pass without its early return, then
    an arrival-ordered `searchEarliestPaths` with the full budget.
  - `src/services/multimodal-journey.service.ts`: `recommendedScoreMinutes`
    keeps the practicality extras (flight distance, flight-transfer
    overhead, long layovers, detours) and replaces only the generic 25-min
    transfer cost with the policy penalty. For rail-only results this equals
    the railway formula. `policy.transferPenaltyMinutes` is exposed in the
    response and used when re-sorting cached pages.
  - `public/journey-results.html`: "Recommended" is the first dropdown
    option. "Number of transfers" stays `selected` and remains the default
    in the JS.
  - `tests/multimodal-search.test.js`: three new tests (validator; ranking
    unit test where a later direct train loses and a near direct train
    wins; real DDN → MAS search where the first result leaves on 28 Oct and
    scores are non-decreasing).
- **Verification (user-authorized):** `npx tsc --noEmit` clean;
  `test:railway-search` 13/13; `test:multimodal-search` 26 pass / 0 fail /
  2 skip. In the app (dev server, Browser pane), DDN → MAS with Sort by
  Recommended shows option 1 as Wed 28 Oct 22:25 → Fri 30 Oct 16:01, with no
  console errors.
- **Before/after (transfers vs recommended, same build):**
  - DDN → MAS: the 28 Oct connections now come first; the 30 Oct direct
    trains move down. 14 → 20 results.
  - HW → KOTA 11-05 15:15: top 3 unchanged (22918 ×2, 12402). The next-day
    19020 direct is replaced by 1-transfer trips arriving Fri 10:10.
  - DWX → SVDK and INDB → SVDK: top 3 direct (12919) unchanged. The Sat
    09321 directs (2 days later) are replaced by 12919 + 22439, arriving 3 h
    earlier.
  - NDLS → BPL and CSMT → PUNE: top 5 identical.
  - NDLS → AGC: same #1. Extra boarding variants appear (20808 from NZM),
    and a dominated 1-transfer variant (20808 + 13008, arriving 47 min after
    the same direct train) reaches #6.
  - HW → LMNR: 1-transfer 19020 + 12416 (Fri 09:33) now ranks above the
    next-day direct 14318 (Sat 06:05).
  - Dehradun → Ahmedabad Flight only: the IXC direct (arrives 11:47, 3 h
    drive) now ranks above the DED direct (arrives 19:17). Mixed: the IXC
    flight + ADI train first, then some 2-transfer options rank higher.
  - Speed: recommended is 0.1–1.3 s on these routes. It is slower than
    transfers where the direct pass used to return early (NDLS → BPL: 19 ms
    → 491 ms).
- **Open:** pick the default (needs the user's review of the above). The
  dominated same-first-train transfer variants (NDLS → AGC #6) could be
  pruned. Server: back up, `prisma migrate deploy`, `prisma generate`,
  `npm run build`, restart.

### 2026-10-23 — Recommended is now the default sort (Claude Code, Opus 5.5)

- **Why:** the user reviewed the before/after comparison above and asked
  for Recommended to be the default in the UI and validators.
- **Changed:**
  - `src/validators/journey-search.validator.ts` and
    `multimodal-journey.validator.ts`: `sortBy` now defaults to
    `"recommended"`.
  - `src/services/journey-search.service.ts` and
    `multimodal-journey.service.ts`: request-level fallbacks
    (`request.options.sortBy ?? …`) are now `"recommended"`. Internal helper
    parameter defaults (`compareJourneyOptions`,
    `selectMultimodalJourneyResults`, `searchRailwayProvider`) stay
    `"transfers"`; they only apply when a caller passes no sort.
  - `public/journey-results.html`: Recommended is `selected`.
    `public/leaflet/journey-results.js`: new `DEFAULT_SORT = "recommended"`
    is used for the clear-filters reset and both non-default-sort checks.
  - Tests: the default assertions now expect `"recommended"`. The railway
    "coordinate search returns ranked nearby-station journeys" test now
    sends `sortBy: "transfers"` explicitly, because its ordering checks are
    for the fewest-transfers sort.
- **Verification:** `npx tsc --noEmit` clean; `test:railway-search` 13/13;
  `test:multimodal-search` 26 pass / 0 fail / 2 skip. In the app, a fresh
  page shows Recommended; DDN → MAS (28 Oct 16:30) with no sort change opens
  on Wed 28 Oct 22:25 → Fri 30 Oct 16:01; changing the sort to Arrival and
  then "Clear all filters" resets it to Recommended. No console errors from
  the page (the only 404 is the preview's request for `/`).
- **Next:** commit when the user asks. Server: back up DB,
  `npx prisma migrate deploy`, `npx prisma generate`, `npm run build`,
  restart. API clients that relied on the implicit `"transfers"` default
  now get `"recommended"` and must send `sortBy: "transfers"` to keep the
  old order.

### 2026-10-23 — "Tight connection" warning for a squeezed boarding wait (Claude Code, Opus 5.5)

- **Why:** the user asked why the boarding wait differs between options.
  It is 20 min (`initial_rail_buffer_minutes`) everywhere, except when the
  leave-home time would fall before the search time. The journey is then
  kept with less time to board: 12912 at Roorkee gets 9 min for DDN → MAS on
  28 Oct 16:30. The user chose to keep these journeys and warn about them.
- **Changed (frontend only, no API change):**
  - `public/leaflet/journey-results.js`: `receiveResults` stores
    `policy.initialRailBufferMinutes` / `initialFlightBufferMinutes` from
    the response. New `tightBoarding(journey)` measures the time from the
    last road-access arrival to the first RAIL/FLIGHT departure and compares
    it with that mode's buffer. When it is short, `renderSummary` shows
    "Tight connection: only X min to board", and `renderTimeline` shows the
    same note on the boarding-wait row.
  - `public/leaflet/journey-results.css`: `.tight-boarding` style using the
    existing `--amber` / `--amber-soft` tokens.
- **Verification:** `node --check` passes. In the app (the user's own
  `npm start` server on :3000, which serves `public/` from disk), DDN → MAS
  28 Oct 16:30 shows the warning only on the 12912-from-Roorkee option, on
  both the card and the "Boarding wait" row; no console errors. On
  Dehradun → Ahmedabad 2026-11-16 01:00, Flight only + Mixed (20 results)
  shows no warnings.
- **Next:** commit when the user asks.

### 2026-10-23 — Drop journeys with a boarding wait below the policy buffer (Claude Code, Opus 5.5)

- **Why:** the user did not want the "Tight connection: only X min to
  board" warning. Journeys that can't keep the
  `journey_routing_policies` boarding buffer should be left out of the
  results instead.
- **Changed:**
  - `public/leaflet/journey-results.js` / `.css`: the warning
    (`tightBoarding`, `.tight-boarding`, buffer state) is fully removed.
    The `DEFAULT_SORT` change stays.
  - `src/services/journey-search.service.ts` `buildOption()`: in flexible
    timing (threshold or date-only), reject a train when station arrival +
    `initialRailBufferMinutes` > departure. Before, it was rejected only
    when station arrival > departure.
  - Same file, source timings: in threshold mode the provider's
    `readyMinute` is now requested + road access + boarding buffer, the same
    bound as above, so the search doesn't spend budget on journeys that
    will be dropped.
  - `tests/multimodal-search.test.js`: the DDN → MAS recommended test also
    asserts that every journey keeps at least the policy boarding buffer.
- **Verification:** `npx tsc --noEmit` clean; `test:railway-search` 13/13;
  `test:multimodal-search` 26 pass / 0 fail / 2 skip.
  - DDN → MAS 28 Oct 16:30: both 12912-from-Roorkee options (9 min) are
    gone; all 20 results have a 20 min boarding wait.
  - Scan across 6 routes (DDN → MAS, HW → KOTA, DWX → SVDK, NDLS → AGC,
    CSMT → PUNE, HW → LMNR) × 5 sorts, Train only: the minimum boarding wait
    is 20 min everywhere, and no journey leaves before the search time.
- **Note:** flight/mixed journeys already always keep the full
  `initial_flight_buffer_minutes` (the leave-home shift added on
  2026-10-22).
- **Next:** the user's running `npm start` server on :3000 still runs the
  old `dist/` loaded at its start and needs a restart (`dist/` is rebuilt).
  Commit when the user asks.

### 2026-10-23 — Route test matrix (195 searches) (Claude Code, Opus 5.5)

- **Why:** the user asked to test other routes. No code changed. Scratch
  scripts (outside the repo) call `searchMultimodalJourneys` directly and
  check every result for:
  - leg times contiguous; `departureAt`, `finalArrivalAt` and
    `totalJourneyMinutes` consistent with the legs
  - no journey leaves before the search time; first service within the
    horizon
  - boarding wait >= the policy buffer (rail 20, flight 120)
  - transfer count = services − 1; journey type matches the filter; no
    duplicate ids
  - order is monotone for the chosen sort
- **Train only:** 18 routes × 5 sorts = 90 searches, **0 failed checks**.
  Routes: NDLS → AGC, CSMT → PUNE, MAS → SBC, HWH → PNBE, ADI → CSMT,
  LKO → CNB (23:45), NDLS → TVC, HWH → CSMT, GHY → NDLS, JAT → MAS,
  ASR → BSB, JU → GKP, MAO → ERS, BBS → VSKP, RNC → CBE, DDN → MAS,
  HW → KOTA, plus NDLS → BPL date-only. 9–20 results each.
- **Flight / Mixed / All types:** 7 city routes on 2026-11-16 × 3 types ×
  5 sorts = 105 searches. Flight only and Mixed: **0 failed checks**.
  Delhi → Mumbai at 22:00 returns 0 flights; this is correct (last DEL → BOM
  flight is 23:00, and the DB has no flights after 16 Nov).
- **Found — "All types" (no `journeyTypes` filter) train journeys still
  start at the search time:** `executeSearch` in
  `multimodal-journey.service.ts` uses `searchRailwayOnly`
  (non-threshold), not `searchRailwayOnlyDeparturesAfter`. So rail-only
  results there leave at the search time with 87–373 min boarding waits
  (Dehradun → Ahmedabad 01:00). The long-layover penalty then pushes them
  down under Recommended. This is not reachable from the UI (its radios
  always send a filter), only from API clients. Not fixed.
- **Checker false positive:** the order flags on "All + Recommended" came
  from the checker ignoring the long-layover penalty. The order is
  consistent with `recommendedScoreMinutes`.
- **Latency:** departure sort on long train routes is 9.8–15.4 s, and
  "All types" + departure is 9.9–18.5 s. Mixed + transfers reaches 5.2 s
  (HYD → GAU). Everything else is under ~2.5 s.
- **Next:** decide on the "All types" rail fix; commit when the user asks.

### 2026-10-23 — Flight data count, and the per-airport 150-flight cap (Claude Code, Opus 5.5)

- **Count (local DB, read-only):** 2,846 flight instances, 2,840 active.
  All 2,840 pass the search's data filters (scheduled airline, active hubs).
  By date: 16 Nov 2026 = 2,734; 3–7 Nov, 15 Nov and 31 Jan 2027 hold the
  small DED sets. 779 routes, 3,978 fares, 168 imports. The jump from 2,436
  (21 Oct) suggests the 2026-10-22 export was imported; there is no log
  entry for it.
- **Found — busy airports lose their later flights:** `loadFlightInstances`
  (`multimodal-routing.repository.ts`) loads at most `maximumPerDepartureAirport`
  = `FIRST_HOP_MAX_FLIGHTS_TOTAL` (150) flights per departure airport,
  earliest first, for the whole 3-day window.
  - From a 06:00 search on 16 Nov, DEL keeps only departures up to 11:05
    (301 of 451 dropped), BLR up to 15:00, BOM up to 16:00, HYD up to 18:50.
  - Proof: Delhi → Mangaluru (IXE) has a direct DEL → IXE flight at 17:30.
    A 12:00 search finds it as #1; a 06:00 search never sees it and shows
    only a BOM connection. This also limits onward legs from those hubs.
  - Not fixed; needs the user's OK. Options: cap per (departure airport,
    arrival airport) instead of per airport, or raise/remove the SQL cap
    and rely on the in-search per-destination limits.

### 2026-10-23 — Flights loaded per route instead of per departure airport (Claude Code, Opus 5.5)

- **Why:** user asked to fix the 150-flights-per-airport cap found above
  and re-run the route tests.
- **Changed:**
  - `src/repositories/multimodal-routing.repository.ts` `loadFlightInstances`:
    the per-airport `CROSS JOIN LATERAL … LIMIT` is replaced by
    `ROW_NUMBER() OVER (PARTITION BY departure_airport_id,
    arrival_airport_id ORDER BY departure_at, id)` with
    `route_rank <= maximumPerRoute`. The parameter is renamed from
    `maximumPerDepartureAirport`. Filters are unchanged.
  - `src/services/multimodal-journey.service.ts`: new
    `MAX_FLIGHTS_LOADED_PER_ROUTE = 150`, passed instead of the unrelated
    `FIRST_HOP_MAX_FLIGHTS_TOTAL`.
  - `tests/multimodal-search.test.js`: the SQL-limit test now checks
    per-route counts and uses 2026-11-16, so it runs instead of skipping.
    New test: Delhi → Mangaluru at 06:00 must include the direct DEL → IXE
    flight.
- **Verification:**
  - `npx tsc --noEmit` clean; `test:railway-search` 13/13;
    `test:multimodal-search` 28 pass / 0 fail / 1 skip (was 2 skips).
  - Delhi → IXE at 06:00: 7 → 20 results, #1 is now the 17:30 direct.
    Delhi → HGI at 06:00: 0 → 1 (12:00 direct).
  - Window load for 16 Nov 06:00 + 3 days: 2,558 flights in 32 ms.
  - The in-search first-hop limit (3 per destination, 150 total) picks every
    destination at DEL/BLR/BOM/HYD (DEL uses 145 slots), so it does not cut
    late flights.
  - Route matrix re-run: train-only 90 searches identical, 0 issues.
    Flight/mixed/all: 105 searches; 15 changed and 1 known checker false
    positive (All + Recommended, long-layover penalty).
  - Improvements: BLR → CCU departure arrives 20:54 instead of 00:04+1;
    MAA → JAI 21:51 instead of 02:21+1; HYD → GAU 9 → 11 results;
    COK → LKO departure now 1 transfer arriving 13:39 instead of
    2 transfers arriving 19:49.
  - Latency: median 389 ms, max 17.4 s (All + departure), essentially
    unchanged.
- **Side effect found (not fixed):** the multimodal search stops at
  `resultLimit` matching journeys, in arrival-priority order, and only then
  sorts. With more early flights loaded, Dehradun → Ahmedabad Mixed sorted
  by Duration no longer includes 6E6713 DED 14:59 + 20987 (arrives 21:45,
  6 h 46 m, previously #1). #1 is now 6E6395 IXC + 19036 (10 h 01 m).
  Recommended is unaffected in practice, because that trip arrives later
  than the 14:23 options. The fix would be to keep exploring past
  `resultLimit` for `duration` (or use a duration-aware stop rule).
- **Next:** decide on the Duration-sort stop rule; commit when the user
  asks.

### 2026-10-23 — Multimodal Duration sort explores past the result limit (Claude Code, Opus 5.5)

- **Why:** the user asked to make the multimodal "Duration" sort keep
  exploring past the result limit so the shortest journeys are found, then
  re-run the route tests.
- **Changed:** `src/services/multimodal-journey.service.ts`: new
  `DURATION_SORT_COLLECTION_FACTOR = 3`. When `sortBy === "duration"`, the
  search loop collects up to `resultLimit × 3` matching journeys
  (`collectionLimit`) before stopping. It is still bounded by
  `MULTIMODAL_MAX_EXPANDED_STATES` (15,000) and the horizon. The final sort
  keeps the shortest `resultLimit`. Other sorts are unchanged.
- **How 3 was chosen** (6 city pairs, Flight only + Mixed, Duration sort,
  16 Nov):

  | Factor | Effect |
  |---|---|
  | 1 (old) | baseline |
  | 3 | 20th-shortest: DEL → BOM flight 18h00 → 11h35, HYD → GAU 29h24 → 24h19, BLR → CCU 17h36 → 14h51. MAA → JAI Mixed shortest 11h45 → 8h32. Max 2.0 s, never truncated. |
  | 5 | little extra gain; DEL → BOM Mixed hits the 15k-state budget |
  | unlimited | every route hits 15k states; up to 29 s (BLR → CCU Flight only) |

  Re-measured after the new data import: identical numbers.
- **The 6h46m Dehradun → Ahmedabad "Mixed" trip is still missing from a
  01:00 Duration search, even with unlimited exploration** (budget runs out
  first). It is 6E6713 DED → AMD, then road to Sabarmati, then local train
  20987 SDGM → Asarva within Ahmedabad. The same flight alone arrives at
  19:17 (4h18m door to door), so the train only adds ~2.5 h. It is still
  found under Transfers, and under Duration from a 12:00 search. Not chased
  further.
- **Data changed during the session (not by Claude):**
  `data/flight-exports/flights-2026-11-16.sqlite` and
  `flights-2026-11-17.sqlite` (15:04–15:05) were imported. The DB now has
  5,390 flights (5,384 active): 16 Nov 2,768, 17 Nov 2,510.
- **Verification:** `npx tsc --noEmit` clean; `test:railway-search` 13/13;
  `test:multimodal-search` 28 pass / 0 fail / 1 skip. Route matrix
  (195 searches): **0 failed checks** (the earlier All + Recommended checker
  false positive no longer triggers). Train-only 90: identical. Flight /
  Mixed / All: 29 changed, mixing the new 17 Nov data (DEL → BOM at 22:00:
  0 → 20 flight results, #1 now 17 Nov 00:52 → 06:02; HYD → GAU 11 → 20) and
  the Duration change (MAA → JAI Mixed #1 8h32 instead of 11h45; COK → LKO
  All #1 13:39 instead of 15:14). Latency median 522 ms, max 16.2 s (All +
  departure).
- **Next:** commit when the user asks; restart servers.

### 2026-10-23 — Airport hub coordinates fix (migration written, not applied) (Claude Code, Opus 5.5)

- **Request:** NCR Plaza (Dehradun) → DED, Flight only, showed "Est. 5.0 km
  by road"; the real airport is ~31 km by the same estimate.
- **Root cause:** the DED hub in `transport_hubs` is stored at Dehradun city
  centre (30.3166680, 78.0333300), not Jolly Grant (30.1892430, 78.1766510).
  Airport hubs created by the old Aviation Edge importer often hold
  city-centre points (round arc-minute values). The SQLite migration and
  `addMissingAirports` in `import-flight-sqlite.ts` skip existing airports,
  so they never correct them. `refreshGeographyAndTransfers` only fills a
  NULL `geom` and never re-maps airport cities, so a link refresh alone does
  not fix it.
- **Check (user ran a read-only comparison against the SQLite migration
  coordinates):** 62 airports > 1 km off. Agreed with the user: fix 43
  (mostly city-centre points; PAB and BEK even point at the wrong city
  entirely), keep 17 precise points 1–1.6 km apart (AMD, RJI, JDH, BDQ, CCU,
  COK, IDR, KQH, IXZ, TEZ, TRZ, JAI, BOM, IXE, JRH, MAA, IXI), keep VTZ
  (SQLite point is the new Bhogapuram airport; unconfirmed that flights moved)
  and SXR (2 km, both precise).
- **Added:** `prisma/migrations/20261023120000_fix_airport_hub_coordinates/migration.sql`
  (one transaction): backs up affected rows to
  `maintenance_backups.airport_hub_coordinates_20261023` (outside `public`,
  so Prisma sees no drift; restore SQL in the file comment), moves the 43
  hubs (`latitude`, `longitude`, `geom`), re-maps the city only when it is
  missing or now > 60 km away, then retires and rebuilds those hubs'
  transfer links with the `linkAirportHubs` rules (100 km max). Skips hubs
  already within 1 km, so it is safe to re-run.
- **Not run:** migration not applied anywhere; no code changed. KQH and IXX
  have no linked city (so no transfer links); IXX gets one from this
  migration, KQH does not (its point was kept).
- **Next:** user reviews the migration → apply locally (`prisma migrate
  deploy`), re-run the check query (expect only the 19 kept airports), re-run
  NCR Plaza → DED (expect ~31 km), run the three test commands, then apply on
  the server. Open decision: importer should warn (recommended) or
  auto-correct when an existing airport is > 1 km from the export point.
- **Applied locally (same day, user-authorized):** `prisma migrate deploy`
  on the local DB (`localhost:5432/afg_geodata`; only this migration was
  pending). 43 rows backed up. Re-run check query: only the 19 kept airports
  remain. NCR Plaza → DED (Flight only, 16 Nov 06:00): estimated road access
  to DED is now 31.1 km (20.7 km aerial); it was 4.3 km with the same
  approximate origin. `npx tsc --noEmit` clean; `test:railway-search` 13/13;
  `test:multimodal-search` 28 pass / 0 fail / 1 skip.
- **New finding:** `transport_cities` rows from Aviation Edge are also
  misplaced: Bareli (26.2167, 81.2333 = Rae Bareli), Bilaspur (31.3167,
  76.8333 = Himachal), Kota (25.0, 76.5), Jabalpur (22.6667, 79.925),
  Deparizo. With no other city within 60 km, BEK, PAB and DEP kept their
  city and now have **0 transfer links** (their old 51/18/6 links pointed at
  stations in the wrong region). Impact is small: BEK 1 and PAB 1 active
  flight, DEP 0. KTU and JLR keep links (27/44). IXX still has no city.
- **Next:** decide whether to fix those city coordinates (then re-map airport
  cities and rebuild links); apply both pending migrations on the server and
  rebuild + restart; importer warn-vs-auto-correct decision still open.

### 2026-10-23 — Airport hub names from the SQLite export (migration written, not applied) (Claude Code, Opus 5.5)

- **Request:** airport results should show the airport name ("Dehradun Jolly
  Grant Airport"), not "Dehra Dun". The results page label is
  `name city (code)` from `transport_hubs.name` (`placeLabel` in
  `public/leaflet/journey-results.js`), so DED showed "Dehra Dun Dehra Dun (DED)".
- **Cause:** same as the coordinates: names come from the old Aviation Edge
  import (often a city or old locality: LKO "Amausi", PNQ "Lohegaon", TRZ and
  RAJ "Civil"), and the SQLite migration/importer never update existing
  airports. Read-only check: 133 of 165 airports differ from the export.
- **City check (read-only, same day):** `transport_cities` points to fix:
  Bilaspur (Himachal instead of Chhattisgarh), Bareli (Rae Bareli instead of
  Bareilly), Kota, Jabalpur. Keep 8 name-match false alarms. Deparizo acts as
  Itanagar (HGI + Naharlagun stations); undecided. No city migration yet.
- **Added:** `prisma/migrations/20261023130000_airport_hub_names/migration.sql`
  (one transaction): lists 164 export names (all except VTZ), backs up the
  rows it will change to `maintenance_backups.airport_hub_names_20261023`,
  then updates only names that differ (132 locally). Re-running does nothing.
- **Not run; no code changed.** After it is applied the label reads
  "Dehradun Jolly Grant Airport Dehra Dun (DED)"; dropping the repeated city
  from `placeLabel` is a separate, not-yet-requested code change.
- **Next:** user review → apply locally; decide on the city-fix migration and
  the label change; apply pending migrations on the server.
- **Applied locally (same day, user-authorized):** `prisma migrate deploy`
  on `localhost:5432/afg_geodata` (only this migration pending). 132 names
  backed up; the name check now returns only VTZ. NCR Plaza → DED search
  (Flight only, 16 Nov 06:00, fresh process on a spare port): flight legs show
  "Dehradun Jolly Grant Airport", "Indira Gandhi International Airport",
  "Pune International Airport". The dev server on :3000 was not restarted.

### 2026-10-23 — Airport label without the repeated city (Claude Code, Opus 5.5)

- **Request:** "Dehradun Jolly Grant Airport Dehra Dun (DED)" should not
  repeat the city.
- **Changed:** `public/leaflet/journey-results.js` `placeLabel`: airports
  now render as `name (CODE)`; the city is no longer appended. Stations are
  unchanged. It is the only place that builds airport labels.
- **Verified in the browser** on the running :3000 server (it serves
  `public/` from disk; its backend is still the old build, but the names come
  from the already-updated local DB): DDN → CSMT, Flight only, 16 Nov 06:00,
  option 1 details show "Dehradun Jolly Grant Airport (DED) → Chhatrapati
  Shivaji Maharaj International Airport (BOM)" and "Est. 29 km by road" from
  Dehradun station to DED. A preview on :3001 could not be used because
  `API_URL` in `.env` points the page at :3000.
- **Next:** commit when the user asks; city fix deferred by the user (2026-10-23);
  production needs the three new migrations plus rebuild + restart.

### 2026-10-23 — City coordinates fix (migration written, not applied) (Claude Code, Opus 5.5)

- **Request:** write the city-fix migration (user had deferred it, then
  asked for it).
- **Added:** `prisma/migrations/20261023140000_fix_city_coordinates/migration.sql`
  (one transaction). Moves PAB Bilaspur → BSP (22.0561021, 82.1707668),
  BEK Bareli → BE (28.3381037, 79.4102663), KTU Kota → KOTA (25.2239827,
  75.8808529), JLR Jabalpur → JBP (23.1649573, 79.9512511). Backs up city
  rows (`maintenance_backups.city_coordinates_20261023`) and every changed
  hub city (`maintenance_backups.hub_cities_20261023`). Re-maps stations near
  the old/new points or in these cities to the nearest city within 60 km, and
  clears the city when none is in range (the existing refresh keeps stale
  cities). Airports keep/choose their `city_iata_code` city. Rebuilds links
  for all hubs in these cities and every re-mapped hub; ranks are computed
  over whole cities so the airport 10-station cap still holds.
- **Read-only preview (local DB):** no airport changes city. Stations: 49
  Bareilly-area (incl. BE, BRY) none → Bareli and 13 Pantnagar → Bareli;
  33 Rae Bareli-area (incl. RBL) Bareli → none, 5 → Lucknow, 2 → Kanpur,
  1 → Allahabad; 27 Chhattisgarh (incl. BSP) none → Bilaspur, 6 Himachal
  Bilaspur → none, 2 → Chandigarh, 1 → Simla; 25 (incl. KOTA) none → Kota,
  6 Kota → none, 1 → Guna; 6 none → Jabalpur, 24 Jabalpur → none.
- **Not run; no code changed.** Deparizo (acts as Itanagar) unchanged.
- **Next:** user review → apply locally, then check BEK/PAB links and a
  Bareilly/Bilaspur search; production needs all four new migrations.
- **Applied locally (same day, user-authorized):** `prisma migrate deploy`
  on `localhost:5432/afg_geodata` (only this migration pending). Backups: 4
  cities, 201 hub cities (matches the preview exactly). Active transfer links
  6,607 → 6,706. Airports now: BEK 72 links (nearest DOX, IZN, BRY; city
  10.1 km), PAB 37 (CHBT, DPH, BYL, BSP; 9.7 km), KTU 46 (incl. KOTA;
  7.9 km), JLR 32 (incl. JBP; 10.4 km). Search Connaught Place → Bilaspur Jn
  (Flight only + Flight → Train, 16 Nov 04:00): DEL → PAB flight, then
  14.6 km estimated road to Bilaspur Jn. `npx tsc --noEmit` clean;
  `test:railway-search` 13/13; `test:multimodal-search` 28 pass / 0 fail /
  1 skip.
- **Next:** commit when the user asks; production needs `prisma migrate
  deploy` (4 migrations) + rebuild + restart; restart the :3000 dev server.
