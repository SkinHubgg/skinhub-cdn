/**
 * The query layer, in three tiers.
 *
 *   1. **Behaviour, on the committed fixture.** Runs everywhere, needs no exporter checkout. Asserts
 *      what the functions do, using only rows that are in `test/fixtures/skins.json`.
 *   2. **Invariants, on the full export.** The claims the API's *return types* rest on — that
 *      `(defindex, paintindex)` is a key, that `weapon.id` is not, that a name only collides between
 *      phases. If one of these stops holding, a function that returns `Skin | undefined` is lying,
 *      and it should fail loudly rather than return an arbitrary row.
 *   3. **The documented figures.** Every count quoted in a doc comment, checked against the export.
 *      This tier is a doc-sync check on purpose: when the exporter publishes new skins it goes red,
 *      and the fix is to update both the number and the sentence around it. A package whose comments
 *      say "measured" has to have something that re-measures.
 *
 * Tiers 2 and 3 skip when `SKINHUB_CDN_FIXTURES` does not point at an `asset-export/out/data`
 * directory, for the same reason `types.test.ts` does: a stranger cloning this repo does not have
 * 16 MB of CS2 exports.
 */

import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ItemsGame } from '../src/datasets/items-game.js'
import type { Skin, Skins } from '../src/datasets/skins.js'
import {
	createSkinIndex,
	compareByRarity,
	defindexForWeaponId,
	findSkin,
	findSkinById,
	gloveSkins,
	gunSkins,
	knifeSkins,
	listCategories,
	listCollections,
	listCrates,
	listGloveTypes,
	listGunTypes,
	listKnifeTypes,
	listWeaponTypes,
	normalizeWeaponId,
	paintIndexOf,
	phasesOf,
	rarityRank,
	SKIN_CATEGORIES,
	SKIN_CATEGORY_IDS,
	skinCategory,
	skinsByName,
	skinsByPaintIndex,
	skinsForWeapon,
	skinsInCategory,
	skinsWithWear,
	statTrakSkins,
	vanillaSkins,
	weaponDefindexes,
	weaponIdForDefindex,
	weaponIdsByDefindex,
	weaponOf,
	WEAR_TIERS,
	wearsOf,
	wearTier,
	wearTierForFloat,
} from '../src/query/index.js'

/*
 * Every type the README's API reference lists for `/query` and `/catalog`, imported from the ROOT
 * barrel. Types are erased at runtime, so nothing else in the suite can catch one that was declared
 * but never exported — `bun run typecheck` fails on this block instead.
 */
import type {
	Catalog,
	CategorySummary,
	ItemCatalogs,
	ItemFinders,
	LoadSkinIndexOptions,
	MarketEntry,
	MarketHashNameOptions,
	MarketVariant,
	NamedGroup,
	ParsedMarketHashName,
	RarityBearer,
	RarityLike,
	RarityObject,
	RarityRank,
	ResolvedItem,
	ResolvedKeychain,
	ResolvedSticker,
	ResolvedWeapon,
	SkinCategoryKey,
	SkinIndex,
	SkinRef,
	WeaponRef,
	WeaponSelector,
	WeaponType,
	WearLike,
	WearName,
	WearShort,
	WearTier,
	WearTierId,
} from '../src/index.js'

type DocumentedTypes = [
	Catalog,
	CategorySummary,
	ItemCatalogs,
	ItemFinders,
	LoadSkinIndexOptions,
	MarketEntry,
	MarketHashNameOptions,
	MarketVariant,
	NamedGroup,
	ParsedMarketHashName,
	RarityBearer,
	RarityLike,
	RarityObject,
	RarityRank,
	ResolvedItem,
	ResolvedKeychain,
	ResolvedSticker,
	ResolvedWeapon,
	SkinCategoryKey,
	SkinIndex,
	SkinRef,
	WeaponRef,
	WeaponSelector,
	WeaponType,
	WearLike,
	WearName,
	WearShort,
	WearTier,
	WearTierId,
]

const FIXTURES = join(import.meta.dir, 'fixtures')
const readJson = async <T>(dir: string, file: string): Promise<T> =>
	JSON.parse(await readFile(join(dir, file), 'utf8')) as T

const fixtureSkins = await readJson<Skins>(FIXTURES, 'skins.json')

/* --------------------------------------------------------------------------------------------
 * Tier 1 — behaviour, on the fixture.
 * ------------------------------------------------------------------------------------------ */

describe('the documented surface', () => {
	test('every type the README lists is exported from the root barrel', () => {
		// The assertion is the `import type` block above plus this reference to it: if any of those
		// names were not exported, `tsc` would have failed before this file ever ran.
		const documented: DocumentedTypes[number] | undefined = undefined
		expect(documented).toBeUndefined()
	})

	test('every runtime name the README lists is exported from the root barrel', async () => {
		const readme = await readFile(join(import.meta.dir, '..', 'README.md'), 'utf8')
		const barrel = await import('../src/index.js')

		const start = readme.indexOf('### `@skinhub/cdn/query`')
		const end = readme.indexOf('### `@skinhub/cdn/placement`')
		expect(start).toBeGreaterThan(-1)
		expect(end).toBeGreaterThan(start)

		// Everything in backticks in those sections, minus the names that are types-only (they are
		// covered by the block above and cannot be seen at runtime).
		const typeOnly = new Set<string>(
			(
				[
					'Catalog',
					'CategorySummary',
					'ItemCatalogs',
					'ItemFinders',
					'LoadSkinIndexOptions',
					'MarketEntry',
					'MarketHashNameOptions',
					'MarketVariant',
					'NamedGroup',
					'ParsedMarketHashName',
					'RarityBearer',
					'RarityLike',
					'RarityObject',
					'RarityRank',
					'ResolvedItem',
					'ResolvedKeychain',
					'ResolvedSticker',
					'ResolvedWeapon',
					'SkinCategoryKey',
					'SkinIndex',
					'SkinRef',
					'WeaponRef',
					'WeaponSelector',
					'WeaponType',
					'WearLike',
					'WearName',
					'WearShort',
					'WearTier',
					'WearTierId',
				] as const
			).map(String),
		)

		const listed = [...readme.slice(start, end).matchAll(/`([A-Za-z_][A-Za-z0-9_]*)`/g)]
			.map(match => match[1] as string)
			.filter(name => !typeOnly.has(name))

		expect(listed.length).toBeGreaterThan(40)
		for (const name of listed) {
			expect({ name, exported: name in barrel }).toEqual({ name, exported: true })
		}
	})
})

