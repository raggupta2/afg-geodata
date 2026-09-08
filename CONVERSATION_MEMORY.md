# Conversation Memory and Claude Code Handoff

Last updated: 2026-09-08 (Asia/Calcutta)

This is a normalized, durable record of the user-visible requests available in
the current development conversation. It is designed for continuation in
Claude Code or another development agent. It is not a raw application export
and intentionally excludes credentials, hidden reasoning, and large command or
tool output.

`AGENTS.md` is authoritative for engineering rules. `PROJECT_MEMORY.md` is the
concise implementation summary and should be read before work continues.

## User requests, in order

### 1. Optimize the existing journey process

The user requested a substantial reduction in server response time with these
requirements:

- Return/show only five records.
- Do not scan or process all records when only five results are required.
- Avoid scanning every record and all of its connections or relationships.
- Stop as early as possible after five valid records are found.
- Do not load relationships for candidates that cannot appear in the final five.
- Apply filters, limits, pagination, and constraints as early as possible.
- Avoid unnecessary fields, relationship loading, database queries, and loops.
- Avoid N+1 queries.
- Optimize required relationship checks so every record's full connection set
  is not scanned.
- Use efficient database queries and indexes where applicable.
- Preserve existing behavior and result correctness.

The primary goals were minimizing database scans, relationship scans,
server-side processing, query count, and overall API response time.

### 2. Optimize the search calendar

The user additionally requested:

- Return a maximum of five results.
- Include departure date and departure time in the search calendar.
- Avoid scanning billions of records and unnecessary connections.
- Apply filters and limits early and stop after five valid results.
- Avoid full-table scans and N+1 queries.

### 3. Validation error report

The user reported:

> Invalid multimodal journey search parameters.

Compatibility handling was subsequently added for legacy date-only inputs and
legacy clients requesting larger pagination values, while the server still
enforces a maximum of five returned results.

### 4. Indore-to-Jammu direct train and sorting

The user reported that an Indore-to-Jammu search returned five transfer
journeys even though a direct train runs daily. The user required:

- Show the direct train.
- Default sorting must use number of transfers first.
- Changing the sort dropdown must perform server-side sorting.

The exact search date and payload were not supplied, so that concrete scenario
has not yet been reproduced against the development database.

### 5. Continue after interruption

The user instructed the agent to continue from the exact stopping point after a
token-limit interruption without repeating completed work.

### 6. Durable memory

The user requested that all knowledge, learning, instructions, and conversation
context be saved permanently on disk. `PROJECT_MEMORY.md` and the durable-memory
instruction at the top of `AGENTS.md` were added.

### 7. RAIL_ONLY departure fallback

The user requested:

> For `RAIL_ONLY` journey searches, if no journey is available exactly at the
> requested `departureAt`, return all available train journeys after the
> requested time instead of returning "No journey is available for the
> requested time."

The user's example was a request at `11:00` with an available train at `12:53`.
The user required the existing `sortBy`, `pageSize`, `resultOffset`, and
`resultLimit` options to apply.

The implementation uses one bounded at-or-after railway search instead of an
exact query followed by a second fallback query. It applies server sorting and
the five-result cap before outer pagination. The exclusive RAIL_ONLY path also
avoids flight-instance, flight-coverage, and transfer-relationship queries.

Regression coverage was added to `tests/multimodal-search.test.js`.

### 8. Claude Code handoff

The user repeated the durable-memory request and stated:

> I will switch codex to Claude code

This file and `CLAUDE.md` were added so the current requirements, conclusions,
working-tree state, and verification restrictions remain available after the
switch.

### 9. Increase journey search to 20 results with server-paginated "Show More"

The user's first request inside Claude Code was:

> The Search API currently returns only 5 results per request, but the UI
> needs to provide users with up to 20 best journey results... On the initial
> search, display only the first 5 best results... When the user clicks Show
> More: make another request to the server/API to retrieve the next 5
> results... Continue until a maximum of 20 results... pagination does not
> create duplicate results... ranking should remain consistent across pages.

