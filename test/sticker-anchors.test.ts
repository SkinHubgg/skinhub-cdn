/**
 * THE FIFTH STICKER'S ANCHOR - what `formatStickerRow`/`parseStickerRow` do with it, and what the
 * WeaponPaints plugin then does with the column.
 *
 * The claim under test was MEASURED, not reasoned about. On the owner's own AK-47, on a live
 * server:
 *
 *     weapon_sticker_4 = '60;0;0;0;0;1;0'          -> NOTHING renders
 *     weapon_sticker_4 = '60;1;0.147;0.029;0;1;0'  -> the sticker RENDERS
 *
 * The AK's model authors four `StickerMarkup` homes and no fifth, so slot 4 anchored to its own
 * index points at a home that does not exist and the pixel shader skips it. Naming home 1 and
 * shifting onto it is what makes it draw, and this file's job is that the row codec keeps emitting
 * exactly that shape.
 *
 * `pluginReads` below is `WeaponAction.cs`'s own reading of the column reimplemented as an oracle,
 * so a format change the plugin would refuse fails here rather than in game.
 */

import { describe, expect, test } from 'bun:test'
import {
	emptySticker,
	f32,
	formatStickerRow,
	makeStickerPlacement,
	parseStickerRow,
	STICKER_OFFSET_MAX,
	type StickerAnchor,
	type StickerPlacement,
} from '../src/placement.js'
import {
	type AnchorCatalogSkin,
	FIFTH_STICKER_SLOT,
	NO_STICKER_ANCHOR,
	STICKER_ANCHORS,
	stickerAnchorFor,
	stickerAnchorLookup,
} from '../src/stickerAnchors.js'

/**
 * `WeaponSynchronization.cs` (`parts.Length == 7`, `float.TryParse`/`uint.TryParse`, which SKIP the
 * whole sticker on a field that will not parse) plus `WeaponAction.cs` after the anchor fix:
 *
 *     uint stickerAnchor = sticker.Schema != 0 ? sticker.Schema : (uint)stickerSlot;
 */
const pluginReads = (column: string, slot: number) => {
	const parts = column.split(';')
	if (parts.length !== 7) return null
	if (!/^\s*\+?\d+\s*$/.test(parts[0] as string) || !/^\s*\+?\d+\s*$/.test(parts[1] as string)) return null
	for (const part of parts.slice(2)) if (!/^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$/.test(part)) return null
	const [id, schema, x, y] = parts.map(Number)
	if (id === 0) return { drawn: false, home: slot, x, y }
	return { drawn: true, home: schema !== 0 ? schema : slot, x: Math.fround(x as number), y: Math.fround(y as number) }
}

/**
 * `g_vStickerNOffset` off `weapon_rif_ak47.vmat_c`, body_hd. Four homes, no fifth.
 */
const AK47_HD_HOMES: [number, number][] = [
	[0.148, -0.434],
	[0.061, -0.434],
	[-0.025, -0.435],
	[-0.164, -0.444],
]

/** Where the viewer draws the AK's fifth sticker (`deriveFifthSlot`, hd mesh). */
const AK47_HD_DERIVED_FIFTH: [number, number] = [0.20799425, -0.40500575]

const AK47 = 7
const P250 = 36

/** Enough of a catalogue row for `stickerAnchorLookup`. 44 is a real AK paint, 12 a legacy kit. */
const CATALOG: AnchorCatalogSkin[] = [
	{ weapon: { id: 'weapon_ak47', weapon_id: AK47 }, paint_index: '44', legacy_model: false },
	{ weapon: { id: 'weapon_ak47', weapon_id: AK47 }, paint_index: '12', legacy_model: true },
	{ weapon: { id: 'weapon_p250', weapon_id: P250 }, paint_index: '1', legacy_model: false },
]

const sticker = (over: Partial<StickerPlacement>): StickerPlacement =>
	makeStickerPlacement({ slot: FIFTH_STICKER_SLOT, sticker_id: 60, ...over })

