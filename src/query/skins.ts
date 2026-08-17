/**
 * Querying `skins.json` — the filters and the lookups.
 *
 * ## Every function here is pure, synchronous, and fetches nothing
 *
 * That is a deliberate choice against the obvious alternative, `skinsForWeapon('AK-47')` returning
 * a promise. Three reasons:
 *
 * 1. **A fetching query hides 4.2 MB behind something that looks like a filter.** `skins.json` is
 *    one file; there is no per-weapon endpoint to hit. A `Promise<Skins>` named after a filter
 *    invites an integrator to call it inside a React render, once per weapon in a picker, and the
 *    only thing saving them is a cache they did not know they were relying on.
 * 2. **The data is not always ours.** A consumer with a `fallback` copy, a database mirror, or an
 *    already-filtered subset should get the same query surface. Taking `Skins` as an argument is
 *    what makes that true.
 * 3. **No network code.** `@skinhub/cdn/query` imports nothing from `fetch.js`, `cache.js` or
 *    `config.js` — the same property `@skinhub/cdn/placement` has, and for the same reason. What
 *    you import is what you ship.
 *
 * The one-liner still exists: `@skinhub/cdn/catalog` fetches once and hands back an index. It is a
 * separate entry point precisely so that importing a filter cannot drag a fetch in with it.
 *
 * ## Return types say what was measured
 *
 * Where a key is unique across the export, the function returns `Skin | undefined`. Where it is
 * not, it returns an array — and the doc says how many rows collide and why. `findSkin` is single
 * because `(defindex, paintindex)` was checked unique across all 2,161 rows; `skinsByName` is an
 * array because 29 names cover 181 rows.
 */

import type { Skin, Skins } from '../datasets/skins.js'
import { isGlove, isGun, isKnife, isVanilla, SKIN_CATEGORY_IDS, type SkinCategoryKey, type WeaponType } from './taxonomy.js'
import { type WearTier, WEAR_TIERS, wearTier } from './wear.js'

/* ---------------------------------------------------------------------------------------------
 * Field accessors — the three places the raw shape is awkward.
 * ------------------------------------------------------------------------------------------ */

/**
 * The paint index as the number an inspect link carries.
 *
 * `Skin['paint_index']` is a **decimal string** and it is `null` on the 20 vanilla knives, while the
 * econ item those knives decode to carries `paintindex: 0`. Normalising null to 0 is what makes the
 * two joinable, and it is safe: with null mapped to 0, `(weapon_id, paintindex)` is still unique
 * across all 2,161 rows — 2,161 distinct pairs, 0 collisions. (It could have collided: the 35
 * vanilla *guns* carry the literal string `'0'`. They do not, because no defindex has both a
 * null-paint row and a `'0'`-paint row.)
 *
 * Measured: every non-null `paint_index` round-trips `String(Number(v)) === v`, so there are no
 * leading zeros or non-integers to lose.
 */
export const paintIndexOf = (skin: Skin): number => (skin.paint_index === null ? 0 : Number(skin.paint_index))

/**
 * The exteriors this finish can exist in, as `WearTier`s rather than `{ id, name }` pairs.
 *
 * Returns `[]` for the 55 finish-less rows, which have **no `wears` key at all** — reading
 * `skin.wears.length` on one of those throws. That is the single most likely crash in code written
 * against the raw type, so this is the accessor to prefer.
 *
 * The tiers come from the row's own `wears` array, not recomputed, so the answer is the exporter's.
 */
export const wearsOf = (skin: Skin): WearTier[] => {
	if (!skin.wears) return []
	const tiers: WearTier[] = []
	for (const wear of skin.wears) {
		const tier = WEAR_TIERS.find(candidate => candidate.id === wear.id)
		if (tier) tiers.push(tier)
	}
	return tiers
}

/**
 * The float range a real item of this finish can land in, or `null` on the 55 finish-less rows.
 *
 * `min_float`/`max_float` are the paint kit's `wear_remap_min`/`wear_remap_max`. Across the rows
 * that have them the widest is `[0, 1]` and every value sits inside that.
 */
export const floatRangeOf = (skin: Skin): { min: number; max: number } | null =>
	skin.min_float === null || skin.max_float === null ? null : { min: skin.min_float, max: skin.max_float }

/** Clamp a float into what this finish can actually be. Returns the input for a finish-less row. */
export const clampFloat = (skin: Skin, float: number): number => {
	const range = floatRangeOf(skin)
	if (!range) return float
	return Math.min(range.max, Math.max(range.min, float))
}

