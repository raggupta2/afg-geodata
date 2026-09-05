# Claude Code Project Handoff

Before investigating or changing this repository, read these files in order:

1. `AGENTS.md` — authoritative engineering, routing, execution, and reporting
   rules.
2. `PROJECT_MEMORY.md` — concise durable requirements, established root causes,
   implementation state, and verification status.
3. `CONVERSATION_MEMORY.md` — normalized chronology of the user-visible requests
   that produced the current working tree.

Treat the current repository and database as authoritative. Preserve all
existing uncommitted changes unless the user explicitly asks to discard them.
The working tree contains one intentional, unfinished verification batch for
journey-search performance and correctness, extended with a 5-to-20
result-limit and server-side "Show More" pagination change for the
multimodal journey search (see `PROJECT_MEMORY.md` and
`CONVERSATION_MEMORY.md` for specifics).

The repository is in edit-only mode unless the user explicitly authorizes
command execution. Do not run builds, tests, scripts, database queries,
migrations, servers, or benchmarks without that authorization.

When execution is authorized, begin with:

```bash
npx tsc --noEmit
npm run test:railway-search
npm run test:multimodal-search
```

The source changes will not affect a currently running compiled server until it
is rebuilt and restarted. The new database indexes also require the pending
migration to be applied in the appropriate environment.

Do not store secrets, credentials, private environment values, hidden model
reasoning, or large raw tool output in the memory files.