describe('wear tiers', () => {
	test('the five tiers are contiguous and cover [0, 1]', () => {
		expect(WEAR_TIERS.length).toBe(5)
		expect(WEAR_TIERS[0]?.min).toBe(0)
		expect(WEAR_TIERS[4]?.max).toBe(1)
		for (let i = 1; i < WEAR_TIERS.length; i++) {
			expect(WEAR_TIERS[i]?.min).toBe(WEAR_TIERS[i - 1]?.max as number)
		}
	})

	test('a float maps to the tier whose half-open interval holds it', () => {
		expect(wearTierForFloat(0).short).toBe('FN')
		expect(wearTierForFloat(0.0699).short).toBe('FN')
		expect(wearTierForFloat(0.07).short).toBe('MW')
		expect(wearTierForFloat(0.15).short).toBe('FT')
		expect(wearTierForFloat(0.38).short).toBe('WW')
		expect(wearTierForFloat(0.45).short).toBe('BS')
		// The upper bound is closed on Battle-Scarred so a max_float of exactly 1 lands somewhere.
		expect(wearTierForFloat(1).short).toBe('BS')
	})

	test('out-of-range floats clamp rather than throw', () => {
		expect(wearTierForFloat(-1).short).toBe('FN')
		expect(wearTierForFloat(2).short).toBe('BS')
	})

	test('a tier is findable by name, short form or wears[].id', () => {
		expect(wearTier('Factory New')?.short).toBe('FN')
		expect(wearTier('factory new')?.short).toBe('FN')
		expect(wearTier('BS')?.name).toBe('Battle-Scarred')
		expect(wearTier('SFUI_InvTooltip_Wear_Amount_2')?.name).toBe('Field-Tested')
		expect(wearTier('Mint Condition')).toBeUndefined()
		expect(wearTier(null)).toBeUndefined()
	})
})

describe('rarity', () => {
	const covert = { id: 'rarity_ancient_weapon', name: 'Covert', color: '#eb4b4b' }

	test('the ladder is ordered and accepts both spellings', () => {
		expect(rarityRank('common')).toBe(1)
		expect(rarityRank('rarity_common_weapon')).toBe(1)
		expect(rarityRank(covert)).toBe(6)
		// Extraordinary — the gloves — is the same rung as Covert, spelled without `_weapon`.
		expect(rarityRank('rarity_ancient')).toBe(6)
		// The one non-mechanical join: Valve's token is `immortal`, the loc key says contraband.
		expect(rarityRank('rarity_contraband_weapon')).toBe(7)
		expect(rarityRank('immortal')).toBe(7)
	})

	test('no rank is undefined, not -1, so "no rarity" is distinguishable', () => {
		expect(rarityRank(null)).toBeUndefined()
		expect(rarityRank(undefined)).toBeUndefined()
		expect(rarityRank('')).toBeUndefined()
		expect(rarityRank('not a rarity')).toBeUndefined()
	})

	test('an unseen id falls back to the token inside it', () => {
		expect(rarityRank('rarity_legendary_character')).toBe(5)
	})

	/*
	 * The regression this section exists for.
	 *
	 * `compareByRarity(skinA, skinB)` used to typecheck and return 0 for EVERY pair: `Skin` has an
	 * `id` (`skin-b2a5203033ee`), the old `RarityLike` accepted any `{ id: string }`, and a row id
	 * ranks as `undefined` — so the sort silently did nothing and looked like it had worked.
	 */
	test('a whole row ranks by its rarity, not by its own id', () => {
		for (const skin of fixtureSkins) {
			expect({ id: skin.id, viaRow: rarityRank(skin) }).toEqual({
				id: skin.id,
				viaRow: rarityRank(skin.rarity),
			})
			expect(rarityRank(skin)).not.toBeUndefined()
		}
	})

	test('a row whose own id would otherwise win still reads its rarity', async () => {
		// A sticker has BOTH `id: '1'` and `rarity: 'rare'`. Reading the id would rank the sticker
		// number — which does not rank at all, so it would be another silent undefined.
		const stickers = await readJson<{ id: string; rarity: string | null }[]>(FIXTURES, 'stickers.json')
		const ranked = stickers.find(sticker => sticker.rarity !== null)
		expect(ranked).toBeDefined()
		expect(rarityRank(ranked as { rarity: string | null })).toBe(rarityRank((ranked as { rarity: string }).rarity))
		expect(rarityRank(ranked as { rarity: string | null })).not.toBeUndefined()
	})

	test('sorting a list of rows actually reorders it', () => {
		const ranks = [...fixtureSkins].sort(compareByRarity).map(skin => rarityRank(skin) as number)
		for (let i = 1; i < ranks.length; i++) expect(ranks[i]).toBeGreaterThanOrEqual(ranks[i - 1] as number)
		// The bug was a stable no-op, so "it is sorted" is not enough — the input must not already be.
		const original = fixtureSkins.map(skin => rarityRank(skin) as number)
		expect(original).not.toEqual(ranks)
	})

	test('an object that merely has an id and a name no longer compiles', () => {
		const collection = { id: 'collection-set-nuke-2', name: 'The 2018 Nuke Collection', image: '' }
		// @ts-expect-error — a collection is not a rarity. This used to be accepted and rank undefined.
		expect(rarityRank(collection)).toBeUndefined()
		// @ts-expect-error — same for the bare `{ id }` shape the old type allowed.
		expect(rarityRank({ id: 'rarity_ancient_weapon' })).toBe(6)
	})

	test('compareByRarity sorts ascending and puts unranked first', () => {
		const sorted = ['rarity_ancient_weapon', null, 'rarity_common_weapon'].sort(compareByRarity)
		expect(sorted).toEqual([null, 'rarity_common_weapon', 'rarity_ancient_weapon'])
	})
})

