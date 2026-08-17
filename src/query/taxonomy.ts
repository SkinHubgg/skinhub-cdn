/**
 * What exists: the categories `skins.json` is divided into, and the weapon types inside them.
 *
 * ## `skins.json` is the whole weapon catalogue, gloves included
 *
 * This is the finding that shapes the rest of the query layer. Counted on the current export, the
 * 2,161 rows split into exactly seven `category.id` values:
 *
 * | rows | `category.id`                            | key         |
 * |-----:|------------------------------------------|-------------|
 * |  576 | `sfui_invpanel_filter_melee`             | `knives`    |
 * |  500 | `csgo_inventory_weapon_category_rifles`  | `rifles`    |
 * |  450 | `csgo_inventory_weapon_category_pistols` | `pistols`   |
 * |  311 | `csgo_inventory_weapon_category_smgs`    | `smgs`      |
 * |  222 | `csgo_inventory_weapon_category_heavy`   | `heavy`     |
 * |   94 | `sfui_invpanel_filter_gloves`            | `gloves`    |
 * |    8 | `loadoutslot_equipment`                  | `equipment` |
 *
 * **Gloves and knives are already in there.** A consumer building a picker needs one 4.2 MB fetch,
 * not three — `gloves.json` is a 95-row side table that adds nothing `skins.json` does not already
 * carry except a `Gloves | Default` row with `weapon_defindex: 0`. That is why every function here
 * takes `Skins` and there is no `fetchGlovesForPicker`.
 *
 * ## Why the key is `weapon.weapon_id` and never `weapon.id`
 *
 * `weapon.id` looks like the stable identifier and is not. Across the 2,161 rows there are **83
 * distinct `weapon.id` values but only 63 distinct `weapon.weapon_id`**, because each of the 20
 * knife types carries a second id: the 20 vanilla rows spell the Bayonet `sfui_wpnhud_knifebayonet`
 * while its 34 finishes spell it `weapon_bayonet`. Group a picker by `weapon.id` and every knife
 * splits into "the knife" and "the vanilla knife" as two separate weapons.
 *
 * `weapon_id` is the item definition index, which is also what a decoded inspect link calls
 * `defindex`, which is also `Glove['weapon_defindex']`. One number, three names, and it is the only
 * one of the three that is a key. Measured: every one of the 63 defindexes has exactly one
 * non-`sfui_` `weapon.id`, exactly one `weapon.name` and exactly one `category.id`; and those 63
 * non-`sfui_` ids are themselves unique. `test/query-taxonomy.test.ts` re-derives all four.
 */

import type { Skin, Skins } from '../datasets/skins.js'

/**
 * Our word for a category, not Valve's.
 *
 * Closed on purpose, and it is the one closed union in this package. The dataset types keep their
 * unions `Open<>` because they describe bytes Valve controls; this describes a vocabulary *we*
 * control, and an integrator writing `switch (category)` should get exhaustiveness checking. When
 * Valve adds a category, `skinCategory` returns `null` for it rather than widening the type under
 * everyone's feet — see the note on that function.
 */
export type SkinCategoryKey = 'rifles' | 'pistols' | 'smgs' | 'heavy' | 'knives' | 'gloves' | 'equipment'

/** Every key, in the order a loadout screen lists them. */
export const SKIN_CATEGORIES: readonly SkinCategoryKey[] = [
	'rifles',
	'smgs',
	'heavy',
	'pistols',
	'knives',
	'gloves',
	'equipment',
] as const

/** Key → the `category.id` the export writes. */
export const SKIN_CATEGORY_IDS: Record<SkinCategoryKey, string> = {
	rifles: 'csgo_inventory_weapon_category_rifles',
	pistols: 'csgo_inventory_weapon_category_pistols',
	smgs: 'csgo_inventory_weapon_category_smgs',
	heavy: 'csgo_inventory_weapon_category_heavy',
	knives: 'sfui_invpanel_filter_melee',
	gloves: 'sfui_invpanel_filter_gloves',
	equipment: 'loadoutslot_equipment',
}

const CATEGORY_BY_ID: Record<string, SkinCategoryKey> = Object.fromEntries(
	Object.entries(SKIN_CATEGORY_IDS).map(([key, id]) => [id, key as SkinCategoryKey]),
)

/**
 * The category a row belongs to, or `null` for a `category.id` this package has not seen.
 *
 * `null` rather than a widened union so that a `switch` stays exhaustive. A row that returns `null`
 * is a signal to upgrade the package, not a value to branch on — and it is visible, which a
 * silently-widened string would not be.
 */
