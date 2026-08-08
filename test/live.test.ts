/**
 * Hits the real CDN. **Opt-in** — set `SKINHUB_CDN_LIVE=1`.
 *
 * Off by default because a test suite that fails when the office wifi drops is a test suite people
 * stop trusting, and because these pull megabytes.
 *
 *   bun run test:live
 *
 * ## State of the origin when this was written (2026-08-08, measured)
 *
 * `cdn.skinhub.gg` was **mid-upload**. `manifest.json` (6.95 MB) and `data/items_game.json`
 * (6.84 MB) were live and correct; the other seven `data/*.json` returned **404**. So these tests
 * are written to report what is there rather than to assume all eight are:
 * `items_game.json` is asserted hard, and the seven are checked opportunistically — a 404 is
 * reported as a skip-with-reason, anything else that is served must validate.
 *
 * The 404 body is a Cloudflare HTML page, `content-type: text/html`, which is exactly the shape
 * `CdnError` exists to describe — so the "the file is missing" path is itself asserted.
 */

import { describe, expect, test } from 'bun:test'
import { clearDefaultCache } from '../src/cache.js'
import { dataUrl, SKINHUB_CDN_DEFAULT_ORIGIN } from '../src/config.js'
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
	skinShape,
	stickerShape,
	validate,
} from './validate.js'

const LIVE = process.env.SKINHUB_CDN_LIVE === '1'

describe.skipIf(!LIVE)(`live CDN (${SKINHUB_CDN_DEFAULT_ORIGIN})`, () => {
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
})