describe('the anchor table', () => {
	const entries = Object.entries(STICKER_ANCHORS).flatMap(([weaponId, variants]) =>
		(['hd', 'legacy'] as const)
			.map(variant => ({ weaponId, variant, entry: variants[variant] }))
			.filter((row): row is { weaponId: string; variant: 'hd' | 'legacy'; entry: StickerAnchor } => !!row.entry),
	)

	test('covers the 29 weapon+mesh variants whose model authors no fifth home', () => {
		expect(entries.length).toBe(29)
	})

	test('never names home 0, which the column cannot express', () => {
		expect(entries.every(row => row.entry.anchor >= 1 && row.entry.anchor <= 3)).toBe(true)
	})

	test('is only ever consulted for the fifth slot', () => {
		for (const slot of [0, 1, 2, 3]) expect(stickerAnchorFor('weapon_ak47', false, slot)).toBeNull()
		expect(stickerAnchorFor('weapon_ak47', false, FIFTH_STICKER_SLOT)).toBeTruthy()
	})

	/**
	 * 40 of the 69 variants author their own fifth home and draw a fifth sticker correctly today.
	 * They are ABSENT from the table, so a caller must keep resolving no anchor for them.
	 */
	test('a weapon that authors its own fifth home gets no anchor', () => {
		for (const weaponId of ['weapon_p250', 'weapon_aug', 'weapon_famas', 'weapon_cz75a', 'weapon_taser'])
			expect(stickerAnchorFor(weaponId, false, FIFTH_STICKER_SLOT)).toBeNull()
		// The AWP is the shape worth remembering: its LEGACY mesh authors a fifth home and its hd
		// mesh does not, so only one of the two is listed.
		expect(stickerAnchorFor('weapon_awp', false, FIFTH_STICKER_SLOT)).toBeTruthy()
		expect(stickerAnchorFor('weapon_awp', true, FIFTH_STICKER_SLOT)).toBeNull()
	})

	test('a weapon nothing has heard of gets no anchor', () => {
		expect(stickerAnchorFor('weapon_not_a_gun', false, FIFTH_STICKER_SLOT)).toBeNull()
		expect(stickerAnchorFor(null, false, FIFTH_STICKER_SLOT)).toBeNull()
	})
})

describe('the AK-47 row that was verified in game', () => {
	const anchor = stickerAnchorFor('weapon_ak47', false, FIFTH_STICKER_SLOT) as StickerAnchor

	test('names home 1 and shifts onto it by the measured amount', () => {
		expect(anchor.anchor).toBe(1)
		expect(anchor.dx).toBeCloseTo(0.147, 3)
		expect(anchor.dy).toBeCloseTo(0.029, 3)
	})

	test('an untouched fifth sticker is the row the owner saw render, and the old one is what he saw vanish', () => {
		const withAnchor = formatStickerRow(sticker({}), anchor)
		const withoutAnchor = formatStickerRow(sticker({}))
		expect(withAnchor.split(';').slice(0, 4).join(';')).toBe('60;1;0.14699425;0.028994253')
		expect(withoutAnchor.split(';').slice(0, 4).join(';')).toBe('60;0;0;0')
		expect(pluginReads(withAnchor, FIFTH_STICKER_SLOT)?.home).toBe(1)
	})

	/**
	 * The point of the whole exercise: the anchor home plus the stored offset has to equal where
	 * the viewer draws the fifth sticker, because that is the position the caller picked.
	 */
	test('anchor home plus the stored offset is where the viewer draws it', () => {
		for (const [ux, uy] of [
			[0, 0],
			[0.05, -0.02],
			[-0.31, 0.11],
		] as const) {
			const row = formatStickerRow(sticker({ offset_x: ux, offset_y: uy }), anchor)
			const read = pluginReads(row, FIFTH_STICKER_SLOT)
			expect(read).not.toBeNull()
			const home = AK47_HD_HOMES[read?.home ?? 0] as [number, number]
			expect(home[0] + (read?.x ?? 0)).toBeCloseTo(AK47_HD_DERIVED_FIFTH[0] + ux, 6)
			expect(home[1] + (read?.y ?? 0)).toBeCloseTo(AK47_HD_DERIVED_FIFTH[1] + uy, 6)
		}
	})
})

