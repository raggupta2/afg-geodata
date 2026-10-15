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

### 19. Departure time shown before the requested search time

The user reported, with a screenshot of `journey-results.html`, that a NEW
DELHI (NDLS) -> BHOPAL JUNCTION (BPL) search for `2026-09-08T15:50` (Train
only, the page's default filter) showed results headlined "15:30"/"15:17" -
apparently before the requested departure time.

Investigation (read-only trace, then a targeted fix) found the exclusive
RAIL_ONLY multimodal path (`executeRailOnlySearch` ->
`searchRailwayOnlyDeparturesAfter` -> `executeCoordinateRailwayJourneySearch`
with `departureAtIsTrainThreshold = true`) already enforced the correct
constraint - every candidate train's actual scheduled departure
(`firstTrainDepartureAt`) is `>= departureAt`, guaranteed by the
`earliestDeparture` bound in `searchEarliestPaths`/`findNextTrainOccurrence`.
The bug was that the journey card's headline `departureAt` field
(`convertRailwayResult()` in `multimodal-journey.service.ts`) was set to
`result.suggestedLeaveHomeAt` - a "leave home" time back-calculated from the
found train's departure minus the boarding buffer and road-access time
(`journey-search.service.ts`'s `buildOption()`, `flexibleOriginTiming`
branch) - which can legitimately fall before the requested time when the
origin is the boarding station itself (near-zero road access). Candidate
generation and the threshold constraint were correct throughout; only the
displayed headline time was wrong.

Fixed by adding a `useActualTrainDeparture` flag to `convertRailwayResult()`,
set `true` only for the exclusive RAIL_ONLY call site, so it reports
`firstTrainDepartureAt` instead. The general (non-exclusive) multimodal path
and the unrelated direct `/railways/search` endpoint were left untouched -
neither exhibited the bug. While making this change, also fixed a latent
"array.map(callback)-leaks-the-index" hazard at the other, unmodified
`convertRailwayResult` call site by wrapping it in an arrow function, since
adding the new optional second parameter would otherwise have received the
array index there.

Flagged, not changed: the journey's `legs[]` array still carries the earlier
back-calculated "leave home" time on its first `LOCAL` leg (arguably useful
trip-planning info - "leave by X to catch this train"), so a user opening
"View details" on a RAIL_ONLY result will still see that earlier time in the
timeline even though the headline is now corrected.

Not yet verified by command execution - repository is in edit-only mode. See
`PROJECT_MEMORY.md`'s "Verification status" for the exact re-check needed
once authorized.

### 20. Direct train hidden, wrong-direction boarding station, and a Saturday-only train on a Wednesday search

The user reported three issues for an INDORE JUNCTION (INDB) -> SHRI MATA
VAISHNO DEVI KATRA (SVDK) search on `2026-09-09T10:15`: a known daily direct
train not appearing; a result whose "Road access" leg read "1h 2m, INDB ->
Dr. Ambedkar Nagar" (implying the traveler must travel backward to an
upstream station, even though the train itself later stops at INDB on its
way to SVDK); and a train they say runs only on Saturdays appearing for a
Wednesday search.

Read-only code trace (`journey-search.service.ts`, `railway-provider.service.ts`)
found that the railway search evaluates every nearby candidate boarding
station independently, as designed, and can legitimately produce two options
for the same physical train - one boarding at INDB (the user's own selected
station, near-zero road access) and one boarding at a nearby upstream station
(Dr. Ambedkar Nagar, real road-distance access). `itineraryKey()` - used by
`groupJourneyOptions()` to decide which options are "the same itinerary" -
keyed only on train number, service date, and inter-leg transfer stations; it
never included the boarding or alighting station. So these two genuinely
different options were merged into one group, and only whichever one
`compareJourneyOptions()` favored was kept as `recommended`; the other was
demoted to `alternativeBoardingStations`, a field the multimodal RAIL_ONLY
conversion (`convertRailwayResult()`) never carries into its API response at
all - so on `journey-results.html` the demoted option was simply invisible.
This explains both symptoms directly. Fixed by adding the boarding and
alighting station ids to `itineraryKey()`, so different boarding stations for
the same train now surface as distinct results instead of being silently
merged - a narrow grouping-key change; no ranking, pruning, or search-engine
logic was touched.

