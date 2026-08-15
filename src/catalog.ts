/**
 * `@skinhub/cdn/catalog` — fetch once, query many. The one-liner over `@skinhub/cdn/query`.
 *
 * This is the only new module in the query work that touches the network, and it is a separate
 * entry point for exactly that reason: importing `skinsForWeapon` should not be able to pull a fetch
 * into your bundle. Everything here is `fetchSkins` + `createSkinIndex` and a cache key.
 *
 * ## The memoisation is the fetch cache, not a second one
 *
 * `loadSkinIndex` does not hold its own TTL. It keys a `WeakMap` on the **array `fetchSkins`
 * returned**, so:
 *
 *   - while the fetch layer keeps serving the same parsed array (one hour by default), you get the
 *     same index back and the maps are built once;
 *   - when that entry expires and the next fetch parses a fresh array, the key is a new object, the
 *     index is rebuilt, and the old one becomes garbage with no eviction logic to get wrong.
 *
 * An index that outlived its data would be the worst kind of stale — a picker quietly missing the
 * finishes Valve shipped this morning. Tying its lifetime to the data's own identity makes that
 * impossible to express.
 *
 * ## Fetch what the item needs, not what the catalogue has
 *
 * `stickers.json` is 5.5 MB and `keychains.json` is 40 KB, against `skins.json`'s 4.2 MB. Neither is
 * fetched unless you ask, because most questions — what weapons exist, what finishes an AK has,
 * what a market hash name resolves to — need none of it. For a single inspect link, check the
 * decoded placement first:
 *
 * ```ts
 * import { readInspectUrl } from '@skinhub/cdn/inspect'
 * import { hasStickers, hasKeychain } from '@skinhub/cdn/query'
 * import { loadSkinIndex } from '@skinhub/cdn/catalog'
 *
 * const placement = readInspectUrl(link)
 * const index = await loadSkinIndex({ stickers: hasStickers(placement), keychains: hasKeychain(placement) })
 * const item = index.resolve(placement)
 * ```
 *
 * ## One caveat that is not this module's
 *
 * `cdn.skinhub.gg` currently serves no `access-control-allow-origin`, so *any* fetch in this
 * package — this module, `fetchSkins`, all of it — works from a server and not from a browser. That
 * is an origin configuration, not an API shape, and nothing here is designed around it. When the
 * header lands this module works in a browser unchanged; until then, call it server-side and hand
 * the rows to the client, or point `origin` at your own proxy with `configureCdn`.
 */

import { createSkinIndex, type SkinIndex } from './query/lookup.js'
import type { Keychains } from './datasets/keychains.js'
import { fetchKeychains } from './datasets/keychains.js'
import type { Skins } from './datasets/skins.js'
import { fetchSkins } from './datasets/skins.js'
import type { Stickers } from './datasets/stickers.js'
import { fetchStickers } from './datasets/stickers.js'
import type { DatasetOptions } from './fetch.js'

export type LoadSkinIndexOptions = DatasetOptions<Skins> & {
	/** Also fetch `stickers.json` (5.5 MB) so `resolve` can name sticker ids. */
	stickers?: boolean
	/** Also fetch `keychains.json` (40 KB) so `resolve` can name charm ids. */
	keychains?: boolean
}

/** Keyed on the parsed array, so the index lives exactly as long as the data it describes. */
const plain = new WeakMap<Skins, SkinIndex>()
const withStickers = new WeakMap<Skins, WeakMap<Stickers | Keychains, SkinIndex>>()

const bare = (skins: Skins): SkinIndex => {
	const existing = plain.get(skins)
	if (existing) return existing
	const index = createSkinIndex(skins)
	plain.set(skins, index)
	return index
}

/**
 * Fetch `skins.json` and return it indexed.
 *
 * ```ts
 * const index = await loadSkinIndex()
 *
 * index.weaponTypes('knives')                   // the 20 knife types
 * index.forWeapon(7)                            // every AK-47 finish
 * index.findByMarketHashName('AK-47 | Asiimov (Field-Tested)')?.skin
 * ```
 *
 * Every option `fetchSkins` takes is accepted and forwarded — `origin`, `fallback`, `cache`,
 * `ttlMs`, `signal`, `fetch`. Two extra flags pull in the sticker and charm lists.
 */
export const loadSkinIndex = async (options: LoadSkinIndexOptions = {}): Promise<SkinIndex> => {
	const { stickers: wantStickers, keychains: wantKeychains, ...fetchOptions } = options
	const skins = await fetchSkins(fetchOptions)

	if (!wantStickers && !wantKeychains) return bare(skins)

	const [stickers, keychains] = await Promise.all([
		wantStickers ? fetchStickers({ origin: fetchOptions.origin, cache: fetchOptions.cache }) : undefined,
		wantKeychains ? fetchKeychains({ origin: fetchOptions.origin, cache: fetchOptions.cache }) : undefined,
	])

	// Memoise on the identity of whichever extra list is present, so repeated calls with the same
	// cached lists reuse the same index rather than rebuilding 15,455 market keys each time.
	const anchor = stickers ?? keychains
	if (!anchor) return bare(skins)

	let perSkins = withStickers.get(skins)
	if (!perSkins) {
		perSkins = new WeakMap()
		withStickers.set(skins, perSkins)
	}
	const cached = perSkins.get(anchor)
	if (cached) return cached

	const index = createSkinIndex(skins, { stickers, keychains })
	perSkins.set(anchor, index)
	return index
}

export type Catalog = {
	skins: Skins
	stickers: Stickers
	keychains: Keychains
	index: SkinIndex
}

/**
 * Everything an item viewer can need, in one call: skins, stickers, charms and the index over them.
 *
 * About 10 MB of JSON. That is the right call for a server that resolves arbitrary inspect links
 * and the wrong one for a page that shows a picker, which wants `loadSkinIndex()` alone.
 */
export const loadCatalog = async (options: DatasetOptions<never> = {}): Promise<Catalog> => {
	const forward = { origin: options.origin, cache: options.cache, ttlMs: options.ttlMs, fetch: options.fetch }
	const [skins, stickers, keychains] = await Promise.all([
		fetchSkins(forward),
		fetchStickers(forward),
		fetchKeychains(forward),
	])
	return { skins, stickers, keychains, index: createSkinIndex(skins, { stickers, keychains }) }
}
