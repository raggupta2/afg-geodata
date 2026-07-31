type CacheEntry<Value> = {
    expiresAt: number;
    value: Value;
};

export class BoundedAsyncTtlCache<Value> {
    private readonly entries = new Map<string, CacheEntry<Value>>();
    private readonly pending = new Map<string, Promise<Value>>();

    constructor(
        private readonly ttlMs: number,
        private readonly maxEntries: number
    ) {
        if (ttlMs <= 0 || maxEntries <= 0) {
            throw new RangeError("Cache TTL and maximum entries must be positive.");
        }
    }

    async getOrLoad(key: string, loader: () => Promise<Value>): Promise<Value> {
        const now = Date.now();
        const existing = this.entries.get(key);
        if (existing && existing.expiresAt > now) {
            // Refresh insertion order so eviction behaves like a small LRU.
            this.entries.delete(key);
            this.entries.set(key, existing);
            return existing.value;
        }
        if (existing) this.entries.delete(key);

        const inFlight = this.pending.get(key);
        if (inFlight) return inFlight;

        const promise = loader()
            .then(value => {
                this.set(key, value);
                return value;
            })
            .finally(() => {
                this.pending.delete(key);
            });
        this.pending.set(key, promise);
        return promise;
    }

    clear(): void {
        this.entries.clear();
    }

    private set(key: string, value: Value): void {
        if (this.entries.has(key)) this.entries.delete(key);
        this.entries.set(key, {
            expiresAt: Date.now() + this.ttlMs,
            value
        });

        while (this.entries.size > this.maxEntries) {
            const oldestKey = this.entries.keys().next().value;
            if (oldestKey === undefined) break;
            this.entries.delete(oldestKey);
        }
    }
}
