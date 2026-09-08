# AFG Geodata Project Memory

Last updated: 2026-09-08 (Asia/Calcutta)

This file is durable working memory for future development sessions. Read it
together with `AGENTS.md`, which remains the authoritative engineering policy.
It summarizes user-provided requirements and completed or pending work; it is
not a verbatim export of hidden reasoning or raw tool output.

For the normalized user-visible conversation chronology and a portable Claude
Code handoff, also read `CONVERSATION_MEMORY.md` and `CLAUDE.md`.

## User requirements and preferences

- The multimodal journey-search API (`/api/v1/journeys/search`, backing
  `journey-results.html`) now returns up to **20** results per search, exposed
  five at a time. The initial request returns results 1-5; each "Show More"
  click issues a new server-side-paginated request (`resultOffset`/`pageSize`)
  for the next five, appended to the existing list, until 20 is reached, then
  the button hides/disables. Pagination must not duplicate results, and
  ranking must stay consistent across pages (a later page must never contain
  a journey that should have ranked earlier).
- The direct coordinate railway search (`/api/v1/railways/search`, backing
  `train-schedule.html`, which has no "Show More" UI) intentionally keeps the
  original five-result cap - it was not part of this pagination request.
- Query, filtering, pagination, and relationship constraints must be applied as
  early as possible. Do not scan or process an entire dataset when only a
  bounded number of valid results are required.
- Stop candidate processing as soon as the requested number of valid results
  has been found, subject to preserving the requested sort order and route
  correctness.
- Avoid full-table scans, unnecessary field loading, N+1 queries, and loading
  connections for candidates that cannot appear in the final five.
- The search calendar must collect both departure date and departure time.
- Date-time requests must include an explicit UTC offset. The browser currently
  submits India time using `+05:30`.
- Legacy multimodal requests containing only `YYYY-MM-DD` must remain accepted
  and are normalized to midnight at `+05:30`.
- Legacy clients requesting up to 50 results must be accepted but normalized to
  the server's result limit (five for the direct railway endpoint, twenty for
  the paginated multimodal endpoint) instead of receiving a validation error.
- `journey-results.html` has two stacked "From"/"To" row pairs: an
  address-autocomplete pair (`originAddressLabel`/`destinationAddressLabel`,
  calls `/places/autocomplete` + `/places/details`) and a station-autocomplete
  pair (`originLabel`/`destinationLabel`, calls `/railways/stations`; this is
  the pair actually read by `validateAndBuildRequest()` for search). Selecting
  an address suggestion writes its resolved coordinates into the *station*
  pair's hidden lat/lng inputs and label. Clicking "Use my location" must fill
  **both** From boxes (`originLabel` and `originAddressLabel`), not just one.
- The station-autocomplete row is now hidden by default (`class="location-fields is-hidden"`,
  `.is-hidden { display: none; }` in `journey-results.css`) so only the
  address row is visible. It stays fully functional though - its
  `required` attributes are inert (the form has `novalidate`; validation is
  custom JS reading element `.value`s regardless of visibility), and its
  `originLabel`/`originLatitude`/`originLongitude`/(destination equivalents)
  are still what `validateAndBuildRequest()` reads for the actual search -
  they're kept in sync via `selectAddress()`'s existing cross-write and the
  "Use my location" fix above. To re-show that row, remove `is-hidden` from
  its container div in `journey-results.html`.
- The swap button (`swapLocationsButton`) was **moved** from inside the
  (now-hidden) station row into the address row, replacing an empty
  `<span aria-hidden="true">` placeholder that existed there purely to keep
  the 3-column grid alignment; an equivalent empty placeholder was put in the
  swap button's old slot in the station row for when it's un-hidden. Moving
  it was necessary because hiding the station row's container would
  otherwise have hidden the swap button along with it. `swapLocations()` in
  `journey-results.js` now also swaps `originAddressLabel`/
  `destinationAddressLabel` (added `"AddressLabel"` to its suffix loop),
  alongside the pre-existing `Label`/`Latitude`/`Longitude` swap.
