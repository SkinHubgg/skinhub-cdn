/**
 * Inspect link in, renderable item out.
 *
 * This is the headline path the two packages share. `@skinhub/cdn/inspect` decodes a masked link
 * into a `SkinPlacement` — numbers on the wire, and nothing a UI can draw: `defindex 7`,
 * `paintindex 801`, `sticker_id 4622`. The viewer needs a row: which weapon, which finish, which
 * sticker art, what the thing is called, what tier the float lands in. This module is the join, and
 * without it every integrator writes it again, slightly differently.
 *
 * ## Nothing here fetches, and none of the lists are required
 *
 * `resolveItem(placement, {})` is legal and returns the placement's own numbers with every lookup
 * left `undefined`. Pass `skins` and you get the weapon and finish; pass `stickers` as well and the
 * five slots come back named. **That is how a consumer avoids pulling every dataset for one
 * weapon** — `stickers.json` is 5.5 MB against `skins.json`'s 4.2 MB, and an item with no stickers
 * never needs it. `hasStickers`/`hasKeychain` let you check the placement before deciding to fetch.
 *
 * ## The joins, and the two type mismatches in them
 *
 * | placement field | list | joins on |
 * |---|---|---|
 * | `defindex` + `paintindex` | `skins.json` | `weapon.weapon_id` + `paint_index` |
 * | `stickers[].sticker_id`   | `stickers.json` | `id` |
 * | `keychain.sticker_id`     | `keychains.json` | `id` |
 *
 * Both mismatches are string-versus-number. `Skin['paint_index']`, `Sticker['id']` and
 * `Keychain['id']` are all **decimal strings**, and the wire carries `uint32`. Measured: every id in
 * all three files round-trips `String(Number(id)) === id` (11,788 sticker ids, 143 keychain ids,
 * 2,141 non-null paint indexes), so `Number()` is lossless here — but `===` between the two sides
 * without it silently matches nothing, which is the failure that looks like an item with no
 * stickers rather than like a bug.
 */

import type { Keychain, Keychains } from '../datasets/keychains.js'
import type { Skin, Skins } from '../datasets/skins.js'
import type { Sticker, Stickers } from '../datasets/stickers.js'
import type { KeychainPlacement, SkinPlacement, StickerPlacement } from '../placement.js'
import { marketHashName } from './market.js'
import { clampFloat, paintIndexOf, type SkinRef } from './skins.js'
import { isVanilla, type ResolvedWeapon, type SkinCategoryKey, skinCategory, weaponOf } from './taxonomy.js'
import { type WearTier, wearTierForFloat } from './wear.js'

/** The lists to join against. All optional — pass only what the item actually needs. */
export type ItemCatalogs = {
	skins?: Skins
	stickers?: Stickers
	keychains?: Keychains
}

export type ResolvedSticker = {
	/** 0-4. */
	slot: number
	/** The wire id. `0` never appears here — empty slots are dropped. */
	stickerId: number
	/** The catalogue row, or `undefined` when `stickers` was not supplied or the id is unknown. */
	sticker: Sticker | undefined
	/** The placement as decoded, so a renderer needs nothing else. */
	placement: StickerPlacement
}

export type ResolvedKeychain = {
	keychainId: number
	keychain: Keychain | undefined
	placement: KeychainPlacement
}

export type ResolvedItem = {
	/** The placement this was resolved from, normalised. */
	placement: SkinPlacement
	defindex: number
	paintindex: number
	paintseed: number
	/**
	 * The wear float, clamped into the finish's own `[min_float, max_float]` when the finish is
	 * known. `paintwear` off the wire can sit outside the range — a hand-built link, or a link for
	 * an item whose paint kit Valve has since re-ranged — and a renderer that maps it linearly onto
	 * a texture blend wants a value inside the range, not a negative one.
	 */
	float: number
	/** The raw `paintwear` before clamping, so the clamp is visible rather than silent. */
	rawFloat: number
	/** Which exterior `float` lands in. Never null — `wearTierForFloat` always returns one. */
	wear: WearTier
	/**
	 * The row, exactly as the exporter published it. `undefined` when `skins` was not supplied, or
	 * the pair matched no row.
	 *
	 * **Read `item.weapon.id`, not `item.skin.weapon.id`.** The row carries the raw `weapon.id`, which
	 * is a `sfui_wpnhud_*` HUD alias on all 20 vanilla knives; `weapon` below has it resolved.
	 */
	skin: Skin | undefined
	/**
	 * Which weapon this is, with the vanilla-knife alias resolved to the real item name — the field a
	 * renderer keys its model path off. `undefined` without `skins`.
	 */
	weapon: ResolvedWeapon | undefined
	/** `AK-47 | Asiimov`, from the row. `undefined` without `skins`. */
	name: string | undefined
	category: SkinCategoryKey | null
	/** True for the 55 finish-less rows. `false` when the row is unknown. */
	vanilla: boolean
	stattrak: boolean
	/** `null` unless the item is StatTrak™. */
	stattrakCount: number | null
	nametag: string | null
	/**
	 * The Steam key for this exact item, or `null` when there is none — no `skins` list, an unknown
	 * pair, a vanilla gun, or a StatTrak float on a finish that cannot be StatTrak.
	 *
	 * Souvenir is never asserted here: a decoded inspect link carries no quality field that
	 * distinguishes a Souvenir item, so claiming one from the float would be a guess. If you know
	 * the item is Souvenir, call `marketHashName(item.skin, …)` yourself.
	 */
	marketHashName: string | null
	/** Only the filled slots, in slot order. Empty for an item with no stickers. */
	stickers: ResolvedSticker[]
	keychain: ResolvedKeychain | null
}