Investigation found the pagination mechanism (`resultOffset`/`pageSize` on the
multimodal search, a result cache keyed independent of pagination so pages
slice one stable sorted array, and matching `PAGE_SIZE`/`MAX_JOURNEYS`
constants already wired through `journey-results.js`'s "Show More" button)
already existed end-to-end, gated only by the shared `JOURNEY_RESULT_LIMIT`
constant being 5. The fix raised that constant to 20, split out a new
`RAILWAY_DIRECT_SEARCH_RESULT_LIMIT` (5) so the unrelated, non-paginated
`/railways/search` endpoint used by `train-schedule.html` keeps returning
five, and bumped `MAX_JOURNEYS` to 20 in `journey-results.js`. Two stale
validator unit tests in `tests/multimodal-search.test.js` (asserting the old
default/clamp of 5) were updated to assert 20; `tests/railway-search.test.js`
needed no change.

The task's ranking description ("fastest first, fewest transfers as a
tie-break for similar times") was compared against the existing default sort
(transfers-first, a deliberate earlier fix for the Indore-to-Jammu case) and
the existing `sortBy=duration` option (which already does duration-first with
a transfers tie-break, selectable via the existing "Sort By" dropdown). The
default sort and comparator logic were left unchanged; this was flagged to the
user rather than silently changed either way (see `PROJECT_MEMORY.md`,
"Flagged for user confirmation").

### 10. Fix duplicate From/To fields and "Use my location" address fill

The user's next request (terse, informal phrasing) was:

> location-fields mange design and handle if user click Use my location then
> auto add current address in both From inputs

Investigation found `journey-results.html` has two full, stacked "From"/"To"
row pairs: an address-autocomplete pair (`originAddressLabel`/
`destinationAddressLabel`, calling `/places/autocomplete` and
`/places/details`) sitting above a station-autocomplete pair (`originLabel`/
`destinationLabel`, calling `/railways/stations` - this is the pair
`validateAndBuildRequest()` actually reads for search). Both rows were
labeled just "From"/"To" with nothing distinguishing them, and
`useCurrentLocation()` only ever wrote to the station pair, leaving the
address pair's "From" box blank after using geolocation.

The fix made `useCurrentLocation()` write its resolved current-location text
(`"Current location"`, later upgraded to `"<nearest station> area"`) into
**both** `originLabel` and `originAddressLabel`, and added parenthetical
"(address)"/"(station)" hints to all four labels (with a new `.label-hint`
CSS rule) so the two rows are distinguishable. No reverse-geocoding endpoint
exists (`places.service.ts` only has forward autocomplete/details), so both
boxes intentionally show the same resolved place description rather than a
true street address. A larger redesign (merging the two rows, or a toggle
between address/station search) was not attempted - flagged for the user
in `PROJECT_MEMORY.md` under "Flagged for user confirmation" rather than
guessed at.

### 11. Swap between address fields, and hide the station row for now

The user asked:

> Also manage Swap locations between the From (address) To (address) And for
> now I need to hide From (station) To (station) section hide that and manage
> design add class hide only that can I remove and show when I need

The swap button lived inside the station row's container div, so hiding that
whole row would have hidden the swap button too. It was moved into the
address row (swapping places with an empty alignment placeholder `<span>`
that was already there for grid-column symmetry), and an equivalent
placeholder was left in the station row's old button slot. `swapLocations()`
now also swaps `originAddressLabel`/`destinationAddressLabel`. The station
row got `class="location-fields is-hidden"` with a new `.is-hidden { display:
none; }` CSS rule - removing that class later brings the row back exactly as
it was, since none of its underlying fields, ids, or JS wiring changed.

### 12. Delete the now-redundant address-search prototype page

The user asked:

> Remove unnecessary files we have add code in main journey-results.html page
> so we don't need the external page and code so remove it
> address-search.html

`public/address-search.html` and `public/leaflet/address-search.js` were a
standalone, single-field demo of the `/places/autocomplete`/`/places/details`
flow, built before that flow was integrated (with dual From/To fields and
cross-writes into the station coordinate inputs) into `journey-results.html`/
`journey-results.js`. Both were untracked and, confirmed by grep, referenced
nowhere else in the repo, so they were deleted outright. The backend
`/places/*` API was deliberately **not** touched - it's what
`journey-results.html`'s own address fields call.

### 13. Which route-search algorithm is actually in use

The user asked whether search used RAPTOR, CSA, or Dijkstra. Read-only trace
of the live code path (not documentation, not naming conventions) found:
railway search is Dijkstra/A\* depending on sort order; multimodal search is
explicitly weighted A\* (per its own code comments); an unused,
never-called, RAPTOR-shaped function exists in `railway-provider.service.ts`
but is dead code. No changes made.

### 14. Deeper, read-only performance-optimization plan

The user asked to go one level deeper: a concrete optimization plan
(file/function, current bottleneck, expected impact, correctness risk,
benchmark method, P0/P1/P2 priority for each item), plus direct answers on
whether the algorithm or the implementation was the bottleneck (the
implementation - per-state allocation, not the algorithm family), the scale
at which RAPTOR/CSA would become better, whether a hybrid made sense, the
top 3 changes for the best risk/reward, and metrics to collect. Analysis
only - explicitly told not to implement anything yet.

### 15. Read-only concurrency/production-readiness audit

The user asked for a read-only audit focused specifically on multiple
concurrent users (1/5/10/25/50/100 concurrent searches), tracing every
concurrency control, cache, DB connection path, and CPU/memory risk.
Verdict: **CONDITIONAL** - the single biggest gap was that the multimodal
endpoint had no admission control at all, unlike the railway endpoint's
existing `SearchSemaphore`. Analysis only.

### 16. Implement the audit's P0 fixes

> Implement only the highest-priority production-safety fixes described
> below.

The user authorized implementation of exactly three items: bounded
admission control for multimodal search (reusing/extracting the railway
engine's `SearchSemaphore`), an explicit Prisma connection-pool size via
`DATABASE_CONNECTION_LIMIT`, and a consistent `503` overload response -
with tests, and an explicit list of things *not* to do (no algorithm
rewrites, no Set/array optimization, no clustering, no Redis, in that
round).

### 17. Continue with the remaining P1/P2 items

The user asked to continue with the audit's remaining improvements; asked
which to do now via a clarifying question, and selected all four offered:
HTTP rate limiting (in-process, no new dependency, per their explicit
choice), metrics/observability, opt-in multi-process clustering, and the
previously-deferred per-state allocation fixes (`Set`/array copies replaced
with an immutable linked chain in both search engines) - the same fixes
that were explicitly forbidden in request #16's round, now in scope because
the user chose them. All four were implemented, with before/after
`git stash` comparisons against the real dev database confirming the
allocation fixes were behavior-preserving.

### 18. Final production-readiness review

The user asked for a final review covering rate limiting, clustering, DB
limits, concurrency, and metrics; specifically to make sure
`CLUSTER_WORKERS > 1` correctly accounts for per-worker capacity and rate
limits; to document the env vars introduced across requests #16-17; to
decide whether `/api/v1/health/metrics` needed protection; and to add tests
only where genuinely needed without touching pre-existing real-data test
failures or unrelated files (`places.service.ts`, the frontend
`journey-results.*` files, which had picked up further unrelated edits by
this point). The review found the per-worker multiplication was documented
in code comments but not surfaced anywhere at runtime, and that the new
metrics endpoint had no access control. Both were fixed (a cluster-startup
warning log echoing actual configured values; optional
`METRICS_ACCESS_TOKEN` gating, open-by-default with a startup warning), the
duplicated rate-limiter config parsing across both route files was
consolidated into one shared resolver, unit tests were added for the
previously-uncovered rate-limiter and metrics/metrics-auth modules, and
`docs/production-environment-variables.md` was written as the durable
reference. Neither pre-existing test failure was touched.

## Current handoff state

- The working tree now also includes, on top of everything described above:
  `src/utils/search-semaphore.ts`, `src/utils/string-chain.ts`,
  `src/middleware/rate-limiter.ts`, `src/middleware/metrics-auth.ts`,
  `src/observability/metrics.ts`, `docs/production-environment-variables.md`,
  and `tests/search-semaphore.test.js` / `tests/rate-limiter.test.js` /
  `tests/metrics.test.js` (all new/untracked), plus modifications to
  `src/config/database.ts`, `src/routes/health.routes.ts`,
  `src/routes/journey.routes.ts`, `src/routes/railway.routes.ts`,
  `src/server.ts`, `src/services/multimodal-journey.service.ts`, and
  `src/services/railway-provider.service.ts`.
- `src/services/places.service.ts` and the frontend
  `public/journey-results.html` / `public/leaflet/journey-results.css` /
  `public/leaflet/journey-results.js` changes are **not** part of this body
  of work and were deliberately left untouched throughout requests #13-18.
- Do not discard, reset, or overwrite any of this.
- Command execution was authorized and used throughout requests #16-18; see
  `PROJECT_MEMORY.md`'s "Concurrency/production-readiness work verification"
  section for the full, itemized results (`tsc`, build, all test suites,
  live smoke tests). Two pre-existing, real-data-dependent test failures
  remain, confirmed unrelated to this work by `git stash` comparison against
  the original code.
- The running server must be rebuilt and restarted before source changes
  take effect; this is unrelated to the still-pending railway-index
  migration mentioned in `PROJECT_MEMORY.md`'s "Current implementation
  state" (pagination work), which remains outstanding.

## Recommended next verification

The verification sequence used throughout requests #16-18 (all already run
and passing except the two pre-existing failures noted above):

```bash
npx tsc --noEmit
npm run build
npm run test:search-semaphore
npm run test:rate-limiter
npm run test:metrics
npm run test:railway-search
npm run test:multimodal-search
```

Beyond that, still outstanding: a real load-testing pass against the new
admission-control/rate-limit/clustering defaults (all are reasoned, not
measured), and - separately, from the earlier pagination work - applying
the pending Prisma index migration and reproducing the user's exact
Indore-to-Jammu API payload against the development database.