describe('taxonomy, on the fixture', () => {
	test('every fixture row lands in a known category', () => {
		for (const skin of fixtureSkins) expect(skinCategory(skin)).not.toBeNull()
	})

	test('an unknown category id returns null rather than widening the union', () => {
		const alien = { ...(fixtureSkins[0] as Skin), category: { id: 'csgo_category_lightsabers', name: 'x' } }
		expect(skinCategory(alien)).toBeNull()
	})

	test('the category keys and ids are a bijection', () => {
		const ids = SKIN_CATEGORIES.map(key => SKIN_CATEGORY_IDS[key])
		expect(new Set(ids).size).toBe(SKIN_CATEGORIES.length)
	})

	test('weapon types are one per defindex, never one per weapon.id', () => {
		const types = listWeaponTypes(fixtureSkins)
		const defindexes = new Set(fixtureSkins.map(skin => skin.weapon.weapon_id))
		expect(types.length).toBe(defindexes.size)
		// The fixture holds both spellings of the Bayonet, and they must not split into two types.
		const bayonet = types.filter(type => type.defindex === 500)
		expect(bayonet.length).toBe(1)
		expect(bayonet[0]?.id).toBe('weapon_bayonet')
		expect(bayonet[0]?.hasVanilla).toBe(true)
	})

	/*
	 * The other regression. `findSkin(skins, { defindex: 500, paintindex: 0 })?.weapon.id` is
	 * `sfui_wpnhud_knifebayonet` — a HUD string, not an item name — so a renderer keying a model path
	 * off the row goes looking for a model that does not exist. The row stays raw on purpose (it is
	 * the exporter's bytes, and identity with the fetched array has to hold), so the fix is that
	 * `weaponOf` exists, `resolveItem` carries it, and both are the documented path.
	 */
	test('weaponOf resolves the vanilla-knife alias that the raw row keeps', () => {
		const vanilla = fixtureSkins.find(skin => skin.weapon.id.startsWith('sfui_') && skin.weapon.weapon_id === 500)
		expect(vanilla).toBeDefined()
		expect((vanilla as Skin).weapon.id).toBe('sfui_wpnhud_knifebayonet')

		const resolved = weaponOf(fixtureSkins, vanilla as Skin)
		expect(resolved.id).toBe('weapon_bayonet')
		expect(resolved.defindex).toBe(500)
		expect(resolved.category).toBe('knives')
		expect(resolved.aliased).toBe(false)
	})

	test('weaponOf leaves a non-alias row alone', () => {
		for (const skin of fixtureSkins) {
			if (skin.weapon.id.startsWith('sfui_')) continue
			const resolved = weaponOf(fixtureSkins, skin)
			expect({ id: resolved.id, aliased: resolved.aliased }).toEqual({ id: skin.weapon.id, aliased: false })
		}
	})

	test('weaponOf reports `aliased` rather than guessing when the rows hold no item name', () => {
		// Defindex 503 is vanilla-only in this fixture, so there is nothing to resolve with. Returning
		// the row's own id and saying so beats inventing `weapon_knife_css` from a baked-in table.
		const classic = fixtureSkins.find(skin => skin.weapon.weapon_id === 503) as Skin
		const resolved = weaponOf(fixtureSkins, classic)
		expect(resolved.id).toBe('sfui_wpnhud_knifecss')
		expect(resolved.aliased).toBe(true)

		// Given a list that does contain a finished Classic Knife, it resolves.
		const withFinish = [
			...fixtureSkins,
			{ ...classic, id: 'synthetic', weapon: { ...classic.weapon, id: 'weapon_knife_css' } },
		]
		expect(weaponOf(withFinish, classic).id).toBe('weapon_knife_css')
		expect(weaponOf(withFinish, classic).aliased).toBe(false)
	})

	test('the index resolves the alias identically, and never mutates the row', () => {
		const index = createSkinIndex(fixtureSkins)
		for (const skin of fixtureSkins) {
			expect(index.weaponOf(skin)).toEqual(weaponOf(fixtureSkins, skin))
		}
		// The row handed back by a lookup is the same object that is in the array — resolving must not
		// have rewritten it.
		const vanilla = index.find({ defindex: 500, paintindex: 0 }) as Skin
		expect(vanilla.weapon.id).toBe('sfui_wpnhud_knifebayonet')
		expect(fixtureSkins).toContain(vanilla)
	})

	test('an sfui_ alias only survives when the rows given hold no item name for that defindex', () => {
		// The fixture is deliberately lopsided: defindex 500 has both spellings, so the item name has
		// to win; defindex 503 has only the vanilla row, so there is no item name to promote and the
		// alias is the honest answer. Over the full export neither case is a problem — every defindex
		// has a finish row — but a caller querying an already-filtered list can hit the second.
		for (const type of listWeaponTypes(fixtureSkins)) {
			const rows = skinsForWeapon(fixtureSkins, type.defindex)
			const hasItemName = rows.some(skin => !skin.weapon.id.startsWith('sfui_'))
			expect({ defindex: type.defindex, alias: type.id.startsWith('sfui_') }).toEqual({
				defindex: type.defindex,
				alias: !hasItemName,
			})
		}
	})

	test('listing by category agrees with filtering by it', () => {
		for (const key of SKIN_CATEGORIES) {
			const rows = skinsInCategory(fixtureSkins, key)
			const types = listWeaponTypes(fixtureSkins, key)
			expect(types.length).toBe(new Set(rows.map(skin => skin.weapon.weapon_id)).size)
			for (const type of types) expect(type.category).toBe(key)
		}
	})

	test('knives, gloves and guns partition the fixture with the Zeus left over', () => {
		const total = knifeSkins(fixtureSkins).length + gloveSkins(fixtureSkins).length + gunSkins(fixtureSkins).length
		const zeus = skinsInCategory(fixtureSkins, 'equipment').length
		expect(total + zeus).toBe(fixtureSkins.length)
	})

	test('listCategories counts agree with the filters', () => {
		for (const summary of listCategories(fixtureSkins)) {
			expect(summary.skinCount).toBe(skinsInCategory(fixtureSkins, summary.key).length)
			expect(summary.weaponCount).toBe(listWeaponTypes(fixtureSkins, summary.key).length)
		}
	})

	test('listKnifeTypes and listGloveTypes are the category-narrowed list', () => {
		expect(listKnifeTypes(fixtureSkins)).toEqual(listWeaponTypes(fixtureSkins, 'knives'))
		expect(listGloveTypes(fixtureSkins)).toEqual(listWeaponTypes(fixtureSkins, 'gloves'))
		for (const type of listGunTypes(fixtureSkins)) {
			expect(['knives', 'gloves', 'equipment']).not.toContain(type.category)
		}
	})
})