export const skinCategory = (skin: Skin): SkinCategoryKey | null => CATEGORY_BY_ID[skin.category.id] ?? null

/** `true` for the 576 melee rows. */
export const isKnife = (skin: Skin): boolean => skin.category.id === SKIN_CATEGORY_IDS.knives

/**
 * `true` for the 94 glove rows in `skins.json`.
 *
 * **Test the category, never the paint index.** Gloves were once allocated from a private band
 * starting at 10000, and code that took that for a rule is now wrong: measured on the current
 * export, **22 of the 94 glove rows carry a paint index below 10000** — 1398 through 1440, which
 * sits inside the ordinary weapon range whose maximum is 1477. A `paintIndex >= 10000` test
 * misclassifies all 22, silently, as guns.
 */
export const isGlove = (skin: Skin): boolean => skin.category.id === SKIN_CATEGORY_IDS.gloves

/** `true` for the 8 Zeus rows. */
export const isEquipment = (skin: Skin): boolean => skin.category.id === SKIN_CATEGORY_IDS.equipment

/** Rifles, SMGs, heavy and pistols — everything you shoot with. 1,483 rows. */
export const isGun = (skin: Skin): boolean => {
	const key = skinCategory(skin)
	return key === 'rifles' || key === 'pistols' || key === 'smgs' || key === 'heavy'
}

/**
 * The finish-less rows: 20 vanilla knives and 35 vanilla guns, 55 in all.
 *
 * The two halves are spelled differently in the data and both are here for a reason. A vanilla
 * knife has `paint_index: null`; a vanilla gun has `paint_index: '0'` and `rarity.id
 * rarity_default_weapon`. Both have `pattern`, `min_float` and `max_float` null and **no `wears`,
 * `collections` or `souvenir` key at all** — measured: 55 rows are missing those three keys, and 20
 * rows have a null `paint_index`. Code that assumes `skin.wears.length` will throw on 55 of 2,161
 * rows, which is why `wearsOf` in `./skins.js` exists.
 */
export const isVanilla = (skin: Skin): boolean => skin.paint_index === null || skin.paint_index === '0'

/**
 * A weapon type — one entry per item definition index.
 *
 * This is the thing a picker's top level is a list of: 20 knife types, 8 glove types, 34 guns and
 * the Zeus.
 */
export type WeaponRef = {
	/**
	 * The item definition index. 7 for the AK-47, 500 for the Bayonet, 5030 for Sport Gloves.
	 *
	 * The same number a decoded inspect link calls `defindex` and `gloves.json` calls
	 * `weapon_defindex`. The key for everything.
	 */
	defindex: number
	/**
	 * `weapon_ak47`, `weapon_bayonet`, `sporty_gloves`.
	 *
	 * **Always the item name, never the `sfui_wpnhud_*` alias** — which is the whole reason this type
	 * exists rather than handing you `skin.weapon`. See `weaponOf`.
	 */
	id: string
	/** `AK-47`, `Bayonet`, `Sport Gloves`. */
	name: string
	category: SkinCategoryKey | null
}

export type WeaponType = WeaponRef & {
	/** How many rows of the list this was built from carry this defindex, vanilla row included. */
	skinCount: number
	/** Whether one of those rows is the finish-less one. */
	hasVanilla: boolean
}

/**
 * Every weapon type present in the rows given, ascending by defindex.
 *
 * Pass a category to narrow it. Over the full export: no filter → 63, `'knives'` → 20,
 * `'gloves'` → 8, `'rifles'` → 11, `'pistols'` → 10, `'smgs'` → 7, `'heavy'` → 6,
 * `'equipment'` → 1.
 *
 * Derived from the rows, never from a table baked in here — a weapon Valve ships next month appears
 * the moment the exporter publishes it, with no release of this package.
 */
export const listWeaponTypes = (skins: Skins, category?: SkinCategoryKey): WeaponType[] => {
	const wanted = category ? SKIN_CATEGORY_IDS[category] : undefined
	const found = new Map<number, WeaponType>()

	for (const skin of skins) {
		if (wanted && skin.category.id !== wanted) continue

		const defindex = skin.weapon.weapon_id
		const existing = found.get(defindex)
		// The vanilla knife rows carry the HUD alias; never let one win the `id` slot.
		const isAlias = skin.weapon.id.startsWith('sfui_')

		if (!existing) {
			found.set(defindex, {
				defindex,
				id: skin.weapon.id,
				name: skin.weapon.name,
				category: skinCategory(skin),
				skinCount: 1,
				hasVanilla: isVanilla(skin),
			})
			continue
		}

		existing.skinCount++
		if (isVanilla(skin)) existing.hasVanilla = true
		if (!isAlias && existing.id.startsWith('sfui_')) existing.id = skin.weapon.id
	}

	return [...found.values()].sort((a, b) => a.defindex - b.defindex)
}