The user was asked how to close the remaining gaps (whether INDB genuinely
has a valid boarding row in the data; the Saturday/Wednesday question) and
chose both offered options: authorize a read-only database check, and offer
the train number/API JSON. Using that authorization, a real-data
reproduction (temporary scripts calling the raw database directly, then a
second script calling the actual `parseMultimodalSearch` ->
`searchMultimodalJourneys` path with the exact reported input - both deleted
after use, per `AGENTS.md`'s one-off-script rule) found:

- No duplicate "Indore Junction"/"Dr. Ambedkar Nagar" station rows. Exactly
  two real trains run INDB->SVDK (`12919 MALWA EXPRESS`, daily;
  `09321 DADN SVDK SF SPL`, Mon/Wed/Sat), both with a boardable INDB stop.
- The *actual* root cause of issues 1-2 was deeper than the `itineraryKey()`
  fix alone: `directServiceKey()` and `trainSequenceKey()` in
  `railway-provider.service.ts` had the identical origin-blind key shape,
  but at the search-engine level, not just the display-grouping level - so
  the engine itself discarded every candidate boarding station's direct path
  for a given train except whichever one it processed first (empirically
  Ujjain Junction, the farthest station, because it has the shortest raw
  in-vehicle duration). This is why INDB's own zero-access boarding never
  appeared anywhere in the full candidate list, not merely why it lost a
  ranking comparison. Fixed by adding `originStationId` to both keys.
- Verified with a before/after comparison: temporarily `git stash`ed just
  the two fixed files, re-ran the exact reproduction against the unmodified
  code (confirmed the bug: no INDB-boarding option anywhere in 20
  candidates), then restored the fix (confirmed: INDB now appears as its own
  direct, zero-road-access result for both trains) - the same before/after
  method already established in this project's own verification history.
- INDB's own boarding still does not automatically rank #1 after the fix
  (Ujjain/Dewas can still rank higher) - traced to how `totalJourneyMinutes`
  is computed backward from the chosen boarding stop in `buildOption()`,
  which rewards boarding farther downstream when the road-access cost is
  smaller than the in-vehicle time saved. This is a distinct, softer
  ranking-formula question, deliberately left unchanged and flagged rather
  than folded into the candidate-retention fix.
- Issue 3 (Saturday date) did not reproduce at all against real data, in
  either the before or after state - both real trains' actual `runs_mask`
  values already include the searched Wednesday, and every reproduction run
  returned only `2026-09-09`/`09-10`-dated results. Nothing to fix in code
  or data was found; the user was told this and asked to re-test live once
  the fix ships, since something about their exact search may have differed
  from this reproduction.

Verified against the real dev database via the authorized ad hoc
reproduction described above. `npx tsc --noEmit` and the project's own test
suite have not been run (edit-only mode for those).

### 21. `sortBy: "duration"` returning "No journeys match these filters"

Immediately after, the user reported that switching the same INDB -> SVDK
search's sort dropdown to "duration" returned "No journeys match these
filters," while the default sort worked. Continuing to use the read-only
database check authorized for this same debugging thread, a reproduction
across all four `sortBy` values found that `duration` **and** `arrival` both
returned zero results with the search's own `truncated: true` flag, while
`transfers`/`departure` returned the expected 20.

Root cause: `compareStates()` in `railway-provider.service.ts` controls the
priority order the search engine itself explores states in - a different,
internal concern from `compareJourneyOptions()`/`comparePaths()`, which
correctly sort the finished candidate list for output by whatever `sortBy`
was requested. `compareStates()` has dedicated branches for `"transfers"`
(prioritizes an admissible remaining-legs heuristic, true A*) and
`"departure"` (prioritizes the first boarded train's own departure time),
but **no branch for `"duration"` at all** - it silently fell through to the
same default as `"arrival"`: plain Dijkstra ordered only by raw arrival
time, with no sense of progress toward the destination. On this
long-distance route, with several nearby candidate boarding stations each
spawning many cheap local hops, that blind ordering exhausts the search's
expansion budget on ever-cheaper nearby hops before ever reaching a
destination thousands of kilometres away - a real truncation, not a
"legitimately zero results" case.

Fixed by making that fallthrough branch prioritize the same
remaining-legs heuristic the `"transfers"` branch already uses correctly,
so `"duration"`/`"arrival"` searches traverse efficiently like `"transfers"`
does, while still being sorted for actual output exactly as before -
nothing about the output-sorting functions changed. Verified with the same
before/after reproduction method used earlier in this session: 0 results
(truncated) before the fix, 20 results (complete) after, for both
`duration` and `arrival`; `transfers`/`departure` unaffected. Confirmed
pre-existing and unrelated to this session's earlier `itineraryKey()`/
`directServiceKey()`/`trainSequenceKey()` fixes, which never touch
`compareStates()`.

Not yet verified by `tsc`/the project's test suite - only the ad hoc
real-database reproduction was run.

### 22. Journey-summary showing the train's boarding time instead of the true journey start time

The user reported, with a screenshot, that for the same INDB -> SVDK search
(`2026-09-09T09:30`, RAIL_ONLY) the journey-summary headline showed the
train's own boarding time (`14:00` at Ujjain Junction) rather than the true
journey start time (`12:22`, accounting for 1h18m road access + 20m boarding
buffer), and that the headline's "Total journey" duration didn't match the
gap between the shown start and end times as a result. They also required
that clearing all filters still start every journey from the exact searched
time with real road access + boarding wait added forward.

This traced back to request #18's fix, which had special-cased
`convertRailwayResult()` to show the actual train departure - correct for
that report's near-zero-road-access case, but wrong here: for a boarding
station reached by significant road access, the *true* start time (leave
early enough to reach that station) is exactly what should be shown, and it
was being overridden by the less useful train-boarding time, which also
broke the headline's internal consistency with the displayed total
duration.

The real, unifying fix lives in `buildOption()` in
`journey-search.service.ts`: when the backward-computed start time
(train's departure minus boarding buffer minus real road access) falls
before the requested `departureAt` - i.e. there is slack - clamp it and the
corresponding station-arrival time forward by the same amount, and subtract
that same amount from `totalJourneyMinutes` so the two stay consistent.
When there is no slack (real road access, as here), the delta is zero and
the true `12:22` start is shown unchanged. Request #18's
`convertRailwayResult()` special-case was reverted entirely -
`multimodal-journey.service.ts` is back to its original form.

Verified against the real database: INDB -> SVDK now shows
`departureAt = 2026-09-09T12:22:00+05:30` with a duration that exactly
matches `finalArrivalAt - departureAt`; the original NDLS -> BPL case still
never shows a time before the requested `15:50`; and clearing the RAIL_ONLY
filter was confirmed to already start every journey at the exact searched
time with real road access added forward, requiring no separate change.

Not yet verified by `tsc`/the project's test suite - only the ad hoc
real-database reproduction was run.

### 23. Wasteful upstream road-access detour still recommended for a train the selected station already boards

The user reported that, for Malwa Express (12919) on the same INDB -> SVDK
search, one result still recommended a "Road access: 1h 2m / 31 km" detour
to Dr. Ambedkar Nagar - the train's own origin, one stop *upstream* of INDB
- to board the exact same train that already stops at INDB (the user's
selected station) at `12:15`. They required that the journey start from the
selected boarding station and use its own arrival/departure time, and that
no road-access leg to a train's origin be created when the selected station
is already a valid boarding station on that train.

This was not a re-occurrence of request #19's bug (candidate generation had
already been fixed to make INDB's own boarding visible) - it was a genuine,
separate gap: nothing existed to prune a boarding-station candidate that is
strictly dominated by another candidate for the *same physical train*.
Since a train reaches every downstream stop, including the final
destination, at the same time regardless of which valid stop it was
boarded from, boarding upstream of another reachable stop on the same train
never arrives sooner and only ever adds unneeded road-access time - a pure
backtrack/detour, not a real alternative (`AGENTS.md` Practicality:
"Backtracking", "Unnecessary detours"; Candidate Pruning: "only remove
journeys that are demonstrably dominated").

Fixed by adding `pruneUpstreamBoardingDetours()` in
`journey-search.service.ts`, run on the full candidate list before grouping.
It discards a candidate only when another candidate rides the identical
downstream continuation (same trains, same transfers, same alighting
station - computed via a new `downstreamContinuationKey()`, essentially
`itineraryKey()` minus the boarding station) but boards the first train
later - i.e. at a stop downstream of this candidate's - while requiring no
more local road access. This is based on real road-access minutes, not the
(separately flagged, unchanged) `totalJourneyMinutes` ranking formula, so it
can only remove a detour that is strictly no better in every respect; it
never removes a candidate that is merely ranked lower, so Ujjain
Junction/Dewas Junction (both downstream of INDB, both requiring *more* road
access) correctly remain as independent, if less convenient, alternatives.

Verified against the real database: for `sortBy` `transfers`/`duration`/
`arrival`, the Dr. Ambedkar Nagar boarding of either INDB/SVDK train
(12919 or 09321) no longer appears anywhere in the results; INDB/Ujjain/
Dewas boardings remain, independently, exactly as before. The previously
verified headline/total-duration consistency and no-departure-before-
request invariants were re-checked and remain intact. One narrower,
separate finding was flagged rather than fixed: under `sortBy: "departure"`
specifically, a *different* train (09321) still shows a Dr. Ambedkar Nagar
boarding through a multi-leg transfer - not yet confirmed whether an
equivalent INDB-boarding candidate for that exact continuation was even
generated by the search for the new pruning to compare against (plausible,
since `"departure"` sort's own state-exploration/retention caps can retain
different specific candidates per origin than `"transfers"` sort does).

Not yet verified by `tsc`/the project's test suite - only the ad hoc
real-database reproduction was run.

### 24. Direct trains alighting at a nearby station instead of the actual destination, and disappearing under an arrival-time-biased cap

The user reported, for the same INDB -> SVDK search, that Malwa Express
(12919) never appeared reaching SVDK directly - every result alighted at
Jammu Tawi (a busier junction ~31km away, within the destination search
radius) and completed to SVDK by a separate road leg, even though 12919's
own train_connections continue, fully intact, all the way to its own SVDK
stop (confirmed directly via SQL). They required: a direct train shown
whenever one exists, SVDK (not a nearby station) as the shown destination,
correct 0-transfer identification, transfers-ascending sort order, and
direct trains always ranking above transfer journeys.

This took real digging - three separate, cumulative gaps, all variations of
the same mistake (an admission/selection cap ordered by raw arrival time,
blind to which destination or train was involved), found one layer at a
time by adding temporary, narrowly-targeted `console.error` trace points at
each layer and removing them once confirmed (verified clean via `git diff`
before finalizing, per `AGENTS.md`'s Debug Instrumentation allowance):

1. `trainSequenceKey()`/`directServiceKey()` (in `railway-provider.service.ts`,
   already fixed for origin-blindness earlier this session) were also
   **destination-blind**. A train reachable at more than one candidate
   destination station had its later, real alighting at SVDK silently
   treated as "a duplicate" of its earlier alighting at Jammu Tawi -
   discarding SVDK outright. Fixed by adding the alighting station to both
   keys.
2. `findDirectPaths()`'s own per-origin destination selection was
   arrival-time-biased, not destination-fair - a nearby-but-irrelevant
   destination reached sooner by unrelated trains could consume an origin's
   entire quota before 12919's own (necessarily later, being a full day's
   ride) SVDK alighting was ever considered. Fixed with a fair per-destination
   cap, mirroring the pre-existing per-origin fair-share formula one level up.
3. `executeSearch()`'s cross-origin merge had the identical bias, plus a
   train-level version of it - multiple origins boarding the SAME train
   (09321, which physically reaches SVDK earlier than 12919 does) could
   still fill SVDK's whole fair share before a genuinely different train
   serving SVDK was ever reached. Fixed with two admission passes: first
   guarantee one representative per (destination, train) pair regardless of
   arrival time, then fill any remaining budget with further alternatives.

Verified against the real database at each step and all together: for
`sortBy: "transfers"` (the page's default), both real INDB/SVDK trains
(12919 and 09321) now alight at SVDK directly with 0 transfers, from
multiple origins including INDB itself; transfers-ascending order holds;
every previously-verified invariant from this session's earlier items
remains intact.

Flagged, not further chased: the fix does not guarantee literally every
(origin, train) combination survives the outer cap - INDB's own direct
12919-to-SVDK boarding specifically lost its slot to other origins' 09321
entries (which arrive at SVDK earlier), though INDB's own 09321-to-SVDK
boarding did survive. The user's stated requirements are all satisfied by
what does survive; guaranteeing every single combination would need
origin-fairness added as a further dimension, not done since it wasn't
needed to meet the ask. Separately, `searchEarliestPaths()`'s own admission
logic (the path used by `sortBy: "duration"/"arrival"/"departure"`) never
received the same fairness treatment - confirmed `sortBy: "departure"` no
longer reaches SVDK directly for this search, extending rather than
reintroducing the residual `"departure"`-sort gap flagged in request #23.
One more incidental, not-investigated-further observation: the NDLS -> BPL
search (an earlier item this session) also has at least one 0-transfer
result whose rail leg doesn't terminate exactly at BPL - possibly the same
class of issue, not reported by the user for that route.

Not yet verified by `tsc`/the project's test suite - only the ad hoc
real-database reproduction was run.

### 25. Validating `journeyTypes` filtering for all four types and combinations

The user asked to validate Train only / Flight only / Train->Flight /
Flight->Train individually and in combination, since only "Train only"
(the exclusive RAIL_ONLY path, all of this session's earlier work) had been
confirmed correct - the general multimodal engine (used by every other
selection) had not been tested at all this session.

Built a real, verifiable test route with both direct rail and direct
scheduled flights at both ends - NEW DELHI (NDLS railway, DEL/HDX airports)
-> BHOPAL JUNCTION (BPL railway, BHO airport) - confirmed via direct SQL
before testing (flight instances, transfer links). Ran every type and
several combinations against the real database.

**Confirmed correct**: the actual filter-matching logic
(`matchesJourneyType()`/`selectMultimodalJourneyResults()`) works properly
wherever candidates exist - `FLIGHT_ONLY`, `FLIGHT_TO_RAIL`, the no-filter
baseline, and their combinations all returned results that correctly and
exclusively matched what was requested, with no unselected-type leakage.
The frontend's `journeyTypeLabel()` also already correctly re-derives
"Train -> Flight"/"Flight -> Train" from the actual leg sequence for the
underlying `MIXED` classification (there is no literal `RAIL_TO_FLIGHT`/
`FLIGHT_TO_RAIL` value in the result's own `journeyType` field) -
confirmed consistent between backend and frontend, not a bug.

**Confirmed broken**: `journeyTypes: ["RAIL_TO_FLIGHT"]` alone returns
zero results with `truncated: true` - and it's a real missing-results
signal, not "correctly found nothing": raising the search's own
`MULTIMODAL_MAX_EXPANDED_STATES` env var 10x (no source change) found 19
valid matches in ~40 seconds. The candidates exist; the default search
budget (15,000 expanded states) is nowhere near enough to reliably find
them for this specific shape of query. Root cause: a `RAIL_TO_FLIGHT`
completion needs the search to board a train, reach some OTHER hub,
transfer to an airport there, then fly - a much narrower target than
`FLIGHT_TO_RAIL`'s equivalent (which starts from an airport already seeded
directly at the origin), and the existing Haversine-distance-based search
heuristic has no way to steer toward it, so the search burns its budget on
unproductive branches first.

Three angles were tested empirically and ruled out or found insufficient
alone: the origin airport search radius (300km default - reduced via
request options, no improvement); the feeder-rail-leg cap (temporarily
reduced from 2 to 1 and reverted, confirmed via `git diff`; no
improvement); and one genuine, safe optimization that *was* kept - skip a
rail-then-transfer path to an airport already directly reachable from the
origin (provably redundant, can never surface a new flight, always takes
at least as long). This last one was verified via full regression re-test
to change nothing about the already-working filters, but confirmed alone
insufficient (still 0/truncated at the default budget; even 40,000- and
70,000-state budgets found only 1 result each, taking 21-28 seconds).

Flagged rather than risked further without a decision: properly fixing
this needs either a carefully-designed, carefully-tested improvement to
the shared search heuristic (used by every multimodal search, not just
this one) or an interactively-unacceptable budget increase - `AGENTS.md`'s
own guidance warns against "addressing truncation merely by increasing
limits." The user was asked to decide between a heuristic fix, accepting
higher latency, or leaving it as-is.

### 26. Attempting the recommended heuristic fix

The user answered with no preference, so the recommended option (a
properly-designed heuristic fix) was attempted, carefully, with full
regression validation at each step rather than rushed.

Added `FEEDER_TRANSFER_CONNECTIVITY_BONUS_MS` in
`multimodal-journey.service.ts`: the search's existing heuristic only
estimates straight-line time to the final destination, giving a feeder
rail leg (taken before any flight) no credit for reaching a hub that
actually has a transfer link to flight connectivity - the only reason that
leg exists in the first place, per the code's own pre-existing comment.
Registering a feeder-rail-arrival state at a hub with a real transfer link
now gets a 3-hour bonus subtracted from its priority, so the search
explores it (and its onward options) before a same-tier dead-end feeder
stop. This only reorders which not-yet-flown state is explored first; it
changes neither what gets admitted nor the primary sort key for the
default sort, so it cannot make a worse itinerary replace a better one
already found.

Result, verified by full regression re-test across every sort and filter
combination, including a real before/after `git stash` comparison for
`sortBy: "departure"`'s result set: a genuine, partial improvement.
`RAIL_TO_FLIGHT` now succeeds under `sortBy: "duration"`/`"arrival"` at the
default budget (where the adjusted priority is the primary queue-ordering
key), with zero change to any sort/filter combination that already worked.
`sortBy: "transfers"` - the default, and what `journey-results.html`
actually uses - is **still broken**: for that sort, `scheduledLegs`
remains the primary ordering key, so the entire feeder-rail tier must
still be exhausted regardless of internal priority order before the
search can advance, and the bonus cannot shrink that tier's size. Fully
fixing the default sort would need an admission-level change (recognizing
a feeder-rail arrival with no transfer link and no further feeder-hop
budget left as a genuine dead end, and not registering it at all) - a
larger, riskier structural change than a priority adjustment. Given how
much of this session was already spent on this investigation, that was
flagged for a dedicated future session rather than attempted here.

Not yet verified by `tsc`/the project's test suite - only the ad hoc
real-database reproduction was run.

### 27. Journey type filter: checkboxes to radio buttons, plus a road-access ranking tie-break

The user asked to change the Journey type filter from checkboxes to radio
buttons (single-select), collapsing "Train -> Flight" and "Flight -> Train"
into one "Mixed" option, and explicitly asked for the current
classification/filtering logic to be validated before any code changed.

This implementation happened in a session gap this file did not capture
live - reconstructed here afterward from the resulting diff, for
continuity. `journey-results.html`'s three journey-type inputs are now
`type="radio"` (`RAIL_ONLY`, `FLIGHT_ONLY`, `MIXED`).
`journey-results.js` maps the single selected radio value to the server's
existing `journeyTypes` filter through a small lookup table (`MIXED` ->
`["RAIL_TO_FLIGHT", "FLIGHT_TO_RAIL"]`) - purely a frontend translation;
the backend's filter type and matching logic were not changed, since
sending both existing values already produces "either direction of mixed
journey" through the pre-existing OR-based matching validated earlier this
session (request #24/25's investigation had already confirmed this worked
correctly).

The same diff also added a ranking refinement: `compareJourneyOptions()`
now compares each candidate's total road-access minutes before
`totalJourneyMinutes` in its tie-break, so a candidate needing no road
access is never outranked by one that only looks faster because part of
the trip moved from rail to road - with a matching update to
`tests/railway-search.test.js`'s ranking assertion.

### 28. Sort by Departure/Arrival Time showing the search time or a shared value for every result

The user reported that for DEWAS JUNCTION (DWX) -> SHRI MATA VAISHNO DEVI
KATRA (SVDK) at `2026-09-10T07:00`, RAIL_ONLY, sorting by "Departure Time"
showed every result's headline start as the literal searched time
(`07:00`), and sorting by "Arrival Time" showed most results sharing one
arrival instant (`13:30`) - asking for the same fix approach used for the
earlier transfer-sorting truncation fix.

Reproduced against the real database: `sortBy: "departure"` returned 19
results all headlined `07:00`, even though the underlying boarded trains
genuinely departed at five different real times (`07:00`/`07:12`/`07:18`/
`07:24`/`07:25`). This traced back to this session's own earlier clamp fix
(request #21): clamping every candidate whose natural lead time fell short
of the requested time up to the SAME shared floor
(`clock.requestedMinute`) collapses all of them to one identical value -
`Math.max(x, floor)` returns exactly `floor` for every `x <= floor`,
discarding how far below each one actually was. This is a property of
using one shared constant as a floor, not something specific to sort
order; it surfaced here because five different trains all departing
within about 25 minutes of the requested time each had less natural lead
time than the boarding buffer needs, so all five fell into the
"needs clamping" branch and all snapped to the same instant.

Fixed by replacing the shared-floor clamp: when a candidate's natural lead
time is insufficient, fall back to that candidate's own real, scheduled
train departure (`path.departureMinute`) for both the local-access leg's
start and its arrival at the boarding station, instead of the shared
constant. `path.departureMinute` is guaranteed at or after the requested
time by the search's own admissibility bound - the same guarantee the old
floor relied on - but being real per-candidate schedule data, it never
collapses distinct candidates together. Two dependent fields were updated
to match: the local leg's `durationMinutes` (previously hardcoded to the
real road-access minutes, now computed from its own now-possibly-identical
departure/arrival so it never contradicts them), and
`totalJourneyMinutes` (simplified from two separate per-branch formulas
into one direct computation from the actual departure anchor, which is
mathematically identical to the old formulas wherever they were already
correct, and automatically correct in the case they were not).

Verified against the real database: `sortBy: "departure"` now shows 5
distinct real departure times instead of one shared value across the same
19 results, each with its own correctly differing total duration.
`sortBy: "arrival"`'s apparent sharing was checked separately and found to
be genuine, non-buggy data - several results sharing one arrival instant
but with clearly different total durations, i.e. legitimately different
journeys that happen to arrive together, not a collapsing artifact.
`sortBy: "transfers"` (the default) and the two previously-fixed scenarios
from earlier this session (INDB/Ujjain's real road-access `12:22`, and
NDLS/BPL never showing a time before the requested `15:50`) were re-run
and confirmed byte-for-byte unchanged - no regression.

Not yet verified by `tsc`/the project's test suite - only the ad hoc
real-database reproduction was run. `tests/railway-search.test.js` (last
touched in request #27) has not been re-run against this change either.

### 29. Sort keys must use the same "actual journey start"/"actual arrival" logic as the display, and road access must never be hidden

The user's follow-up made explicit what request #28 had left implicit: the
*sort key* for "Departure Time" must be the actual journey start (train
departure minus boarding wait minus road access), not the raw scheduled
train departure; road access and boarding wait must be shown whenever
genuinely required, never hidden/zeroed; and the same journey-building
logic must back both the "Departure Time" and "Arrival Time" sort options.

Investigation found request #28's fix had left two gaps:

1. **The sort keys never matched the display.** The headline
   `departureAt` field was already correct (from request #22's
   `suggestedLeaveHomeAt()` fix), but the comparators used to *order*
   results by "Departure Time" were separate code and had drifted:
   `journey-search.service.ts`'s `compareJourneyOptions()` still sorted by
   `firstTrainDepartureAt` (the raw train departure), and
   `multimodal-journey.service.ts`'s `compareMultimodalResultsBy()` still
   preferred a raw RAIL/FLIGHT leg's own departure over the correct
   `result.departureAt`.
2. **Request #28's own fix hid real road access.** Its fallback (snapping
   both the leave-home time and the station-arrival time to the train's
   own departure, `path.departureMinute`, whenever a candidate's natural
   lead time fell short) made the local-access leg's duration compute to
   `0` regardless of the real distance. Verified against the real
   database: boarding stations 32-45km from DEWAS JUNCTION (Maksi
   Junction, Indore Junction, Ujjain Junction, Bercha) all showed
   `roadAccessMin: 0` under `sortBy=departure`, contradicting the real
   geography.

Fixed by replacing request #28's snap-to-train-departure fallback with a
floor at the traveler's own readiness instant instead
(`clock.requestedMinute` - the actual physical constraint being checked,
since nobody can leave before they say they can). With that floor, the
station-arrival time is always `(leave-home time) + (real road-access
minutes)`, so the local-access leg's duration is always the real,
un-hidden value, never zeroed. This still guarantees the leave-home time
is never shown before the requested search time (request #19's original
requirement), and candidates that legitimately tie on this floor (they are
all equally bound by when the traveler can leave) are still correctly
distinguished by their own, genuinely different, arrival times and
durations (request #28's requirement) - a tie here is a real tie, not an
artifact. Both comparators were then pointed at the actual-journey-start
value: `compareJourneyOptions()`'s `"departure"` branch now uses the
existing `suggestedLeaveHomeAt()` helper, and
`compareMultimodalResultsBy()`'s `"departure"` branch now uses
`result.departureAt` directly, which is already the actual start for every
journey type. "Arrival Time" needed no change - `finalArrivalAt` in both
files was already computed from each candidate's own real train arrival
plus real destination access; this was explicitly re-verified against real
data rather than assumed.

Verified against the real database for DWX -> SVDK, `2026-09-10T07:00`,
RAIL_ONLY: `sortBy=departure` across all 19 results is non-decreasing on
the actual-journey-start key, never before `07:00`, and boarding stations
away from the origin now show their real road-access minutes (Maksi 49,
Indore 52, Ujjain 54, Bercha 67) while the origin station itself (Dewas
Junction) correctly shows `0`. `sortBy=arrival`, `sortBy=transfers`, and
`sortBy=duration` re-run on the same route are all correctly ordered on
their own respective keys. Regression re-check on NDLS -> BPL
(`sortBy=departure`, still never before `15:50`, with genuinely distinct
times shown where lead time allows) and INDB -> SVDK
(`sortBy=transfers`, the direct Indore-boarding Malwa Express candidate
still ranks with `0` road access) both unchanged.

`npx tsc --noEmit` ran clean. `npm run test:railway-search`: 12/13 pass.
`npm run test:multimodal-search`: 22/23 pass. Both single failures were
confirmed, via `git stash` of the two changed service files back to
`HEAD`, to already fail there too - i.e. pre-existing, not caused by this
fix:

- `tests/railway-search.test.js`'s "date-only search includes the direct
  HW to LMNR train" fails because of a real regression in an *earlier*
  turn's `itineraryKey()` change (added in request #20/#22's fix for a
  different bug): `groupJourneyOptions()` groups by `itineraryKey()`,
  which now bakes in both the boarding and alighting station id, so every
  option within a group already shares one boarding station - meaning
  `alternativeBoardingStations` and `availableDestinationStations` can
  never find a different one to report and are structurally empty/trivial
  for every result. Not fixed this turn (needs its own root-cause pass);
  see `PROJECT_MEMORY.md`'s "Flagged for user confirmation" section for
  the suspected fix (`groupJourneyOptions()` should likely group by the
  already-existing, boarding-agnostic `downstreamContinuationKey()`
  instead).
- `tests/multimodal-search.test.js`'s "DDN to DEL ... ranks the direct DED
  flight ahead of rail-only routes" is the already-known, already-deferred
  `RAIL_TO_FLIGHT` truncation issue from request #25 - reconfirmed still
  present, still unrelated to RAIL_ONLY sorting.

### 30. Fixing the `itineraryKey()` grouping regression and the HW admission-budget bug found while verifying request #29

Asked to investigate and fix the `alternativeBoardingStations`/
`availableDestinationStations` regression flagged in request #29, rather
than defer it. Root-caused to two separate, compounding bugs (see
`PROJECT_MEMORY.md`'s "Established root causes" for full detail):

1. `groupJourneyOptions()`'s top-level grouping key (boarding+alighting
   specific, correctly added by an earlier turn to stop a farther boarding
   station's candidate from being invisibly folded into a closer one's
   group) was ALSO being used to scope the two cross-reference helper
   functions, so they could never see a different boarding/alighting
   station to report. Fixed by keeping the top-level grouping unchanged
   and instead computing the two cross-reference fields from the wider,
   already-pruned candidate pool, filtered by the boarding-agnostic
   `downstreamContinuationKey()` / alighting-agnostic
   `upstreamServiceChainKey()` relative to each group's own recommended
   candidate - restoring the cross-references without touching which
   candidates get their own visible row. Verified against real data:
   Roorkee and Saharanpur Junction (train 14310) now correctly
   cross-reference each other as alternative boarding stations.
2. A second, deeper bug then still excluded Haridwar (HW) specifically:
   `executeSearch()`'s default (`sortBy: "transfers"`) fast path had no
   per-origin fairness in its result-admission budget - only per
   destination - so a farther-but-legitimate origin could be completely
   squeezed out by closer origins once the (hard-capped at 5) result
   budget filled up, even though HW genuinely boards train 14310 at
   `07:45` per the real schedule. Confirmed via an isolated-vs-contended
   real-database comparison. Fixed by adding an origin-fairness pass
   between the two existing admission passes, using the exact same
   dedup/per-destination guardrails so it can only add coverage, never
   exceed or displace the existing destination-fairness guarantee;
   deliberately scoped to only the `"transfers"` fast path, since every
   other sort order already tracks per-origin results explicitly and has
   no equivalent gap.

`tests/railway-search.test.js`'s failing test was then updated to locate
its target result by train number + journey type + a match on HW as
either the recommended or an alternative boarding station, instead of an
exact-match on the old (pre-existing-fix) `itineraryKey` string format -
every one of the test's original assertions is preserved, just located
correctly against the intentional, boarding-specific grouping.

Verified: `npx tsc --noEmit` clean. `npm run test:railway-search`: all 13
now pass (was 12/13). `npm run test:multimodal-search`: 22/23 pass (the 1
remaining failure is the unrelated, already-deferred `RAIL_TO_FLIGHT`
issue). Full real-database regression re-run for every scenario verified
in request #29 (DWX -> SVDK departure/arrival sort, NDLS -> BPL departure
sort, INDB -> SVDK transfers sort/Malwa Express) produced byte-for-byte
identical results to before this fix - the origin-fairness pass only
changes output under the specific contention pattern (many origins, few
reachable destinations, tight `resultLimit`) that none of those scenarios
trigger.

### 31. Sort by Departure Time still showing (almost) every result at the search time

The user re-reported the same DWX -> SVDK, `2026-09-10T07:00`, RAIL_ONLY,
"Sort by Departure Time" symptom from request #28 - "every result is
showing journey start as 07:00" - even after requests #29-30's fixes,
along with an illustrative example of the desired calculation (train
departure minus boarding wait minus road access = journey start).

Reproduced: still 19/19 results at `07:00`. This time the bug was one
layer BELOW everything fixed so far: `compareJourneyOptions()`/
`compareMultimodalResultsBy()` (request #29) correctly sort whatever
candidates exist, and `buildOption()` (request #28) correctly computes
each one's actual start without hiding road access - but the underlying
graph search in `railway-provider.service.ts` was never finding the
candidates that would have shown a later, genuinely different departure
time in the first place, for `sortBy: "departure"` specifically. Root
cause: the search's internal exploration priority (`compareStates()`)
ordered states by each candidate's RAW train departure; from a single
origin, one early train can be completed to the destination via many
different downstream transfer combinations, all sharing that same raw
departure, and the search's per-origin result quota filled up entirely on
that combinatorial variety before ever trying that same origin's next,
later, genuinely different (and possibly much simpler, direct) train.
Confirmed against the real database: Ujjain Junction's two real DIRECT
trains to SVDK (12:55 and 14:00) never appeared in the search results at
all, crowded out entirely by dozens of transfer-path variations of a
07:00 train from the same station.

Fixed with two changes in `railway-provider.service.ts`: (1) origins now
carry their own road-access minutes through to the search's exploration
priority, so a farther origin's train is no longer unfairly deprioritized
against a closer origin's earlier-raw-departure train (a real fix, but
insufficient alone since it can't change ordering among ONE origin's own
candidates); (2) a new cap limiting how many admitted results per origin
may share the same first-boarded train, freeing up quota to try that
origin's next distinct departure - tuned against real data to a value
that maximizes departure-time diversity without exhausting the search's
overall exploration budget (a stricter cap was tried and caused the
search to truncate on this real, multi-transfer route).

Verified against the real database: DWX -> SVDK now shows genuinely
different departure times instead of one shared value (17 results,
`07:00`/`07:02`/`10:48` clusters, no longer truncated); INDB -> SVDK spans
`07:00` through `12:59` across a full day of real departures; NDLS -> BPL
shows even more distinct times than before, with the "never before the
requested time" guarantee intact. `sortBy=arrival`/`transfers`/`duration`
and the previously-fixed Malwa Express direct-boarding case are
unaffected. `npx tsc --noEmit` clean, `npm run test:railway-search`
13/13, `npm run test:multimodal-search` 22/23 (the 1 remaining failure is
the unrelated, already-deferred `RAIL_TO_FLIGHT` issue).

### 32. A screenshot showing an impossible journey: arrive at the boarding station after the train already left, displayed as a valid 0m boarding wait

The user sent a screenshot of DWX -> SVDK, `2026-09-10T09:30`, RAIL_ONLY,
sorted by departure: "Option 1" showed road access `09:30 -> Maksi
Junction` taking `49m` (landing at `10:19`), directly followed by a
"Boarding wait" row also timestamped `10:19` with duration `0m`, then a
train row timestamped `10:00` - the train had already left 19 minutes
before the timeline claims the traveler arrived. Asked for: "Each journey
must use its actual calculated departure/start time" and "Boarding wait
should not be 0m."

Root cause: the item-30 readiness floor (never display a start before the
search time) is correct, but forcing the departure later than the train
actually needs can push the *forward-computed* station arrival past that
train's own departure - arriving too late to catch it - without anything
flagging the candidate as broken; `BOARDING_WAIT`'s existing
`Math.max(0, ...)` clamp just silently reports `0m`, indistinguishable
from "arrived just in time." Confirmed against the real database: exactly
this search had 3 of 16 `sortBy=departure` results genuinely impossible
this way (all showing the same fabricated `0m`), while a 4th (Ujjain
Junction, arriving 1 real minute before its train) was legitimately tight
but feasible and correctly showed `1m`.

Fixed by having `buildOption()` return `null` (silently discarded by an
existing filter at its one call site) whenever the floored departure would
still arrive at the boarding station after the train's own departure -
this can only happen once the search-time floor has moved the departure
later than what the train naturally needed, so it does not affect the
already-verified item-30 diversity fix or any non-flexible-timing search.

Verified against the real database for the exact reported search: all 3
fabricated-`0m` candidates are now correctly excluded; the genuinely
tight-but-feasible Ujjain Junction option is retained unchanged; every
remaining result shows its real boarding wait (the actual `20`-minute
buffer, or the true residual margin) instead of a fabricated value. Full
regression re-run across every sort order on DWX -> SVDK, NDLS -> BPL, and
INDB -> SVDK: zero infeasible candidates anywhere, no new truncation
(result counts dropped only by the number of now-correctly-excluded
impossible candidates). `npx tsc --noEmit` clean, `npm run
test:railway-search` 13/13, `npm run test:multimodal-search` 22/23 (the 1
remaining failure is the unrelated, already-deferred `RAIL_TO_FLIGHT`
issue).

### 33. A screenshot of a wasteful backtracking journey: drive to a farther station, ride a train back to the origin, then continue

The user sent a screenshot of DWX -> SVDK, `2026-09-10T09:45`, RAIL_ONLY,
sorted by departure: "Option 1" drove to Maksi Junction (49m road access),
then boarded a train that went back to Dewas Junction (the traveler's own
origin) before continuing to New Delhi and SVDK. Asked, correctly: why
drive away only to ride a train back?

Two compounding root causes, found via real-database investigation (see
`PROJECT_MEMORY.md`'s "A wasteful backtracking journey..." section for the
full account):

1. A genuine gap in the existing detour-pruning: both prior prune
   functions only compare candidates riding the IDENTICAL train sequence,
   so a candidate with one extra, throwaway FIRST leg never matches either
   one and survives unpruned. **Fixed**: a new
   `pruneSelfDefeatingFirstLegs()` compares a candidate's own ride minus
   its first leg against every other candidate's full ride - if another
   candidate reaches the same remaining journey with no worse access, the
   first leg was pure waste. Verified this correctly removes some
   genuinely wasteful candidates in the exact reported search.
2. A deeper admission-budget gap (from item 30's own per-origin fairness
   fix): confirmed via an isolated real-database test that the genuinely
   simple, direct alternative (board a specific train straight from the
   true origin, no detour) never even entered the search's candidate pool
   at all for this route - not a resource-budget shortage, but a
   mathematical property of the existing per-(origin, first-train) cap.
   Attempted a two-phase adaptive-cap fix; **found unsafe on real data**
   (drove Node processes to 2-3GB of memory and 30-60+ seconds, and still
   didn't fully resolve the reported case) and **reverted** back to item
   30's original, safe cap. This means fix #1 alone does not fully resolve
   this exact reported search - only whenever a comparably-good
   alternative happens to already be in the candidate pool.

While diagnosing this, also found (confirmed pre-existing, NOT caused by
today's changes): `sortBy=departure`/`arrival`/`duration` searches on this
same long-distance, multi-transfer route take 30-65+ seconds end to end -
isolated via timing instrumentation to the graph-search itself, not any
post-processing. A serious, separate latency issue, flagged for a
dedicated future session rather than attempted alongside an already-
difficult, already-reverted admission-budget change.

Verified: `npx tsc --noEmit` clean, `npm run test:railway-search` 13/13
(fast - test fixtures don't hit the slow route), `npm run
test:multimodal-search` 22/23 (the 1 remaining failure is the unrelated,
already-deferred `RAIL_TO_FLIGHT` issue). The two pre-existing prune
functions were also rewritten from O(n^2) to O(n) on general principle,
though measured to have no effect on this search's actual wall time - the
candidate pool reaching them is small (~12-20 items); the real cost is
entirely upstream in the provider search.

## Current handoff state

- The working tree now also includes, on top of everything described above:
  `src/utils/search-semaphore.ts`, `src/utils/string-chain.ts`,
  `src/middleware/rate-limiter.ts`, `src/middleware/metrics-auth.ts`,
  `src/observability/metrics.ts`, `docs/production-environment-variables.md`,
  and `tests/search-semaphore.test.js` / `tests/rate-limiter.test.js` /
  `tests/metrics.test.js` (all new/untracked), plus modifications to
  `src/config/database.ts`, `src/routes/health.routes.ts`,
  `src/routes/journey.routes.ts`, `src/routes/railway.routes.ts`,
  `src/server.ts`, and `src/services/railway-provider.service.ts`
  (`directServiceKey()`/`trainSequenceKey()`/`compareStates()` fixes); and
  `src/services/journey-search.service.ts` (`itineraryKey()` grouping fix,
  `pruneUpstreamBoardingDetours()`/`pruneUpstreamAlightingDetours()`,
  `buildOption()` start-time clamp). `src/services/multimodal-journey.service.ts`
  was touched twice earlier this session (requests #18 and #21) but both
  changes were fully reverted once the real fix was relocated to
  `journey-search.service.ts`; it now carries two new, kept changes from
  requests #25-26 (the redundant-airport-transfer pruning and the
  `FEEDER_TRANSFER_CONNECTIVITY_BONUS_MS` heuristic adjustment, both in
  `executeSearch()`).
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
- As of request #30: `npx tsc --noEmit` is clean. `tests/railway-search.test.js`
  is fully green (13/13) - the `itineraryKey()` grouping regression and the
  HW admission-budget bug found while verifying request #29 are both fixed
  and verified (see request #30 above). `tests/multimodal-search.test.js`
  has exactly one remaining, pre-existing, confirmed-unrelated failure (the
  `RAIL_TO_FLIGHT` truncation issue from request #25) - still deferred,
  needs explicit user authorization before a dedicated fix is attempted.

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