- Default journey ordering is **number of transfers first**. A direct journey
  must rank ahead of a transfer journey even when the transfer journey arrives
  earlier or has a shorter duration.
- The sort dropdown must be server-side. Supported values are `transfers`,
  `duration`, `departure`, and `arrival`. Changing the dropdown must issue a new
  API request, and sort order must participate in result/provider cache keys.
- For the reported Indore-to-Jammu case, a daily direct train is expected to be
  shown. The exact reported search date was not provided, so this scenario has
  not yet been reproduced against the development database.
- For an exclusive `RAIL_ONLY` search, `departureAt` is the lower bound for the
  first scheduled train departure. If no train departs exactly at that instant,
  return the available trains departing afterward within the configured search
  horizon. Preserve `sortBy`, `resultLimit`, `pageSize`, and `resultOffset`.

## Flagged for user confirmation (not changed)

- The new pagination requirement's ranking description ("1. fastest journey,
  2. fewest transfers as a tie-break") reads as duration-first. The codebase's
  default `sortBy` is `transfers` (transfers-first), a deliberate prior fix for
  the Indore-to-Jammu case where a direct train must outrank a faster-arriving
  transfer journey. A `sortBy=duration` option already exists and does
  duration-first/transfers-tie-break ranking dynamically via the existing
  "Sort By" dropdown. This work assumed the ranking section describes that
  existing dynamic option rather than asking for the *default* to change, and
  left the default and comparator logic untouched. If the user actually wants
  the default sort flipped to duration-first, that is a one-line change to
  `sortBy` defaults in `journey-search.validator.ts` / `multimodal-journey.validator.ts`
  (see `.default("transfers")`), but doing so would reopen the Indore-to-Jammu
  behavior and should be confirmed first.
- The duplicate From/To row pairs on `journey-results.html` (address search
  stacked above station search, both visibly unlabeled as to which is which)
  were left as two rows, just with parenthetical "(address)"/"(station)"
  hints added to each label - a minimal disambiguation, not a structural
  redesign. A bigger redesign (e.g. merging both into one field with one
  combined autocomplete, or a toggle between modes) was not attempted since
  it wasn't clearly requested and is a larger, more subjective UI change;
  confirm with the user before going further in that direction.

## Established root causes

### Large search response time

- Flight instances were previously loaded for the entire search horizon with
  their relationships and limited only afterward in application code.
- Transfer links were ranked through a window over all active relationships.
- Railway searches performed broad expansion and repeatedly scanned or grouped
  connection data before retaining a small result set.
- The old calendar supplied only a date, preventing an exact lower-bound filter
  on scheduled departures.

### Validation error after adding the date-time calendar

- The multimodal validator initially rejected the old date-only request shape.
- It also rejected cached/legacy browser code that still sent `resultLimit: 50`
  and `pageSize: 20`.
- The validator was changed to normalize those legacy values while continuing
  to enforce no more than five returned results.

### Direct train missing from the first five

- Railway candidate search stopped after five arrival-ordered paths.
- Five transfer paths could fill the quota before a later direct train was
  retained.
- The browser dropdown then only rearranged those five already-truncated
  records, so it could never restore the discarded direct train.

## Current implementation state

The following changes are present in the working tree and were intentionally
made as one performance/correctness effort:

- `JOURNEY_RESULT_LIMIT` (`src/types/journey-search.ts`) is now **20** and is
  the ceiling enforced by the multimodal validator/service and by the two
  `journey-search.service.ts` railway safety-cap sites (`searchCoordinateRailwayJourney`,
  `searchCoordinateRailwayDeparturesAfter`), so a `RAIL_ONLY` multimodal
  search can also produce up to 20 candidates.
- A new, separate constant `RAILWAY_DIRECT_SEARCH_RESULT_LIMIT` (= 5) was
  added and is used only by `journey-search.validator.ts`, so the direct
  `/railways/search` endpoint (`train-schedule.html`, no pagination UI) keeps
  returning five results unchanged.
