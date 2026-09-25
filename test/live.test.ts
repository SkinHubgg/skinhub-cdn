/**
 * Hits the real CDN. **Opt-in** — set `SKINHUB_CDN_LIVE=1`.
 *
 * Off by default because a test suite that fails when the office wifi drops is a test suite people
 * stop trusting, and because these pull megabytes.
 *
 *   bun run test:live
 *
 * ## State of the origin
 *
 * **2026-08-08 (measured):** `cdn.skinhub.gg` was **mid-upload**. `manifest.json` (6.95 MB) and
 * `data/items_game.json` (6.84 MB) were live and correct; the other seven `data/*.json` returned
 * **404**. So these tests were written to report what is there rather than to assume all eight are:
 * `items_game.json` is asserted hard, and the seven are checked opportunistically — a 404 is
 * reported as a skip-with-reason, anything else that is served must validate.
 *
 * **2026-08-15 (measured):** all eight are live and all seven lists validate — 2,161 skins, 11,788
 * stickers, 715 collectibles, 143 charms, 101 music kits, 95 gloves, 81 agents. The opportunistic
 * handling is kept anyway: it costs nothing and it is the shape the next upload window will need.
 *
 * The 404 body is a Cloudflare HTML page, `content-type: text/html`, which is exactly the shape
 * `CdnError` exists to describe — so the "the file is missing" path is itself asserted.
 *
 * **`access-control-allow-origin` is absent from the origin's responses**, so every test here works
 * from a server and would not from a browser. That is an origin configuration rather than anything
 * this package does — nothing in the API is designed around it. See the note in `src/catalog.ts`.
 *
 * **2026-09-24: every request here now carries `Origin: https://skinhub.gg`** (see `LIVE_ORIGIN`
 * below), because the no-Origin requests this suite used to send were a hazard to the site, not just
 * a gap in the test. The pet files (`pets.json`, `petVariants.json`, new with CS2 1.41.8.2) are
 * checked the same opportunistic way as the seven lists, and the catalogue pins count the C4's
 * vanilla row as `+ c4` so they hold before and after the export that adds it is published.
 *
 * Point it at another origin - the local dev CDN, a staging bucket - with
 * `SKINHUB_CDN_URL=<origin> bun run test:live`; the suite title says which origin it ran against.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { C4_DEFINDEX } from '../src/c4.js'
import { clearDefaultCache } from '../src/cache.js'
import { loadSkinIndex } from '../src/catalog.js'
import { fetchPets, fetchPetVariants } from '../src/datasets/pets.js'
import type { Skin } from '../src/datasets/skins.js'
import { marketHashName } from '../src/query/index.js'
import { dataUrl, resolveCdnOrigin } from '../src/config.js'
import { fetchAgents } from '../src/datasets/agents.js'
import { fetchCollectibles } from '../src/datasets/collectibles.js'
import { fetchGloves } from '../src/datasets/gloves.js'
import { fetchItemsGame } from '../src/datasets/items-game.js'
import { fetchKeychains } from '../src/datasets/keychains.js'
import { fetchMusicKits } from '../src/datasets/music.js'
import { fetchSkins } from '../src/datasets/skins.js'
import { fetchStickers } from '../src/datasets/stickers.js'
import { isCdnError } from '../src/errors.js'
import { fetchCdnJson } from '../src/fetch.js'
import {
	agentShape,
	arrayOf,
	collectibleShape,
	gloveShape,
	itemsGameShape,
	keychainShape,
	musicKitShape,
	petsShape,
	petVariantsShape,
	skinShape,
	stickerShape,
	validate,
} from './validate.js'

const LIVE = process.env.SKINHUB_CDN_LIVE === '1'

/**
 * *** EVERY LIVE REQUEST SENDS AN `Origin`. *** `cdn.skinhub.gg` answers `vary: Origin`, but
 * Cloudflare does not key its cache on it, so the first copy an edge caches is the copy every browser
 * gets. A copy warmed by a request WITHOUT an `Origin` - a server-side test run, curl - carries no
 * `access-control-allow-origin`, and every browser `fetch()` of that file fails until the edge
 * expires it. This suite runs from a server and pulls every data file, so it must never be the
 * request that warms one.
 *
 * The package's fetch layer reads `globalThis.fetch` at call time, so wrapping it for the suite
 * covers every helper, `loadSkinIndex` included, without touching the code under test.
 */
const LIVE_ORIGIN = 'https://skinhub.gg'

let unwrappedFetch: typeof globalThis.fetch | undefined

/** `globalThis.fetch` with `Origin` set on every request that does not already name one. */
const fetchWithOrigin = (realFetch: typeof globalThis.fetch): typeof globalThis.fetch => {
	const wrapped = (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
		const headers = new Headers(input instanceof Request ? input.headers : undefined)
		new Headers(init?.headers).forEach((value, name) => {
			headers.set(name, value)
		})
		if (!headers.has('origin')) headers.set('origin', LIVE_ORIGIN)
		return realFetch(input, { ...init, headers })
	}
	return Object.assign(wrapped, realFetch)
}

