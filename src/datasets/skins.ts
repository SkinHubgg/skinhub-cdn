/**
 * `data/skins.json` — 2,126 rows, 4.2 MB.
 *
 * The shape is measured off the real export, not copied from the interface that used to describe
 * it. Four differences worth knowing, because each one is a bug waiting in code written against
 * the old type:
 *
 * 1. **20 rows are vanilla weapons** — `skin-vanilla-weapon_bayonet` and its siblings, the knives
 *    with no finish. On those rows `pattern`, `min_float`, `max_float` and `paint_index` are
 *    `null`, and `souvenir`, `wears` and `collections` are **absent keys**. Two different flavours
 *    of missing in one file, so the type models both: nullable for the first four, optional for
 *    the last three.
 * 2. **`phase` is on 181 of 2,126 rows.** Typing it `string` would claim 1,945 rows have a phase
 *    they do not; it is optional, and its values are the eight the export actually contains.
 * 3. **`weapon.weapon_id`, `legacy_model` and `original` exist** and the old interface had none of
 *    them. `weapon.weapon_id` is the item definition index — the number an inventory row stores,
 *    and the one thing that used to require a second lookup table.
 * 4. **`category` is never null.** The old type had `category.id` and `category.name` as
 *    `string | null`; across 2,126 rows neither is.
 */

import { fetchCdnData } from '../fetch.js'
import type { DatasetOptions } from '../fetch.js'
import type { ImageUrl, Open } from './common.js'

/** The eight Doppler / Gamma Doppler variants the export names. */
export type SkinPhase = Open<
	'Phase 1' | 'Phase 2' | 'Phase 3' | 'Phase 4' | 'Ruby' | 'Sapphire' | 'Emerald' | 'Black Pearl'
>

export type SkinWeapon = {
	/** `weapon_ak47`, or `sfui_wpnhud_knifebayonet` on the vanilla knives. */
	id: string
	/** The item definition index — 7 for the AK-47, 500 for the Bayonet. */
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
	/** `null` on the 20 vanilla weapons. */
	pattern: SkinPattern | null
	/** `null` on the 20 vanilla weapons. */
	min_float: number | null
	/** `null` on the 20 vanilla weapons. */
	max_float: number | null
	rarity: SkinRarity
	stattrak: boolean
	/** **Absent** on the 20 vanilla weapons. */
	souvenir?: boolean
	/** A decimal string, `'44'`. `null` on the 20 vanilla weapons. Not unique — 1,480 distinct. */
	paint_index: string | null
	/** **Absent** on the 20 vanilla weapons. */
	wears?: SkinWear[]
	/** **Absent** on the 20 vanilla weapons; `[]` on 671 of the rest. */
	collections?: SkinCollection[]
	crates: SkinCrate[]
	team: SkinTeam
	/** Whether the finish renders on the pre-2018 model. */
	legacy_model: boolean
	image: ImageUrl
	/** `{ name: 'weapon_ak47' }` — the untranslated item name. */
	original: { name: string }
	/** Present on 181 rows. Absent, never null, on the other 1,945. */
	phase?: SkinPhase
}

export type Skins = Skin[]

/** `data/skins.json`. */
export const SKINS_FILE = 'skins.json'

export const fetchSkins = (options: DatasetOptions<Skins> = {}): Promise<Skins> =>
	fetchCdnData<Skins>(SKINS_FILE, options)
