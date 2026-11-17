/**
 * A typed client for the SkinHub image endpoint - `@skinhub/cdn/image`.
 *
 * `GET https://api.skinhub.gg/image?...` renders anything the SkinHub viewer can draw to a PNG or
 * WebP on a transparent background. `RENDER.md` in the SkinHub repo is the source of truth for the
 * vocabulary, the billing and the error table; every option name below is the query parameter's own
 * name, so a URL from that document and an options object from this one read the same.
 *
 *   - `imageUrl(options)` builds the URL and fetches nothing. It is what goes in an `<img src>`, and
 *     it is the only place `?key=` is written - an `<img>` cannot send a header.
 *   - `fetchImage(options)` fetches it with the key in `Authorization: Bearer` instead, and returns
 *     the bytes plus the `x-skinhub-*` report. A non-2xx answer throws `ImageError`.
 *
 * **Stickers and the charm on a weapon can only be set through `?i=`.** There is no per-sticker query
 * parameter, and `?charm=` names the lone-charm subject rather than attaching one. So `item` takes a
 * `SkinPlacement` and encodes it with this package's own codec (`./inspect.ts`), as the bare hex the
 * endpoint accepts - shorter than the `steam://` form and byte-identical in what it draws.
 *
 * **The URL is built to be cache-stable, because the cache is the price list.** One credit per real
 * render; a cache hit, a coalesced answer, a `304` and every error are free. The renderer's cache key
 * sorts params but does not normalise values (`apps/render/src/cache.ts`), and an edge cache keys on
 * the exact URL string, so this builder writes params in one fixed order, numbers in JS's shortest
 * round-trip form, and leaves out an off-by-default flag passed as `false` rather than writing `=0` -
 * otherwise `{ trim: false }` and `{}` would be two renders of one picture.
 *
 * Anything the typed options do not cover (the lone `sticker=`/`charm=`/`agent=`/`pet=` subjects,
 * `view=`, `glove=`, ...) goes through `params` unchanged.
 */

import type { FetchLike } from './fetch.js'
import { buildInspectUrl } from './inspect.js'
import type { SkinPlacement } from './placement.js'

/** Where the endpoint lives. The API, not the render service - `render.skinhub.gg` answers `404`. */
export const SKINHUB_IMAGE_BASE_URL = 'https://api.skinhub.gg'

export type ImageFormat = 'png' | 'webp'

/** The finish bake's resolution. `half` bakes at 2048² instead of 4096². */
export type ImageComposite = 'full' | 'half'

/** The side of the item the camera starts from. A weapon's left is the shooter's left. */
export type ImageSide =
	| 'left'
	| 'right'
	| 'top'
	| 'bottom'
	| 'muzzle'
	| 'stock'
	| 'tip'
	| 'handle'
	| 'front'
	| 'back'
	| 'palm'

/** The lighting probes `?map=` accepts. `none` is the calibrated reference rig. */
export const IMAGE_MAPS = [
	'Ancient',
	'Anubis',
	'Baggage',
	'Cache',
	'Dust II',
	'Inferno',
	'Italy',
	'Mirage',
	'Nuke',
	'Office',
	'Overpass',
	'Train',
	'Vertigo',
	'Warehouse',
] as const

export type ImageMap = (typeof IMAGE_MAPS)[number]

export type ImageTime = 'Day' | 'Night'

export type ImageScalePreset = 'Performance' | 'Balanced' | 'Native'

/** A value `params` can carry. `undefined` and `null` are skipped. */
export type ImageParamValue = string | number | boolean | null | undefined

