# AGENTS.md

## Project Context

`afg-geodata` implements a **multimodal journey search engine** (Road + Railway + Flight) using **TypeScript**, **Prisma**, **PostgreSQL**, and **PostGIS**.

The routing architecture consists of independent transport providers coordinated by a central journey orchestrator. Core services include:

- `src/services/multimodal-journey.service.ts`
- `src/services/journey-search.service.ts`
- `src/services/railway-provider.service.ts`
- `src/services/station-access.service.ts`
- `src/repositories/multimodal-routing.repository.ts`

Journey-wide business configuration (road speeds, boarding and transfer buffers, transfer limits, search radius, search horizon, ranking weights, penalties, and similar values) belongs in the `journey_routing_policies` table, **not** as hardcoded constants in service classes.

---

## Multimodal Routing Rules

### Architecture and Responsibilities

The routing engine is transport-agnostic. Supported transport modes are:

- `LOCAL`
- `RAIL`
- `FLIGHT`
- `TRANSFER`
- `WALK`

Future transport providers must integrate without requiring modifications to the routing engine.

The journey orchestrator is responsible for:

- Hub discovery
- Candidate generation
- End-to-end journey construction
- Ranking
- Final recommendation

Transport providers should return only transport-specific journeys.

### Configuration

All routing behavior must be driven by `journey_routing_policies`. Do not hardcode:

- Ranking weights
- Transfer penalties
- Search limits
- Boarding or transfer buffers
- Search radius
- Road speeds
- Search horizon

If a required configuration does not exist, propose adding it rather than introducing a hardcoded constant.

When consolidating duplicated configuration:

1. Search the entire repository for every duplicate location.
2. Keep business logic in code while moving configurable values into policy data.
3. Preserve existing behavior; when execution is authorized, verify that new defaults produce behavior identical to the previous hardcoded values.

### Candidate Generation

Generate **all feasible journeys** within configured search limits. Examples include:

- Local → Rail → Local
- Local → Flight → Local
- Local → Rail → Flight → Local
- Local → Flight → Rail → Local
- Local → Rail → Rail → Local

Candidate generation and ranking are separate responsibilities. Never compensate for missing search results by modifying ranking logic.

A missing-route issue generally belongs to search, state expansion, or candidate retention; a wrong-order issue generally belongs to comparison or scoring. Diagnose which mechanism is responsible before changing either one.

### Route Ranking

Unless overridden by routing policy, rank complete end-to-end journeys using:

1. Earliest final arrival.
2. Lowest total door-to-door journey duration.
3. Fewest transport transfers.
4. Lowest cost, when available.
5. Highest practicality.
6. Highest service reliability, when available.

Never optimize a transport mode independently or optimize for raw in-vehicle duration alone. Journey duration includes:

- Origin local transport
- Walking
- Waiting
- Boarding buffers
- Railway travel
- Flight travel
- Transfer time
- Destination local transport

### Practicality

Prefer practical journeys. Apply policy-configured penalties for:

- Excessive transfers
- Four or more flight segments
- Long layovers
- Long railway waits
- Long road access
- Backtracking
- Unnecessary detours

A slightly longer but significantly simpler journey may rank higher when allowed by routing policy. Practicality logic must evaluate the complete journey, including total time, transfer count, flight-transfer count, layovers, and detours.

### Railway

- Always evaluate the selected station.
- Discover nearby candidate stations.
- Search every candidate independently.
- Rank candidates using complete door-to-door journey time.
- Preserve existing railway search logic unless explicitly requested otherwise.

### Flight

Only scheduled commercial passenger flights are eligible. Database queries must include:

```sql
aviation_airlines.service_type = 'scheduled'
```

Exclude the following in SQL, rather than fetching and filtering afterward:

- Private
- Charter
- Cargo
- Government
- Military
- Training
- Positioning
- Ferry
- Any other non-scheduled service

### Candidate Pruning and Dominance

Only remove journeys that are demonstrably dominated. Establish comparability using criteria such as:

- Identical service sequence
- Shared transport or service prefix
- Same boarding opportunity
- Same real destination, including routes that use different last-mile hubs

Do not limit comparison solely to candidates that share an internal transit hub. Conversely, do not apply a blanket rule that any faster route dominates every slower route to the same destination. Key pruning to actual shared services or boarding opportunities so legitimate alternative itineraries survive.

### Scalability and Truncation

Search truncation (`truncated = true`) indicates incomplete search coverage. A search that reaches its expansion cap while many states remain unprocessed is a real missing-results signal, not merely a performance metric.

Do not address truncation merely by increasing limits. Investigate:

- Candidate explosion
- State expansion and unprocessed states
- Duplicate states
- Transfer-target fan-out
- Railway re-expansion
- Multi-hop breadth
- Search pruning

---

## Engineering Workflow

### Root Cause and Evidence

Always identify and explain the actual root cause before proposing or implementing a fix. Do not guess or patch symptoms; trace the responsible mechanism with concrete evidence such as:

- Exact file and line references
- Real SQL or Prisma query results
- Runtime or instrumented traces
- Exact reproduction steps

Cite code claims and changed locations with Markdown links that include paths and line numbers, for example `[file.ts:123](path/to/file.ts:123)`.

Use clear headings for findings and summaries, such as `## Summary` and `## Root cause`, followed by numbered analysis points, concise comparisons, or tables where useful. When multiple issues appear, state which is the actual bug and which are minor, related, or pre-existing issues.

If an unrelated issue is discovered, identify it separately and ask before changing it. Do not silently fix or silently ignore it. Do not re-derive conclusions already established in the same conversation; report a repeated result briefly and continue from the existing conclusion.

### Debugging

Reproduce the reported scenario exactly before theorizing, using the same:

- Coordinates
- Dates
- Inputs
- API payloads
- Concrete result data, including JSON payloads, itinerary legs, or screenshot text

Treat concrete reported output as the ground truth to reproduce, not as a paraphrase. Prefer the real development database over mocked data because schedule and policy behavior depends on real data.

Distinguish among these diagnoses because they require different fixes:

- The correct candidate was generated, but ranking hid or misplaced it.
- Candidate generation never found or retained it, including truncation or state starvation.
- The required underlying data does not exist.

Before deciding which side of a test/implementation mismatch is wrong, inspect other real consumers, such as frontend API callers, and fix the stale side rather than whichever side is easiest to edit.

### Implementation

Make the smallest safe change that satisfies the stated requirement. Avoid unrelated refactoring, cosmetic cleanup, renaming, API changes, response-schema changes, or other "while here" work unless explicitly requested.

Respect scope boundaries literally, including restrictions to a particular file, preserving response formats, or retaining existing ranking behavior unless it incorrectly excludes valid candidates.

After changing a shared helper or interface, find and update every call site. Prefer narrow, surgical edits over rewriting entire functions when only a few lines need to change.

### Analysis-Only Tasks

When asked to analyze, investigate, or review without making changes:

- Do not edit code or add temporary fixes.
- Answer every requested question directly.
- Support findings with code and data references.
- End by asking whether implementation should proceed.

Treat "analyze first, apply later" as two distinct phases. Require explicit approval in a later turn before editing. If a proposed fix proves too broad or too narrow during user verification, adjust the existing mechanism rather than discarding the investigation and starting over.

### Context Management

- Continue from conclusions already established in the same conversation.
- If the user asks to continue after an interruption, resume at the next unfinished step rather than restarting.
- Do not ask again for context already supplied earlier in the conversation.
- Re-read the current file before editing, especially after an interruption or possible concurrent change.
- Treat the current repository and database state as authoritative.
- If a file contains an unexpected, conflicting, or half-finished change, stop and flag it rather than overwriting or silently working around it.

### Reporting

Technical summaries should lead with what changed and why. Include a concise verification section stating what was run, what passed, and whether any failure was pre-existing or unrelated. Avoid narrating steps already evident from tool calls.

---

## Execution Policy

Operate in **edit-only mode** unless the user explicitly authorizes command execution.

In edit-only mode, do not:

- Run tests or builds.
- Start servers.
- Execute scripts or benchmarks.
- Add temporary debug logging or instrumentation.
- Perform repeated edit → build → test loops.

After editing:

1. Summarize the changes.
2. List the exact verification commands that should be run.
3. Wait for confirmation before executing them.

Explicit authorization to execute commands does not broaden the requested implementation scope.

### Debug Instrumentation

When live debugging and command execution are explicitly authorized, temporary source instrumentation may be used only when necessary. Remove all temporary instrumentation before finalizing, and confirm its removal through a clean diff and, when authorized, a clean rebuild with no debug output.

One-off verification scripts that invoke compiled service code against the real database must live inside the project directory so `node_modules` resolves. Delete them after use. Never create such scripts in edit-only or analysis-only mode.

---

## Verification

The default verification sequence, when execution is authorized, is:

```bash
npx tsc --noEmit
node --test tests/<relevant-test>.test.js
```

Use the relevant test file or files rather than the entire suite unless broader verification is warranted.

If execution is restricted, list the commands without running them and wait for the user to provide the results. When terminal output is provided, read it completely, confirm whether the intended checks passed, and classify every failure as caused by the change or pre-existing/unrelated, with a concise reason.

---

## Token Efficiency

- Prefer evidence-based reasoning over trial and error.
- Batch related reads and edits.
- Avoid repeated edit → build → test cycles.
- Inspect and modify only files relevant to the task.
- Do not inspect unrelated modules.
- Stop when the requested work is complete.

---

## Tool Usage

- Use **Grep**, **Glob**, and **Read** to locate implementations and duplicated constants.
- Use **Edit** for existing files and **Write** only for genuinely new files.
- Use **Bash** for authorized database verification through Prisma or `psql`, confirming data existence and shape before attributing a problem to code.
- Use **AskUserQuestion** only when a requirement is genuinely ambiguous or before a destructive or blocking action, not for routine implementation decisions.
- Prefer minimal, surgical edits.
