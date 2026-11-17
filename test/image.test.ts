/**
 * `@skinhub/cdn/image` - the typed client for `api.skinhub.gg/image`.
 *
 * No network: every `fetchImage` call here gets an injected `fetch` that records the request and
 * answers with a canned `Response`. The canned headers and bodies are copied from RENDER.md ("The
 * response", "Errors are JSON, never an image") and from `apps/render/app.ts`, which writes them.
 */

import { describe, expect, test } from 'bun:test'
import type { FetchLike } from '../src/fetch.js'
import {
	fetchImage,
	IMAGE_ERROR_CODES,
	ImageError,
	type ImageOptions,
	imageUrl,
	isImageError,
	readImageError,
	readImageMeta,
	SKINHUB_IMAGE_BASE_URL,
} from '../src/image.js'
import * as barrel from '../src/index.js'
import {
	buildInspectUrl,
	emptySticker,
	makeSkinPlacement,
	makeStickerPlacement,
	readInspectUrl,
	type SkinPlacement,
} from '../src/inspect.js'

const KEY = 'sk_live_test_0123456789'

const searchOf = (url: string) => new URL(url).searchParams
const namesOf = (url: string) => [...searchOf(url).keys()]

/** An AK with two stickers and a charm - the configuration only `?i=` can carry. */
const decorated = (): SkinPlacement => ({
	defindex: 7,
	paintindex: 44,
	paintseed: 661,
	paintwear: 0.02,
	nametag: 'render test',
	stattrak: true,
	stattrak_count: 1337,
	stickers: [
		makeStickerPlacement({ slot: 0, sticker_id: 7691, wear: 0.25, rotation: 12, offset_x: 0.05, offset_y: -0.02 }),
		emptySticker(1),
		makeStickerPlacement({ slot: 2, sticker_id: 5032, wear: 0, rotation: -45, offset_x: -0.03, offset_y: 0.01 }),
		emptySticker(3),
		emptySticker(4),
	],
	keychain: { slot: 0, sticker_id: 21, offset_x: 1.5, offset_y: -2.25, offset_z: 0.125, pattern: 41, wrapped_sticker: 0 },
})

type Recorded = { url: string; headers: Headers }

