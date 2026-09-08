import { ApiError } from "../errors/api.error";

/**
 * Bounded admission control for expensive, CPU-heavy search work. At most
 * `maximum` calls to `run()` execute their task concurrently; additional
 * callers wait in a FIFO queue capped at `maxQueued`. Once that queue is
 * full, further callers are rejected immediately with a 503 instead of
 * growing the queue without bound. Slots are always released via
 * try/finally, including when the task throws or rejects.
 *
 * Shared by railway-provider.service.ts and multimodal-journey.service.ts -
 * each keeps its own instance/capacity so one search type can never starve
 * the other out of admission.
 */
export class SearchSemaphore {
    private active = 0;
    private readonly queue: Array<() => void> = [];

    constructor(
        private readonly maximum: number,
        private readonly maxQueued: number,
        private readonly busyMessage: string
    ) {}

    /** Currently executing task count - for observability only, not a lock. */
    get activeCount(): number {
        return this.active;
    }

    /** Currently waiting caller count - for observability only, not a lock. */
    get queuedCount(): number {
        return this.queue.length;
    }

    async run<Value>(task: () => Promise<Value>): Promise<Value> {
        if (this.active >= this.maximum) {
            if (this.queue.length >= this.maxQueued) {
                throw new ApiError(503, this.busyMessage);
            }
            await new Promise<void>(resolve => this.queue.push(resolve));
        }

        this.active += 1;
        try {
            return await task();
        } finally {
            this.active -= 1;
            this.queue.shift()?.();
        }
    }
}
