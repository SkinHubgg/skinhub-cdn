/**
 * The CS2 inspect-link codec — `@skinhub/cdn/inspect`.
 *
 * **This is encode/decode, not data-fetching.** It shares a package with the CDN layer so that a
 * site needs one dependency rather than ours *and* `cs2-inspect-lib`, but it shares nothing else:
 * it is its own entry point, imports nothing from `config`/`fetch`/`cache`, and could move to its
 * own package without a breaking change to anything that imports `@skinhub/cdn`.
 *
 * The seam runs the other way too. `cs2-inspect-lib` is a Node-shaped library — its dependency
 * list includes `steam-user` and `node-cs2`, for a Game Coordinator round trip this module never
 * makes. Those are behind a dynamic `import()` inside a method, so they are not pulled in eagerly,
 * but a browser bundle that only wants `fetchSkins` should never even resolve them. Keeping this
 * out of the root export is what guarantees that.
 *
 * This is a **thin wrapper, not a fork**: `cs2-inspect-lib` stays the implementation. What is ours
 * is the boundary — every value goes through `makeSkinPlacement` before it reaches the encoder, so
 * a caller cannot hand the wire a signed, fractional or exponent-formatted id. That guard exists
 * because the CS2 WeaponPaints plugin parses ids with `uint.TryParse` and **silently skips** an
 * item whose id is not a plain unsigned integer: the sticker simply does not appear in game.
 * Owning the boundary is where that check belongs.
 *
 * Normalising the whole item, rather than only its stickers, is also what makes encode → decode an
 * identity for input a human wrote. `paintwear` is a protobuf `float`; hand the encoder the double
 * `0.154` and a decode returns `0.15399999916553497`. Quantising on the way in means the value you
 * built and the value you decoded compare equal.
 */

import { CS2Inspect, type EconItem, type Sticker as InspectSticker } from 'cs2-inspect-lib'
import {
	emptyKeychain,
	emptySticker,
	type KeychainPlacement,
	makeKeychainPlacement,
	makeSkinPlacement,
	makeStickerPlacement,
	type SkinPlacement,
	STICKER_SLOTS,
	type StickerPlacement,
} from './placement.js'

/** Re-exported so `@skinhub/cdn/inspect` is a complete surface on its own. */
export {
	clamp,
	clampStickerOffset,
	DEFAULT_KEYCHAIN,
	DEFAULT_STICKER,
	DEFAULT_STICKER_SCALE,
	emptyKeychain,
	emptySticker,
	f32,
	formatKeychainRow,
	formatStickerRow,
	KEYCHAIN_SCHEMA,
	type KeychainPlacement,
	makeKeychainPlacement,
	makeSkinPlacement,
	makeStickerPlacement,
	migrateLegacyKeychainRow,
	normalizedFromOffset,
	offsetFromNormalized,
	parseKeychainRow,
	parseStickerRow,
	shortFloat,
	type SkinPlacement,
	STICKER_OFFSET_MAX,
	STICKER_OFFSET_MIN,
	STICKER_SCHEMA,
	STICKER_SLOTS,
	type StickerPlacement,
	type StickerSlot,
	u32,
	UINT32_MAX,
} from './placement.js'

/** The upstream item type, re-exported so a consumer needs no second dependency for the types. */
export type { EconItem } from 'cs2-inspect-lib'

/**
 * One encoder for the module. It is stateless for `createInspectUrl` / `decodeMaskedUrl`; the
 * Steam client it can also hold is never constructed on these paths.
 */
const cs2inspect = new CS2Inspect()

/** Empty slots carry no data, and the game omits them entirely rather than sending `sticker_id 0`. */
const isPlaced = (placement: { sticker_id: number }) => placement.sticker_id > 0

const toInspectSticker = (placement: StickerPlacement): InspectSticker => ({
	slot: placement.slot,
	sticker_id: placement.sticker_id,
	wear: placement.wear,
	scale: placement.scale,
	rotation: placement.rotation,
	offset_x: placement.offset_x,
	offset_y: placement.offset_y,
})

const toInspectKeychain = (placement: KeychainPlacement): InspectSticker => ({
	slot: placement.slot,
	sticker_id: placement.sticker_id,
	offset_x: placement.offset_x,
	offset_y: placement.offset_y,
	offset_z: placement.offset_z,
	pattern: placement.pattern,
})

/**
 * A `SkinPlacement` as the protobuf message sees it.
 *
 * Every placement is re-normalised on the way through — this is the choke point the plugin's
 * `uint.TryParse` behaviour requires, and it is why `buildInspectUrl` cannot be bypassed into
 * emitting an id the game will drop.
 */
export const toEconItem = (skin: SkinPlacement): EconItem => {
	const normalized = makeSkinPlacement(skin)
	const stickers = normalized.stickers.filter(isPlaced).map(toInspectSticker)
	const keychain =
		normalized.keychain && isPlaced(normalized.keychain) ? [toInspectKeychain(normalized.keychain)] : undefined

	return {
		defindex: normalized.defindex,
		paintindex: normalized.paintindex,
		paintseed: normalized.paintseed,
		paintwear: normalized.paintwear,
		customname: normalized.nametag || undefined,
		killeaterscoretype: normalized.stattrak ? 0 : undefined,
		killeatervalue: normalized.stattrak ? normalized.stattrak_count : undefined,
		stickers: stickers.length > 0 ? stickers : undefined,
		keychains: keychain,
	}
}

/** The inverse. Always returns all five sticker slots, empty ones included. */
export const fromEconItem = (item: EconItem): SkinPlacement =>
	makeSkinPlacement({
		defindex: item.defindex,
		paintindex: item.paintindex,
		paintseed: item.paintseed,
		paintwear: item.paintwear,
		nametag: item.customname ?? null,
		stattrak: typeof item.killeaterscoretype === 'number',
		stattrak_count: item.killeatervalue ?? 0,
		stickers: STICKER_SLOTS.map(slot => {
			const found = item.stickers?.find(sticker => sticker.slot === slot)
			return found ? makeStickerPlacement({ ...found, slot }) : emptySticker(slot)
		}),
		keychain: item.keychains?.[0] ? makeKeychainPlacement({ ...item.keychains[0], slot: 0 }) : emptyKeychain(),
	})

/** `steam://rungame/730/…+csgo_econ_action_preview <hex>` for the item as configured. */
export const buildInspectUrl = (skin: SkinPlacement): string => cs2inspect.createInspectUrl(toEconItem(skin))

/** The console form, so it can be pasted straight into CS2. */
export const toGameCommand = (inspectUrl: string): string => {
	const encoded = inspectUrl.split('+csgo_econ_action_preview%20')[1]
	return encoded ? `csgo_econ_action_preview ${decodeURIComponent(encoded)}` : inspectUrl
}

/**
 * Decode a MASKED link back into a placement.
 *
 * Masked links only. `S…A…D…` / `M…` links carry no item data — they needed a Game Coordinator
 * round trip Valve has since shut down — so there is nothing to prefill from. Use
 * `isLegacyInspectUrl` to tell the two apart before calling this.
 */
export const readInspectUrl = (url: string): SkinPlacement => fromEconItem(cs2inspect.decodeMaskedUrl(url))

/** True for the unmasked market/inventory form, which this module cannot decode. */
export const isLegacyInspectUrl = (url: string): boolean =>
	/[SM]\d+A\d+D\d+/i.test(url) && !/csgo_econ_action_preview[+%\s]*[0-9A-F]{40,}/i.test(url)
