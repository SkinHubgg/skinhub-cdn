/**
 * `createSkinIndex` — the same queries, with the scans done once.
 *
 * ## Why an index is built and never shipped
 *
 * The obvious "make lookups fast" move for a data package is to publish a prebuilt index next to the
 * data: a `skins-index.json` with the maps already in it. This package deliberately does not, and
 * the reason is the package's whole premise. The exporter re-runs and `skins.json` changes; a
 * prebuilt index shipped in an npm tarball is stale from the moment it is published, and the failure
 * is silent — the new AK finish is on the CDN, the index in `node_modules` has never heard of it,
 * and the integrator's picker is missing a row with nothing to show for it. The CDN is the live
 * source. Anything derived from it has to be derived at runtime.
 *
 * So the index is a function of the rows you fetched, built in memory, and it costs about what one
 * `Array.prototype.find` over the same rows costs. Measured on the 2,161-row export it is a
 * single pass: seven maps, no sorting beyond `listWeaponTypes`.
 *
 * ## When to bother
 *
 * `findSkin(skins, ref)` is a linear scan of 2,161 rows — fine once, fine in a route handler,
 * wasteful in a loop over an inventory. Resolving 1,000 inventory rows is 2.1 M comparisons without
 * an index and 1,000 map hits with one. Build it if you are resolving more than a handful of items;
 * use the free functions otherwise.
 *
 * The index is a plain object of maps and functions, not a class, so it destructures and
 * tree-shakes like everything else here.
 */

import type { Keychain, Keychains } from '../datasets/keychains.js'
import type { Skin, Skins } from '../datasets/skins.js'
import type { Sticker, Stickers } from '../datasets/stickers.js'
import type { SkinPlacement } from '../placement.js'
import { marketHashNames, type MarketVariant } from './market.js'
import { type ResolvedItem, resolveItemWith } from './resolve.js'
import { paintIndexOf, type SkinRef } from './skins.js'
import { listWeaponTypes, type ResolvedWeapon, type SkinCategoryKey, type WeaponType } from './taxonomy.js'

/** One `market_hash_name`, the rows it covers, and the variant it describes. */
export type MarketEntry = MarketVariant & {
	/** The first row. For a phase group this is an arbitrary member — see `skins`. */
	skin: Skin
	/** Every row this key covers. Length > 1 only for the Doppler families. */
	skins: Skin[]
}

export type SkinIndex = {
	/** The rows this index was built from, untouched. */
	readonly skins: Skins

	/** `(defindex, paintindex)` → row. The primary key, verified unique across the export. */
	readonly byRef: Map<string, Skin>
	/** `skin.id` → row. Unique: 2,161 of 2,161. */
	readonly byId: Map<string, Skin>
	/** Lowercased `skin.name` → rows. 29 keys hold more than one — the Doppler phase groups. */
	readonly byName: Map<string, Skins>
	/** `paint_index` → rows. 113 keys hold more than one weapon. */
	readonly byPaintIndex: Map<number, Skins>
	/** defindex → every row for that weapon. 63 keys. */
	readonly byWeapon: Map<number, Skins>
	/**
	 * `weapon.id` → the weapon type. 83 keys, because **the aliases are keys here too**.
	 *
	 * The one map in this index that is deliberately not 1:1 with a defindex. A caller looking a
	 * string up got it from somewhere - a database column, a config file, a URL - and that somewhere
	 * may well hold `sfui_wpnhud_knifebayonet`. Failing to find it would be the wrong answer; the
	 * `WeaponType` it maps to still carries the item name in `id`, so the alias resolves rather than
	 * misses. See `weaponById`.
	 */
	readonly byWeaponId: Map<string, WeaponType>
	/** Lowercased `market_hash_name` → the rows it sells as. 15,455 keys. */
	readonly byMarketHashName: Map<string, MarketEntry>

	/** The 63 weapon types, ascending by defindex. */
	readonly weapons: WeaponType[]

	/** O(1) `findSkin`. */
	find(ref: SkinRef): Skin | undefined
	/** O(1) `findSkinById`. */
	findById(id: string): Skin | undefined
	/** O(1) `skinsByName`. Always an array; empty when unknown. */
	findByName(name: string): Skins
	/** O(1) `skinsByMarketHashName`, plus the variant flags Steam's string encoded. */
	findByMarketHashName(marketHashName: string): MarketEntry | undefined
	/** O(1) `skinsForWeapon`, by defindex only — the key. */
	forWeapon(defindex: number): Skins
	/** The weapon types in one category. */
	weaponTypes(category?: SkinCategoryKey): WeaponType[]
	/**
	 * O(1) `weaponOf` — the weapon a row belongs to, with the vanilla-knife alias resolved.
	 *
	 * **Use this rather than `skin.weapon`**, which carries a `sfui_wpnhud_*` HUD string on all 20
	 * finish-less knife rows.
	 */
	weaponOf(skin: Skin): ResolvedWeapon
	/** The same, straight from a defindex. `undefined` when nothing in the index has it. */
	weaponFor(defindex: number): WeaponType | undefined
	/**
	 * O(1) lookup by `weapon.id`, alias or item name. `undefined` when nothing in the index has it.
	 *
	 * This is the direction a WeaponPaints-schema database needs: `wp_player_knife.knife` is the
	 * item name string, not the defindex, so reading a loadout starts here.
	 * `weaponById('sfui_wpnhud_knifebayonet')?.id` is `'weapon_bayonet'`.
	 */
	weaponById(id: string): WeaponType | undefined
	/** O(1) `resolveItem`. `stickers`/`keychains` come from `withCatalogs`. */
	resolve(placement: SkinPlacement): ResolvedItem
	/** A copy of this index that also resolves sticker and charm ids. */
	withCatalogs(catalogs: { stickers?: Stickers; keychains?: Keychains }): SkinIndex
}

