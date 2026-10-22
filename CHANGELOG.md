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

## Current status (updated 2026-10-22)

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
