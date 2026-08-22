/**
 * Inspect link → resolved item, end to end through the real codec.
 *
 * This is the seam the two packages meet at, so the test builds a real masked link with
 * `buildInspectUrl`, decodes it with `readInspectUrl`, and resolves the result — rather than
 * hand-constructing a `SkinPlacement` and pretending a link produced it. If the codec and the
 * resolver ever disagree about what `defindex` or `paintindex` mean, that shows up here and nowhere
 * else.
 *
 * The joins being checked are the two string-versus-number ones: `paint_index`, `Sticker['id']` and
 * `Keychain['id']` are decimal strings in the data and `uint32` on the wire. A `===` across that gap
 * silently matches nothing, and "nothing matched" is indistinguishable from "this item has no
 * stickers" unless something asserts otherwise.
 */

import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Keychains } from '../src/datasets/keychains.js'
import type { Skin, Skins } from '../src/datasets/skins.js'
import type { Stickers } from '../src/datasets/stickers.js'
import { buildInspectUrl, readInspectUrl } from '../src/inspect.js'
import { emptySticker, makeSkinPlacement, STICKER_SLOTS } from '../src/placement.js'
import {
	createSkinIndex,
	hasKeychain,
	hasStickers,
	paintIndexOf,
	resolveItem,
	wearsOf,
} from '../src/query/index.js'

const FIXTURES = join(import.meta.dir, 'fixtures')
const readJson = async <T>(dir: string, file: string): Promise<T> =>
	JSON.parse(await readFile(join(dir, file), 'utf8')) as T

const fixtureSkins = await readJson<Skins>(FIXTURES, 'skins.json')
const fixtureStickers = await readJson<Stickers>(FIXTURES, 'stickers.json')
const fixtureKeychains = await readJson<Keychains>(FIXTURES, 'keychains.json')

const named = (name: string): Skin => {
	const found = fixtureSkins.find(skin => skin.name === name)
	if (!found) throw new Error(`fixture has no row named ${name}`)
	return found
}

/** A placement for a row, wearing whatever else the test wants. */
const placementFor = (skin: Skin, extra: Partial<Parameters<typeof makeSkinPlacement>[0]> = {}) =>
	makeSkinPlacement({
		defindex: skin.weapon.weapon_id,
		paintindex: paintIndexOf(skin),
		paintseed: 661,
		paintwear: skin.min_float ?? 0,
		stickers: STICKER_SLOTS.map(slot => emptySticker(slot)),
		keychain: null,
		...extra,
	})

/** Encode and decode again, so what is resolved is what a real link would produce. */
const throughALink = (skin: Skin, extra: Partial<Parameters<typeof makeSkinPlacement>[0]> = {}) =>
	readInspectUrl(buildInspectUrl(placementFor(skin, extra)))