export type ImageOptions = {
	/* --- Naming the item. Any one of these; several combine (see RENDER.md "Naming the item"). --- */

	/** A model key (`weapon_ak47`, `sporty_gloves`) or our slug (`ak-47`, with `skin`). */
	weapon?: string
	/** The paint index. With `hash`, picks a Doppler phase. */
	paint?: number
	/** Our finish slug (`case-hardened`), alongside a slug `weapon`. */
	skin?: string
	/** Steam's `market_hash_name`, whole and unedited (`★ Karambit | Doppler (Factory New)`). */
	hash?: string
	/** An inspect link: hex, or the whole `steam://` URL. Use `item` to build one instead. */
	i?: string
	/**
	 * The item as a placement - stickers, charm, StatTrak, name plate and all - encoded to `?i=` with
	 * this package's codec. The only way to put stickers or a charm on a weapon. Not with `i`.
	 */
	item?: SkinPlacement

	/* --- The item's configuration. Anything spelled out here beats what the link says. --- */

	/** Wear, 0 to 1. */
	float?: number
	/** Paint seed, 0 to 65535. */
	seed?: number
	/** The StatTrak counter's value. `0` is a real counter, `-1` removes the module. */
	st?: number
	/** The name plate. `''` removes it. */
	nametag?: string
	/** The legacy mesh variant, where one exists. The slowest path the endpoint has. */
	legacy?: boolean

	/* --- Output. --- */

	/** Width, 16 to 4096. Default 1024. `w * h` is capped at 4 MP. */
	w?: number
	/** Height, 16 to 4096. Default 1024. */
	h?: number
	/** Default `png`. */
	format?: ImageFormat
	/** 0 to 1, WebP only - PNG rejects it with a `400`. */
	q?: number
	/** Crop to the item's alpha box. Changes the output size. */
	trim?: boolean

	/* --- Camera. --- */

	side?: ImageSide
	/** Degrees off `side`. Positive turns the near face to the screen's right. */
	yaw?: number
	/** -90 to 90, positive looks down. An operator is clamped to +30 / -10. */
	pitch?: number
	/** 1 to 179. Default 26. */
	fov?: number
	/** 0.05 to 20, a multiplier on the solved fit distance. Default 1. */
	zoom?: number

	/* --- Scene. `bg` is not here: `transparent` is the only value this endpoint can draw. --- */

	/** The lighting probe. Default `Ancient`. */
	map?: ImageMap | 'none'
	/** Default `Night`. */
	time?: ImageTime
	/** CS2's wetness layer. Not deterministic, so the answer is cached for 5 minutes, not a year. */
	rain?: boolean
	/** `0` disables the post chain, up to 10. Default 1. */
	bloom?: number
	/** Bloom spill, 0 to 10. Default 1. */
	spill?: number
	/** Anti-aliasing. On by default. */
	aa?: boolean
	/** Off by default. */
	shadows?: boolean
	/** Render scale, 0.25 to 3, or a preset. Default 1.5. */
	scale?: number | ImageScalePreset
	/** Default `full`. See RENDER.md "Composite resolution" before reaching for `half`. */
	composite?: ImageComposite

	/* --- Transport. --- */

	/**
	 * Your API key (`sk_live_...`). `imageUrl` writes it as `?key=`, which puts it in page source,
	 * history and every access log on the way - use that only where the page is already public.
	 * `fetchImage` sends it as `Authorization: Bearer` and never puts it in the URL.
	 */
	key?: string
	/** Default `https://api.skinhub.gg`. A path is kept, so a proxy at `https://you.example/skinhub` works. */
	baseUrl?: string
	/**
	 * Any other parameter from RENDER.md, written as given (booleans as `1`/`0`). A name that a typed
	 * option above also sets is refused rather than sent twice - the endpoint reads only the first.
	 */
	params?: Record<string, ImageParamValue>
}

/**
 * The typed params, in the order they are written. RENDER.md's own order: the item, its
 * configuration, output, camera, scene. `key` always goes last and is not in this list.
 */
const ORDER = [
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
] as const satisfies readonly (keyof ImageOptions)[]

type TypedParam = (typeof ORDER)[number]

const TYPED = new Set<string>(ORDER)

/**
 * Flags RENDER.md documents as off when absent. `false` on one of these is left out of the URL so it
 * shares a cache entry with the bare URL. `aa` (on by default) and `legacy` (no documented default)
 * are written as given.
 */
const OFF_BY_DEFAULT = new Set<string>(['trim', 'rain', 'shadows'])

const serialise = (name: string, value: string | number | boolean): string | undefined => {
	if (typeof value === 'boolean') {
		if (!value && OFF_BY_DEFAULT.has(name)) return undefined
		return value ? '1' : '0'
	}
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new RangeError(`@skinhub/cdn: ?${name}= must be a finite number, got ${value}`)
		// `String` is JS's shortest round-trip form, so 0.02 is always `0.02` and -0 is `0`.
		return String(value)
	}
	return value
}

/** An item as the bare inspect hex - everything after `csgo_econ_action_preview%20`. */
const inspectHex = (item: SkinPlacement): string => {
	const link = buildInspectUrl(item)
	return link.slice(link.lastIndexOf('%20') + 3)
}

