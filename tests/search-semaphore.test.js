const assert = require("node:assert/strict");
const { test } = require("node:test");
const { SearchSemaphore } = require("../dist/utils/search-semaphore");

// Deterministic, non-timer control over when a queued task "finishes" -
// avoids flaky wall-clock-dependent assertions entirely.
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

// Lets already-scheduled microtasks (semaphore bookkeeping) run without
// resolving anything, so we can assert "has not started yet" reliably.
async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

test("a search runs immediately when capacity is available", async () => {
    const semaphore = new SearchSemaphore(2, 5, "busy");
    const result = await semaphore.run(async () => "ok");
    assert.equal(result, "ok");
});

test("additional searches wait when active capacity is exhausted", async () => {
    const semaphore = new SearchSemaphore(1, 5, "busy");
    const first = deferred();
    let secondStarted = false;

    const firstRun = semaphore.run(() => first.promise);
    const secondRun = semaphore.run(async () => {
        secondStarted = true;
        return "second";
    });

    await flushMicrotasks();
    assert.equal(
        secondStarted,
        false,
        "second task must not start while the only slot is held"
    );

    first.resolve("first");
    const [firstResult, secondResult] = await Promise.all([firstRun, secondRun]);
    assert.equal(firstResult, "first");
    assert.equal(secondResult, "second");
    assert.equal(secondStarted, true);
});

test("requests beyond the queue limit are rejected immediately with a 503", async () => {
    const semaphore = new SearchSemaphore(1, 1, "The search service is busy. Please retry shortly.");
    const active = deferred();
    const queued = deferred();

    // Occupies the single active slot.
    const activeRun = semaphore.run(() => active.promise);
    await flushMicrotasks();

    // Occupies the single queue slot (does not run yet).
    const queuedRun = semaphore.run(() => queued.promise);
    await flushMicrotasks();

    // The queue is now full: this caller must be rejected immediately,
    // not silently dropped and not left waiting.
    await assert.rejects(
        () => semaphore.run(async () => "should never run"),
        error => {
            assert.equal(error.statusCode, 503);
            assert.equal(
                error.message,
                "The search service is busy. Please retry shortly."
            );
            return true;
        }
    );

    // Clean up the two in-flight calls so they don't leak into other tests.
    active.resolve("active");
    queued.resolve("queued");
    await Promise.all([activeRun, queuedRun]);
});

test("a successful search releases its slot for the next caller", async () => {
    const semaphore = new SearchSemaphore(1, 5, "busy");
    const firstResult = await semaphore.run(async () => "first");
    assert.equal(firstResult, "first");

    // If the slot were not released, this would hang forever (and the test
    // runner would time out) instead of resolving.
    const secondResult = await semaphore.run(async () => "second");
    assert.equal(secondResult, "second");
});

test("a failed/throwing search releases its slot for the next caller", async () => {
    const semaphore = new SearchSemaphore(1, 5, "busy");

    await assert.rejects(
        () => semaphore.run(async () => {
            throw new Error("search blew up");
        }),
        /search blew up/
    );

    // The failed run above must have released the slot via try/finally.
    const result = await semaphore.run(async () => "recovered");
    assert.equal(result, "recovered");
});

test("a waiting request eventually executes once a slot becomes available", async () => {
    const semaphore = new SearchSemaphore(1, 5, "busy");
    const first = deferred();

    const firstRun = semaphore.run(() => first.promise);
    const secondRun = semaphore.run(async () => "second ran");

    await flushMicrotasks();
    first.resolve("first ran");

    const [firstResult, secondResult] = await Promise.all([firstRun, secondRun]);
    assert.equal(firstResult, "first ran");
    assert.equal(secondResult, "second ran");
});

test("no request can permanently deadlock the queue across repeated cycles", async () => {
    const semaphore = new SearchSemaphore(1, 5, "busy");
    const results = [];

    for (let index = 0; index < 5; index += 1) {
        // Mixes successful and throwing runs; every one must still release
        // its slot so the next sequential caller is never stuck waiting.
        if (index === 2) {
            await assert.rejects(
                () => semaphore.run(async () => {
                    throw new Error(`cycle ${index} failed`);
                })
            );
            continue;
        }
        results.push(await semaphore.run(async () => `cycle ${index}`));
    }

    assert.deepEqual(results, ["cycle 0", "cycle 1", "cycle 3", "cycle 4"]);
});

test("the configured maximum active count is never exceeded under a burst of callers", async () => {
    const maximum = 2;
    const semaphore = new SearchSemaphore(maximum, 10, "busy");
    let activeCount = 0;
    let peakActiveCount = 0;
    const gates = Array.from({ length: 6 }, () => deferred());

    const runs = gates.map((gate, index) => semaphore.run(async () => {
        activeCount += 1;
        peakActiveCount = Math.max(peakActiveCount, activeCount);
        assert.ok(
            activeCount <= maximum,
            `active count ${activeCount} exceeded configured maximum ${maximum}`
        );
        await gate.promise;
        activeCount -= 1;
        return `task ${index}`;
    }));

    // All 6 callers are already contending for only `maximum` slots at this
    // point (the .map above ran synchronously before any gate resolved).
    // Resolving every gate now only lets each task finish *once it has
    // actually acquired a slot* - the semaphore's own internal queue is what
    // decides when that happens, not the order gates are resolved in - so
    // this does not weaken the over-subscription exercised above, and it
    // avoids any dependency on exact microtask-timing between releases.
    gates.forEach(gate => gate.resolve());

    const results = await Promise.all(runs);
    assert.deepEqual(
        results,
        gates.map((_, index) => `task ${index}`)
    );
    assert.ok(
        peakActiveCount <= maximum,
        `observed peak active count ${peakActiveCount} exceeded configured maximum ${maximum}`
    );
    assert.equal(activeCount, 0, "all tasks must have released their slot");
});