/* ---------------------------------------------------------------------------------------------
 * Filters.
 * ------------------------------------------------------------------------------------------ */

/**
 * How you name a weapon.
 *
 * A number is the defindex, which is the key. A string is matched against `weapon.id` first
 * (`weapon_ak47`), then case-insensitively against `weapon.name` (`AK-47`, `ak-47`) — because an
 * integrator holding a display name should not have to look up an id to ask a question. An object
 * with a `defindex` covers `WeaponType`, a decoded inspect link, and a `gloves.json` row after
 * `{ defindex: row.weapon_defindex }`.
 */
export type WeaponSelector = number | string | { defindex: number } | WeaponType

const matchesWeapon = (skin: Skin, selector: WeaponSelector): boolean => {
	if (typeof selector === 'number') return skin.weapon.weapon_id === selector
	if (typeof selector === 'object') return skin.weapon.weapon_id === selector.defindex
	if (skin.weapon.id === selector) return true
	return skin.weapon.name.toLowerCase() === selector.toLowerCase()
}

/**
 * Every finish for one weapon, vanilla row included.
 *
 * ```ts
 * skinsForWeapon(skins, 7)                          // 62 AK-47 rows
 * skinsForWeapon(skins, 'weapon_ak47')              // the same 62
 * skinsForWeapon(skins, 'AK-47')                    // the same 62
 * skinsForWeapon(skins, readInspectUrl(url))        // the same 62, for whatever was inspected
 * ```
 *
 * Matching a knife by `weapon.id` works for either spelling: `'weapon_bayonet'` finds the 34
 * finishes and `'sfui_wpnhud_knifebayonet'` finds the vanilla row, but **`500` and `'Bayonet'` find
 * all 35**, which is what a picker wants. Prefer the defindex.
 */
export const skinsForWeapon = (skins: Skins, weapon: WeaponSelector): Skins =>
	skins.filter(skin => matchesWeapon(skin, weapon))

/** Every row in one category. `skinsInCategory(skins, 'knives')` → 576. */
export const skinsInCategory = (skins: Skins, category: SkinCategoryKey): Skins => {
	const id = SKIN_CATEGORY_IDS[category]
	return skins.filter(skin => skin.category.id === id)
}

/** All 576 knife rows, every type, vanilla rows included. */
export const knifeSkins = (skins: Skins): Skins => skins.filter(isKnife)

/**
 * All 94 glove rows.
 *
 * This is "all gloves" without a second fetch. `gloves.json` is a 95-row side table whose only
 * extra row is `Gloves | Default` with `weapon_defindex: 0`; every real glove finish is here, with
 * a rarity, an image, a float range and a collection that `gloves.json` does not carry.
 */
export const gloveSkins = (skins: Skins): Skins => skins.filter(isGlove)

/** The 1,483 gun rows — rifles, SMGs, heavy and pistols. No knives, gloves or Zeus. */
export const gunSkins = (skins: Skins): Skins => skins.filter(isGun)

/** The 55 finish-less rows: 20 vanilla knives and 35 vanilla guns. */
export const vanillaSkins = (skins: Skins): Skins => skins.filter(isVanilla)

/** Rows that can exist as StatTrak™. */
export const statTrakSkins = (skins: Skins): Skins => skins.filter(skin => skin.stattrak)

/** Rows that can exist as Souvenir. The key is absent on the 55 finish-less rows, so `=== true`. */
export const souvenirSkins = (skins: Skins): Skins => skins.filter(skin => skin.souvenir === true)

/** Rows whose finish can exist in a given exterior. */
export const skinsWithWear = (skins: Skins, wear: string | WearTier): Skins => {
	const tier = wearTier(typeof wear === 'string' ? wear : wear.id)
	if (!tier) return []
	return skins.filter(skin => skin.wears?.some(entry => entry.id === tier.id) === true)
}

/* ---------------------------------------------------------------------------------------------
 * Lookups.
 * ------------------------------------------------------------------------------------------ */

/**
 * The item identity a marketplace actually holds: which weapon, wearing which paint kit.
 *
 * Structurally satisfied by a decoded inspect link — both `SkinPlacement` and `EconItem` have
 * exactly these two fields — so `findSkin(skins, readInspectUrl(url))` compiles and does the right
 * thing.
 */
export type SkinRef = { defindex: number; paintindex: number }

