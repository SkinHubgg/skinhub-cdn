/**
 * The one fetch every dataset goes through.
 *
 * This generalises `fetchGameData(file, fallback, label)` from the API it replaces. Three things
 * carried over from that code because each was there for a measured reason, and three that changed.
 *
 * Carried over:
 *   - **`cache: 'no-cache'`.** `data/*.json` keeps the same filename across every export, and the
 *     origin serves it `public, max-age=60, stale-while-revalidate=300` (measured 2026-08-08), so
 *     a plain `fetch` can serve a heuristically-fresh copy and never see a new export. `no-cache`
 *     forces a conditional request and reuses the cached body on a 304 — one round trip, no
 *     payload.
 *   - **`response.ok` before `response.json()`.** A missing key comes back as a Cloudflare *HTML*
 *     page; parsing it first turns a 404 into a syntax error. See `errors.ts`.
 *   - **An optional fallback.** A consumer that cannot start without the data can supply its own
 *     copy and keep the CDN off its critical path.
 *
 * Changed:
 *   - **Throws by default.** The original always swallowed the failure into `console.warn` because
 *     it always had a fallback to fall back to. Here a fallback is optional, and silently returning
 *     nothing is not an option, so no fallback means the error propagates.
 *   - **Caching is injected, not assumed.** See `cache.ts`.
 *   - **Concurrent calls for the same URL share one request.** Two components asking for
 *     `skins.json` on the same tick should cost one 4.2 MB download, not two.
 */

import { type CdnCache, getDefaultCache } from './cache.js'
import { cdnUrl, dataUrl } from './config.js'
import { CdnError } from './errors.js'

/** Anything call-compatible with `fetch`. Lets a caller pass an instrumented or mocked one. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type CdnFetchOptions<T = unknown> = {
	/** Overrides the configured origin for this call only. */
	origin?: string
	/** Returned instead of throwing when the fetch or the parse fails. */
	fallback?: T
	/** `false` disables caching entirely. Omit for the shared in-memory cache. */
	cache?: CdnCache | false
	/** Defaults to the resolved URL. Override when several origins share one store. */
	cacheKey?: string
	/** How long a cached entry stays fresh. Default 1 hour. */
	ttlMs?: number
	/** Injected `fetch`. Defaults to the global one. */
	fetch?: FetchLike
	/** Abort the request. */
	signal?: AbortSignal
	/** Merged into the `RequestInit`; wins over the defaults this module sets. */
	init?: RequestInit
	/** Called when a `fallback` absorbs an error, so the failure is still visible. */
	onError?: (error: CdnError) => void
}

/** What a dataset helper takes. Same bag — named separately so the helpers read cleanly. */
export type DatasetOptions<T> = CdnFetchOptions<T>

const inFlight = new Map<string, Promise<unknown>>()

const request = async <T>(url: string, options: CdnFetchOptions<T>): Promise<T> => {
	const doFetch: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init))

	let response: Response
	try {
		response = await doFetch(url, {
			// A conditional request rather than a heuristically-fresh disk copy — see the header note.
			cache: 'no-cache',
			...(options.signal ? { signal: options.signal } : {}),
			...options.init,
		})
	} catch (cause) {
		throw new CdnError(`${url} — ${cause instanceof Error ? cause.message : 'request failed'}`, { url, cause })
	}

	const contentType = response.headers.get('content-type') ?? undefined

	if (!response.ok) {
		throw new CdnError(`${url} — HTTP ${response.status} ${response.statusText}`.trimEnd(), {
			url,
			status: response.status,
			contentType,
		})
	}

	try {
		return (await response.json()) as T
	} catch (cause) {
		throw new CdnError(
			`${url} — HTTP ${response.status} but the body is not JSON (content-type: ${contentType ?? 'none'})`,
			{ url, status: response.status, contentType, cause },
		)
	}
}

const load = async <T>(url: string, options: CdnFetchOptions<T>): Promise<T> => {
	const cache = options.cache === false ? undefined : (options.cache ?? getDefaultCache())
	const key = options.cacheKey ?? url

	try {
		if (cache) {
			const hit = await cache.get(key)
			if (hit !== undefined) return hit as T
		}

		const pending = inFlight.get(key) as Promise<T> | undefined
		if (pending) return await pending

		const started = (async () => {
			try {
				const value = await request<T>(url, options)
				if (cache) await cache.set(key, value, options.ttlMs ?? 0)
				return value
			} finally {
				inFlight.delete(key)
			}
		})()

		inFlight.set(key, started)
		return await started
	} catch (error) {
		if (options.fallback === undefined) throw error

		const cdnError =
			error instanceof CdnError
				? error
				: new CdnError(error instanceof Error ? error.message : String(error), { url, cause: error })

		if (options.onError) options.onError(cdnError)
		else console.warn(`[@skinhub/cdn] ${cdnError.message} — using fallback`)

		return options.fallback
	}
}

/**
 * Fetch and parse any JSON on the CDN, by path from the root.
 *
 * `fetchCdnJson('manifest.json')` and `fetchCdnJson('data/skins.json')` both work.
 */
export const fetchCdnJson = <T>(path: string, options: CdnFetchOptions<T> = {}): Promise<T> =>
	load<T>(cdnUrl(path, options.origin), options)

/**
 * Fetch one of the `data/*.json` lists. Every dataset helper is one call to this.
 *
 * Exported because the eight files this package knows about are not a closed set — the exporter can
 * publish another one tomorrow, and a consumer should be able to read it without waiting for a
 * release here.
 */
export const fetchCdnData = <T>(file: string, options: DatasetOptions<T> = {}): Promise<T> =>
	load<T>(dataUrl(file, options.origin), options)

/** Requests currently in flight. A test hook for the dedupe above. */
export const inFlightCount = () => inFlight.size