/*
 * The weapon id as a key. These exist because the defindex is the key everywhere else in this
 * package, and a WeaponPaints-schema database holds the item NAME in `wp_player_knife.knife`.
 */
describe('weapon id as a key, on the fixture', () => {
	test('the map is one entry per weapon type and agrees with listWeaponTypes', () => {
		const map = weaponDefindexes(fixtureSkins)
		const types = listWeaponTypes(fixtureSkins)

		expect(Object.keys(map).length).toBe(types.length)
		for (const type of types) expect(map[type.id]).toBe(type.defindex)

		// The fixture is deliberately lopsided: one defindex has only its vanilla row, so its `id` IS
		// the alias and that key is the honest answer. Every other key is an item name.
		for (const key of Object.keys(map)) {
			if (!key.startsWith('sfui_')) continue
			const rows = skinsForWeapon(fixtureSkins, map[key] as number)
			expect(rows.every(skin => skin.weapon.id.startsWith('sfui_'))).toBe(true)
		}
	})

	test('weaponIdsByDefindex is the exact inverse of weaponDefindexes', () => {
		const forward = weaponDefindexes(fixtureSkins)
		const back = weaponIdsByDefindex(fixtureSkins)

		expect(Object.keys(back).length).toBe(Object.keys(forward).length)
		for (const [id, defindex] of Object.entries(forward)) expect(back[defindex]).toBe(id)
	})

	test('defindexForWeaponId accepts the alias as well as the item name', () => {
		const vanilla = fixtureSkins.find(skin => skin.weapon.id.startsWith('sfui_')) as Skin
		const resolved = weaponOf(fixtureSkins, vanilla)

		expect(defindexForWeaponId(fixtureSkins, vanilla.weapon.id)).toBe(vanilla.weapon.weapon_id)
		expect(defindexForWeaponId(fixtureSkins, resolved.id)).toBe(vanilla.weapon.weapon_id)
		expect(defindexForWeaponId(fixtureSkins, 'weapon_not_a_thing')).toBeUndefined()
	})

	test('weaponIdForDefindex prefers the item name over the alias', () => {
		for (const type of listWeaponTypes(fixtureSkins)) {
			expect(weaponIdForDefindex(fixtureSkins, type.defindex)).toBe(type.id)
		}
		expect(weaponIdForDefindex(fixtureSkins, 999999)).toBeUndefined()
	})

	test('normalizeWeaponId is the string-only form of weaponOf', () => {
		for (const skin of fixtureSkins) {
			expect(normalizeWeaponId(fixtureSkins, skin.weapon.id)).toBe(weaponOf(fixtureSkins, skin).id)
		}
		// An id the rows have never heard of comes back untouched rather than throwing.
		expect(normalizeWeaponId(fixtureSkins, 'sfui_wpnhud_nothing')).toBe('sfui_wpnhud_nothing')
		expect(normalizeWeaponId(fixtureSkins, 'weapon_ak47')).toBe('weapon_ak47')
	})

	test('the index keys every spelling, aliases included, and resolves them', () => {
		const index = createSkinIndex(fixtureSkins)

		expect(index.byWeaponId.size).toBe(new Set(fixtureSkins.map(skin => skin.weapon.id)).size)
		for (const skin of fixtureSkins) {
			const type = index.weaponById(skin.weapon.id)
			expect(type?.defindex).toBe(skin.weapon.weapon_id)
			// The alias resolves rather than misses: the type it lands on carries the item name.
			expect(type?.id).toBe(weaponOf(fixtureSkins, skin).id)
		}
		expect(index.weaponById('weapon_not_a_thing')).toBeUndefined()
	})

	test('the index agrees with the free functions', () => {
		const index = createSkinIndex(fixtureSkins)

		for (const [id, defindex] of Object.entries(weaponDefindexes(fixtureSkins))) {
			expect(index.weaponById(id)?.defindex).toBe(defindex)
			expect(index.weaponFor(defindex)?.id).toBe(weaponIdForDefindex(fixtureSkins, defindex))
		}
	})
})

