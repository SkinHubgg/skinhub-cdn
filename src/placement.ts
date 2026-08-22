/**
 * Sticker and charm placement, stored as the GAME's own fields — and the quantisation guard that
 * has to sit between a caller and any encoder.
 *
 * **This module has no external dependencies** - its one import is `./stickerAnchors.js`, a sibling
 * data file with none of its own. It is a separate entry point (`@skinhub/cdn/placement`) from
 * `@skinhub/cdn/inspect` for that reason: a server that writes WeaponPaints rows needs the
 * normalisation and the row format but has no use for a protobuf codec, and should not install one.
 *
 * The shape is `CEconItemPreviewDataBlock.Sticker` verbatim — `slot`, `sticker_id`, `wear`,
 * `scale`, `rotation`, `offset_x`, `offset_y`, `offset_z`, `pattern`. Nothing is renamed, negated
 * or remapped on the way in or out. That is what makes an encode → decode → deep-equal test
 * meaningful rather than a test of a translation layer.
 *
 * Ground truth for the offsets: `g_vStickerNOffset` is `Range2(-0.5,-0.5, 0.5,0.5)`, i.e. UV space
 * centred on the slot's anchor. Protobuf offsets map 1:1 and need no conversion at all.
 *
 * ONE SLOT IS NOT A SIMPLE CONVERSION: the fifth. See `./stickerAnchors.ts` for why, and for the
 * table `parseStickerRow`/`formatStickerRow` take an anchor from below.
 */

import { NO_STICKER_ANCHOR, type StickerAnchor } from './stickerAnchors.js'

export {
	type AnchorCatalogSkin,
	FIFTH_STICKER_SLOT,
	NO_STICKER_ANCHOR,
	type StickerAnchor,
	STICKER_ANCHORS,
	stickerAnchorFor,
	stickerAnchorLookup,
} from './stickerAnchors.js'

/** Every wire field below is a protobuf `float`, so the canonical value is float32. */
export const f32 = (value: number) => (Number.isFinite(value) ? Math.fround(value) : 0)

/** `g_vStickerNOffset` = Range2(-0.5,-0.5, 0.5,0.5). */
export const STICKER_OFFSET_MIN = -0.5
export const STICKER_OFFSET_MAX = 0.5

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * The CS2 WeaponPaints plugin reads every id/seed field with `uint.TryParse`
 * (`WeaponSynchronization.cs`), which has no `NumberStyles.AllowExponent` and no sign — a negative
 * or non-integral id makes it SKIP the sticker and zero the charm outright, so the value vanishes
 * in game rather than failing loudly. The protobuf fields are `uint32` for the same reason.
 * Quantising here keeps the value inside the one grammar both consumers accept.
 */
export const UINT32_MAX = 4294967295

export const u32 = (value: number) => (Number.isFinite(value) ? clamp(Math.trunc(value), 0, UINT32_MAX) : 0)

export const clampStickerOffset = (value: number) =>
	f32(clamp(Number.isFinite(value) ? value : 0, STICKER_OFFSET_MIN, STICKER_OFFSET_MAX))

/**
 * A point on the weapon in [0..1] surface coordinates → the game's centred offset, and back.
 * The ranges line up, so this is a recentre and nothing more.
 */
export const offsetFromNormalized = (normalized: number) => clampStickerOffset(normalized - 0.5)
export const normalizedFromOffset = (offset: number) => clamp(clampStickerOffset(offset) + 0.5, 0, 1)

/** A sticker slot, in the game's own field names. `sticker_id === 0` means the slot is empty. */
export type StickerPlacement = {
	slot: number
	sticker_id: number
	wear: number
	scale: number
	rotation: number
	offset_x: number
	offset_y: number
}

/**
 * A charm. It rides `CEconItemPreviewDataBlock.keychains` (field 20), which is the same message as
 * a sticker — so `pattern` is the charm's seed and `offset_z` is real, not a placeholder.
 */
export type KeychainPlacement = {
	slot: number
	sticker_id: number
	offset_x: number
	offset_y: number
	offset_z: number
	pattern: number
}

/** The five sticker slots a CS2 weapon has. */
export const STICKER_SLOTS = [0, 1, 2, 3, 4] as const

export type StickerSlot = (typeof STICKER_SLOTS)[number]

/**
 * A whole configured item: the weapon, its finish, and everything stuck to it.
 *
 * Declared here rather than next to the codec so it can be built, validated and written to a
 * database without pulling in a protobuf implementation.
 */
export type SkinPlacement = {
	defindex: number
	paintindex: number
	paintseed: number
	paintwear: number
	nametag?: string | null
	stattrak?: boolean
	stattrak_count?: number
	stickers: StickerPlacement[]
	keychain: KeychainPlacement | null
}