/** A `fetch` that records what it was asked and answers with `respond()`. */
const fakeFetch = (respond: () => Response) => {
	const calls: Recorded[] = []
	const fetch: FetchLike = async (url, init) => {
		calls.push({ url, headers: new Headers(init?.headers) })
		return respond()
	}
	return { fetch, calls }
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** The headers RENDER.md quotes off a real AK render. */
const RENDERED_HEADERS = {
	'content-type': 'image/png',
	etag: '"43af3221b563a81d547b3d404c01b8df0455cbb62d9c8f748c3c06c4c9007301"',
	'cache-control': 'public, max-age=31536000, immutable',
	'x-skinhub-cache': 'miss',
	'x-skinhub-render-ms': '17866',
	'x-skinhub-coverage': '0.0567',
	'x-skinhub-timings': 'resolve=0 apply=3427 ready=8102 settle=2289 capture=3634 encode=3 total=17857',
	'x-skinhub-settle': 'identity=true ready=true probes=3 stable=true',
	'x-skinhub-renderer': 'r42',
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

/** Rejects with an `ImageError`, or fails the test. */
const caught = async (promise: Promise<unknown>): Promise<ImageError> => {
	try {
		await promise
	} catch (error) {
		if (error instanceof ImageError) return error
		throw error
	}
	throw new Error('expected an ImageError, got a result')
}

describe('imageUrl', () => {
	test("reproduces RENDER.md's first example byte for byte", () => {
		expect(imageUrl({ weapon: 'weapon_ak47', paint: 44, float: 0.02, seed: 661, w: 1024, h: 1024 })).toBe(
			'https://api.skinhub.gg/image?weapon=weapon_ak47&paint=44&float=0.02&seed=661&w=1024&h=1024',
		)
	})

	test('the order the options were written in does not change the URL', () => {
		// The edge cache keys on the exact URL string, so one picture must have one spelling.
		const a = imageUrl({ weapon: 'weapon_ak47', paint: 44, seed: 661, w: 512, format: 'webp', q: 0.9, side: 'right' })
		const b = imageUrl({ side: 'right', q: 0.9, format: 'webp', w: 512, seed: 661, paint: 44, weapon: 'weapon_ak47' })
		expect(a).toBe(b)
	})

	test('every typed option is written under its RENDER.md name, in one fixed order, key last', () => {
		const options: Required<Omit<ImageOptions, 'item' | 'baseUrl' | 'params'>> = {
			key: KEY,
			composite: 'half',
			scale: 'Balanced',
			shadows: true,
			aa: false,
			spill: 2,
			bloom: 0,
			rain: true,
			time: 'Day',
			map: 'Dust II',
			zoom: 1.25,
			fov: 30,
			pitch: -12,
			yaw: 20,
			side: 'right',
			trim: true,
			q: 0.9,
			format: 'webp',
			h: 768,
			w: 1024,
			legacy: true,
			nametag: 'hello',
			st: 1337,
			seed: 661,
			float: 0.02,
			i: 'ABCDEF',
			hash: 'AK-47 | Case Hardened',
			skin: 'case-hardened',
			paint: 44,
			weapon: 'ak-47',
		}
		const url = imageUrl(options)
		expect(namesOf(url)).toEqual([
			'weapon',
			'paint',
			'skin',
			'hash',
			'i',
			'float',
			'seed',
			'st',
			'nametag',
			'legacy',
			'w',
			'h',
			'format',
			'q',
			'trim',
			'side',
			'yaw',
			'pitch',
			'fov',
			'zoom',
			'map',
			'time',
			'rain',
			'bloom',
			'spill',
			'aa',
			'shadows',
			'scale',
			'composite',
			'key',
		])
		expect(Object.fromEntries(searchOf(url))).toEqual({
			weapon: 'ak-47',
			paint: '44',
			skin: 'case-hardened',
			hash: 'AK-47 | Case Hardened',
			i: 'ABCDEF',
			float: '0.02',
			seed: '661',
			st: '1337',
			nametag: 'hello',
			legacy: '1',
			w: '1024',
			h: '768',
			format: 'webp',
			q: '0.9',
			trim: '1',
			side: 'right',
			yaw: '20',
			pitch: '-12',
			fov: '30',
			zoom: '1.25',
			map: 'Dust II',
			time: 'Day',
			rain: '1',
			bloom: '0',
			spill: '2',
			aa: '0',
			shadows: '1',
			scale: 'Balanced',
			composite: 'half',
			key: KEY,
		})
	})

	test('a market hash name survives the trip, star and pipe included', () => {
		const hash = '★ StatTrak™ Karambit | Doppler (Factory New)'
		expect(searchOf(imageUrl({ hash, paint: 418 })).get('hash')).toBe(hash)
	})

	test('st=-1 and an empty nametag are real values and are written', () => {
		const url = imageUrl({ weapon: 'weapon_ak47', paint: 44, st: -1, nametag: '' })
		expect(searchOf(url).get('st')).toBe('-1')
		expect(searchOf(url).get('nametag')).toBe('')
	})

	test('an off-by-default flag passed as false is left out, so it shares the bare URL', () => {
		const bare = imageUrl({ weapon: 'weapon_ak47', paint: 44 })
		expect(imageUrl({ weapon: 'weapon_ak47', paint: 44, trim: false, rain: false, shadows: false })).toBe(bare)
		// `aa` is on by default and `legacy` has no documented default: both are written as given.
		expect(searchOf(imageUrl({ weapon: 'weapon_ak47', aa: false, legacy: false })).get('aa')).toBe('0')
		expect(searchOf(imageUrl({ weapon: 'weapon_ak47', aa: false, legacy: false })).get('legacy')).toBe('0')
		expect(searchOf(imageUrl({ weapon: 'weapon_ak47', aa: true })).get('aa')).toBe('1')
	})

	test('numbers are written in their shortest form', () => {
		const url = imageUrl({ weapon: 'weapon_ak47', float: 0.1 + 0.2, zoom: -0, pitch: 1e-7 })
		expect(searchOf(url).get('float')).toBe('0.30000000000000004')
		expect(searchOf(url).get('zoom')).toBe('0')
		expect(searchOf(url).get('pitch')).toBe('1e-7')
	})

	test('a non-finite number is refused rather than sent', () => {
		expect(() => imageUrl({ weapon: 'weapon_ak47', float: Number.NaN })).toThrow(RangeError)
		expect(() => imageUrl({ weapon: 'weapon_ak47', w: Number.POSITIVE_INFINITY })).toThrow(RangeError)
	})

	test('the base URL is overridable, keeps a path and loses trailing slashes', () => {
		expect(SKINHUB_IMAGE_BASE_URL).toBe('https://api.skinhub.gg')
		expect(imageUrl({})).toBe('https://api.skinhub.gg/image')
		expect(imageUrl({ weapon: 'weapon_ak47', baseUrl: 'http://localhost:3000/' })).toBe(
			'http://localhost:3000/image?weapon=weapon_ak47',
		)
		expect(imageUrl({ weapon: 'weapon_ak47', baseUrl: 'https://you.example/skinhub//' })).toBe(
			'https://you.example/skinhub/image?weapon=weapon_ak47',
		)
	})

	test('params pass the rest of the vocabulary through, sorted, after the typed ones', () => {
		const url = imageUrl({
			weapon: 'weapon_ak47',
			paint: 44,
			w: 1024,
			key: KEY,
			params: { view: 'agent', agent: 5036, glove: 'sporty_gloves:10038:0.06:420', skipped: undefined, also: null },
		})
		expect(namesOf(url)).toEqual(['weapon', 'paint', 'w', 'agent', 'glove', 'view', 'key'])
		expect(searchOf(url).get('glove')).toBe('sporty_gloves:10038:0.06:420')
	})

	test('params can set a typed name the options left unset, but not one they set', () => {
		expect(searchOf(imageUrl({ weapon: 'weapon_ak47', params: { map: 'Nuke' } })).get('map')).toBe('Nuke')
		expect(() => imageUrl({ weapon: 'weapon_ak47', map: 'Mirage', params: { map: 'Nuke' } })).toThrow(TypeError)
	})

	test('params refuses the key, which fetchImage would otherwise leak into the URL', () => {
		expect(() => imageUrl({ weapon: 'weapon_ak47', params: { key: KEY } })).toThrow(TypeError)
	})
})

describe('imageUrl with an item: stickers and a charm through the codec', () => {
	test('the item becomes ?i= as the bare hex of the package’s own inspect link', () => {
		const item = decorated()
		const i = searchOf(imageUrl({ item, w: 900, h: 900 })).get('i')
		expect(i).toMatch(/^[0-9A-F]+$/)
		const link = buildInspectUrl(item)
		expect(link.endsWith(`%20${i}`)).toBe(true)
	})

	test('decoding that hex gives back the stickers and the charm that went in', () => {
		const item = decorated()
		const i = searchOf(imageUrl({ item })).get('i') as string
		const decoded = readInspectUrl(i)

		expect(decoded).toEqual(makeSkinPlacement(item))
		expect(decoded.stickers.filter(sticker => sticker.sticker_id > 0).map(sticker => sticker.sticker_id)).toEqual([
			7691, 5032,
		])
		expect(decoded.stickers[0]?.offset_x).toBe(Math.fround(0.05))
		expect(decoded.stickers[2]?.rotation).toBe(-45)
		expect(decoded.keychain).toEqual({
			slot: 0,
			sticker_id: 21,
			offset_x: 1.5,
			offset_y: -2.25,
			offset_z: 0.125,
			pattern: 41,
			wrapped_sticker: 0,
		})
	})

	test('a charm alone on an otherwise bare weapon still goes through ?i=', () => {
		const item: SkinPlacement = {
			...decorated(),
			stickers: [0, 1, 2, 3, 4].map(emptySticker),
			keychain: { slot: 0, sticker_id: 3, offset_x: 0, offset_y: 0, offset_z: 0, pattern: 77, wrapped_sticker: 0 },
		}
		const decoded = readInspectUrl(searchOf(imageUrl({ item })).get('i') as string)
		expect(decoded.keychain?.sticker_id).toBe(3)
		expect(decoded.keychain?.pattern).toBe(77)
		expect(decoded.stickers.every(sticker => sticker.sticker_id === 0)).toBe(true)
	})

	test('a configure-only item (defindex 0) sits beside weapon/paint, which name the gun', () => {
		const item = { ...decorated(), defindex: 0, paintindex: 0 }
		const url = imageUrl({ weapon: 'weapon_ak47', paint: 44, item, float: 0.5 })
		expect(namesOf(url)).toEqual(['weapon', 'paint', 'i', 'float'])
		expect(readInspectUrl(searchOf(url).get('i') as string).defindex).toBe(0)
	})

	test('item and i together are refused - they are the same parameter', () => {
		expect(() => imageUrl({ item: decorated(), i: 'ABCDEF' })).toThrow(TypeError)
		expect(() => imageUrl({ item: decorated(), params: { i: 'ABCDEF' } })).toThrow(TypeError)
	})
})

describe('fetchImage', () => {
	test('sends the key as a bearer header and never in the URL', async () => {
		const { fetch, calls } = fakeFetch(() => new Response(PNG, { status: 200, headers: RENDERED_HEADERS }))
		const result = await fetchImage({ weapon: 'weapon_ak47', paint: 44, w: 512, key: KEY, fetch })

		expect(calls).toHaveLength(1)
		expect(calls[0]?.url).toBe('https://api.skinhub.gg/image?weapon=weapon_ak47&paint=44&w=512')
		expect(calls[0]?.url).not.toContain(KEY)
		expect(calls[0]?.headers.get('authorization')).toBe(`Bearer ${KEY}`)
		expect(calls[0]?.headers.has('if-none-match')).toBe(false)
		expect(result.url).not.toContain(KEY)
	})

	test('returns the bytes, the content type, the ETag and the x-skinhub report', async () => {
		const { fetch } = fakeFetch(() => new Response(PNG, { status: 200, headers: RENDERED_HEADERS }))
		const result = await fetchImage({ weapon: 'weapon_ak47', paint: 44, key: KEY, fetch })

		if (result.notModified) throw new Error('expected a 200')
		expect(result.status).toBe(200)
		expect([...result.bytes]).toEqual([...PNG])
		expect(result.contentType).toBe('image/png')
		expect(result.etag).toBe(RENDERED_HEADERS.etag)
		expect(result.cache).toBe('miss')
		expect(result.charged).toBe(true)
		expect(result.deterministic).toBe(true)
		expect(result.renderMs).toBe(17866)
		expect(result.coverage).toBe(0.0567)
		expect(result.timings).toEqual({
			resolve: 0,
			apply: 3427,
			ready: 8102,
			settle: 2289,
			capture: 3634,
			encode: 3,
			total: 17857,
		})
		expect(result.settle).toEqual({ identity: true, ready: true, probes: 3, stable: true })
		expect(result.problems).toEqual([])
		expect(result.renderer).toBe('r42')
		expect(result.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
	})

	test('keeps the caller’s own headers and passes the signal through', async () => {
		let seen: RequestInit | undefined
		const fetch: FetchLike = async (_url, init) => {
			seen = init
			return new Response(PNG, { status: 200, headers: RENDERED_HEADERS })
		}
		const controller = new AbortController()
		await fetchImage({
			weapon: 'weapon_ak47',
			key: KEY,
			fetch,
			signal: controller.signal,
			init: { headers: { 'x-request-id': 'abc' } },
		})
		const headers = new Headers(seen?.headers)
		expect(headers.get('x-request-id')).toBe('abc')
		expect(headers.get('authorization')).toBe(`Bearer ${KEY}`)
		expect(seen?.signal).toBe(controller.signal)
	})

	test('a cache hit and a coalesced answer are free; a bypass is a render', async () => {
		for (const [cache, charged] of [
			['hit', false],
			['coalesced', false],
			['bypass', true],
			['miss', true],
		] as const) {
			const { fetch } = fakeFetch(
				() => new Response(PNG, { status: 200, headers: { ...RENDERED_HEADERS, 'x-skinhub-cache': cache } }),
			)
			const result = await fetchImage({ weapon: 'weapon_ak47', key: KEY, fetch })
			expect({ cache: result.cache, charged: result.charged }).toEqual({ cache, charged })
		}
	})

	test('a weak ETag marks the picture as not deterministic', async () => {
		const { fetch } = fakeFetch(
			() =>
				new Response(PNG, {
					status: 200,
					headers: { ...RENDERED_HEADERS, etag: 'W/"abc"', 'cache-control': 'public, max-age=300' },
				}),
		)
		const result = await fetchImage({ params: { subject: 'agent', agent: 5036 }, key: KEY, fetch })
		expect(result.deterministic).toBe(false)
		expect(result.etag).toBe('W/"abc"')
	})

	test('If-None-Match goes out, and a 304 comes back as notModified with no bytes', async () => {
		const etag = RENDERED_HEADERS.etag
		const { fetch, calls } = fakeFetch(
			() =>
				new Response(null, {
					status: 304,
					headers: { etag, 'x-skinhub-cache': 'revalidated', 'x-skinhub-renderer': 'r42' },
				}),
		)
		const result = await fetchImage({ weapon: 'weapon_ak47', paint: 44, key: KEY, ifNoneMatch: etag, fetch })

		expect(calls[0]?.headers.get('if-none-match')).toBe(etag)
		expect(result.notModified).toBe(true)
		expect(result.status).toBe(304)
		expect(result.bytes).toBeNull()
		expect(result.etag).toBe(etag)
		expect(result.cache).toBe('revalidated')
		expect(result.charged).toBe(false)
	})

	test('a 304 without an ETag header keeps the one that was sent', async () => {
		const { fetch } = fakeFetch(() => new Response(null, { status: 304 }))
		const result = await fetchImage({ weapon: 'weapon_ak47', key: KEY, ifNoneMatch: '"x"', fetch })
		expect(result.etag).toBe('"x"')
	})

	test('problems on a successful render are split out of the header', async () => {
		const header =
			'?w= was given 2 times - only the first value was read | ?floatt=: no such parameter | ?sticker_1=: no such parameter'
		const { fetch } = fakeFetch(
			() => new Response(PNG, { status: 200, headers: { ...RENDERED_HEADERS, 'x-skinhub-problems': header } }),
		)
		const result = await fetchImage({ weapon: 'weapon_ak47', key: KEY, fetch })
		expect(result.problems).toEqual([
			'?w= was given 2 times - only the first value was read',
			'?floatt=: no such parameter',
			'?sticker_1=: no such parameter',
		])
	})
})

describe('errors', () => {
	test('the renderer’s nested shape: 503 busy with Retry-After', async () => {
		const { fetch } = fakeFetch(() =>
			json(
				503,
				{ error: { code: 'busy', message: 'every warm page is in use and the queue is full', problems: [] } },
				{ 'retry-after': '12' },
			),
		)
		const error = await caught(fetchImage({ weapon: 'weapon_ak47', key: KEY, fetch }))

		expect(isImageError(error)).toBe(true)
		expect(error.name).toBe('ImageError')
		expect(error.status).toBe(503)
		expect(error.code).toBe('busy')
		expect(error.detail).toBe('every warm page is in use and the queue is full')
		expect(error.retryAfter).toBe(12)
		expect(error.retryable).toBe(true)
		expect(error.problems).toEqual([])
		expect(error.message).toBe('HTTP 503 busy: every warm page is in use and the queue is full')
	})

	test('422 unknown-item carries the body’s problems', async () => {
		const { fetch } = fakeFetch(() =>
			json(422, {
				error: {
					code: 'unknown-item',
					message: 'No 3D model for weapon_notathing',
					problems: ['?floatt=: no such parameter'],
				},
			}),
		)
		const error = await caught(fetchImage({ weapon: 'weapon_notathing', key: KEY, fetch }))
		expect(error.code).toBe('unknown-item')
		expect(error.problems).toEqual(['?floatt=: no such parameter'])
		expect(error.retryable).toBe(false)
		expect(error.retryAfter).toBeUndefined()
	})

	test('a body with no problems falls back to the header', async () => {
		const response = json(
			400,
			{ error: { code: 'bad-request', message: '?q= applies to ?format=webp only - PNG is lossless' } },
			{ 'x-skinhub-problems': '?q=: needs format=webp' },
		)
		const error = await readImageError(response, 'https://api.skinhub.gg/image?q=0.5')
		expect(error.code).toBe('bad-request')
		expect(error.problems).toEqual(['?q=: needs format=webp'])
		expect(error.url).toBe('https://api.skinhub.gg/image?q=0.5')
	})

	test('the API’s flat shape: 401 api-key-invalid, and the key is nowhere in the error', async () => {
		const { fetch } = fakeFetch(() =>
			json(401, {
				code: 'api-key-invalid',
				message: 'That API key is not valid. It may have been rerolled - check https://skinhub.gg/client.',
			}),
		)
		const error = await caught(fetchImage({ weapon: 'weapon_ak47', key: KEY, fetch }))
		expect(error.status).toBe(401)
		expect(error.code).toBe('api-key-invalid')
		expect(error.problems).toEqual([])
		expect(error.retryable).toBe(false)
		for (const text of [error.message, error.url, String(error), JSON.stringify(error)]) {
			expect(text).not.toContain(KEY)
		}
	})

	test('402 out-of-credits is not retryable', async () => {
		const { fetch } = fakeFetch(() =>
			json(402, { code: 'out-of-credits', message: 'This account has no credits left.' }),
		)
		const error = await caught(fetchImage({ weapon: 'weapon_ak47', key: KEY, fetch }))
		expect(error.code).toBe('out-of-credits')
		expect(error.retryable).toBe(false)
	})

	test('429 rate-limited with Retry-After as an HTTP date', async () => {
		const at = new Date(Date.now() + 30_000).toUTCString()
		const { fetch } = fakeFetch(() =>
			json(429, { error: { code: 'rate-limited', message: 'too many renders from this caller', problems: [] } }, {
				'retry-after': at,
			}),
		)
		const error = await caught(fetchImage({ weapon: 'weapon_ak47', key: KEY, fetch }))
		expect(error.code).toBe('rate-limited')
		expect(error.retryable).toBe(true)
		expect(error.retryAfter).toBeGreaterThanOrEqual(28)
		expect(error.retryAfter).toBeLessThanOrEqual(31)
	})

	test('every documented code is read through as-is', async () => {
		const statuses: Record<(typeof IMAGE_ERROR_CODES)[number], number> = {
			'bad-request': 400,
			'api-key-required': 401,
			'api-key-invalid': 401,
			'out-of-credits': 402,
			'unknown-item': 422,
			blank: 422,
			'rate-limited': 429,
			busy: 503,
			overloaded: 503,
			timeout: 504,
			'render-failed': 500,
		}
		for (const code of IMAGE_ERROR_CODES) {
			const status = statuses[code]
			const error = await readImageError(json(status, { error: { code, message: code, problems: [] } }), 'u')
			expect({ code: error.code, status: error.status }).toEqual({ code, status })
			expect(error.retryable).toBe([429, 502, 503, 504].includes(status))
		}
	})

	test('a body that is not the endpoint’s JSON is unexpected-response, not a SyntaxError', async () => {
		const { fetch } = fakeFetch(
			() =>
				new Response('<html><body>502 Bad Gateway</body></html>', {
					status: 502,
					statusText: 'Bad Gateway',
					headers: { 'content-type': 'text/html' },
				}),
		)
		const error = await caught(fetchImage({ weapon: 'weapon_ak47', key: KEY, fetch }))
		expect(error.status).toBe(502)
		expect(error.code).toBe('unexpected-response')
		expect(error.detail).toContain('text/html')
		expect(error.retryable).toBe(true)
	})

	test('JSON without a code is unexpected-response too', async () => {
		const error = await readImageError(json(500, { ok: false }), 'u')
		expect(error.code).toBe('unexpected-response')
	})

	test('a network failure is not wrapped', async () => {
		const failure = new TypeError('fetch failed')
		const fetch: FetchLike = async () => {
			throw failure
		}
		await expect(fetchImage({ weapon: 'weapon_ak47', key: KEY, fetch })).rejects.toBe(failure)
	})
})

describe('readImageMeta', () => {
	test('an answer with none of the headers reads as empty, not as charged', () => {
		expect(readImageMeta(new Headers())).toEqual({
			cache: undefined,
			charged: false,
			deterministic: undefined,
			renderMs: undefined,
			coverage: undefined,
			timings: {},
			settle: {},
			problems: [],
			renderer: undefined,
		})
	})

	test('settle keeps a non-numeric value as text', () => {
		expect(readImageMeta(new Headers({ 'x-skinhub-settle': 'stable=false probes=1 mode=fast' })).settle).toEqual({
			stable: false,
			probes: 1,
			mode: 'fast',
		})
	})
})

describe('the package entry', () => {
	test('exports the image client', () => {
		expect(barrel.imageUrl).toBe(imageUrl)
		expect(barrel.fetchImage).toBe(fetchImage)
		expect(barrel.ImageError).toBe(ImageError)
		expect(barrel.isImageError).toBe(isImageError)
		expect(barrel.readImageError).toBe(readImageError)
		expect(barrel.readImageMeta).toBe(readImageMeta)
		expect(barrel.SKINHUB_IMAGE_BASE_URL).toBe(SKINHUB_IMAGE_BASE_URL)
		expect(barrel.IMAGE_ERROR_CODES).toBe(IMAGE_ERROR_CODES)
	})
})
