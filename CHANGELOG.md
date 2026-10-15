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

## Current status (updated 2026-10-15)

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
- **Pending DB migration:** `20260902090000_journey_search_candidate_indexes`
  is NOT applied to the local `afg_geodata` database (`prisma migrate status`).
- **Missing file:** `docs/production-environment-variables.md` is referenced
  by the memory files but `docs/` is git-ignored, so it was not carried over to
  this account.

### Next steps (open, in suggested order)

1. User decision: normalize line endings / file mode (e.g. add
   `.gitattributes` with `* text=auto eol=lf` and/or
   `git config core.fileMode false`) and commit the current verified work.
2. Apply the pending index migration (`npx prisma migrate deploy`/`dev`) when
   the user approves.
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