/**
 * The game treats an unset scale as 1 (identity), and encoders reject `scale <= 0` outright. The
 * WeaponPaints row default of `0` therefore means "default", not "zero-sized".
 */
export const DEFAULT_STICKER_SCALE = 1

export const DEFAULT_STICKER: StickerPlacement = {
	slot: 0,
	sticker_id: 0,
	wear: 0,
	scale: DEFAULT_STICKER_SCALE,
	rotation: 0,
	offset_x: 0,
	offset_y: 0,
}

export const DEFAULT_KEYCHAIN: KeychainPlacement = {
	slot: 0,
	sticker_id: 0,
	offset_x: 0,
	offset_y: 0,
	offset_z: 0,
	pattern: 0,
}

export const emptySticker = (slot: number): StickerPlacement => ({ ...DEFAULT_STICKER, slot })
export const emptyKeychain = (): KeychainPlacement => ({ ...DEFAULT_KEYCHAIN })

/**
 * Normalises any candidate placement onto the wire's own precision and ranges.
 *
 * An EMPTY slot is normalised all the way to empty. The game omits `sticker_id 0` from an inspect
 * link entirely, so a row like `0;0;-0.017181508554945435;0.1884339428091309;0;0;0` — an
 * unoccupied slot still carrying the offsets of a sticker that was removed — is a placement no
 * inspect link can represent, and it is the one shape that would make a stored row and a link
 * disagree. Dropping the orphaned offsets is what keeps the round trip exact.
 */
export const makeStickerPlacement = (placement: Partial<StickerPlacement> & { slot: number }): StickerPlacement => {
	const slot = Math.trunc(placement.slot)
	const sticker_id = u32(placement.sticker_id ?? 0)
	if (sticker_id === 0) return emptySticker(slot)

	return {
		slot,
		sticker_id,
		wear: f32(clamp(placement.wear ?? 0, 0, 1)),
		scale: f32(placement.scale && placement.scale > 0 ? placement.scale : DEFAULT_STICKER_SCALE),
		rotation: f32(placement.rotation ?? 0),
		offset_x: clampStickerOffset(placement.offset_x ?? 0),
		offset_y: clampStickerOffset(placement.offset_y ?? 0),
	}
}

export const makeKeychainPlacement = (placement: Partial<KeychainPlacement>): KeychainPlacement => {
	const sticker_id = u32(placement.sticker_id ?? 0)
	if (sticker_id === 0) return emptyKeychain()

	return {
		slot: Math.trunc(placement.slot ?? 0),
		sticker_id,
		offset_x: f32(placement.offset_x ?? 0),
		offset_y: f32(placement.offset_y ?? 0),
		offset_z: f32(placement.offset_z ?? 0),
		pattern: u32(placement.pattern ?? 0),
	}
}

/**
 * Normalises a whole item — the finish AND everything stuck to it.
 *
 * The item-level fields bypassed the quantisation the sticker fields go through, and that is a real
 * gap rather than a tidiness one. `paintwear` is a protobuf `float`, so a caller passing the plain
 * double `0.154` gets `0.15399999916553497` back out of a decode: the encode → decode round trip is
 * **not** identity for any wear a human typed, only for one that was already float32. Anything
 * comparing "the item I built" against "the item I decoded" — a test, a cache key, a dirty-check in
 * an editor — then sees a difference that is not there.
 *
 * `defindex`, `paintindex`, `paintseed` and `stattrak_count` are `uint32` on the wire and are read
 * by the WeaponPaints plugin with `uint.TryParse`, which is the same reason `sticker_id` is
 * quantised: out-of-grammar values are dropped silently rather than rejected loudly.
 *
 * Always returns all five sticker slots, and a charm rather than `null`. Idempotent.
 */
export const makeSkinPlacement = (placement: SkinPlacement): SkinPlacement => ({
	defindex: u32(placement.defindex),
	paintindex: u32(placement.paintindex),
	paintseed: u32(placement.paintseed),
	paintwear: f32(placement.paintwear),
	nametag: placement.nametag ?? null,
	stattrak: Boolean(placement.stattrak),
	stattrak_count: placement.stattrak ? u32(placement.stattrak_count ?? 0) : 0,
	stickers: STICKER_SLOTS.map(slot => {
		const found = placement.stickers?.find(sticker => sticker.slot === slot)
		return found ? makeStickerPlacement({ ...found, slot }) : emptySticker(slot)
	}),
	keychain: placement.keychain ? makeKeychainPlacement(placement.keychain) : emptyKeychain(),
})