const refKey = (defindex: number, paintindex: number) => `${defindex}:${paintindex}`

const push = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
	const existing = map.get(key)
	if (existing) existing.push(value)
	else map.set(key, [value])
}

type IdMaps = {
	stickers?: Map<number, Sticker>
	keychains?: Map<number, Keychain>
}

const build = (skins: Skins, ids: IdMaps): SkinIndex => {
	const byRef = new Map<string, Skin>()
	const byId = new Map<string, Skin>()
	const byName = new Map<string, Skins>()
	const byPaintIndex = new Map<number, Skins>()
	const byWeapon = new Map<number, Skins>()
	const byMarketHashName = new Map<string, MarketEntry>()

	for (const skin of skins) {
		const paintindex = paintIndexOf(skin)
		// First row wins. The pair is unique across the export, so this only matters for a caller
		// that passed a list with duplicates in it.
		const key = refKey(skin.weapon.weapon_id, paintindex)
		if (!byRef.has(key)) byRef.set(key, skin)
		if (!byId.has(skin.id)) byId.set(skin.id, skin)
		push(byName, skin.name.toLowerCase(), skin)
		push(byPaintIndex, paintindex, skin)
		push(byWeapon, skin.weapon.weapon_id, skin)

		for (const variant of marketHashNames(skin)) {
			const lower = variant.marketHashName.toLowerCase()
			const existing = byMarketHashName.get(lower)
			if (existing) existing.skins.push(skin)
			else byMarketHashName.set(lower, { ...variant, skin, skins: [skin] })
		}
	}

	const weapons = listWeaponTypes(skins)
	// `listWeaponTypes` has already picked the non-alias id per defindex, so the alias resolution
	// `weaponOf` does with a scan is a map hit here.
	const weaponByDefindex = new Map(weapons.map(weapon => [weapon.defindex, weapon]))

	// Every spelling seen in the rows, aliases included, pointed at the resolved type. Built from the
	// rows rather than from `weapons` because `weapons` holds one id per defindex by construction.
	const byWeaponId = new Map<string, WeaponType>()
	for (const skin of skins) {
		if (byWeaponId.has(skin.weapon.id)) continue
		const type = weaponByDefindex.get(skin.weapon.weapon_id)
		if (type) byWeaponId.set(skin.weapon.id, type)
	}

	const resolveWeapon = (skin: Skin): ResolvedWeapon => {
		const known = weaponByDefindex.get(skin.weapon.weapon_id)
		const id = known?.id ?? skin.weapon.id
		return {
			defindex: skin.weapon.weapon_id,
			id,
			name: known?.name ?? skin.weapon.name,
			category: known?.category ?? null,
			aliased: id.startsWith('sfui_'),
		}
	}

	const finders = {
		skin: (ref: SkinRef) => byRef.get(refKey(ref.defindex, ref.paintindex)),
		sticker: (id: number) => ids.stickers?.get(id),
		keychain: (id: number) => ids.keychains?.get(id),
		weapon: resolveWeapon,
	}

	return {
		skins,
		byRef,
		byId,
		byName,
		byPaintIndex,
		byWeapon,
		byWeaponId,
		byMarketHashName,
		weapons,
		find: ref => byRef.get(refKey(ref.defindex, ref.paintindex)),
		findById: id => byId.get(id),
		findByName: name => byName.get(name.trim().toLowerCase()) ?? [],
		findByMarketHashName: name => byMarketHashName.get(name.trim().toLowerCase()),
		forWeapon: defindex => byWeapon.get(defindex) ?? [],
		weaponTypes: category =>
			category === undefined ? weapons : weapons.filter(weapon => weapon.category === category),
		weaponOf: resolveWeapon,
		weaponFor: defindex => weaponByDefindex.get(defindex),
		weaponById: id => byWeaponId.get(id),
		resolve: placement => resolveItemWith(placement, finders),
		withCatalogs: catalogs =>
			build(skins, {
				stickers: catalogs.stickers
					? new Map(catalogs.stickers.map(sticker => [Number(sticker.id), sticker]))
					: ids.stickers,
				keychains: catalogs.keychains
					? new Map(catalogs.keychains.map(keychain => [Number(keychain.id), keychain]))
					: ids.keychains,
			}),
	}
}

/**
 * Build the maps once.
 *
 * ```ts
 * const index = createSkinIndex(await fetchSkins())
 *
 * index.weaponTypes('knives')                       // the 20 knife types
 * index.forWeapon(7)                                // every AK-47 finish
 * index.find({ defindex: 7, paintindex: 801 })      // AK-47 | Asiimov
 * index.findByMarketHashName('AK-47 | Asiimov (Field-Tested)')
 * index.resolve(readInspectUrl(link))               // the whole item
 * ```
 *
 * Pass the sticker and charm lists too — or add them later with `withCatalogs` — and `resolve`
 * names the stickers as well.
 */
export const createSkinIndex = (
	skins: Skins,
	catalogs: { stickers?: Stickers; keychains?: Keychains } = {},
): SkinIndex =>
	build(skins, {
		stickers: catalogs.stickers ? new Map(catalogs.stickers.map(row => [Number(row.id), row])) : undefined,
		keychains: catalogs.keychains ? new Map(catalogs.keychains.map(row => [Number(row.id), row])) : undefined,
	})
