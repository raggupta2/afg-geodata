const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createRateLimiter } = require("../dist/middleware/rate-limiter");

// Minimal Express-shaped req/res doubles - the middleware only reads req.ip
// and calls next(), so nothing heavier (no real HTTP, no app boot) is
// needed to exercise it deterministically.
function fakeReq(ip) {
    return { ip };
}

function callLimiter(limiter, ip) {
    let calledWith;
    limiter(fakeReq(ip), {}, error => {
        calledWith = error;
    });
    return calledWith;
}

test("allows requests within the configured limit", () => {
    const limiter = createRateLimiter({
        windowMs: 60_000,
        maxRequests: 3,
        busyMessage: "busy"
    });

    assert.equal(callLimiter(limiter, "1.1.1.1"), undefined);
    assert.equal(callLimiter(limiter, "1.1.1.1"), undefined);
    assert.equal(callLimiter(limiter, "1.1.1.1"), undefined);
});

test("rejects the request that exceeds the limit within the window with a 429", () => {
    const limiter = createRateLimiter({
        windowMs: 60_000,
        maxRequests: 2,
        busyMessage: "Too many requests, slow down."
    });

    assert.equal(callLimiter(limiter, "2.2.2.2"), undefined);
    assert.equal(callLimiter(limiter, "2.2.2.2"), undefined);

    const error = callLimiter(limiter, "2.2.2.2");
    assert.ok(error, "the third request in the window must be rejected");
    assert.equal(error.statusCode, 429);
    assert.equal(error.message, "Too many requests, slow down.");
});

test("tracks each client IP independently", () => {
    const limiter = createRateLimiter({
        windowMs: 60_000,
        maxRequests: 1,
        busyMessage: "busy"
    });

    assert.equal(callLimiter(limiter, "3.3.3.3"), undefined);
    assert.ok(callLimiter(limiter, "3.3.3.3"), "second request from the same IP must be rejected");
    assert.equal(
        callLimiter(limiter, "4.4.4.4"),
        undefined,
        "a different IP must have its own, unaffected budget"
    );
});

test("resets the window using an injected clock, without real timers", () => {
    let now = 0;
    const limiter = createRateLimiter({
        windowMs: 1_000,
        maxRequests: 1,
        busyMessage: "busy",
        now: () => now
    });

    assert.equal(callLimiter(limiter, "5.5.5.5"), undefined);
    assert.ok(callLimiter(limiter, "5.5.5.5"), "second request in the same window must be rejected");

    now += 1_000;
    assert.equal(
        callLimiter(limiter, "5.5.5.5"),
        undefined,
        "a request in a new window must be allowed again"
    );
});

test("evicts the oldest tracked client once maxTrackedClients is exceeded", () => {
    const limiter = createRateLimiter({
        windowMs: 60_000,
        maxRequests: 1,
        busyMessage: "busy",
        maxTrackedClients: 2
    });

    assert.equal(callLimiter(limiter, "10.0.0.1"), undefined);
    assert.equal(callLimiter(limiter, "10.0.0.2"), undefined);
    // Third distinct client evicts the oldest (10.0.0.1) to stay bounded.
    assert.equal(callLimiter(limiter, "10.0.0.3"), undefined);

    // 10.0.0.1 was evicted, so it is treated as a fresh client again, not
    // as still being inside its original (now-forgotten) window.
    assert.equal(
        callLimiter(limiter, "10.0.0.1"),
        undefined,
        "an evicted client's next request must be treated as a fresh window"
    );
});