/* -------------------------------------------------------------------------------------------------
 * WeaponPaints row serialisation
 *
 * `wp_player_skins` is owned by the CS2 WeaponPaints plugin, so the column FORMAT is fixed. Read
 * off `Nereziel/cs2-WeaponPaints` — `WeaponSynchronization.cs` parses, `WeaponAction.cs` applies:
 *
 *   sticker  `id;schema;x;y;wear;scale;rotation`   uint;uint;float;float;float;float;float
 *   keychain `id;x;y;z;seed`                       uint;float;float;float;uint
 *
 * Every field is then written straight onto the item as a game attribute, one per column field —
 * and those attributes are exactly what `CEconItemPreviewDataBlock.Sticker` carries in an inspect
 * link. So the column's `offset_x`/`offset_y` ARE the inspect link's coordinate for slots 0-3,
 * with nothing to convert - and for the fifth slot on the 29 weapon+mesh variants an anchor
 * applies to, converting IS the job: `CEconItemPreviewDataBlock.Sticker` has no field for the
 * anchor at all, so a caller decoding or encoding slot 4 for one of those variants has to fold the
 * shift into `offset_x`/`offset_y` on the way past rather than carry it as a sixth number.
 *
 * ONE DIVERGENCE IS FORCED BY THE PLUGIN'S COLUMN HAVING FEWER FIELDS THAN THE PROTOBUF MESSAGE:
 * a sticker's `offset_z` and `tint_id`/`pattern`/`highlight_reel` have no column and no attribute
 * the plugin sets, so they cannot survive a save.
 *
 * THE OTHER, `schema`, USED TO BE A SECOND ONE AND IS NOT ANY MORE. `WeaponAction.cs` no longer
 * hardcodes it to 0 - it reads the column's second field as an ANCHOR, naming which of the weapon's
 * authored `StickerMarkup` homes the slot hangs off, with 0 still meaning "use the slot's own
 * index". `./stickerAnchors.ts` is the whole argument for why that matters and the table it is
 * measured against; `parseStickerRow`/`formatStickerRow` below take one as an optional third and
 * second argument respectively, exactly as `sticker_id` and `slot` are already explicit rather than
 * inferred, so a caller with no catalogue to resolve an anchor from keeps today's behaviour for
 * free.
 *
 * Floats are parsed with `float.TryParse(NumberStyles.Float, CultureInfo.InvariantCulture)`, so
 * the grammar is `[+-]?digits[.digits][eE[+-]digits]` with a `.` separator and no group
 * separators — which is what `shortFloat` emits.
 * ---------------------------------------------------------------------------------------------- */

export const STICKER_SCHEMA = '0;0;0;0;0;0;0'
export const KEYCHAIN_SCHEMA = '0;0;0;0;0'

/**
 * Shortest decimal that reads back as the SAME float32. `String(Math.fround(0.3))` is
 * `'0.30000001192092896'` — 19 characters of double-precision noise for a value the wire only
 * holds to 24 bits. Seven of those would overflow the plugin's `varchar(128)` column, and the
 * extra digits carry no information, so each field is written at the shortest precision that still
 * round-trips exactly.
 */
export const shortFloat = (value: number) => {
	if (Number.isInteger(value)) return String(value)
	for (let precision = 1; precision < 9; precision++) {
		const candidate = value.toPrecision(precision)
		if (Math.fround(Number(candidate)) === value) return String(Number(candidate))
	}
	return String(Number(value.toPrecision(9)))
}

const numbers = (row: string, expected: number): number[] | null => {
	const parts = row.split(';').map(Number)
	if (parts.length !== expected || parts.some(n => !Number.isFinite(n))) return null
	return parts
}

/**
 * *** THE DELTA IS QUANTISED TO FLOAT32 ON BOTH SIDES, AND THAT IS WHAT STOPS THE COLUMN FROM
 * WANDERING. *** `STICKER_ANCHORS`'s numbers are shortest-decimal spellings of float32 values, so
 * reading one back out of source gives a double that is merely NEAR the float32 the wire holds.
 * Adding that double on write and subtracting it on read makes `parse -> format` a map that is not
 * its own fixed point - measured over the real table it took up to nine save/load cycles to settle,
 * creeping 2.8e-7 uv on the way. Putting both sides on the wire's own grid settles on the first
 * save, with the read landing 3e-8 uv from where the caller put it.
 *
 * Also the guard against a malformed anchor reaching the arithmetic: a shape that is not exactly
 * `{ anchor, dx, dy }` - a stray array index, a partial object - degrades to "no anchor" rather
 * than producing `NaN` fields that `numbers()`/`Number.isFinite` would then read as a malformed row.
 */
const usableAnchor = (anchor: StickerAnchor | null | undefined): StickerAnchor | null =>
	anchor && typeof anchor === 'object' && Number.isFinite(anchor.anchor) && Number.isFinite(anchor.dx) && Number.isFinite(anchor.dy)
		? { anchor: anchor.anchor, dx: f32(anchor.dx), dy: f32(anchor.dy) }
		: null