describe('resolving a link', () => {
	test('with no catalogs at all it still returns the wire values', () => {
		const item = resolveItem(throughALink(named('M4A4 | Howl'), { paintwear: 0.2 }))
		expect(item.defindex).toBe(16)
		expect(item.paintindex).toBe(309)
		expect(item.skin).toBeUndefined()
		expect(item.name).toBeUndefined()
		expect(item.marketHashName).toBeNull()
		// The wear tier does not need the catalogue — it is a function of the float alone.
		expect(item.wear.short).toBe('FT')
	})

	test('with skins it names the item and builds its Steam key', () => {
		const item = resolveItem(throughALink(named('M4A4 | Howl'), { paintwear: 0.2 }), { skins: fixtureSkins })
		expect(item.name).toBe('M4A4 | Howl')
		expect(item.category).toBe('rifles')
		expect(item.vanilla).toBe(false)
		expect(item.marketHashName).toBe('M4A4 | Howl (Field-Tested)')
	})

	test('a StatTrak link gets the StatTrak key and its counter', () => {
		const item = resolveItem(
			throughALink(named('M4A4 | Howl'), { paintwear: 0.2, stattrak: true, stattrak_count: 1337 }),
			{ skins: fixtureSkins },
		)
		expect(item.stattrak).toBe(true)
		expect(item.stattrakCount).toBe(1337)
		expect(item.marketHashName).toBe('StatTrak™ M4A4 | Howl (Field-Tested)')
	})

	test('a knife keeps the star ahead of the badge', () => {
		const item = resolveItem(
			throughALink(named('★ Bayonet | Case Hardened'), { paintwear: 0.02, stattrak: true }),
			{ skins: fixtureSkins },
		)
		expect(item.marketHashName).toBe('★ StatTrak™ Bayonet | Case Hardened (Factory New)')
		expect(item.category).toBe('knives')
	})

	test('a vanilla knife resolves, has no exterior in its key, and is flagged vanilla', () => {
		const item = resolveItem(throughALink(named('★ Bayonet')), { skins: fixtureSkins })
		expect(item.paintindex).toBe(0)
		expect(item.name).toBe('★ Bayonet')
		expect(item.vanilla).toBe(true)
		expect(item.marketHashName).toBe('★ Bayonet')
	})

	/*
	 * The regression a placement-to-viewer-props adapter hit: reading `item.skin.weapon.id` gets a
	 * HUD string on the vanilla knives, so the renderer looks up a model that does not exist.
	 * `item.weapon` is the field that is safe to key a model path off.
	 */
	test('item.weapon carries the real item name where the raw row carries the alias', () => {
		const item = resolveItem(throughALink(named('★ Bayonet')), { skins: fixtureSkins })
		expect(item.skin?.weapon.id).toBe('sfui_wpnhud_knifebayonet')
		expect(item.weapon?.id).toBe('weapon_bayonet')
		expect(item.weapon?.defindex).toBe(500)
		expect(item.weapon?.category).toBe('knives')
		expect(item.weapon?.aliased).toBe(false)
	})

	test('item.weapon agrees with the row on every fixture skin', () => {
		for (const skin of fixtureSkins) {
			const item = resolveItem(throughALink(skin), { skins: fixtureSkins })
			expect(item.weapon?.defindex).toBe(skin.weapon.weapon_id)
			expect(item.weapon?.name).toBe(skin.weapon.name)
			if (!skin.weapon.id.startsWith('sfui_')) expect(item.weapon?.id).toBe(skin.weapon.id)
		}
	})

	test('item.weapon is undefined without a skins list, rather than half-built', () => {
		expect(resolveItem(throughALink(named('★ Bayonet'))).weapon).toBeUndefined()
	})

	test('a nametag survives the round trip', () => {
		const item = resolveItem(throughALink(named('M4A4 | Howl'), { paintwear: 0.2, nametag: 'my rifle' }), {
			skins: fixtureSkins,
		})
		expect(item.nametag).toBe('my rifle')
	})

	test('an unknown pair resolves to the wire values and no row', () => {
		const item = resolveItem(
			makeSkinPlacement({
				defindex: 7,
				paintindex: 999_999,
				paintseed: 0,
				paintwear: 0.3,
				stickers: [],
				keychain: null,
			}),
			{ skins: fixtureSkins },
		)
		expect(item.skin).toBeUndefined()
		expect(item.marketHashName).toBeNull()
		expect(item.wear.short).toBe('FT')
	})
})

describe('the float', () => {
	test('is clamped into the finish’s own range, with the raw value kept', () => {
		// `Five-SeveN | Monkey Business` is [0.1, 0.9], so it has no Factory New. A link claiming a
		// float of 0 is either hand-built or stale, and a renderer mapping it onto a wear texture
		// wants the value the finish can actually take.
		const narrow = named('Five-SeveN | Monkey Business')
		const min = narrow.min_float as number
		expect(min).toBeGreaterThan(0)
		expect(wearsOf(narrow).some(tier => tier.short === 'FN')).toBe(false)

		const item = resolveItem(throughALink(narrow, { paintwear: 0 }), { skins: fixtureSkins })
		expect(item.rawFloat).toBe(0)
		expect(item.float).toBe(min)
		expect(String(item.wear.short)).toBe(wearsOf(narrow)[0]?.short as string)
	})

	test('is left alone when the finish is unknown', () => {
		const item = resolveItem(
			makeSkinPlacement({
				defindex: 7,
				paintindex: 999_999,
				paintseed: 0,
				paintwear: 0,
				stickers: [],
				keychain: null,
			}),
		)
		expect(item.float).toBe(0)
		expect(item.rawFloat).toBe(0)
	})

	test('is the float32 the wire actually carries, not the double that was handed in', () => {
		// `paintwear` is a protobuf float. Resolving off the decoded value rather than the input is
		// what stops a UI showing 0.154 for an item the game will show as 0.15399999916553497.
		const item = resolveItem(throughALink(named('M4A4 | Howl'), { paintwear: 0.154 }), { skins: fixtureSkins })
		expect(item.rawFloat).toBe(Math.fround(0.154))
	})
})