describe('selecting a weapon, on the fixture', () => {
	test('a defindex, an id and a display name all find the same rows', () => {
		const byDefindex = skinsForWeapon(fixtureSkins, 3)
		expect(byDefindex.length).toBeGreaterThan(0)
		expect(skinsForWeapon(fixtureSkins, 'weapon_fiveseven')).toEqual(byDefindex)
		expect(skinsForWeapon(fixtureSkins, 'Five-SeveN')).toEqual(byDefindex)
		expect(skinsForWeapon(fixtureSkins, 'five-seven')).toEqual(byDefindex)
	})

	test('an object with a defindex works, so a decoded inspect link can be passed straight in', () => {
		expect(skinsForWeapon(fixtureSkins, { defindex: 3 })).toEqual(skinsForWeapon(fixtureSkins, 3))
	})

	test('the defindex finds both knife spellings where weapon.id finds only one', () => {
		const all = skinsForWeapon(fixtureSkins, 500)
		const byItemName = skinsForWeapon(fixtureSkins, 'weapon_bayonet')
		const byHudAlias = skinsForWeapon(fixtureSkins, 'sfui_wpnhud_knifebayonet')
		expect(byHudAlias.length).toBe(1)
		expect(byItemName.length + byHudAlias.length).toBe(all.length)
	})

	test('an unknown weapon is an empty array, not a throw', () => {
		expect(skinsForWeapon(fixtureSkins, 99_999)).toEqual([])
		expect(skinsForWeapon(fixtureSkins, 'weapon_lightsaber')).toEqual([])
	})
})

describe('field accessors, on the fixture', () => {
	test('paintIndexOf normalises the vanilla knife null to 0', () => {
		const vanillaKnife = fixtureSkins.find(skin => skin.paint_index === null) as Skin
		expect(paintIndexOf(vanillaKnife)).toBe(0)
		const vanillaGun = fixtureSkins.find(skin => skin.paint_index === '0') as Skin
		expect(paintIndexOf(vanillaGun)).toBe(0)
	})

	test('wearsOf returns [] on a vanilla row instead of throwing on a missing key', () => {
		for (const skin of vanillaSkins(fixtureSkins)) {
			expect('wears' in skin).toBe(false)
			expect(wearsOf(skin)).toEqual([])
		}
	})

	test('wearsOf mirrors the row and stays in ascending wear order', () => {
		for (const skin of fixtureSkins) {
			const tiers = wearsOf(skin)
			expect(tiers.map(tier => String(tier.name))).toEqual((skin.wears ?? []).map(wear => wear.name))
			for (let i = 1; i < tiers.length; i++) {
				expect(tiers[i]?.min).toBeGreaterThan(tiers[i - 1]?.min as number)
			}
		}
	})

	test('skinsWithWear only returns rows whose finish reaches that exterior', () => {
		for (const skin of skinsWithWear(fixtureSkins, 'Battle-Scarred')) {
			expect(wearsOf(skin).some(tier => tier.short === 'BS')).toBe(true)
		}
		expect(skinsWithWear(fixtureSkins, 'Pristine')).toEqual([])
	})
})

describe('lookups, on the fixture', () => {
	test('findSkin resolves a (defindex, paintindex) pair', () => {
		const target = fixtureSkins.find(skin => skin.paint_index === '309') as Skin
		const found = findSkin(fixtureSkins, { defindex: target.weapon.weapon_id, paintindex: 309 })
		expect(found?.id).toBe(target.id)
		expect(found?.name).toBe('M4A4 | Howl')
	})

	test('findSkin tells the two vanilla spellings apart by defindex', () => {
		expect(findSkin(fixtureSkins, { defindex: 500, paintindex: 0 })?.id).toBe('skin-vanilla-weapon_bayonet')
		expect(findSkin(fixtureSkins, { defindex: 1, paintindex: 0 })?.id).toBe('skin-vanilla-weapon_deagle')
	})

	test('a pair that is not there is undefined', () => {
		expect(findSkin(fixtureSkins, { defindex: 7, paintindex: 999_999 })).toBeUndefined()
	})

	test('findSkinById is exact', () => {
		expect(findSkinById(fixtureSkins, 'skin-vanilla-weapon_bayonet')?.name).toBe('★ Bayonet')
		expect(findSkinById(fixtureSkins, 'skin-nope')).toBeUndefined()
	})

	test('skinsByName returns every phase of a Doppler family', () => {
		const doppler = skinsByName(fixtureSkins, '★ Paracord Knife | Doppler')
		expect(doppler.length).toBe(2)
		expect(new Set(doppler.map(skin => skin.phase))).toEqual(new Set(['Black Pearl', 'Phase 4']))
		// Same name, same weapon, different paint index — which is why a name is not a key.
		expect(new Set(doppler.map(skin => skin.weapon.weapon_id)).size).toBe(1)
		expect(new Set(doppler.map(skin => skin.paint_index)).size).toBe(2)
	})

	test('skinsByPaintIndex accepts the string form the data uses', () => {
		expect(skinsByPaintIndex(fixtureSkins, 309)).toEqual(skinsByPaintIndex(fixtureSkins, '309'))
	})

	test('phasesOf returns the family for a phase row and nothing for anything else', () => {
		const phased = fixtureSkins.find(skin => skin.phase !== undefined) as Skin
		expect(phasesOf(fixtureSkins, phased).length).toBeGreaterThan(0)
		const plain = fixtureSkins.find(skin => skin.phase === undefined) as Skin
		expect(phasesOf(fixtureSkins, plain)).toEqual([])
	})
})