/** The 20 knife types. What "which knives exist?" means. */
export const listKnifeTypes = (skins: Skins): WeaponType[] => listWeaponTypes(skins, 'knives')

/** The 8 glove types: Bloodhound, Broken Fang, Driver, Hand Wraps, Hydra, Moto, Specialist, Sport. */
export const listGloveTypes = (skins: Skins): WeaponType[] => listWeaponTypes(skins, 'gloves')

const GUN_CATEGORIES: readonly SkinCategoryKey[] = ['rifles', 'pistols', 'smgs', 'heavy'] as const

/** The 34 guns — 11 rifles, 10 pistols, 7 SMGs, 6 heavy. No knives, gloves or Zeus. */
export const listGunTypes = (skins: Skins): WeaponType[] =>
	listWeaponTypes(skins).filter(type => type.category !== null && GUN_CATEGORIES.includes(type.category))

/**
 * **The weapon a row belongs to, with the alias resolved. Use this instead of `skin.weapon`.**
 *
 * `findSkin` and every other lookup here return the exporter's row untouched — they have to, because
 * a package whose job is "the CDN's bytes, typed" cannot hand back a row that differs from the one in
 * the array. So the alias survives the lookup:
 *
 * ```ts
 * findSkin(skins, { defindex: 500, paintindex: 0 })?.weapon.id  // 'sfui_wpnhud_knifebayonet'
 * weaponOf(skins, vanillaBayonet).id                            // 'weapon_bayonet'
 * ```
 *
 * The first is a HUD string, not an item name; a renderer that keys a model path off it goes looking
 * for something that does not exist. It bites on all 20 vanilla knives and nowhere else — measured:
 * 83 distinct `weapon.id` values against 63 defindexes, and every one of the 20 extras is a
 * `sfui_wpnhud_*` on a finish-less knife row.
 *
 * Resolution is done from the rows you pass rather than from a table baked in here, so a knife Valve
 * ships next month resolves the moment the exporter publishes its finishes. If the list you pass
 * holds *only* the vanilla row for a defindex — a caller querying an already-filtered subset — there
 * is no item name to find, and the row's own id comes back rather than a guess. `aliased` says which
 * happened, so the caller can tell "resolved" from "nothing to resolve with".
 */
export type ResolvedWeapon = WeaponRef & {
	/** `true` when the id returned is still the HUD alias, because the rows held no item name. */
	aliased: boolean
}

export const weaponOf = (skins: Skins, skin: Skin): ResolvedWeapon => {
	const defindex = skin.weapon.weapon_id
	let id = skin.weapon.id

	if (id.startsWith('sfui_')) {
		for (const candidate of skins) {
			if (candidate.weapon.weapon_id !== defindex) continue
			if (candidate.weapon.id.startsWith('sfui_')) continue
			id = candidate.weapon.id
			break
		}
	}

	return {
		defindex,
		id,
		name: skin.weapon.name,
		category: skinCategory(skin),
		aliased: id.startsWith('sfui_'),
	}
}

/* ---------------------------------------------------------------------------------------------
 * The weapon id as a key, in both directions.
 *
 * Everything above keys on the defindex, because the defindex is the key. But a large family of
 * consumers does not hold one: the CS2 **WeaponPaints** plugin schema, which is what a community
 * server's website reads and writes, stores `wp_player_knife.knife` as the item NAME string
 * (`weapon_bayonet`) while `wp_player_skins.weapon_defindex` beside it is the number. Reading a
 * loadout means going name -> defindex; writing an equipped knife means going defindex -> name.
 * Neither direction had a home here, so every consumer wrote the same eight-line derivation over
 * `weapon.weapon_id` and got to decide for itself whether to filter the `sfui_` aliases.
 *
 * There is no `WEAPON_IDS` constant, deliberately. A table baked into this package is stale the
 * moment Valve ships a knife, which is the same argument `lookup.ts` makes about a prebuilt index.
 * These are functions of the rows you fetched, like everything else here.
 * ------------------------------------------------------------------------------------------ */