describe('stickers and charms', () => {
	const stickerId = Number(fixtureStickers[0]?.id)
	const keychainId = Number(fixtureKeychains[0]?.id)

	test('hasStickers / hasKeychain answer the "is it worth fetching 5.5 MB" question', () => {
		const bare = throughALink(named('M4A4 | Howl'), { paintwear: 0.2 })
		expect(hasStickers(bare)).toBe(false)
		expect(hasKeychain(bare)).toBe(false)

		const dressed = throughALink(named('M4A4 | Howl'), {
			paintwear: 0.2,
			stickers: [{ ...emptySticker(2), sticker_id: stickerId, wear: 0.25 }],
			keychain: { slot: 0, sticker_id: keychainId, offset_x: 0, offset_y: 0, offset_z: 0, pattern: 7, wrapped_sticker: 0 },
		})
		expect(hasStickers(dressed)).toBe(true)
		expect(hasKeychain(dressed)).toBe(true)
	})

	test('only filled slots come back, and they carry both the row and the placement', () => {
		const link = throughALink(named('M4A4 | Howl'), {
			paintwear: 0.2,
			stickers: [{ ...emptySticker(3), sticker_id: stickerId, wear: 0.25, rotation: 12 }],
		})
		const item = resolveItem(link, { skins: fixtureSkins, stickers: fixtureStickers })

		expect(item.stickers.length).toBe(1)
		const [placed] = item.stickers
		expect(placed?.slot).toBe(3)
		expect(placed?.stickerId).toBe(stickerId)
		// The join that a `===` between a string id and a uint32 would silently fail.
		expect(placed?.sticker?.name).toBe(fixtureStickers[0]?.name as string)
		expect(placed?.placement.rotation).toBe(12)
	})

	test('without the sticker list the slot is still reported, just unnamed', () => {
		const link = throughALink(named('M4A4 | Howl'), {
			paintwear: 0.2,
			stickers: [{ ...emptySticker(0), sticker_id: stickerId }],
		})
		const item = resolveItem(link, { skins: fixtureSkins })
		expect(item.stickers.length).toBe(1)
		expect(item.stickers[0]?.sticker).toBeUndefined()
	})

	test('a charm resolves to its row and keeps its seed', () => {
		const link = throughALink(named('M4A4 | Howl'), {
			paintwear: 0.2,
			keychain: { slot: 0, sticker_id: keychainId, offset_x: 1, offset_y: 2, offset_z: 3, pattern: 42, wrapped_sticker: 0 },
		})
		const item = resolveItem(link, { skins: fixtureSkins, keychains: fixtureKeychains })
		expect(item.keychain?.keychainId).toBe(keychainId)
		expect(item.keychain?.keychain?.name).toBe(fixtureKeychains[0]?.name as string)
		expect(item.keychain?.placement.pattern).toBe(42)
	})

	test('an id nothing matches leaves the row undefined rather than dropping the slot', () => {
		const link = throughALink(named('M4A4 | Howl'), {
			paintwear: 0.2,
			stickers: [{ ...emptySticker(1), sticker_id: 999_999 }],
		})
		const item = resolveItem(link, { skins: fixtureSkins, stickers: fixtureStickers })
		expect(item.stickers.length).toBe(1)
		expect(item.stickers[0]?.sticker).toBeUndefined()
	})
})

describe('the index resolves identically', () => {
	test('index.resolve matches resolveItem', () => {
		const index = createSkinIndex(fixtureSkins, { stickers: fixtureStickers, keychains: fixtureKeychains })
		for (const skin of fixtureSkins) {
			const link = throughALink(skin)
			expect(index.resolve(link)).toEqual(resolveItem(link, {
				skins: fixtureSkins,
				stickers: fixtureStickers,
				keychains: fixtureKeychains,
			}))
		}
	})

	test('withCatalogs adds the lists to an index that was built without them', () => {
		const stickerId = Number(fixtureStickers[0]?.id)
		const link = throughALink(named('M4A4 | Howl'), {
			paintwear: 0.2,
			stickers: [{ ...emptySticker(0), sticker_id: stickerId }],
		})

		const bare = createSkinIndex(fixtureSkins)
		expect(bare.resolve(link).stickers[0]?.sticker).toBeUndefined()

		const dressed = bare.withCatalogs({ stickers: fixtureStickers })
		expect(dressed.resolve(link).stickers[0]?.sticker?.name).toBe(fixtureStickers[0]?.name as string)
		// The original is untouched.
		expect(bare.resolve(link).stickers[0]?.sticker).toBeUndefined()
	})
})

/* --------------------------------------------------------------------------------------------
 * The full export.
 * ------------------------------------------------------------------------------------------ */

const FULL = process.env.SKINHUB_CDN_FIXTURES
const hasFull = Boolean(FULL && existsSync(join(FULL, 'skins.json')))

describe.skipIf(!hasFull)('every row survives the whole loop', () => {
	test('build a link for all 2,161 rows, decode it, and resolve back to the same row', async () => {
		const skins = await readJson<Skins>(FULL as string, 'skins.json')
		const index = createSkinIndex(skins)

		let resolved = 0
		for (const skin of skins) {
			const link = buildInspectUrl(
				makeSkinPlacement({
					defindex: skin.weapon.weapon_id,
					paintindex: paintIndexOf(skin),
					paintseed: 0,
					paintwear: skin.min_float ?? 0,
					stickers: [],
					keychain: null,
				}),
			)
			const item = index.resolve(readInspectUrl(link))
			expect({ row: skin.id, resolved: item.skin?.id }).toEqual({ row: skin.id, resolved: skin.id })

			// The float always lands inside the finish's declared range.
			if (skin.min_float !== null && skin.max_float !== null) {
				expect(item.float).toBeGreaterThanOrEqual(skin.min_float)
				expect(item.float).toBeLessThanOrEqual(skin.max_float)
			}
			resolved++
		}
		expect(resolved).toBe(2161)
	}, 60_000)
})
