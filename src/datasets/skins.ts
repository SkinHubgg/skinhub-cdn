/**
 * `data/skins.json` — 2,161 rows, 4.2 MB. **The whole weapon catalogue, knives and gloves
 * included**: 1,483 gun rows, 576 melee, 94 glove, 8 Zeus. Nothing else has to be fetched to answer
 * "what exists" — `@skinhub/cdn/query` runs entirely off this one file.
 *
 * The shape is measured off the real export, not copied from the interface that used to describe
 * it. Four differences worth knowing, because each one is a bug waiting in code written against
 * the old type:
 *
 * 1. **55 rows are vanilla — finish-less — and they come in two spellings.** The 20 vanilla knives
 *    (`skin-vanilla-weapon_bayonet` and its siblings) carry `paint_index: null`; the 35 vanilla guns
 *    (`skin-vanilla-weapon_deagle`, …) carry `paint_index: '0'` and `rarity.id
 *    rarity_default_weapon`. All 55 have `pattern`, `min_float` and `max_float` null and `souvenir`,
 *    `wears` and `collections` as **absent keys**. Two different flavours of missing in one file, so
 *    the type models both: nullable for the first three, optional for the last three. Prefer
 *    `isVanilla` and `wearsOf` from `@skinhub/cdn/query` over testing for either spelling by hand.
 * 2. **`phase` is on 181 of 2,161 rows.** Typing it `string` would claim 1,980 rows have a phase
 *    they do not; it is optional, and its values are the eight the export actually contains. Those
 *    181 rows are also the only reason `name` is not unique — 29 names cover all of them.
 * 3. **`weapon.weapon_id`, `legacy_model` and `original` exist** and the old interface had none of
 *    them. `weapon.weapon_id` is the item definition index — the number an inventory row stores, the
 *    number a decoded inspect link calls `defindex`, and the only stable key a weapon has.
 *    `weapon.id` is not one: 83 distinct values against 63 defindexes, because every vanilla knife
 *    row carries an `sfui_wpnhud_*` alias in place of the item name.
 * 4. **`category` is never null.** The old type had `category.id` and `category.name` as
 *    `string | null`; across 2,161 rows neither is.
 *
 * One field is a trap rather than a shape: **`souvenir` does not mean a Souvenir version exists.**
 * It is `true` on 1,456 rows including `AK-47 | Asiimov`, and it contradicts `stattrak` on 698 of
 * them. Use `canBeSouvenir` from `@skinhub/cdn/query`, which derives it from the drop source.
 */

import { fetchCdnData } from '../fetch.js'
import type { DatasetOptions } from '../fetch.js'
import type { ImageUrl, Open } from './common.js'

/** The eight Doppler / Gamma Doppler variants the export names. */
export type SkinPhase = Open<
	'Phase 1' | 'Phase 2' | 'Phase 3' | 'Phase 4' | 'Ruby' | 'Sapphire' | 'Emerald' | 'Black Pearl'
>

export type SkinWeapon = {
	/**
	 * `weapon_ak47` — **except on the 20 vanilla knife rows, where it is a `sfui_wpnhud_*` HUD
	 * string** (`sfui_wpnhud_knifebayonet`) rather than the item name.
	 *
	 * ⚠️ **Do not key a model path, a route or a group-by off this field.** It is not the weapon's
	 * identity: across 2,161 rows there are 83 distinct values here against 63 distinct `weapon_id`s,
	 * and the 20 extras are all HUD aliases. Grouping by it lists every knife twice; rendering from it
	 * asks for a model that does not exist.
	 *
	 * Use `weaponOf(skins, skin)` from `@skinhub/cdn/query`, or `resolveItem(...).weapon`, both of
	 * which resolve the alias. Use `weapon_id` below when you just want the key.
	 */
	id: string
	/**
	 * The item definition index — 7 for the AK-47, 500 for the Bayonet.
	 *
	 * The stable identity, and the same number a decoded inspect link calls `defindex`.
	 */
	weapon_id: number
	name: string
}

export type SkinCategory = {
	/** `csgo_inventory_weapon_category_rifles`, `sfui_invpanel_filter_melee`, … */
	id: string
	name: string
}

export type SkinPattern = {
	/** The paint kit name: `cu_ak47_asiimov`. */
	id: string
	name: string
}

export type SkinRarity = {
	/** `rarity_ancient_weapon`, `rarity_contraband_weapon`, … */
	id: string
	name: string
	/** `#eb4b4b` — the grade colour, hex with the leading `#`. */
	color: string
}

export type SkinWear = {
	/** `SFUI_InvTooltip_Wear_Amount_0` … `_4`. */
	id: string
	/** `Factory New` … `Battle-Scarred`. */
	name: string
}

export type SkinCollection = {
	id: string
	name: string
	image: ImageUrl
}

export type SkinCrate = {
	id: string
	name: string
	image: ImageUrl
}

export type SkinTeam = {
	id: 'both' | 'terrorists' | 'counter-terrorists'
	name: string
}

export type Skin = {
	/** `skin-b2a5203033ee`, or `skin-vanilla-weapon_bayonet`. Unique across the file. */
	id: string
	/** `AK-47 | Asiimov`. */
	name: string
	description: string
	weapon: SkinWeapon
	category: SkinCategory
	/** `null` on all 55 vanilla rows. */
	pattern: SkinPattern | null
	/** `null` on all 55 vanilla rows. */
	min_float: number | null
	/** `null` on all 55 vanilla rows. */
	max_float: number | null
	rarity: SkinRarity
	/** Whether a StatTrak™ version exists. Reliable — unlike `souvenir`. 1,274 rows. */
	stattrak: boolean
	/**
	 * **Not "a Souvenir version exists".** `true` on 1,456 rows, including 698 that are also
	 * `stattrak: true`, which no real CS2 item is. It reflects what the prefab permits. For the
	 * question you actually mean, use `canBeSouvenir` from `@skinhub/cdn/query`.
	 *
	 * **Absent** on all 55 vanilla rows.
	 */
	souvenir?: boolean
	/**
	 * A decimal string, `'44'`. `null` on the 20 vanilla knives and `'0'` on the 35 vanilla guns.
	 * Not unique on its own — 1,480 distinct values, 113 of which are worn by more than one weapon.
	 * Paired with `weapon.weapon_id` it *is* unique across all 2,161 rows; that pair is the key.
	 */
	paint_index: string | null
	/** **Absent** on all 55 vanilla rows. */
	wears?: SkinWear[]
	/** **Absent** on all 55 vanilla rows; `[]` on 651 of the rest. */
	collections?: SkinCollection[]
	crates: SkinCrate[]
	team: SkinTeam
	/** Whether the finish renders on the pre-2018 model. */
	legacy_model: boolean
	image: ImageUrl
	/** `{ name: 'weapon_ak47' }` — the untranslated item name. */
	original: { name: string }
	/** Present on 181 rows. Absent, never null, on the other 1,980. */
	phase?: SkinPhase
}

export type Skins = Skin[]

/** `data/skins.json`. */
export const SKINS_FILE = 'skins.json'

export const fetchSkins = (options: DatasetOptions<Skins> = {}): Promise<Skins> =>
	fetchCdnData<Skins>(SKINS_FILE, options)