describe.skipIf(!LIVE)(`live CDN (${resolveCdnOrigin()})`, () => {
	beforeAll(() => {
		unwrappedFetch = globalThis.fetch
		globalThis.fetch = fetchWithOrigin(unwrappedFetch)
	})

	afterAll(() => {
		if (unwrappedFetch) globalThis.fetch = unwrappedFetch
	})

	test('manifest.json is served as JSON', async () => {
		const manifest = await fetchCdnJson<Record<string, unknown>>('manifest.json', { cache: false })
		expect(typeof manifest).toBe('object')
		expect(Object.keys(manifest).length).toBeGreaterThan(100)
	}, 120_000)

	test('data/items_game.json is live and validates', async () => {
		const data = await fetchItemsGame({ cache: false })
		expect(validate(itemsGameShape, data, 'items_game.json')).toEqual([])
		expect(Object.keys(data.items_game).length).toBeGreaterThan(20)
		expect(data.items_game.paint_kits).toBeDefined()
	}, 120_000)

	const seven = [
		{ file: 'skins.json', fetch: fetchSkins, shape: arrayOf(skinShape) },
		{ file: 'stickers.json', fetch: fetchStickers, shape: arrayOf(stickerShape) },
		{ file: 'collectibles.json', fetch: fetchCollectibles, shape: arrayOf(collectibleShape) },
		{ file: 'keychains.json', fetch: fetchKeychains, shape: arrayOf(keychainShape) },
		{ file: 'music.json', fetch: fetchMusicKits, shape: arrayOf(musicKitShape) },
		{ file: 'gloves.json', fetch: fetchGloves, shape: arrayOf(gloveShape) },
		{ file: 'agents.json', fetch: fetchAgents, shape: arrayOf(agentShape) },
	] as const

	for (const { file, fetch, shape } of seven) {
		test(`data/${file} — validates if served, reports cleanly if not`, async () => {
			clearDefaultCache()
			try {
				const rows = await fetch({ cache: false })
				expect(Array.isArray(rows)).toBe(true)
				expect(rows.length).toBeGreaterThan(0)
				expect(validate(shape, rows, file)).toEqual([])
				console.log(`  ✓ ${file}: ${rows.length} rows, validates`)
			} catch (error) {
				if (!isCdnError(error)) throw error
				// A missing file is the known mid-upload state, not a failure of this package. What
				// IS asserted is that the failure is legible: a 404 with the origin's HTML content
				// type, not a JSON syntax error.
				expect(error.status).toBe(404)
				expect(error.url).toBe(dataUrl(file))
				console.log(`  – ${file}: HTTP 404 (${error.contentType}) — not uploaded yet`)
			}
		}, 120_000)
	}

	// Objects rather than row arrays, and new with CS2 1.41.8.2: until the export that writes them is
	// published they 404, which is reported exactly like a missing list above.
	const petFiles = [
		{ file: 'pets.json', fetch: fetchPets, shape: petsShape },
		{ file: 'petVariants.json', fetch: fetchPetVariants, shape: petVariantsShape },
	] as const

	for (const { file, fetch, shape } of petFiles) {
		test(`data/${file} - validates if served, reports cleanly if not`, async () => {
			clearDefaultCache()
			try {
				const data = await fetch({ cache: false })
				expect(validate(shape, data, file)).toEqual([])
				console.log(`  ✓ ${file}: validates`)
			} catch (error) {
				if (!isCdnError(error)) throw error
				expect(error.status).toBe(404)
				expect(error.url).toBe(dataUrl(file))
				console.log(`  - ${file}: HTTP 404 (${error.contentType}) - not uploaded yet`)
			}
		}, 120_000)
	}

	test('a missing key surfaces as a 404 CdnError, not a JSON parse error', async () => {
		const error = await fetchCdnJson('data/definitely-not-a-file.json', { cache: false }).catch(e => e)
		expect(isCdnError(error)).toBe(true)
		expect((error as { status?: number }).status).toBe(404)
	}, 60_000)

	test('a fallback absorbs a missing file', async () => {
		const fallback = [{ weapon_defindex: 0, paint: 0, image: '', paint_name: 'Gloves | Default' }]
		const result = await fetchCdnJson('data/definitely-not-a-file.json', {
			cache: false,
			fallback,
			onError: () => {},
		})
		expect(result).toBe(fallback)
	}, 60_000)

	// The query layer against the bytes the CDN is actually serving, not against a fixture. Everything
	// asserted here is a number quoted in a doc comment somewhere.
	test('the query layer answers the catalogue questions against the live file', async () => {
		clearDefaultCache()
		const index = await loadSkinIndex()

		// 1 once the CS2 1.41.8.2 export is live (the C4's vanilla row), 0 before - as in test/query.test.ts.
		const c4 = index.skins.filter(skin => skin.weapon.weapon_id === C4_DEFINDEX).length
		expect(c4).toBeLessThanOrEqual(1)
		expect(index.skins.length).toBe(2161 + c4)
		expect(index.weaponTypes().length).toBe(63 + c4)
		expect(index.weaponTypes('knives').length).toBe(20)
		expect(index.weaponTypes('gloves').length).toBe(8)
		expect(index.forWeapon(7).length).toBeGreaterThan(50)
		expect(index.byMarketHashName.size).toBe(15_455)

		const asiimov = index.find({ defindex: 7, paintindex: 801 })
		expect(asiimov?.name).toBe('AK-47 | Asiimov')
		expect(marketHashName(asiimov as Skin, { wear: 'Field-Tested', stattrak: true })).toBe(
			'StatTrak™ AK-47 | Asiimov (Field-Tested)',
		)

		// The index is memoised on the fetched array, so a second call is free.
		expect(await loadSkinIndex()).toBe(index)
	}, 120_000)
})