/** The lookups `resolveItem` needs. Swappable so an index can make them O(1). */
export type ItemFinders = {
	skin: (ref: SkinRef) => Skin | undefined
	sticker: (id: number) => Sticker | undefined
	keychain: (id: number) => Keychain | undefined
	/** Resolves the vanilla-knife alias. Omit and `ResolvedItem['weapon']` comes back `undefined`. */
	weapon?: (skin: Skin) => ResolvedWeapon | undefined
}

const linearFinders = (catalogs: ItemCatalogs): ItemFinders => ({
	skin: ref =>
		catalogs.skins?.find(skin => skin.weapon.weapon_id === ref.defindex && paintIndexOf(skin) === ref.paintindex),
	sticker: id => catalogs.stickers?.find(sticker => Number(sticker.id) === id),
	keychain: id => catalogs.keychains?.find(keychain => Number(keychain.id) === id),
	weapon: skin => (catalogs.skins ? weaponOf(catalogs.skins, skin) : undefined),
})

/** `true` when the placement has at least one sticker, so `stickers.json` is worth fetching. */
export const hasStickers = (placement: SkinPlacement): boolean =>
	placement.stickers.some(sticker => sticker.sticker_id > 0)

/** `true` when the placement has a charm, so `keychains.json` is worth fetching. */
export const hasKeychain = (placement: SkinPlacement): boolean => (placement.keychain?.sticker_id ?? 0) > 0

/**
 * Resolve a decoded placement against whichever lists you have.
 *
 * ```ts
 * import { readInspectUrl } from '@skinhub/cdn/inspect'
 * import { fetchSkins } from '@skinhub/cdn'
 * import { resolveItem, hasStickers } from '@skinhub/cdn/query'
 *
 * const placement = readInspectUrl(link)
 * const skins = await fetchSkins()
 * const stickers = hasStickers(placement) ? await fetchStickers() : undefined
 *
 * const item = resolveItem(placement, { skins, stickers })
 * item.name            // 'AK-47 | Asiimov'
 * item.wear.name       // 'Field-Tested'
 * item.marketHashName  // 'StatTrak™ AK-47 | Asiimov (Field-Tested)'
 * item.stickers[0]?.sticker?.image
 * ```
 */
export const resolveItem = (placement: SkinPlacement, catalogs: ItemCatalogs = {}): ResolvedItem =>
	resolveItemWith(placement, linearFinders(catalogs))

/** `resolveItem` with the lookups supplied. `createSkinIndex` uses this to make them O(1). */
export const resolveItemWith = (placement: SkinPlacement, finders: ItemFinders): ResolvedItem => {
	const skin = finders.skin({ defindex: placement.defindex, paintindex: placement.paintindex })
	const rawFloat = placement.paintwear
	const float = skin ? clampFloat(skin, rawFloat) : rawFloat
	const wear = wearTierForFloat(float)
	const stattrak = placement.stattrak === true

	const stickers: ResolvedSticker[] = []
	for (const entry of placement.stickers) {
		if (entry.sticker_id <= 0) continue
		stickers.push({
			slot: entry.slot,
			stickerId: entry.sticker_id,
			sticker: finders.sticker(entry.sticker_id),
			placement: entry,
		})
	}
	stickers.sort((a, b) => a.slot - b.slot)

	const charm = placement.keychain
	const keychain: ResolvedKeychain | null =
		charm && charm.sticker_id > 0
			? { keychainId: charm.sticker_id, keychain: finders.keychain(charm.sticker_id), placement: charm }
			: null

	return {
		placement,
		defindex: placement.defindex,
		paintindex: placement.paintindex,
		paintseed: placement.paintseed,
		float,
		rawFloat,
		wear,
		skin,
		weapon: skin ? (finders.weapon?.(skin) ?? undefined) : undefined,
		name: skin?.name,
		category: skin ? skinCategory(skin) : null,
		vanilla: skin ? isVanilla(skin) : false,
		stattrak,
		stattrakCount: stattrak ? (placement.stattrak_count ?? 0) : null,
		nametag: placement.nametag ?? null,
		marketHashName: skin ? marketHashName(skin, { wear, stattrak }) : null,
		stickers,
		keychain,
	}
}
