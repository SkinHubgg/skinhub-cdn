/**
 * The fetch layer, exercised with an injected `fetch` — no network.
 *
 * The 404 case reproduces what the live origin actually does: a Cloudflare **HTML** page with a
 * `text/html` content type. That is the shape that turns into a confusing `SyntaxError` if the code
 * parses before it checks the status, so it gets its own test rather than a generic `500`.
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import { clearDefaultCache, createMemoryCache } from '../src/cache.js'
import { configureCdn } from '../src/config.js'
import { CdnError, isCdnError } from '../src/errors.js'
import { fetchCdnData, fetchCdnJson, type FetchLike, inFlightCount } from '../src/fetch.js'
import { fetchGloves } from '../src/datasets/gloves.js'

const ORIGIN = 'https://test.invalid'

const json = (body: unknown, init: ResponseInit = {}) =>
	new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })

/** What cdn.skinhub.gg returned for `data/skins.json` on 2026-08-08 while the bucket was uploading. */
const cloudflare404 = () =>
	new Response('<!doctype html><html><head><title>Not Found</title></head><body>404</body></html>', {
		status: 404,
		statusText: 'Not Found',
		headers: { 'content-type': 'text/html' },
	})

type Recorded = { url: string; init?: RequestInit | undefined }

const recorder = (handler: (url: string) => Response | Promise<Response>) => {
	const calls: Recorded[] = []
	const fetch: FetchLike = async (url, init) => {
		calls.push({ url, init })
		return handler(url)
	}
	return { fetch, calls }
}

beforeEach(() => {
	clearDefaultCache()
	configureCdn({ origin: undefined })
})

describe('fetchCdnData', () => {
	test('hits data/<file> on the resolved origin and parses JSON', async () => {
		const { fetch, calls } = recorder(() => json([{ paint: '1' }]))
		const result = await fetchCdnData<{ paint: string }[]>('gloves.json', { origin: ORIGIN, fetch, cache: false })

		expect(result).toEqual([{ paint: '1' }])
		expect(calls[0]?.url).toBe(`${ORIGIN}/data/gloves.json`)
	})

	test('sends cache: no-cache so a renamed-in-place export is actually seen', async () => {
		const { fetch, calls } = recorder(() => json([]))
		await fetchCdnData('gloves.json', { origin: ORIGIN, fetch, cache: false })
		expect(calls[0]?.init?.cache).toBe('no-cache')
	})

	test('init overrides the defaults', async () => {
		const { fetch, calls } = recorder(() => json([]))
		await fetchCdnData('gloves.json', {
			origin: ORIGIN,
			fetch,
			cache: false,
			init: { cache: 'reload', headers: { 'x-test': '1' } },
		})
		expect(calls[0]?.init?.cache).toBe('reload')
		expect(calls[0]?.init?.headers).toEqual({ 'x-test': '1' })
	})
})

/** Awaits a rejection and narrows it, so the assertions below are typed rather than `unknown`. */
const rejection = async (promise: Promise<unknown>): Promise<CdnError> => {
	try {
		await promise
	} catch (error) {
		if (isCdnError(error)) return error
		throw new Error(`expected a CdnError, got ${String(error)}`)
	}
	throw new Error('expected the promise to reject, but it resolved')
}

describe('errors', () => {
	test('an HTML 404 is an HTTP error, not a JSON parse error', async () => {
		const { fetch } = recorder(cloudflare404)
		const error = await rejection(fetchCdnData('skins.json', { origin: ORIGIN, fetch, cache: false }))

		expect(error).toBeInstanceOf(CdnError)
		expect(error.status).toBe(404)
		expect(error.contentType).toBe('text/html')
		expect(error.url).toBe(`${ORIGIN}/data/skins.json`)
		expect(error.message).toContain('HTTP 404')
		expect(error.message).not.toContain('JSON')
	})

	test('a 200 that is not JSON says so, and keeps the content type', async () => {
		const { fetch } = recorder(() => new Response('not json', { headers: { 'content-type': 'text/plain' } }))
		const error = await rejection(fetchCdnData('skins.json', { origin: ORIGIN, fetch, cache: false }))

		expect(error.status).toBe(200)
		expect(error.contentType).toBe('text/plain')
		expect(error.message).toContain('not JSON')
	})

	test('a transport failure is wrapped with the url and no status', async () => {
		const fetch: FetchLike = async () => {
			throw new Error('getaddrinfo ENOTFOUND')
		}
		const error = await rejection(fetchCdnData('skins.json', { origin: ORIGIN, fetch, cache: false }))

		expect(error.status).toBeUndefined()
		expect(error.url).toBe(`${ORIGIN}/data/skins.json`)
		expect(error.message).toContain('ENOTFOUND')
	})

	test('throws when there is no fallback', async () => {
		const { fetch } = recorder(cloudflare404)
		expect(fetchCdnData('skins.json', { origin: ORIGIN, fetch, cache: false })).rejects.toThrow(CdnError)
	})
})