/**
 * The one row for a (defindex, paintindex) pair, or `undefined`.
 *
 * **This is the lookup.** Everything a decoded inspect link, a Steam inventory row or a trade offer
 * gives you reduces to these two numbers, and they are a key: measured across the current export,
 * the 2,161 rows produce 2,161 distinct pairs with zero collisions.
 *
 * Note what is *not* a key. `paint_index` alone is not — 113 of the 1,480 non-null paint indexes
 * appear on more than one weapon (paint kit 44, Case Hardened, is on 23 of them). A defindex alone
 * is not either; it names the weapon, not the item. Neither one identifies a skin on its own, and
 * an API that pretended otherwise would return the wrong row for 113 paint kits.
 */
export const findSkin = (skins: Skins, ref: SkinRef): Skin | undefined =>
	skins.find(skin => skin.weapon.weapon_id === ref.defindex && paintIndexOf(skin) === ref.paintindex)

/** By the export's own row id (`skin-b2a5203033ee`). Unique: 2,161 distinct ids over 2,161 rows. */
export const findSkinById = (skins: Skins, id: string): Skin | undefined => skins.find(skin => skin.id === id)

/**
 * Every row using a paint kit, across all the weapons that wear it.
 *
 * An array because a paint index is not a key: 113 of 1,480 span more than one weapon. Pass the
 * defindex too and use `findSkin` when you know which weapon you mean.
 */
export const skinsByPaintIndex = (skins: Skins, paintIndex: number | string): Skins => {
	const wanted = typeof paintIndex === 'string' ? Number(paintIndex) : paintIndex
	return skins.filter(skin => paintIndexOf(skin) === wanted)
}

/**
 * Every row with a display name, case-insensitively.
 *
 * An array, and this is the interesting one. `name` is unique on 2,009 of 2,161 rows; the rest
 * collide, and the collisions are not noise. Measured: exactly **29 names cover 181 rows**, every
 * group shares one `weapon_id`, and within a group the rows differ only by `phase` — the Doppler
 * and Gamma Doppler families. `★ Bayonet | Doppler` is 7 rows (Phase 1-4, Ruby, Sapphire, Black
 * Pearl) with 7 different paint indexes.
 *
 * Steam does the same thing: all 7 sell under one `market_hash_name`. So a name — and a market hash
 * name — identifies a *listing*, not an item. Only the paint index tells the phases apart, which is
 * why `findSkin` takes one.
 */
export const skinsByName = (skins: Skins, name: string): Skins => {
	const needle = name.trim().toLowerCase()
	return skins.filter(skin => skin.name.toLowerCase() === needle)
}

/* ---------------------------------------------------------------------------------------------
 * Groupings a picker needs.
 * ------------------------------------------------------------------------------------------ */

export type NamedGroup = {
	id: string
	name: string
	image: string
	skinCount: number
}

const groupBy = (skins: Skins, pick: (skin: Skin) => { id: string; name: string; image: string }[]): NamedGroup[] => {
	const found = new Map<string, NamedGroup>()
	for (const skin of skins) {
		for (const entry of pick(skin)) {
			const existing = found.get(entry.id)
			if (existing) existing.skinCount++
			else found.set(entry.id, { id: entry.id, name: entry.name, image: entry.image, skinCount: 1 })
		}
	}
	return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Every collection any row belongs to, with a count. `collections` is absent on 55 rows. */
export const listCollections = (skins: Skins): NamedGroup[] => groupBy(skins, skin => skin.collections ?? [])

/** Every crate any row drops from, with a count. */
export const listCrates = (skins: Skins): NamedGroup[] => groupBy(skins, skin => skin.crates)

/** Rows in one collection, by its id (`set_community_32`). */
export const skinsInCollection = (skins: Skins, collectionId: string): Skins =>
	skins.filter(skin => skin.collections?.some(collection => collection.id === collectionId) === true)

/** Rows dropping from one crate, by its id. */
export const skinsInCrate = (skins: Skins, crateId: string): Skins =>
	skins.filter(skin => skin.crates.some(crate => crate.id === crateId))

/**
 * The phase variants of a finish, keyed by phase name.
 *
 * Only the 181 phase rows have one, so this is empty for everything else. Given any row of a
 * Doppler family it returns the whole family, because the family is exactly "same weapon, same
 * name".
 */
export const phasesOf = (skins: Skins, skin: Skin): Skin[] =>
	skin.phase === undefined
		? []
		: skins.filter(
				candidate => candidate.weapon.weapon_id === skin.weapon.weapon_id && candidate.name === skin.name,
			)
