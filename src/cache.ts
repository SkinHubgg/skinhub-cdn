/**
 * Caching belongs to the caller.
 *
 * The code this package generalises hardwired Redis with a one-day TTL plus an in-process memo. A
 * library cannot make that choice: a Next.js route wants the framework's own cache, an Elysia
 * server wants the Redis it already has, a browser wants nothing at all and a script wants the
 * fetch to happen exactly once. So the surface is an interface with two methods and a default that
 * works with no configuration.
 *
 * Adapters are three lines each — see the README for Redis and for `unstable_cache`.
 */

export interface CdnCache {
	/** Return the cached value, or `undefined` on a miss. May be async. */
	get(key: string): unknown | undefined | Promise<unknown | undefined>
	/** Store a value. `ttlMs` is advisory; a store without TTLs may ignore it. May be async. */
	set(key: string, value: unknown, ttlMs: number): void | Promise<void>
	/** Optional — only used by `clearMemoryCache`-style helpers and by tests. */
	delete?(key: string): void | Promise<void>
}

export type MemoryCacheOptions = {
	/** Entries older than this are treated as a miss. Default 1 hour. */
	ttlMs?: number
	/** Hard cap on entries; the oldest insert is dropped first. Default 32. */
	max?: number
}

export type MemoryCache = CdnCache & {
	delete(key: string): void
	clear(): void
	readonly size: number
}

export const DEFAULT_TTL_MS = 60 * 60 * 1000

/**
 * A `Map` with expiry and an insertion-order cap.
 *
 * The cap matters more than it looks: `stickers.json` is 5.5 MB parsed into 11,788 objects and
 * `items_game.json` is 6.5 MB. Eight datasets is the whole universe of keys, so 32 is generous —
 * it exists to stop an unbounded key space (say, one entry per `origin`) from becoming a leak.
 */
export const createMemoryCache = (options: MemoryCacheOptions = {}): MemoryCache => {
	const ttlDefault = options.ttlMs ?? DEFAULT_TTL_MS
	const max = options.max ?? 32
	const store = new Map<string, { value: unknown; expiresAt: number }>()

	return {
		get(key) {
			const entry = store.get(key)
			if (!entry) return undefined
			if (entry.expiresAt <= Date.now()) {
				store.delete(key)
				return undefined
			}
			return entry.value
		},
		set(key, value, ttlMs) {
			const ttl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : ttlDefault
			// Re-insert so the key moves to the end of the iteration order.
			store.delete(key)
			store.set(key, { value, expiresAt: Date.now() + ttl })
			while (store.size > max) {
				const oldest = store.keys().next()
				if (oldest.done) break
				store.delete(oldest.value)
			}
		},
		delete(key) {
			store.delete(key)
		},
		clear() {
			store.clear()
		},
		get size() {
			return store.size
		},
	}
}

/**
 * The cache used when a call passes no `cache` option.
 *
 * It is created lazily so that importing this module allocates nothing — the package is marked
 * `sideEffects: false` and that has to stay true.
 */
let shared: MemoryCache | undefined

export const getDefaultCache = (): MemoryCache => {
	shared ??= createMemoryCache()
	return shared
}

/** Drop everything the default cache is holding. Handy after an export, and in tests. */
export const clearDefaultCache = () => shared?.clear()