const query = (options: ImageOptions): URLSearchParams => {
	if (options.item !== undefined && options.i !== undefined) {
		throw new TypeError('@skinhub/cdn: pass `item` or `i`, not both - they are the same ?i= parameter')
	}

	const search = new URLSearchParams()
	const typed = (name: TypedParam): ImageParamValue =>
		name === 'i' && options.item !== undefined ? inspectHex(options.item) : options[name]

	for (const name of ORDER) {
		const value = typed(name)
		if (value === undefined || value === null) continue
		const written = serialise(name, value)
		if (written !== undefined) search.append(name, written)
	}

	const extras = Object.entries(options.params ?? {})
		.filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined && entry[1] !== null)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

	for (const [name, value] of extras) {
		if (name === 'key') {
			// `fetchImage` moves `options.key` into a header. A key smuggled in here would ride the URL.
			throw new TypeError('@skinhub/cdn: pass the API key as `key`, not in `params`')
		}
		if (TYPED.has(name) && typed(name as TypedParam) !== undefined && typed(name as TypedParam) !== null) {
			throw new TypeError(`@skinhub/cdn: ?${name}= is set both as an option and in \`params\``)
		}
		const written = serialise(name, value)
		if (written !== undefined) search.append(name, written)
	}

	return search
}

const trimBase = (baseUrl: string) => baseUrl.trim().replace(/\/+$/, '')

/**
 * The image URL for these options. Fetches nothing.
 *
 * ```ts
 * imageUrl({ weapon: 'weapon_ak47', paint: 44, float: 0.02, seed: 661, w: 1024, h: 1024 })
 * // https://api.skinhub.gg/image?weapon=weapon_ak47&paint=44&float=0.02&seed=661&w=1024&h=1024
 * ```
 */
export const imageUrl = (options: ImageOptions): string => {
	const search = query(options)
	if (options.key) search.append('key', options.key)
	const qs = search.toString()
	return `${trimBase(options.baseUrl ?? SKINHUB_IMAGE_BASE_URL)}/image${qs ? `?${qs}` : ''}`
}

/* -------------------------------------------------------------------------------------------------
 * The response
 * ---------------------------------------------------------------------------------------------- */

/**
 * `x-skinhub-cache`. `miss` and `bypass` are renders (a `bypass` rendered and declined to store an
 * unsettled still); `hit`, `coalesced` and `revalidated` are free.
 */
export type ImageCacheStatus = 'hit' | 'miss' | 'bypass' | 'coalesced' | 'revalidated'

const CHARGED = new Set<string>(['miss', 'bypass'])

/** What the `x-skinhub-*` headers and the `ETag` say about an answer. */
export type ImageMeta = {
	/** `x-skinhub-cache`, or `undefined` when absent. */
	cache: ImageCacheStatus | (string & {}) | undefined
	/**
	 * Whether this answer was a render, which is what a credit pays for. An HTTP cache between you
	 * and the API (the browser's own, a CDN) replays the original headers, so a replayed copy of a
	 * `miss` reads `true` here without being billed a second time.
	 */
	charged: boolean
	/**
	 * Strong `ETag` = the URL names the picture completely. Weak (`W/"..."`) = two renders genuinely
	 * differ (an operator, `rain`, a still that never settled). `undefined` without an `ETag`.
	 */
	deterministic: boolean | undefined
	/** `x-skinhub-render-ms`: how long the render that produced these bytes took. */
	renderMs: number | undefined
	/** `x-skinhub-coverage`: share of the frame the item covers, 0 to 1. */
	coverage: number | undefined
	/** `x-skinhub-timings` as numbers: `resolve`, `prep`, `apply`, `ready`, `settle`, `capture`, `encode`, `total`. */
	timings: Record<string, number>
	/** `x-skinhub-settle`: `identity`, `ready`, `stable` as booleans, `probes`, `iterMs`, ... as numbers. */
	settle: Record<string, number | boolean | string>
	/**
	 * `x-skinhub-problems`, split on ` | `. Best effort: the header is truncated past ~8 KB, has
	 * non-ASCII replaced, and a problem quoting a value that itself contains ` | ` (every market hash
	 * name does) splits in two. An error's body carries the full list - see `ImageError.problems`.
	 */
	problems: string[]
	/** `x-skinhub-renderer`: the renderer version in the cache key. */
	renderer: string | undefined
}

const numberHeader = (headers: Headers, name: string): number | undefined => {
	const raw = headers.get(name)
	if (raw === null || raw.trim() === '') return undefined
	const value = Number(raw)
	return Number.isFinite(value) ? value : undefined
}