/**
 * The plugin's second column is the sticker's ANCHOR (see the header above and
 * `./stickerAnchors.ts`) - which of the weapon's authored homes this slot hangs off, 0 meaning "use
 * the slot's own index". Only the caller knows which weapon and mesh a row belongs to, so it is not
 * inferred here: pass the anchor `stickerAnchorFor`/`stickerAnchorLookup` resolve for this
 * `(weaponId, legacy, slot)`, or omit it to get today's behaviour - the column read literally, with
 * no shift applied.
 *
 * *** KEYED ON THE ROW'S OWN FIELD, NOT ON WHETHER THE CALLER HANDED ONE IN. *** A row written
 * before this table existed carries a 0 and was never shifted; un-shifting it because the weapon
 * now HAS an anchor would move a sticker nobody touched. So the row's own second field has to be
 * non-zero, as well as the caller's anchor being usable, before anything is subtracted.
 */
export const parseStickerRow = (
	row: string | null | undefined,
	slot: number,
	anchor: StickerAnchor | null = null,
): StickerPlacement => {
	const parts = numbers(row ?? STICKER_SCHEMA, 7)
	if (!parts) return emptySticker(slot)
	const [sticker_id, schema, rawX, rawY, wear, scale, rotation] = parts as [
		number,
		number,
		number,
		number,
		number,
		number,
		number,
	]
	const applied = sticker_id && schema ? usableAnchor(anchor) : null
	const offset_x = applied ? f32(f32(rawX) - applied.dx) : rawX
	const offset_y = applied ? f32(f32(rawY) - applied.dy) : rawY
	return makeStickerPlacement({ slot, sticker_id, offset_x, offset_y, wear, scale, rotation })
}

/**
 * *** CLAMP THEN SHIFT, NOT THE OTHER WAY ROUND. *** `clampStickerOffset` inside
 * `makeStickerPlacement` bounds where a caller may PLACE a sticker. The anchor shift is not a
 * placement - it is a change of coordinate frame, from the home the viewer draws in to the home the
 * game will use - and several of the table's shifts are larger than that bound on their own (the
 * Galil's hd shift is 0.363). Re-clamping after applying it would drag the sticker away from the
 * spot the caller picked, which is the opposite of what the clamp is for.
 *
 * An EMPTY slot (`sticker_id === 0`) takes no shift and writes anchor 0, so a column nobody ever
 * touched stays exactly the string it has always been - `STICKER_SCHEMA` - anchor table or not.
 */
export const formatStickerRow = (placement: StickerPlacement, anchor: StickerAnchor | null = null) => {
	const normalized = makeStickerPlacement(placement)
	const { sticker_id, wear, scale, rotation } = normalized
	const applied = sticker_id === 0 ? null : usableAnchor(anchor)
	const offset_x = f32(normalized.offset_x + (applied?.dx ?? 0))
	const offset_y = f32(normalized.offset_y + (applied?.dy ?? 0))
	const f = shortFloat
	return `${sticker_id};${applied ? applied.anchor : NO_STICKER_ANCHOR};${f(offset_x)};${f(offset_y)};${f(wear)};${f(scale)};${f(rotation)}`
}

export const parseKeychainRow = (row: string | null | undefined): KeychainPlacement => {
	const parts = numbers(row ?? KEYCHAIN_SCHEMA, 5)
	if (!parts) return emptyKeychain()
	const [sticker_id, offset_x, offset_y, offset_z, pattern] = parts as [number, number, number, number, number]
	return makeKeychainPlacement({ slot: 0, sticker_id, offset_x, offset_y, offset_z, pattern })
}

export const formatKeychainRow = (placement: KeychainPlacement) => {
	const { sticker_id, offset_x, offset_y, offset_z, pattern } = makeKeychainPlacement(placement)
	const f = shortFloat
	return `${sticker_id};${f(offset_x)};${f(offset_y)};${f(offset_z)};${pattern}`
}

/**
 * Rewrites a charm row written by the pre-2026 `GetKeychainSchema`, which wrote `id;-x;1;-y;seed`
 * into an `id;x;y;z;seed` column: x arrived negated, the y column was pinned to the constant 1,
 * the vertical value landed in z, and the real z was dropped.
 *
 * Returns `null` for rows that are empty or already native, so a migration using it is safe to
 * re-run.
 */
const LEGACY_KEYCHAIN_Y = 1

export const migrateLegacyKeychainRow = (row: string): string | null => {
	const parts = numbers(row, 5)
	if (!parts) return null

	const [sticker_id, x, y, z, pattern] = parts as [number, number, number, number, number]
	if (sticker_id <= 0 || y !== LEGACY_KEYCHAIN_Y) return null

	return formatKeychainRow(
		makeKeychainPlacement({ slot: 0, sticker_id, offset_x: -x, offset_y: -z, offset_z: 0, pattern }),
	)
}