describe('fallback', () => {
	test('is returned instead of throwing, and the error is reported', async () => {
		const { fetch } = recorder(cloudflare404)
		const seen: CdnError[] = []
		const offline = [{ weapon_defindex: 0, paint: 0, image: '', paint_name: 'Gloves | Default' }]

		const result = await fetchGloves({
			origin: ORIGIN,
			fetch,
			cache: false,
			fallback: offline,
			onError: e => seen.push(e),
		})

		expect(result).toBe(offline)
		expect(seen).toHaveLength(1)
		expect(seen[0]?.status).toBe(404)
	})

	test('a fallback is not cached, so the next call retries the CDN', async () => {
		let attempt = 0
		const cache = createMemoryCache()
		const fetch: FetchLike = async () => (attempt++ === 0 ? cloudflare404() : json([{ ok: true }]))

		const first = await fetchCdnData('skins.json', {
			origin: ORIGIN,
			fetch,
			cache,
			fallback: [{ ok: false }],
			onError: () => {},
		})
		expect(first).toEqual([{ ok: false }])

		const second = await fetchCdnData('skins.json', { origin: ORIGIN, fetch, cache, onError: () => {} })
		expect(second).toEqual([{ ok: true }])
	})
})

describe('caching', () => {
	test('the default cache serves the second call without a request', async () => {
		const { fetch, calls } = recorder(() => json([1, 2, 3]))
		await fetchCdnData('music.json', { origin: ORIGIN, fetch })
		await fetchCdnData('music.json', { origin: ORIGIN, fetch })
		expect(calls).toHaveLength(1)
	})

	test('cache: false always refetches', async () => {
		const { fetch, calls } = recorder(() => json([1]))
		await fetchCdnData('music.json', { origin: ORIGIN, fetch, cache: false })
		await fetchCdnData('music.json', { origin: ORIGIN, fetch, cache: false })
		expect(calls).toHaveLength(2)
	})

	test('different origins are different cache entries', async () => {
		const { fetch, calls } = recorder(url => json([url]))
		const a = await fetchCdnData('music.json', { origin: 'https://a.invalid', fetch })
		const b = await fetchCdnData('music.json', { origin: 'https://b.invalid', fetch })
		expect(a).not.toEqual(b)
		expect(calls).toHaveLength(2)
	})

	test('an injected async cache is used for both get and set — the Redis shape', async () => {
		const store = new Map<string, string>()
		const redisLike = {
			get: async (key: string) => {
				const raw = store.get(key)
				return raw === undefined ? undefined : JSON.parse(raw)
			},
			set: async (key: string, value: unknown) => {
				store.set(key, JSON.stringify(value))
			},
		}

		const { fetch, calls } = recorder(() => json({ from: 'cdn' }))
		await fetchCdnData('music.json', { origin: ORIGIN, fetch, cache: redisLike })
		expect(store.size).toBe(1)

		const second = await fetchCdnData('music.json', { origin: ORIGIN, fetch, cache: redisLike })
		expect(second).toEqual({ from: 'cdn' })
		expect(calls).toHaveLength(1)
	})

	test('an expired entry is refetched', async () => {
		const cache = createMemoryCache({ ttlMs: 1 })
		const { fetch, calls } = recorder(() => json([1]))
		await fetchCdnData('music.json', { origin: ORIGIN, fetch, cache, ttlMs: 1 })
		await Bun.sleep(5)
		await fetchCdnData('music.json', { origin: ORIGIN, fetch, cache, ttlMs: 1 })
		expect(calls).toHaveLength(2)
	})

	test('the memory cache evicts past its cap, oldest first', () => {
		const cache = createMemoryCache({ max: 2 })
		cache.set('a', 1, 60_000)
		cache.set('b', 2, 60_000)
		cache.set('c', 3, 60_000)
		expect(cache.size).toBe(2)
		expect(cache.get('a')).toBeUndefined()
		expect(cache.get('c')).toBe(3)
	})
})

describe('request dedupe', () => {
	test('concurrent calls for the same file cost one request', async () => {
		let resolve: ((r: Response) => void) | undefined
		const gate = new Promise<Response>(r => {
			resolve = r
		})
		const calls: string[] = []
		const fetch: FetchLike = async url => {
			calls.push(url)
			return gate
		}

		const all = Promise.all([
			fetchCdnData('skins.json', { origin: ORIGIN, fetch, cache: false }),
			fetchCdnData('skins.json', { origin: ORIGIN, fetch, cache: false }),
			fetchCdnData('skins.json', { origin: ORIGIN, fetch, cache: false }),
		])

		expect(inFlightCount()).toBe(1)
		resolve?.(json([{ id: 'skin-1' }]))

		const [a, b, c] = await all
		expect(calls).toHaveLength(1)
		expect(a).toEqual(b)
		expect(b).toEqual(c)
		expect(inFlightCount()).toBe(0)
	})

	test('the in-flight entry is released after a failure', async () => {
		const { fetch } = recorder(cloudflare404)
		await fetchCdnData('skins.json', { origin: ORIGIN, fetch, cache: false }).catch(() => {})
		expect(inFlightCount()).toBe(0)
	})
})

describe('fetchCdnJson', () => {
	test('reads a path from the CDN root, not from data/', async () => {
		const { fetch, calls } = recorder(() => json({ '0': { kit: 'default' } }))
		await fetchCdnJson('manifest.json', { origin: ORIGIN, fetch, cache: false })
		expect(calls[0]?.url).toBe(`${ORIGIN}/manifest.json`)
	})
})