describe('the round trip', () => {
	/**
	 * Not bit-exact on the first pass - float32 add-then-subtract is not its own inverse to the last
	 * bit, which is what the settling test below is really about - but well within a sticker's own
	 * precision, and everything but the two offsets round-trips exactly.
	 */
	test('formatStickerRow -> parseStickerRow with the same anchor is close to the identity', () => {
		const anchor = stickerAnchorFor('weapon_ak47', false, FIFTH_STICKER_SLOT) as StickerAnchor
		const placed = sticker({ offset_x: 0.1234, offset_y: -0.05, wear: 0.3, scale: 0.75, rotation: 42.5 })
		const row = formatStickerRow(placed, anchor)
		const read = parseStickerRow(row, FIFTH_STICKER_SLOT, anchor)
		expect(read).toEqual({ ...placed, offset_x: read.offset_x, offset_y: read.offset_y })
		expect(read.offset_x).toBeCloseTo(placed.offset_x, 6)
		expect(read.offset_y).toBeCloseTo(placed.offset_y, 6)
	})

	/**
	 * *** DOES NOT STACK, AND DOES NOT WALK. *** The stacking half is obvious. The walking half is
	 * the one that nearly shipped: with the delta left as the double its decimal spells, a
	 * format -> parse -> format cycle was not its own fixed point. Putting both sides on the wire's
	 * float32 grid is what settles it on the first pass.
	 */
	test('a format/parse cycle does not stack the shift, and does not walk', () => {
		let worst = 0
		for (const [weaponId, variants] of Object.entries(STICKER_ANCHORS)) {
			for (const variant of ['hd', 'legacy'] as const) {
				const anchor = variants[variant]
				if (!anchor) continue
				for (const [offset_x, offset_y] of [
					[0, 0],
					[0.037, -0.081],
					[-0.4131, 0.2277],
				] as const) {
					const placed = sticker({ offset_x, offset_y, wear: 0.3, rotation: 12 })
					let row = formatStickerRow(placed, anchor)
					let previousRow: string | null = null
					for (let cycle = 0; cycle < 6; cycle++) {
						const read = parseStickerRow(row, FIFTH_STICKER_SLOT, anchor)
						worst = Math.max(worst, Math.abs(read.offset_x - f32(offset_x)), Math.abs(read.offset_y - f32(offset_y)))
						const next = formatStickerRow(read, anchor)
						if (previousRow) expect({ weaponId, variant, next }).toEqual({ weaponId, variant, next: previousRow })
						previousRow = next
						row = next
					}
				}
			}
		}
		// float32 add-then-subtract is not the identity to the bit; a sticker is about 0.07 uv
		// across, so this is four ten-thousandths of one percent of a sticker.
		expect(worst).toBeLessThan(1e-6)
	})

	/**
	 * A row carrying schema 0 was written before this table existed and was never shifted.
	 * Un-shifting it just because the weapon now HAS an anchor would move a sticker nobody touched -
	 * which is every row in `wp_player_skins` today. No migration, by design.
	 */
	test('an existing row with schema 0 comes back unshifted even when an anchor is supplied', () => {
		const stored = '8;0;-0.1223;0.2157;0;0;0'
		const anchor = stickerAnchorFor('weapon_ak47', false, FIFTH_STICKER_SLOT) as StickerAnchor
		expect(parseStickerRow(stored, FIFTH_STICKER_SLOT, anchor)).toEqual(parseStickerRow(stored, FIFTH_STICKER_SLOT))
	})

	test('an empty slot is written exactly as it always was, anchor or no anchor', () => {
		const anchor = stickerAnchorFor('weapon_ak47', false, FIFTH_STICKER_SLOT) as StickerAnchor
		expect(formatStickerRow(emptySticker(FIFTH_STICKER_SLOT), anchor)).toBe(formatStickerRow(emptySticker(FIFTH_STICKER_SLOT)))
		expect(parseStickerRow(formatStickerRow(emptySticker(FIFTH_STICKER_SLOT)), FIFTH_STICKER_SLOT, anchor)).toEqual(
			emptySticker(FIFTH_STICKER_SLOT),
		)
	})
})