describe('groupings, on the fixture', () => {
	test('collections and crates are deduped with counts that add up', () => {
		for (const group of listCollections(fixtureSkins)) {
			const rows = fixtureSkins.filter(skin => skin.collections?.some(entry => entry.id === group.id))
			expect(group.skinCount).toBe(rows.length)
		}
		for (const group of listCrates(fixtureSkins)) {
			const rows = fixtureSkins.filter(skin => skin.crates.some(entry => entry.id === group.id))
			expect(group.skinCount).toBe(rows.length)
		}
	})
})

describe('the index agrees with the free functions', () => {
	const index = createSkinIndex(fixtureSkins)

	test('find / findById / forWeapon / findByName match', () => {
		for (const skin of fixtureSkins) {
			const ref = { defindex: skin.weapon.weapon_id, paintindex: paintIndexOf(skin) }
			expect(index.find(ref)?.id).toBe(findSkin(fixtureSkins, ref)?.id as string)
			expect(index.findById(skin.id)?.id).toBe(skin.id)
			expect(index.forWeapon(skin.weapon.weapon_id)).toEqual(skinsForWeapon(fixtureSkins, skin.weapon.weapon_id))
			expect(index.findByName(skin.name)).toEqual(skinsByName(fixtureSkins, skin.name))
		}
	})

	test('weaponTypes matches listWeaponTypes for every category', () => {
		expect(index.weaponTypes()).toEqual(listWeaponTypes(fixtureSkins))
		for (const key of SKIN_CATEGORIES) expect(index.weaponTypes(key)).toEqual(listWeaponTypes(fixtureSkins, key))
	})

	test('a miss is undefined or empty, never a wrong row', () => {
		expect(index.find({ defindex: 7, paintindex: 999_999 })).toBeUndefined()
		expect(index.findById('nope')).toBeUndefined()
		expect(index.findByName('nope')).toEqual([])
		expect(index.forWeapon(99_999)).toEqual([])
	})
})

/* --------------------------------------------------------------------------------------------
 * Tiers 2 and 3 — the full export.
 * ------------------------------------------------------------------------------------------ */

const FULL = process.env.SKINHUB_CDN_FIXTURES
const hasFull = Boolean(FULL && existsSync(join(FULL, 'skins.json')))