/**
 * Weapon item name -> item definition index. `weapon_ak47` is 7, `weapon_bayonet` is 500.
 *
 * One entry per weapon type, so 63 over the full export, and the `sfui_wpnhud_*` aliases are never
 * keys - `listWeaponTypes` has already resolved each defindex to its item name. Measured: the 83
 * distinct `weapon.id` values in the data collapse to exactly these 63, the 20 dropped are all
 * aliases, and no two defindexes share an id.
 *
 * The 8 glove ids (`sporty_gloves`, `specialist_gloves`, …) are in here, because `skins.json` holds
 * the glove rows too. A consumer does not need `gloves.json` to map a glove name to its defindex.
 */
export const weaponDefindexes = (skins: Skins): Record<string, number> => {
	const map: Record<string, number> = {}
	for (const type of listWeaponTypes(skins)) map[type.id] = type.defindex
	return map
}

/** The reverse: item definition index -> weapon item name. 63 entries, never an alias. */
export const weaponIdsByDefindex = (skins: Skins): Record<number, string> => {
	const map: Record<number, string> = {}
	for (const type of listWeaponTypes(skins)) map[type.defindex] = type.id
	return map
}

/**
 * The defindex for a weapon item name, or `undefined`.
 *
 * Accepts an alias too, so a value that reached your database before anything filtered them still
 * resolves: `defindexForWeaponId(skins, 'sfui_wpnhud_knifebayonet')` is 500, the same as
 * `'weapon_bayonet'`. Matching is exact and case-sensitive - these are item names out of
 * `items_game`, not display names. For `'AK-47'` use `skinsForWeapon`, which takes either.
 */
export const defindexForWeaponId = (skins: Skins, id: string): number | undefined => {
	for (const skin of skins) if (skin.weapon.id === id) return skin.weapon.weapon_id
	return undefined
}

/** The weapon item name for a defindex, or `undefined`. Never an alias. */
export const weaponIdForDefindex = (skins: Skins, defindex: number): string | undefined => {
	let fallback: string | undefined
	for (const skin of skins) {
		if (skin.weapon.weapon_id !== defindex) continue
		if (!skin.weapon.id.startsWith('sfui_')) return skin.weapon.id
		fallback ??= skin.weapon.id
	}
	return fallback
}

/**
 * An id string with the vanilla-knife alias resolved. The string-only form of `weaponOf`.
 *
 * `weaponOf` needs a `Skin`; this needs only the string, which is what a database column hands you.
 * Returns the input unchanged when it is already an item name, and when it is an alias the rows
 * hold no item name for - the same "nothing to resolve with" case `weaponOf` reports as `aliased`.
 *
 * ```ts
 * normalizeWeaponId(skins, 'sfui_wpnhud_knifebayonet') // 'weapon_bayonet'
 * normalizeWeaponId(skins, 'weapon_ak47')              // 'weapon_ak47'
 * ```
 */
export const normalizeWeaponId = (skins: Skins, id: string): string => {
	if (!id.startsWith('sfui_')) return id
	const defindex = defindexForWeaponId(skins, id)
	if (defindex === undefined) return id
	return weaponIdForDefindex(skins, defindex) ?? id
}

export type CategorySummary = {
	key: SkinCategoryKey
	/** The `category.id` in the data. */
	id: string
	/** `Rifles`, `Knives`, … — the exporter's display name, taken from the first row seen. */
	name: string
	skinCount: number
	weaponCount: number
}

/** Every category present in the rows given, in loadout order, with counts. */
export const listCategories = (skins: Skins): CategorySummary[] => {
	const seen = new Map<SkinCategoryKey, { name: string; skinCount: number; defindexes: Set<number> }>()

	for (const skin of skins) {
		const key = skinCategory(skin)
		if (key === null) continue
		const entry = seen.get(key)
		if (entry) {
			entry.skinCount++
			entry.defindexes.add(skin.weapon.weapon_id)
		} else {
			seen.set(key, { name: skin.category.name, skinCount: 1, defindexes: new Set([skin.weapon.weapon_id]) })
		}
	}

	return SKIN_CATEGORIES.filter(key => seen.has(key)).map(key => {
		const entry = seen.get(key) as { name: string; skinCount: number; defindexes: Set<number> }
		return {
			key,
			id: SKIN_CATEGORY_IDS[key],
			name: entry.name,
			skinCount: entry.skinCount,
			weaponCount: entry.defindexes.size,
		}
	})
}