describe('the clamp and the shift are different things', () => {
	const anchor = stickerAnchorFor('weapon_galilar', false, FIFTH_STICKER_SLOT) as StickerAnchor

	test('the shift pushes the stored column outside the range a caller may place in', () => {
		// 0.363 on top of a placement already allowed to reach 0.5.
		const stored = Number(formatStickerRow(sticker({ offset_x: STICKER_OFFSET_MAX }), anchor).split(';')[2])
		expect(stored).toBeGreaterThan(STICKER_OFFSET_MAX)
		expect(stored).toBeCloseTo(STICKER_OFFSET_MAX + anchor.dx, 6)
	})

	/**
	 * The caller's own value is clamped by `makeStickerPlacement` before the shift is added, and the
	 * shift itself is never re-clamped - re-clamping after it would drag the sticker off the spot
	 * the caller picked, and on this weapon it would drag it most of the way across the gun.
	 */
	test('the read gives the clamped placed value back, not a doubly-clamped one', () => {
		const read = parseStickerRow(formatStickerRow(sticker({ offset_x: 9, offset_y: -9 }), anchor), FIFTH_STICKER_SLOT, anchor)
		expect(read.offset_x).toBeCloseTo(STICKER_OFFSET_MAX, 6)
		expect(read.offset_y).toBeCloseTo(-STICKER_OFFSET_MAX, 6)
	})
})

describe('a malformed anchor degrades to no anchor', () => {
	test('a stray array index does not corrupt the row', () => {
		for (const strayIndex of [0, 1, 2, 3, 4]) {
			const row = formatStickerRow(sticker({ offset_x: 0.1 }), strayIndex as unknown as StickerAnchor)
			expect(row).toBe(`60;${NO_STICKER_ANCHOR};0.1;0;0;1;0`)
			expect(pluginReads(row, strayIndex)).not.toBeNull()
		}
		expect(parseStickerRow('60;1;0.2;0.1;0;0;0', FIFTH_STICKER_SLOT, 3 as unknown as StickerAnchor)).toEqual(
			parseStickerRow('60;1;0.2;0.1;0;0;0', FIFTH_STICKER_SLOT),
		)
	})

	test('a partial object is rejected the same way', () => {
		const row = formatStickerRow(sticker({}), { anchor: 1 } as StickerAnchor)
		expect(row.split(';')[1]).toBe(String(NO_STICKER_ANCHOR))
	})
})

describe('which mesh a row is', () => {
	const anchorFor = stickerAnchorLookup(CATALOG)

	test('a normal paint takes the hd anchor', () => {
		expect(anchorFor(AK47, 44, FIFTH_STICKER_SLOT)).toEqual(STICKER_ANCHORS.weapon_ak47?.hd as StickerAnchor)
	})

	test('a legacy_model paint takes the legacy anchor, which is a different shift', () => {
		expect(anchorFor(AK47, 12, FIFTH_STICKER_SLOT)).toEqual(STICKER_ANCHORS.weapon_ak47?.legacy as StickerAnchor)
		expect(STICKER_ANCHORS.weapon_ak47?.hd?.dx).not.toBe(STICKER_ANCHORS.weapon_ak47?.legacy?.dx)
	})

	/**
	 * A paint the catalogue has no row for renders on the LEGACY mesh, not the hd one - matching
	 * `WeaponAction.cs`'s own `isLegacyModel = skinInfo.Count <= 0 || ...`.
	 */
	test('a paint nothing has a row for falls to the legacy mesh, as the plugin does', () => {
		expect(anchorFor(AK47, 999999, FIFTH_STICKER_SLOT)).toEqual(STICKER_ANCHORS.weapon_ak47?.legacy as StickerAnchor)
	})

	test('a weapon that authors its own fifth home gets nothing, whatever the paint', () => {
		expect(anchorFor(P250, 1, FIFTH_STICKER_SLOT)).toBeNull()
		expect(anchorFor(P250, 999999, FIFTH_STICKER_SLOT)).toBeNull()
	})
})