- `public/leaflet/journey-results.js`'s `MAX_JOURNEYS` constant is now 20
  (`PAGE_SIZE` stays 5). The file's existing "Show More" plumbing
  (`resultOffset`/`pageSize`/`resultLimit` in every request, offset tracking,
  append-with-dedup-by-id, button hide/disable at the cap) required no other
  changes - it was already built against these two constants.
- `paginateCachedSearchResult` in `multimodal-journey.service.ts` already
  cached the full (now up to 20) ranked result per search - keyed without
  `resultOffset`/`pageSize` - and sliced pages from that single cached array,
  so ranking is consistent across pages and pages cannot duplicate results by
  construction. No change was needed there.
- Search-breadth/engine tuning constants (`candidatesPerMode`,
  `MAX_TRANSFER_TARGETS_PER_HUB`, `MAX_EXPANDED_STATES`, per-hop flight caps,
  etc.) were left untouched - they control candidate-generation breadth, not
  the final result-count ceiling, and the task did not report a
  missing-candidate/truncation problem.
- Journey and train calendars use `datetime-local` and submit offset-aware
  timestamps.
- Station autocomplete requests are limited to five suggestions.
- Flight loading uses one SQL query with scheduled-service, activity, time
  window, active-hub, narrow-projection, and per-departure-airport limits inside
  the database query.
- Transfer-link loading uses bounded lateral index lookups per active source hub
  and filters inactive destination hubs before returning rows.
- A migration at
  `prisma/migrations/20260902090000_journey_search_candidate_indexes/migration.sql`
  adds partial indexes for active flight lookup and nearest active transfers.
- Railway graph snapshots cache indexes by train and by alighting station. The
  immutable active timetable is still loaded once per graph-cache lifetime to
  preserve multi-hop routing correctness; it is no longer regrouped for each
  request.
- Railway route search uses bounded best-first expansion with reverse
  reachability pruning and stops at the configured result limit (five for the
  direct `/railways/search` endpoint; up to twenty when invoked from the
  multimodal search).
- Multimodal search stops once the requested number (up to twenty) of
  non-dominated candidates matching the requested filters are retained.
- Exclusive `RAIL_ONLY` requests use the dedicated railway fast path, and
  `FLIGHT_ONLY` requests skip railway expansion and transfer-link loading.
- The server accepts a `sortBy` option and returns results using that ordering.
- Transfer-first railway searches run a bounded direct-service pass before
  transfer expansion. If five direct services are found, transfer expansion is
  skipped entirely. Otherwise only the remaining result slots are filled.
- Railway and multimodal priority queues use the requested sort order during
  candidate generation, so sorting is applied before the result-limit cutoff.
- The journey-results dropdown defaults to `transfers`; changing it performs a
  new server request. Client-side filters preserve the server-provided order.
- Exclusive `RAIL_ONLY` searches use a train-departure-threshold path: nearby
  station and timetable work runs once, the first train must depart at or after
  `departureAt`, and final sorting/limiting happens before the existing outer
  pagination is applied. The rail-only fast path does not query flight instances
  or flight coverage merely to populate metadata.