/** `a=1 b=true c=x` into a record. Numbers and booleans are converted, anything else kept as text. */
const pairs = (raw: string | null): Record<string, number | boolean | string> => {
	const out: Record<string, number | boolean | string> = {}
	if (!raw) return out
	for (const token of raw.trim().split(/\s+/)) {
		const at = token.indexOf('=')
		if (at <= 0) continue
		const name = token.slice(0, at)
		const value = token.slice(at + 1)
		if (value === 'true' || value === 'false') out[name] = value === 'true'
		else if (value !== '' && Number.isFinite(Number(value))) out[name] = Number(value)
		else out[name] = value
	}
	return out
}

const splitProblems = (raw: string | null): string[] =>
	raw
		? raw
				.split(' | ')
				.map(problem => problem.trim())
				.filter(Boolean)
		: []

/**
 * Read the `x-skinhub-*` report off any response from the endpoint - for a caller doing its own
 * `fetch`, or a proxy passing the bytes through.
 */
export const readImageMeta = (headers: Headers): ImageMeta => {
	const cache = headers.get('x-skinhub-cache') ?? undefined
	const etag = headers.get('etag')
	const timings: Record<string, number> = {}
	for (const [name, value] of Object.entries(pairs(headers.get('x-skinhub-timings')))) {
		if (typeof value === 'number') timings[name] = value
	}
	return {
		cache,
		charged: cache !== undefined && CHARGED.has(cache),
		deterministic: etag ? !etag.startsWith('W/') : undefined,
		renderMs: numberHeader(headers, 'x-skinhub-render-ms'),
		coverage: numberHeader(headers, 'x-skinhub-coverage'),
		timings,
		settle: pairs(headers.get('x-skinhub-settle')),
		problems: splitProblems(headers.get('x-skinhub-problems')),
		renderer: headers.get('x-skinhub-renderer') ?? undefined,
	}
}

/* -------------------------------------------------------------------------------------------------
 * Errors
 * ---------------------------------------------------------------------------------------------- */

/** The codes RENDER.md documents ("Errors are JSON, never an image"). */
export const IMAGE_ERROR_CODES = [
	'bad-request',
	'api-key-required',
	'api-key-invalid',
	'out-of-credits',
	'unknown-item',
	'blank',
	'rate-limited',
	'busy',
	'overloaded',
	'timeout',
	'render-failed',
] as const

/**
 * A documented code, `unexpected-response` (set here, not by the server: the body was not the
 * endpoint's JSON error - a proxy's HTML page, an empty body), or any other code the API sends.
 */
export type ImageErrorCode = (typeof IMAGE_ERROR_CODES)[number] | 'unexpected-response' | (string & {})

/** Statuses worth retrying as-is: the rate limit, a busy or overloaded box, a timeout, a bad gateway. */
const RETRYABLE = new Set([429, 502, 503, 504])

/**
 * A non-2xx answer from the image endpoint. Nothing was charged for it.
 *
 * Network failures (DNS, offline, abort) are not wrapped - they reject with whatever `fetch` threw.
 */
export class ImageError extends Error {
	override readonly name = 'ImageError'
	/** HTTP status. */
	readonly status: number
	readonly code: ImageErrorCode
	/** The server's message, without the status and code `message` is prefixed with. */
	readonly detail: string
	/** Every parameter problem the renderer reported. Empty for the API's own key/credit errors. */
	readonly problems: string[]
	/** Seconds to wait, from `Retry-After` (set on `429` and `503 busy`). */
	readonly retryAfter: number | undefined
	/** `429`, `502`, `503` or `504`: the URL is fine, try it again later. */
	readonly retryable: boolean
	/** The request URL. Never carries the key - `fetchImage` sends it as a header. */
	readonly url: string

	constructor(details: {
		status: number
		code: ImageErrorCode
		detail: string
		problems?: string[]
		retryAfter?: number | undefined
		url: string
	}) {
		super(`HTTP ${details.status} ${details.code}: ${details.detail}`)
		this.status = details.status
		this.code = details.code
		this.detail = details.detail
		this.problems = details.problems ?? []
		this.retryAfter = details.retryAfter
		this.retryable = RETRYABLE.has(details.status)
		this.url = details.url
	}
}

export const isImageError = (error: unknown): error is ImageError => error instanceof ImageError

/** `Retry-After` is seconds or an HTTP date. The renderer sends seconds. */
const retryAfterSeconds = (raw: string | null, now: number): number | undefined => {
	if (!raw) return undefined
	const value = raw.trim()
	if (/^\d+$/.test(value)) return Number(value)
	const at = Date.parse(value)
	return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - now) / 1000))
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Turn a non-2xx response into an `ImageError`. Reads the body.
 *
 * Two shapes arrive: the renderer nests its error (`{"error":{"code","message","problems"}}`) and the
 * API's own key and credit errors are flat (`{"code","message"}`). Both are read; anything else is
 * `unexpected-response`.
 */