describe.skipIf(!hasFull)('invariants the return types depend on', () => {
	let skins: Skins = []

	test('load', async () => {
		skins = await readJson<Skins>(FULL as string, 'skins.json')
		expect(skins.length).toBeGreaterThan(2000)
	})

	test('(defindex, paintindex) is a key — this is what lets findSkin return one row', () => {
		const seen = new Map<string, Skin[]>()
		for (const skin of skins) {
			const key = `${skin.weapon.weapon_id}:${paintIndexOf(skin)}`
			const bucket = seen.get(key)
			if (bucket) bucket.push(skin)
			else seen.set(key, [skin])
		}
		const collisions = [...seen.entries()].filter(([, rows]) => rows.length > 1)
		expect(collisions).toEqual([])
		expect(seen.size).toBe(skins.length)
	})

	test('skin.id is a key', () => {
		expect(new Set(skins.map(skin => skin.id)).size).toBe(skins.length)
	})

	test('weapon.id is NOT a key, which is why WeaponType is built on the defindex', () => {
		const ids = new Set(skins.map(skin => skin.weapon.id))
		const defindexes = new Set(skins.map(skin => skin.weapon.weapon_id))
		expect(ids.size).toBeGreaterThan(defindexes.size)

		// Every extra id is an sfui_ hud alias on a vanilla knife row, and every defindex has
		// exactly one real item name. Both halves matter: the first says the aliases are the whole
		// discrepancy, the second says picking the non-alias is well-defined.
		const perDefindex = new Map<number, Set<string>>()
		for (const skin of skins) {
			const bucket = perDefindex.get(skin.weapon.weapon_id) ?? new Set<string>()
			bucket.add(skin.weapon.id)
			perDefindex.set(skin.weapon.weapon_id, bucket)
		}
		let aliases = 0
		for (const bucket of perDefindex.values()) {
			const real = [...bucket].filter(id => !id.startsWith('sfui_'))
			expect(real.length).toBe(1)
			aliases += bucket.size - 1
		}
		expect(defindexes.size + aliases).toBe(ids.size)
	})

	test('a defindex has exactly one name and one category', () => {
		const names = new Map<number, Set<string>>()
		const categories = new Map<number, Set<string>>()
		for (const skin of skins) {
			names.set(skin.weapon.weapon_id, (names.get(skin.weapon.weapon_id) ?? new Set()).add(skin.weapon.name))
			categories.set(
				skin.weapon.weapon_id,
				(categories.get(skin.weapon.weapon_id) ?? new Set()).add(skin.category.id),
			)
		}
		for (const set of names.values()) expect(set.size).toBe(1)
		for (const set of categories.values()) expect(set.size).toBe(1)
	})

	test('the 63 real weapon ids are themselves unique', () => {
		const types = listWeaponTypes(skins)
		expect(new Set(types.map(type => type.id)).size).toBe(types.length)
	})

	test('paint_index is a clean integer string wherever it is not null', () => {
		for (const skin of skins) {
			if (skin.paint_index === null) continue
			expect(String(Number(skin.paint_index))).toBe(skin.paint_index)
		}
	})

	test('a name only ever collides between phases of one weapon', () => {
		const byName = new Map<string, Skins>()
		for (const skin of skins) {
			const bucket = byName.get(skin.name)
			if (bucket) bucket.push(skin)
			else byName.set(skin.name, [skin])
		}
		const collisions = [...byName.values()].filter(rows => rows.length > 1)
		expect(collisions.length).toBeGreaterThan(0)

		for (const rows of collisions) {
			// One weapon…
			expect(new Set(rows.map(skin => skin.weapon.weapon_id)).size).toBe(1)
			// …every row phased, and no two the same phase.
			expect(rows.every(skin => skin.phase !== undefined)).toBe(true)
			expect(new Set(rows.map(skin => skin.phase)).size).toBe(rows.length)
		}

		// And the colliding rows are exactly the phased rows — nothing else shares a name.
		const collidingRows = collisions.reduce((sum, rows) => sum + rows.length, 0)
		expect(collidingRows).toBe(skins.filter(skin => skin.phase !== undefined).length)
	})

	test('every category id in the export is one the package knows', () => {
		for (const skin of skins) expect(skinCategory(skin)).not.toBeNull()
	})

	test('the vanilla rows are the ones with no wears, in exactly two spellings', () => {
		const noWears = skins.filter(skin => !('wears' in skin))
		expect(vanillaSkins(skins).length).toBe(noWears.length)
		for (const skin of noWears) {
			expect(skin.pattern).toBeNull()
			expect(skin.min_float).toBeNull()
			expect(skin.max_float).toBeNull()
			expect(skin.paint_index === null || skin.paint_index === '0').toBe(true)
		}
	})

	test('the wear thresholds reproduce the exporter’s own wears array on every row', () => {
		let checked = 0
		for (const skin of skins) {
			if (!skin.wears || skin.min_float === null || skin.max_float === null) continue
			const derived = WEAR_TIERS.filter(tier =>
				skin.min_float === skin.max_float
					? (skin.min_float as number) >= tier.min && (skin.min_float as number) < tier.max
					: (skin.min_float as number) < tier.max && (skin.max_float as number) > tier.min,
			)
			expect({ skin: skin.id, wears: derived.map(tier => String(tier.name)) }).toEqual({
				skin: skin.id,
				wears: skin.wears.map(wear => wear.name),
			})
			checked++
		}
		expect(checked).toBeGreaterThan(2000)
	})

	test('every rarity id in the export ranks, and the ranks are items_game’s own', async () => {
		for (const skin of skins) expect(rarityRank(skin.rarity)).not.toBeUndefined()

		const itemsGame = await readJson<ItemsGame>(FULL as string, 'items_game.json')
		const rarities = itemsGame.items_game.rarities as Record<string, { value: string | number }>
		for (const [token, entry] of Object.entries(rarities)) {
			expect({ token, rank: rarityRank(token) as number | undefined }).toEqual({
				token,
				rank: Number(entry.value),
			})
		}
	})
})

