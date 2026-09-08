import { NextFunction, Request, Response } from "express";
import { ApiError } from "../errors/api.error";

export type RateLimiterOptions = {
    windowMs: number;
    maxRequests: number;
    busyMessage: string;
    maxTrackedClients?: number;
    /** Injectable clock, for deterministic tests. Defaults to Date.now. */
    now?: () => number;
};

export type ResolvedRateLimiterConfig = {
    windowMs: number;
    maxRequests: number;
};

/**
 * Resolves SEARCH_RATE_LIMIT_WINDOW_MS / SEARCH_RATE_LIMIT_MAX_REQUESTS once,
 * shared by every route that applies createRateLimiter (currently
 * journey.routes.ts and railway.routes.ts) so both stay in sync and
 * server.ts's cluster-capacity startup log can report the same values.
 */
export function resolveRateLimiterConfig(): ResolvedRateLimiterConfig {
    const configuredWindowMs = Number(process.env.SEARCH_RATE_LIMIT_WINDOW_MS ?? 60_000);
    const configuredMaxRequests = Number(process.env.SEARCH_RATE_LIMIT_MAX_REQUESTS ?? 20);
    return {
        windowMs: Number.isInteger(configuredWindowMs) && configuredWindowMs > 0
            ? configuredWindowMs
            : 60_000,
        maxRequests: Number.isInteger(configuredMaxRequests) && configuredMaxRequests > 0
            ? configuredMaxRequests
            : 20
    };
}

type ClientWindow = {
    count: number;
    windowStart: number;
};

/**
 * In-process, per-client fixed-window rate limiter for the expensive search
 * endpoints. Deliberately not Redis-backed or otherwise distributed - the
 * deployment model is one or more independent Node processes (see
 * server.ts's opt-in clustering), each enforcing its own window, consistent
 * with SearchSemaphore's own in-process-only design. Under clustering, the
 * effective per-client limit is `maxRequests` per worker, not cluster-wide.
 *
 * This limits request *rate* (a client sending too many requests) and
 * responds 429; it is a different concern from SearchSemaphore's *admission
 * control* (the server being at capacity), which responds 503.
 *
 * Client windows are tracked in a bounded map keyed by IP, refreshed
 * (re-inserted) on every new window so the oldest-untouched entries are
 * evicted first once `maxTrackedClients` is exceeded - the same bounded,
 * lazily-evicted pattern used by BoundedAsyncTtlCache, so memory cannot grow
 * without bound even with many distinct one-off clients.
 */
export function createRateLimiter(options: RateLimiterOptions) {
    const clients = new Map<string, ClientWindow>();
    const maxTrackedClients = options.maxTrackedClients ?? 10_000;
    const getNow = options.now ?? Date.now;

    return function rateLimiter(
        req: Request,
        _res: Response,
        next: NextFunction
    ): void {
        const key = req.ip ?? "unknown";
        const now = getNow();
        const existing = clients.get(key);

        if (existing && now - existing.windowStart < options.windowMs) {
            if (existing.count >= options.maxRequests) {
                next(new ApiError(429, options.busyMessage));
                return;
            }
            existing.count += 1;
            next();
            return;
        }

        clients.delete(key);
        clients.set(key, { count: 1, windowStart: now });
        while (clients.size > maxTrackedClients) {
            const oldestKey = clients.keys().next().value;
            if (oldestKey === undefined) break;
            clients.delete(oldestKey);
        }
        next();
    };
}
