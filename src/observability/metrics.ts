import { monitorEventLoopDelay } from "perf_hooks";
import { logger } from "../config/logger";

export type SemaphoreStats = {
    active: number;
    queued: number;
};

type SemaphoreStatsProvider = () => SemaphoreStats;

const semaphoreProviders = new Map<string, SemaphoreStatsProvider>();

/**
 * Registers a named SearchSemaphore for observability. Call once per
 * semaphore instance at module load (railway-provider.service.ts,
 * multimodal-journey.service.ts) - this only reads activeCount/queuedCount
 * on demand, it does not affect admission-control behavior.
 */
export function registerSemaphoreMetrics(
    name: string,
    provider: SemaphoreStatsProvider
): void {
    semaphoreProviders.set(name, provider);
}

// Native, allocation-free event-loop delay histogram - no new dependency.
// Enabled once at module load; reset on each periodic log flush below so
// each snapshot reflects only the interval since the last one.
const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelay.enable();

const nanosToMs = (value: number): number => value / 1e6;

// Rolling window of Prisma query durations, fed by config/database.ts's
// query-event listener. This is a proxy for DB load, not literal Prisma
// connection-pool wait time - Prisma only exposes that via its "metrics"
// preview feature, which would require a schema.prisma change and was
// deliberately left untouched here (see config/database.ts). Rising query
// duration/count alongside rising event-loop lag is the closest available
// signal to "the pool is under pressure" without that change.
const QUERY_SAMPLE_WINDOW_MS = 60_000;
const MAX_QUERY_SAMPLES = 5_000;
let querySamples: Array<{ durationMs: number; at: number }> = [];

export function recordQueryDuration(durationMs: number): void {
    querySamples.push({ durationMs, at: Date.now() });
    if (querySamples.length > MAX_QUERY_SAMPLES) {
        querySamples = querySamples.slice(-MAX_QUERY_SAMPLES);
    }
}

function recentQueryDurations(): number[] {
    const cutoff = Date.now() - QUERY_SAMPLE_WINDOW_MS;
    querySamples = querySamples.filter(sample => sample.at >= cutoff);
    return querySamples.map(sample => sample.durationMs).sort((left, right) => left - right);
}

function percentile(sortedValues: number[], fraction: number): number {
    if (sortedValues.length === 0) return 0;
    const index = Math.min(
        sortedValues.length - 1,
        Math.floor(fraction * sortedValues.length)
    );
    return sortedValues[index];
}

export function currentMetricsSnapshot() {
    const durations = recentQueryDurations();
    return {
        timestamp: new Date().toISOString(),
        // Every value below (semaphores, event loop, DB, memory) is
        // PER PROCESS. Under CLUSTER_WORKERS > 1 this snapshot reflects only
        // the single worker that happened to answer this request - pid and
        // configuredClusterWorkers are included so that's never mistaken for
        // a cluster-wide total; effective cluster-wide totals are each
        // per-worker value multiplied by configuredClusterWorkers (see
        // server.ts's cluster-mode startup log for the full breakdown).
        pid: process.pid,
        configuredClusterWorkers: Number(process.env.CLUSTER_WORKERS ?? 1),
        semaphores: Object.fromEntries(
            [...semaphoreProviders.entries()].map(
                ([name, provider]) => [name, provider()]
            )
        ),
        eventLoop: {
            meanMs: nanosToMs(eventLoopDelay.mean),
            p95Ms: nanosToMs(eventLoopDelay.percentile(95)),
            maxMs: nanosToMs(eventLoopDelay.max)
        },
        database: {
            queryCountLastMinute: durations.length,
            meanQueryDurationMs: durations.length === 0
                ? 0
                : durations.reduce((sum, value) => sum + value, 0) / durations.length,
            p95QueryDurationMs: percentile(durations, 0.95),
            maxQueryDurationMs: durations.length === 0
                ? 0
                : durations[durations.length - 1]
        },
        memory: process.memoryUsage()
    };
}

let loggingInterval: NodeJS.Timeout | null = null;

/**
 * Starts periodic structured-log metrics snapshots. Must be called only
 * from the real process entrypoint (server.ts), never from app.ts or a
 * service module - otherwise every test file that imports the compiled app
 * would also start a background timer.
 */
export function startPeriodicMetricsLogging(
    intervalMs = Number(process.env.METRICS_LOG_INTERVAL_MS ?? 30_000)
): void {
    if (loggingInterval) return;
    const resolvedIntervalMs = Number.isInteger(intervalMs) && intervalMs > 0
        ? intervalMs
        : 30_000;
    loggingInterval = setInterval(() => {
        logger.info({ metrics: currentMetricsSnapshot() }, "search metrics snapshot");
        eventLoopDelay.reset();
    }, resolvedIntervalMs);
    loggingInterval.unref();
}

export function stopPeriodicMetricsLogging(): void {
    if (loggingInterval) {
        clearInterval(loggingInterval);
        loggingInterval = null;
    }
}