describe.skipIf(!hasFull)('the figures quoted in the doc comments', () => {
	let skins: Skins = []

	test('load', async () => {
		skins = await readJson<Skins>(FULL as string, 'skins.json')
	})

	test('row and category counts', () => {
		expect(skins.length).toBe(2161)
		expect(Object.fromEntries(listCategories(skins).map(row => [row.key, row.skinCount]))).toEqual({
			rifles: 500,
			smgs: 311,
			heavy: 222,
			pistols: 450,
			knives: 576,
			gloves: 94,
			equipment: 8,
		})
		expect(knifeSkins(skins).length).toBe(576)
		expect(gloveSkins(skins).length).toBe(94)
		expect(gunSkins(skins).length).toBe(1483)
	})

	test('weapon id maps', () => {
		// The figures the `weaponDefindexes` doc quotes: 63 entries, the 20 aliases dropped, and the
		// 8 glove ids present without `gloves.json`.
		const map = weaponDefindexes(skins)
		expect(Object.keys(map).length).toBe(63)
		expect(Object.keys(map).filter(id => id.startsWith('sfui_')).length).toBe(0)
		expect(new Set(skins.map(skin => skin.weapon.id)).size - Object.keys(map).length).toBe(20)

		expect(map.weapon_ak47).toBe(7)
		expect(map.weapon_bayonet).toBe(500)
		expect(map.sporty_gloves).toBe(5030)

		const gloveIds = listGloveTypes(skins).map(type => type.id)
		expect(gloveIds.length).toBe(8)
		for (const id of gloveIds) expect(map[id]).toBe(defindexForWeaponId(skins, id) as number)

		// Both directions round-trip over the whole export.
		const back = weaponIdsByDefindex(skins)
		for (const [id, defindex] of Object.entries(map)) {
			expect(back[defindex]).toBe(id)
			expect(weaponIdForDefindex(skins, defindex)).toBe(id)
		}

		// Every alias in the data normalises to an item name - none is left unresolved on the full
		// export, which is the difference between it and the deliberately-lopsided fixture.
		const aliases = [...new Set(skins.map(skin => skin.weapon.id))].filter(id => id.startsWith('sfui_'))
		expect(aliases.length).toBe(20)
		for (const alias of aliases) expect(normalizeWeaponId(skins, alias).startsWith('sfui_')).toBe(false)
	})

	test('weapon type counts', () => {
		expect(listWeaponTypes(skins).length).toBe(63)
		expect(Object.fromEntries(SKIN_CATEGORIES.map(key => [key, listWeaponTypes(skins, key).length]))).toEqual({
			rifles: 11,
			smgs: 7,
			heavy: 6,
			pistols: 10,
			knives: 20,
			gloves: 8,
			equipment: 1,
		})
		expect(listGunTypes(skins).length).toBe(34)
		expect(new Set(skins.map(skin => skin.weapon.id)).size).toBe(83)
	})

	test('the per-weapon figures the doc comments quote', () => {
		// `skinsForWeapon`'s example block. This was 46 when it was written and is 62 now, which is
		// exactly the drift this tier exists to catch.
		expect(skinsForWeapon(skins, 7).length).toBe(62)
		expect(skinsForWeapon(skins, 'weapon_ak47').length).toBe(62)
		expect(skinsForWeapon(skins, 'AK-47').length).toBe(62)

		// The Bayonet split the same block documents: 35 by defindex, 34 by item name, 1 by alias.
		expect(skinsForWeapon(skins, 500).length).toBe(35)
		expect(skinsForWeapon(skins, 'Bayonet').length).toBe(35)
		expect(skinsForWeapon(skins, 'weapon_bayonet').length).toBe(34)
		expect(skinsForWeapon(skins, 'sfui_wpnhud_knifebayonet').length).toBe(1)

		// `skinsByName`'s example: the seven Bayonet Doppler phases.
		expect(skinsByName(skins, '★ Bayonet | Doppler').length).toBe(7)
	})

	test('vanilla, phase and collision counts', () => {
		expect(vanillaSkins(skins).length).toBe(55)
		expect(skins.filter(skin => skin.paint_index === null).length).toBe(20)
		expect(skins.filter(skin => skin.paint_index === '0').length).toBe(35)
		expect(skins.filter(skin => skin.phase !== undefined).length).toBe(181)
		expect(new Set(skins.map(skin => skin.name)).size).toBe(2009)
		expect(skins.filter(skin => skin.collections?.length === 0).length).toBe(651)
	})

	test('paint index spread', () => {
		const nonNull = skins.filter(skin => skin.paint_index !== null)
		expect(new Set(nonNull.map(skin => skin.paint_index)).size).toBe(1480)
		const multi = [...new Set(nonNull.map(skin => paintIndexOf(skin)))].filter(
			index => skinsByPaintIndex(skins, index).length > 1,
		)
		expect(multi.length).toBe(113)
		expect(skinsByPaintIndex(skins, 44).length).toBe(23)
	})

	test('quality flag counts', () => {
		expect(statTrakSkins(skins).length).toBe(1274)
		expect(skins.filter(skin => skin.souvenir === true).length).toBe(1456)
	})

	test('gloves are no longer confined to the 10000+ paint index band', () => {
		// The claim behind `isGlove` testing the category rather than the paint index. A consumer
		// carrying the old `paintIndex >= 10000` rule of thumb misclassifies these 22 rows as guns.
		const gloves = gloveSkins(skins)
		const belowBand = gloves.filter(skin => paintIndexOf(skin) < 10_000)
		expect(gloves.length).toBe(94)
		expect(belowBand.length).toBe(22)
		expect(Math.min(...belowBand.map(paintIndexOf))).toBe(1398)
		expect(Math.max(...belowBand.map(paintIndexOf))).toBe(1440)

		// And the bands genuinely overlap now: the highest non-glove index is above the lowest glove.
		const nonGlove = skins.filter(skin => !gloves.includes(skin)).map(paintIndexOf)
		expect(Math.max(...nonGlove)).toBe(1477)
		expect(nonGlove.filter(index => index >= 10_000).length).toBe(0)
	})

	test('collection and crate counts', () => {
		expect(listCollections(skins).length).toBe(94)
		expect(listCrates(skins).length).toBe(196)
	})

	// Written after shipping `{ defindex: 7, paintindex: 279 } // AK-47 | Asiimov` in four doc
	// comments and the README. 279 is the AWP's Asiimov; the AK's is 801. Nothing caught it, because
	// a wrong example in a comment compiles, passes and reads perfectly — so this reads the examples
	// back out of the docs and resolves them.
	test('every (defindex, paintindex) example in the docs resolves to the row it claims', async () => {
		const root = join(import.meta.dir, '..')
		const sources = [
			'README.md',
			'src/query/index.ts',
			'src/query/lookup.ts',
			'src/query/market.ts',
			'src/query/resolve.ts',
			'src/query/skins.ts',
		]

		let examples = 0
		for (const file of sources) {
			const text = await readFile(join(root, file), 'utf8')
			for (const line of text.split('\n')) {
				const pair = /defindex:?\s*(\d+)[,\s].*?paintindex:?\s*(\d+)/.exec(line)
				if (!pair) continue

				const found = findSkin(skins, { defindex: Number(pair[1]), paintindex: Number(pair[2]) })
				expect({ file, line: line.trim(), resolved: found !== undefined }).toEqual({
					file,
					line: line.trim(),
					resolved: true,
				})

				// If the line also names an item, it has to be that item.
				const claimed = /\/\/.*?([A-Za-z0-9★][^|]*\|[^(]+)/.exec(line)?.[1]?.trim()
				if (claimed && found) {
					expect({ file, claimed, actual: found.name }).toEqual({ file, claimed, actual: claimed })
				}
				examples++
			}
		}
		expect(examples).toBeGreaterThan(4)
	})
})