export const readImageError = async (response: Response, url: string = response.url): Promise<ImageError> => {
	const retryAfter = retryAfterSeconds(response.headers.get('retry-after'), Date.now())
	const contentType = response.headers.get('content-type') ?? 'none'

	let body: unknown
	try {
		body = JSON.parse(await response.text())
	} catch {
		body = undefined
	}

	const payload = isRecord(body) ? (isRecord(body.error) ? body.error : body) : undefined
	const code = typeof payload?.code === 'string' ? payload.code : undefined

	if (!payload || !code) {
		return new ImageError({
			status: response.status,
			code: 'unexpected-response',
			detail: `${response.statusText || 'no status text'}, and the body is not the endpoint's JSON error (content-type: ${contentType})`,
			problems: splitProblems(response.headers.get('x-skinhub-problems')),
			retryAfter,
			url,
		})
	}

	const problems = Array.isArray(payload.problems)
		? payload.problems.filter((problem): problem is string => typeof problem === 'string')
		: []

	return new ImageError({
		status: response.status,
		code,
		detail: typeof payload.message === 'string' ? payload.message : '',
		problems: problems.length > 0 ? problems : splitProblems(response.headers.get('x-skinhub-problems')),
		retryAfter,
		url,
	})
}

/* -------------------------------------------------------------------------------------------------
 * Fetching
 * ---------------------------------------------------------------------------------------------- */

export type FetchImageOptions = ImageOptions & {
	/** A previous answer's `etag`. A match comes back `304` with no body, before a page is taken. */
	ifNoneMatch?: string
	/** Injected `fetch`. Defaults to the global one. */
	fetch?: FetchLike
	/** Abort the request. A cold render can take 25 s, so there is no default timeout. */
	signal?: AbortSignal
	/** Merged into the `RequestInit`. Its headers are kept; `key` and `ifNoneMatch` set theirs on top. */
	init?: RequestInit
}

type ImageAnswer = ImageMeta & {
	/** The URL that was fetched. No key in it. */
	url: string
	/** As sent - pass it back as `ifNoneMatch` unchanged. On a `304`, the server's or the one you sent. */
	etag: string | undefined
	/** Every response header, for anything not parsed above. */
	headers: Headers
}

export type FetchedImage = ImageAnswer & {
	notModified: false
	status: number
	bytes: Uint8Array
	/** `image/png` or `image/webp`. */
	contentType: 'image/png' | 'image/webp' | (string & {})
}

export type NotModifiedImage = ImageAnswer & {
	notModified: true
	status: 304
	bytes: null
	contentType: undefined
}

export type ImageResult = FetchedImage | NotModifiedImage

/**
 * Fetch an image. The key goes in `Authorization: Bearer`, never the URL.
 *
 * Resolves with the bytes and the report, or with `notModified: true` for a `304`. Rejects with
 * `ImageError` for any other non-2xx answer.
 *
 * ```ts
 * const image = await fetchImage({ hash: 'AK-47 | Case Hardened', seed: 661, format: 'webp', key })
 * image.bytes        // Uint8Array
 * image.cache        // 'hit' | 'miss' | ...
 * image.charged      // true only when it rendered
 * ```
 */
export const fetchImage = async (options: FetchImageOptions): Promise<ImageResult> => {
	const { key, ifNoneMatch, fetch: injected, signal, init, ...rest } = options
	const url = imageUrl(rest)

	const headers = new Headers(init?.headers)
	if (key) headers.set('authorization', `Bearer ${key}`)
	if (ifNoneMatch) headers.set('if-none-match', ifNoneMatch)

	const doFetch: FetchLike = injected ?? ((input, requestInit) => globalThis.fetch(input, requestInit))
	const response = await doFetch(url, { ...init, headers, ...(signal ? { signal } : {}) })

	const meta = readImageMeta(response.headers)
	const etag = response.headers.get('etag') ?? undefined

	if (response.status === 304) {
		return {
			...meta,
			notModified: true,
			status: 304,
			url,
			bytes: null,
			contentType: undefined,
			etag: etag ?? ifNoneMatch,
			headers: response.headers,
		}
	}

	if (!response.ok) throw await readImageError(response, url)

	return {
		...meta,
		notModified: false,
		status: response.status,
		url,
		bytes: new Uint8Array(await response.arrayBuffer()),
		contentType: response.headers.get('content-type') ?? '',
		etag,
		headers: response.headers,
	}
}
