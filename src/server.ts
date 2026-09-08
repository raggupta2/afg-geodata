import "dotenv/config";
import cluster from "cluster";
import fs from "fs";
import https from "https";
import { Server } from "http";
import app from "./app";
import { prisma } from "./config/database";
import { logger } from "./config/logger";
import {
    startPeriodicMetricsLogging,
    stopPeriodicMetricsLogging
} from "./observability/metrics";

const PORT = parseInt(process.env.PORT || "3000", 10);

// Opt-in only: CLUSTER_WORKERS unset (or <=1) preserves the exact existing
// single-process behavior, so existing deployments are unaffected unless
// this is explicitly configured. When enabled, each worker is a separate OS
// process with its own module registry - it independently constructs its
// own Prisma client (see config/database.ts's DATABASE_CONNECTION_LIMIT
// note), its own railway graph snapshot, its own result caches, and its own
// SearchSemaphore instances. RAILWAY_SEARCH_CONCURRENCY and
// MULTIMODAL_SEARCH_CONCURRENCY are therefore enforced PER WORKER, not
// cluster-wide - the effective total concurrent-search ceiling across the
// whole cluster is the configured value multiplied by CLUSTER_WORKERS. Size
// all of these together, not independently, when turning clustering on.
const configuredWorkers = Number(process.env.CLUSTER_WORKERS ?? 1);
const workerCount = Number.isInteger(configuredWorkers) && configuredWorkers > 1
    ? configuredWorkers
    : 1;

function startWorker(): void {
    let server: Server;

    if (process.env.USE_HTTPS === "true") {
        const sslOptions = {
            key: fs.readFileSync(process.env.SSL_KEY_PATH || "ssl/staging/privkey.pem"),
            cert: fs.readFileSync(process.env.SSL_CERT_PATH || "ssl/staging/fullchain.pem"),
        };

        server = https.createServer(sslOptions, app);

        server.listen(PORT, "0.0.0.0", () => {
            logger.info({ port: PORT, pid: process.pid }, "HTTPS server running");
        });
    } else {
        server = app.listen(PORT, "0.0.0.0", () => {
            logger.info({ port: PORT, pid: process.pid }, "HTTP server running");
        });
    }

    server.requestTimeout = Number(process.env.REQUEST_TIMEOUT_MS ?? 30_000);
    server.headersTimeout = Number(process.env.HEADERS_TIMEOUT_MS ?? 35_000);
    server.keepAliveTimeout = Number(process.env.KEEP_ALIVE_TIMEOUT_MS ?? 5_000);

    startPeriodicMetricsLogging();

    let shuttingDown = false;
    async function shutdown(signal: string): Promise<void> {
        if (shuttingDown) return;
        shuttingDown = true;
        logger.info({ signal, pid: process.pid }, "Shutting down server");
        stopPeriodicMetricsLogging();

        const forcedExit = setTimeout(() => {
            logger.error("Forced shutdown after timeout");
            process.exit(1);
        }, 10_000);
        forcedExit.unref();

        server.close(async error => {
            await prisma.$disconnect();
            clearTimeout(forcedExit);
            if (error) {
                logger.error({ error }, "Server shutdown failed");
                process.exit(1);
            }
            process.exit(0);
        });
    }

    process.on("SIGTERM", () => void shutdown("SIGTERM"));
    process.on("SIGINT", () => void shutdown("SIGINT"));
}

function startPrimary(): void {
    // Each worker is a separate OS process: RAILWAY_SEARCH_CONCURRENCY,
    // MULTIMODAL_SEARCH_CONCURRENCY, DATABASE_CONNECTION_LIMIT, and
    // SEARCH_RATE_LIMIT_MAX_REQUESTS are all enforced independently PER
    // WORKER (see the matching comments in railway-provider.service.ts,
    // multimodal-journey.service.ts, config/database.ts, and
    // middleware/rate-limiter.ts). This logs the raw configured/default
    // values once at cluster startup, alongside workerCount, purely so the
    // multiplication is visible to whoever is deploying this - it does not
    // re-derive or duplicate any of those modules' own validation logic.
    logger.warn(
        {
            workerCount,
            perWorkerRailwaySearchConcurrency:
                process.env.RAILWAY_SEARCH_CONCURRENCY ?? "(unset, default 2)",
            perWorkerMultimodalSearchConcurrency:
                process.env.MULTIMODAL_SEARCH_CONCURRENCY ?? "(unset, default 2)",
            perWorkerDatabaseConnectionLimit:
                process.env.DATABASE_CONNECTION_LIMIT ?? "(unset, default 10)",
            perWorkerSearchRateLimitMaxRequests:
                process.env.SEARCH_RATE_LIMIT_MAX_REQUESTS ?? "(unset, default 20)"
        },
        `Cluster mode active with ${workerCount} workers: the values above `
        + "are each enforced PER WORKER, not cluster-wide. Effective "
        + `cluster-wide totals are each value multiplied by ${workerCount} - `
        + "in particular, confirm perWorkerDatabaseConnectionLimit * "
        + "workerCount stays within your Postgres max_connections before "
        + "deploying."
    );

    for (let index = 0; index < workerCount; index += 1) {
        cluster.fork();
    }

    let clusterShuttingDown = false;

    cluster.on("exit", (worker, code, signal) => {
        if (clusterShuttingDown) {
            if (Object.keys(cluster.workers ?? {}).length === 0) {
                process.exit(0);
            }
            return;
        }
        logger.error(
            { workerId: worker.id, code, signal },
            "Worker exited unexpectedly - forking a replacement"
        );
        cluster.fork();
    });

    function shutdownCluster(signal: NodeJS.Signals): void {
        if (clusterShuttingDown) return;
        clusterShuttingDown = true;
        logger.info({ signal }, "Shutting down cluster");

        const workers = Object.values(cluster.workers ?? {});
        if (workers.length === 0) {
            process.exit(0);
            return;
        }
        for (const worker of workers) {
            worker?.process.kill(signal);
        }
    }

    process.on("SIGTERM", () => shutdownCluster("SIGTERM"));
    process.on("SIGINT", () => shutdownCluster("SIGINT"));
}

if (workerCount > 1 && cluster.isPrimary) {
    startPrimary();
} else {
    startWorker();
}
