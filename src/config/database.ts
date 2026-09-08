import { PrismaClient } from "@prisma/client";
import { recordQueryDuration } from "../observability/metrics";

// Prisma's query engine sizes its own connection pool from the
// `connection_limit` query parameter on the connection string (this is
// Prisma's own mechanism - not a PrismaClient constructor option), so an
// explicit value is appended here rather than relying on its undocumented
// default for this deployment. This still constructs exactly one
// PrismaClient (the existing singleton, exported once below) - no adapter,
// no per-request client, no second client instance.
//
// DATABASE_CONNECTION_LIMIT MUST be reviewed and overridden per production
// environment: it needs to be sized against the target Postgres instance's
// max_connections and the number of app instances sharing it, not just this
// process's own bounded search concurrency. The default below is a
// conservative starting point sized only against this service's own admission
// controls (RAILWAY_SEARCH_CONCURRENCY + MULTIMODAL_SEARCH_CONCURRENCY, each
// defaulting to 2 concurrent searches, each issuing a handful of parallel
// queries at peak) - it is not a production-tuned value.
//
// IMPORTANT if CLUSTER_WORKERS (server.ts) is set above 1: each worker is a
// separate OS process with its own module registry, so each one constructs
// its own PrismaClient from this file - the EFFECTIVE total connection count
// against Postgres is DATABASE_CONNECTION_LIMIT multiplied by the number of
// worker processes, not this value alone. Size DATABASE_CONNECTION_LIMIT
// with that multiplication in mind once clustering is enabled.
const DEFAULT_CONNECTION_LIMIT = 20;

function resolveDatabaseUrl(): string {
    const rawUrl = process.env.DATABASE_URL;
    if (!rawUrl) {
        throw new Error("DATABASE_URL environment variable is not set.");
    }

    const url = new URL(rawUrl);
    if (!url.searchParams.has("connection_limit")) {
        const configuredLimit = Number(process.env.DATABASE_CONNECTION_LIMIT);
        const connectionLimit = Number.isInteger(configuredLimit) && configuredLimit > 0
            ? configuredLimit
            : DEFAULT_CONNECTION_LIMIT;
        url.searchParams.set("connection_limit", String(connectionLimit));
    }
    return url.toString();
}

export const prisma = new PrismaClient({
    datasources: { db: { url: resolveDatabaseUrl() } },
    log: [{ emit: "event", level: "query" }]
});

// Proxy signal for DB load/pool pressure (see observability/metrics.ts) -
// not literal Prisma connection-pool wait time, which Prisma only exposes
// via its "metrics" preview feature (a schema.prisma change, deliberately
// not made here). Stable, non-preview query-event logging only.
prisma.$on("query", event => {
    recordQueryDuration(event.duration);
});