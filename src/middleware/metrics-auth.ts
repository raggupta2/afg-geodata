import { timingSafeEqual } from "crypto";
import { NextFunction, Request, Response } from "express";
import { ApiError } from "../errors/api.error";
import { logger } from "../config/logger";

let warnedUnprotected = false;

function tokensMatch(provided: string, required: string): boolean {
    const providedBuffer = Buffer.from(provided);
    const requiredBuffer = Buffer.from(required);
    if (providedBuffer.length !== requiredBuffer.length) return false;
    return timingSafeEqual(providedBuffer, requiredBuffer);
}

/**
 * Optional shared-token guard for the metrics endpoint. Metrics expose
 * operational/capacity signals (semaphore queue depth, event-loop lag,
 * memory) - not secrets, but enough to help time a load-based attack, so
 * this is worth gating in production even though it isn't a credentials
 * leak.
 *
 * If METRICS_ACCESS_TOKEN is unset, access is left open (matching the
 * existing /health endpoint's unauthenticated behavior, and preserving
 * local/dev zero-config use) but a one-time startup-path warning is logged
 * so this isn't a silent gap. Set METRICS_ACCESS_TOKEN and send it as
 * `Authorization: Bearer <token>` to restrict access.
 */
export function metricsAuth(
    req: Request,
    _res: Response,
    next: NextFunction
): void {
    const requiredToken = process.env.METRICS_ACCESS_TOKEN;
    if (!requiredToken) {
        if (!warnedUnprotected) {
            warnedUnprotected = true;
            logger.warn(
                "METRICS_ACCESS_TOKEN is not set - /api/v1/health/metrics is "
                + "unauthenticated. Set METRICS_ACCESS_TOKEN in production to "
                + "restrict access."
            );
        }
        next();
        return;
    }

    const header = req.get("authorization") ?? "";
    const providedToken = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!providedToken || !tokensMatch(providedToken, requiredToken)) {
        next(new ApiError(401, "Unauthorized."));
        return;
    }
    next();
}