- `useCurrentLocation()` in `journey-results.js` now writes the resolved
  current-location label (either "Current location" or "<nearest station>
  area") into **both** `originLabel` and `originAddressLabel`, not just the
  station field. The four "From"/"To" labels on `journey-results.html` gained
  parenthetical "(address)"/"(station)" hints, and `journey-results.css`
  gained a `.label-hint` rule, to disambiguate the two stacked row pairs.

## Concurrency, admission control, and production-readiness work

Separate from the pagination/UI work above. Read-only analysis (route-search
algorithm identification, a performance-optimization plan, and a concurrency
production-readiness audit) preceded implementation; see "Conversation
chronology" below for what was analysis-only versus what was implemented.

Established findings (analysis, not yet all acted on):
- Route search is **not** literal RAPTOR or CSA. The railway engine
  (`searchEarliestPaths` in `railway-provider.service.ts`) is a priority-queue
  label-setting search - Dijkstra when sorting by arrival, A\* (admissible
  leg-count heuristic) when sorting by transfers (the default). The
  multimodal engine (`executeSearch` in `multimodal-journey.service.ts`) is
  explicitly a **weighted** A\* (its own code comments say so) over a hub
  graph, using a Haversine-distance time heuristic. A RAPTOR-shaped function,
  `searchRoundBasedPaths` in `railway-provider.service.ts`, exists but has
  **zero call sites** anywhere - confirmed dead code, deliberately left
  untouched.
- The single biggest pre-existing production gap was that the multimodal
  search had **no admission control** at all, unlike the railway engine's
  existing `SearchSemaphore` - fixed, see below.

Implemented (in the working tree, verified - see "Verification status"):
- **Admission control**: `SearchSemaphore` (bounded active-count + FIFO wait
  queue + immediate `503` once the queue is full, always released via
  try/finally) extracted from `railway-provider.service.ts` into
  `src/utils/search-semaphore.ts` and reused by a new, independent instance
  in `multimodal-journey.service.ts`, wrapping only the actual cache-miss
  search execution (both `executeSearch` and `executeRailOnlySearch`) inside
  `searchMultimodalJourneys` - cache *hits* never touch the semaphore.
- **DB connection pool**: `config/database.ts` now appends
  `connection_limit=<DATABASE_CONNECTION_LIMIT>` (default 10) to
  `DATABASE_URL` unless already present, via Prisma's own connection-string
  mechanism - still exactly one `PrismaClient` singleton.
- **Rate limiting**: `src/middleware/rate-limiter.ts`, an in-process
  per-IP fixed-window limiter (`SEARCH_RATE_LIMIT_WINDOW_MS`/
  `SEARCH_RATE_LIMIT_MAX_REQUESTS`), applied only to the two search POST
  routes, responding `429` (distinct from the semaphores' `503`). Both route
  files share one `resolveRateLimiterConfig()` to avoid config drift.
- **Metrics**: `src/observability/metrics.ts` - semaphore active/queued
  counts, event-loop delay (via `perf_hooks.monitorEventLoopDelay`), a Prisma
  query-duration proxy (via non-preview query-event logging in
  `database.ts` - **not** literal pool-wait time), and process memory,
  exposed at `GET /api/v1/health/metrics` (gated by optional
  `METRICS_ACCESS_TOKEN`, open with a startup warning if unset) and logged
  periodically (`METRICS_LOG_INTERVAL_MS`, only started from `server.ts`,
  never on module import).
- **Clustering**: opt-in via `CLUSTER_WORKERS` (default 1 = unchanged
  single-process behavior) in `server.ts`, using Node's built-in `cluster`
  module - crashed workers auto-replaced, `SIGTERM`/`SIGINT` fan out and wait
  for all workers before the primary exits. **Every per-worker env var above
  is enforced per worker process, not cluster-wide** (own Prisma client, own
  graph snapshot, own caches, own semaphores, own rate-limiter state) - the
  primary logs a `warn`-level line at cluster startup with the actual
  configured values so this multiplication is visible at deploy time, not
  just documented. Full reference: `docs/production-environment-variables.md`.
- **Search-engine allocation fixes**: `visitedStationIds`/`usedTrainIds`
  (railway) and `visitedCityIds`/`visitedHubIds`/`usedTrainIds`/
  `usedFlightIds`/`serviceKeys` (multimodal) converted from `Set`/array
  copy-on-every-expansion to a shared immutable linked chain
  (`src/utils/string-chain.ts`, O(1) prepend instead of O(depth) copy). This
  also corrected an earlier under-estimate: the railway engine was
  re-copying its visited-station set at *every* alighting-allowed stop
  within a single train boarding, an O(stops²) cost per boarding, not just
  O(legs). `rides`/`ride` (railway) and `modes`/`legs` (multimodal) were
  deliberately left as plain arrays - small, bounded, and every read site
  needs full enumeration anyway, so there was no allocation win to capture.
  Behavior-preservation was verified by running the real-DB test suites
  before and after via git-stash comparison, confirming byte-identical
  pass/fail results at each step (see "Verification status").

Deferred / explicitly not done (flagged, not silently skipped):
- Multi-process CPU parallelism beyond opt-in clustering (no adaptive
  autoscaling).
- Enabling Prisma's `metrics` preview feature (would give literal
  connection-pool wait time) - a `schema.prisma` change, not made without
  checking first.
- Converting `rides`/`ride`/`modes`/`legs` to the linked-chain
  representation (see above - judged not worth the added risk/complexity
  this round).
- A full load-testing pass against the new admission-control/rate-limit/
  clustering defaults - defaults are reasoned, not measured.

## Relevant files

- `src/utils/search-semaphore.ts`, `src/utils/string-chain.ts`
- `src/middleware/rate-limiter.ts`, `src/middleware/metrics-auth.ts`
- `src/observability/metrics.ts`
- `docs/production-environment-variables.md`
- `tests/search-semaphore.test.js`, `tests/rate-limiter.test.js`,
  `tests/metrics.test.js`
- `public/journey-results.html`
- `public/leaflet/journey-results.js`
- `public/leaflet/journey-results.css`
- `public/train-schedule.html`
- `public/leaflet/train-schedule.js`
- `src/types/journey-search.ts`
- `src/types/multimodal-journey.ts`
- `src/validators/journey-search.validator.ts`
- `src/validators/multimodal-journey.validator.ts`
- `src/repositories/multimodal-routing.repository.ts`
- `src/services/journey-search.service.ts`
- `src/services/multimodal-journey.service.ts`
- `src/services/railway-provider.service.ts`
- `tests/railway-search.test.js`
- `tests/multimodal-search.test.js`

## Verification status

- `git diff --check` passed after the earlier edits in this batch. Its only
  output was the repository's existing LF-to-CRLF warning.
- Builds, tests, database queries, migrations, benchmarks, and the exact
  Indore-to-Jammu reproduction have **not** been run because `AGENTS.md` places
  the repository in edit-only mode unless command execution is explicitly
  authorized. This includes the 5-to-20 result-limit and pagination changes
  described above - `tsc` and the two focused test files below have not been
  re-run against them yet.
- The running server uses compiled output and must be rebuilt and restarted
  before source changes take effect.
- Once the server is rebuilt/restarted, the "Show More" flow on
  `journey-results.html` should be exercised in a browser for a
  route/date/sort combination with more than five non-dominated candidates,
  clicking through to 20 and confirming the button then hides/disables and no
  card repeats.
- The "Use my location" fix (writes to both From boxes) and the label-hint
  CSS are frontend-only and need no `tsc`/backend test run; they were checked
  by reading the code and by opening `journey-results.html` as a static
  `file://` page, which confirms label text and DOM order only -
  `/leaflet/journey-results.css` is referenced with a root-relative path and
  does not load under `file://`, so the grid/CSS layout itself has **not**
  been visually confirmed and should be checked once the app is served over
  HTTP.

When execution is authorized, use the focused verification sequence:

```bash
npx tsc --noEmit
npm run test:railway-search
npm run test:multimodal-search
```

Apply the database migration where appropriate, then rebuild and restart the
application. For a definitive direct-train verification, obtain the exact
Indore and Jammu coordinates/station selections, departure date and time, and
API payload used by the user, then reproduce it against the development
database before making further ranking or candidate-generation changes.

### Concurrency/production-readiness work verification (2026-09-08)

Command execution was authorized for this work. Verified, in order, after
each change (not only at the end):

- `npx tsc --noEmit` - clean throughout.
- `npm run build` - clean throughout.
- `tests/search-semaphore.test.js` (8), `tests/rate-limiter.test.js` (5),
  `tests/metrics.test.js` (4) - new, all passing; pure unit tests with no DB
  dependency, using controllable deferred promises/an injectable clock
  rather than real timers.
- `tests/railway-search.test.js` - 12/13 passing, consistently, before and
  after every change in this body of work. The one failure
  (`date-only search includes the direct HW to LMNR train`) is pre-existing
  and unrelated - reconfirmed via `git stash` comparison against the
  original code, where it fails identically (real train-schedule data for
  that date, not caused by any change here).
- `tests/multimodal-search.test.js` - 22/23 passing, consistently, same
  method. The one failure
  (`DDN to DEL on 2026-09-18 ranks the direct DED flight ahead of rail-only routes`)
  is likewise pre-existing and confirmed unrelated the same way, even though
  it directly exercises the newly-wrapped `searchMultimodalJourneys` path.
- Live smoke tests (manual `curl` against a locally-run `dist/server.js`):
  single-process boot; rate-limiter 429 after the configured max; cluster
  boot with `CLUSTER_WORKERS=2` (both workers bound the shared port) followed
  by clean `SIGTERM` shutdown with zero orphaned processes; the cluster
  startup warning log correctly echoing actually-configured env values; the
  metrics endpoint open by default and correctly returning `401` without/with
  the wrong `METRICS_ACCESS_TOKEN` and `200` with the correct one.
- Neither pre-existing failure has been fixed - out of scope, and doing so
  was never requested.

## Conversation chronology

1. The user requested aggressive early limiting to five records, early database
   filtering, minimal connection scanning, no N+1 queries, and lower API latency.
2. The user requested a date-and-time search calendar while retaining the same
   performance constraints.
3. After the date-time change, the user reported `Invalid multimodal journey
   search parameters.` Compatibility normalization was added for date-only and
   legacy limit/pagination payloads.
4. The user reported that Indore-to-Jammu returned five transfer journeys even
   though a daily direct train exists. They requested transfer-count-first
   default ordering and server-side dropdown sorting. Direct-service retention
   and the server sort contract were implemented.
5. The user asked that durable knowledge, learning, instructions, and the
   conversation be saved on disk. This file and the `AGENTS.md` read/update rule
   were added in response.
6. The user required exclusive `RAIL_ONLY` searches to return trains departing
   after the requested time when none departs at that exact instant, while
   retaining all existing server sorting and pagination options. A dedicated
   train-departure-threshold search path and regression coverage were added.
7. The user said they intend to switch from Codex to Claude Code and requested
   that all durable knowledge, instructions, and conversation context remain on
   disk. `CLAUDE.md` and `CONVERSATION_MEMORY.md` were added as a portable
   handoff. These files intentionally exclude credentials, hidden reasoning,
   and large raw tool output.
8. In the first Claude Code session, the user requested up to 20 journey
   results (five initially, five more per "Show More" click, server-side
   paginated, no duplicates, consistent ranking across pages). The existing
   pagination scaffolding (`resultOffset`/`pageSize`, the pagination-agnostic
   result cache, the frontend's `PAGE_SIZE`/`MAX_JOURNEYS` constants) already
   anticipated this; the change raised `JOURNEY_RESULT_LIMIT` to 20, added
   `RAILWAY_DIRECT_SEARCH_RESULT_LIMIT` (5) to keep the unrelated direct
   railway/train-schedule endpoint unchanged, and bumped `MAX_JOURNEYS` to 20
   in `journey-results.js`. Default ranking order was deliberately left
   unchanged (see "Flagged for user confirmation" above).
9. The user asked (tersely) to "manage design" of the location fields and to
   make "Use my location" auto-fill the current address into both From
   inputs. Investigation found `journey-results.html` has two stacked
   From/To row pairs (address-autocomplete and station-autocomplete, both
   just labeled "From"/"To" with no distinguishing text) and that
   `useCurrentLocation()` only ever wrote to the station pair. The fix
   populates both From fields on geolocation and adds "(address)"/"(station)"
   hints to the four labels; a larger layout redesign was not attempted (see
   "Flagged for user confirmation" above).
10. The user asked to make swap work between the address From/To fields too,
    and to hide the station From/To row "for now" behind a class they can
    remove later to bring it back. The swap button was moved from the
    station row into the address row (it would otherwise have been hidden
    along with its old container), `swapLocations()` now also swaps the
    address labels, and the station row got `class="location-fields
    is-hidden"` with a new `.is-hidden { display: none; }` rule. The station
    row's underlying fields stay functionally wired (still what the search
    request actually reads), just visually hidden.
11. Once the address fields were integrated into `journey-results.html`, the
    user asked to delete the now-redundant standalone prototype page,
    `public/address-search.html` and its dedicated script
    `public/leaflet/address-search.js` (a single-field demo of the same
    `/places/autocomplete`/`/places/details` flow, used only to develop the
    integration before it was merged in). Both were untracked files with no
    other references anywhere in the repo (confirmed by grep before
    deleting) and were removed. The backend `/places/*` API
    (`src/controllers/places.controller.ts`, `src/routes/places.routes.ts`,
    `src/services/places.service.ts`, `src/types/places.ts`,
    `src/validators/places.validator.ts`) was **kept** - it's still actively
    called by `journey-results.html`'s own address-autocomplete fields.
12. The user asked which route-search algorithm was actually in use (RAPTOR,
    CSA, or Dijkstra). Read-only trace of the live code path found neither
    literally - see "Established findings" above.
13. The user asked for a deeper, read-only performance-optimization plan:
    per-item file/function, bottleneck, expected impact, correctness risk,
    benchmark method, and P0/P1/P2 priority, plus direct answers on whether
    the algorithm itself or the implementation was the bottleneck (the
    implementation), at what scale RAPTOR/CSA would win, and whether a
    hybrid made sense. Analysis only, nothing implemented yet.
14. The user asked for a read-only production-readiness audit specifically
    about concurrent users (1/5/10/25/50/100), tracing every concurrency
    control end to end. Verdict: **CONDITIONAL** - the biggest gap was no
    admission control at all on the multimodal endpoint. Analysis only.
15. The user authorized implementation of the audit's P0 fixes: bounded
    admission control for multimodal search (reusing/extracting the
    railway engine's existing `SearchSemaphore`), an explicit Prisma
    connection-pool size, and a consistent `503` overload contract - with
    tests, and explicit instructions not to touch the search algorithms,
    priority queues, or `Set`/array allocations in that round.
16. The user asked to continue with the audit's remaining P1/P2 items; asked
    which to do now, all four were selected (HTTP rate limiting, metrics/
    observability, opt-in clustering, and the previously-deferred per-state
    allocation fixes), with rate limiting specified as in-process/no-new-
    dependency. All four were implemented and verified as described above.
17. The user asked for a final production-readiness review: re-check rate
    limiting/clustering/DB limits/concurrency/metrics, specifically make
    sure `CLUSTER_WORKERS > 1` correctly accounts for per-worker capacity
    and rate limits, document the new env vars, and decide whether
    `/api/v1/health/metrics` needs protection - while leaving pre-existing
    failures and unrelated files (`places.service.ts`, the frontend
    `journey-results.*` files) untouched. Findings and fixes: added a
    cluster-startup warning log that echoes actually-configured values for
    the four per-worker variables (previously only documented in code
    comments, not surfaced at runtime); added optional `METRICS_ACCESS_TOKEN`
    gating for the metrics endpoint (open by default with a startup
    warning, matching `/health`'s existing unauthenticated convention);
    added `pid`/`configuredClusterWorkers` to the metrics snapshot so a
    single worker's numbers are never mistaken for a cluster-wide total;
    deduplicated the rate-limiter config parsing that had been copy-pasted
    across both route files into one shared resolver; added unit tests for
    the previously-uncovered rate limiter and metrics/metrics-auth modules;
    wrote `docs/production-environment-variables.md` as the durable env-var
    reference. No pre-existing failure was touched or hidden.
