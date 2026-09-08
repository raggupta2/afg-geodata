const assert = require("node:assert/strict");
const { test } = require("node:test");
const { metricsAuth } = require("../dist/middleware/metrics-auth");
const {
    currentMetricsSnapshot,
    registerSemaphoreMetrics
} = require("../dist/observability/metrics");

function fakeReq(headers = {}) {
    return {
        get(name) {
            return headers[name.toLowerCase()];
        }
    };
}

function callAuth(req) {
    let calledWith = "not-called";
    metricsAuth(req, {}, error => {
        calledWith = error;
    });
    return calledWith;
}

function withMetricsAccessToken(value, run) {
    const original = process.env.METRICS_ACCESS_TOKEN;
    if (value === undefined) delete process.env.METRICS_ACCESS_TOKEN;
    else process.env.METRICS_ACCESS_TOKEN = value;
    try {
        run();
    } finally {
        if (original === undefined) delete process.env.METRICS_ACCESS_TOKEN;
        else process.env.METRICS_ACCESS_TOKEN = original;
    }
}

test("metrics endpoint is open when METRICS_ACCESS_TOKEN is unset", () => {
    withMetricsAccessToken(undefined, () => {
        assert.equal(callAuth(fakeReq()), undefined);
    });
});

test("metrics endpoint rejects requests without a valid token when METRICS_ACCESS_TOKEN is set", () => {
    withMetricsAccessToken("secret-token", () => {
        const noHeader = callAuth(fakeReq());
        assert.ok(noHeader, "a request with no Authorization header must be rejected");
        assert.equal(noHeader.statusCode, 401);

        const wrongToken = callAuth(fakeReq({ authorization: "Bearer wrong" }));
        assert.ok(wrongToken, "a request with the wrong token must be rejected");
        assert.equal(wrongToken.statusCode, 401);
    });
});

test("metrics endpoint allows requests with the correct token", () => {
    withMetricsAccessToken("secret-token", () => {
        const result = callAuth(fakeReq({ authorization: "Bearer secret-token" }));
        assert.equal(result, undefined);
    });
});

test("currentMetricsSnapshot reports pid, cluster config, and per-semaphore stats", () => {
    registerSemaphoreMetrics("test-engine", () => ({ active: 1, queued: 2 }));
    const snapshot = currentMetricsSnapshot();

    assert.equal(snapshot.pid, process.pid);
    assert.equal(typeof snapshot.configuredClusterWorkers, "number");
    assert.deepEqual(snapshot.semaphores["test-engine"], { active: 1, queued: 2 });
    assert.equal(typeof snapshot.eventLoop.meanMs, "number");
    assert.equal(typeof snapshot.database.queryCountLastMinute, "number");
    assert.ok(snapshot.memory.heapUsed > 0);
});
