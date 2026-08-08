/**
 * `@skinhub/cdn/placement` — normalisation and the WeaponPaints row format.
 *
 * The row format is not a matter of taste: `wp_player_skins` is owned by the CS2 WeaponPaints
 * plugin, which parses ids with `uint.TryParse` and floats with
 * `float.TryParse(NumberStyles.Float, InvariantCulture)`. The tests below assert the properties
 * that parser requires, which is why they are phrased as grammar checks rather than as string
 * equality against a golden row.
 */

import { describe, expect, test } from 'bun:test'
import {
	clampStickerOffset,
	DEFAULT_STICKER_SCALE,
	emptyKeychain,
	emptySticker,
	f32,
	formatKeychainRow,
	formatStickerRow,
	KEYCHAIN_SCHEMA,
	makeKeychainPlacement,
	makeStickerPlacement,
	migrateLegacyKeychainRow,
	normalizedFromOffset,
	offsetFromNormalized,
	parseKeychainRow,
	parseStickerRow,
	shortFloat,
	STICKER_OFFSET_MAX,
	STICKER_OFFSET_MIN,
	STICKER_SCHEMA,
	STICKER_SLOTS,
	u32,
	UINT32_MAX,
} from '../src/placement.js'

/** What `uint.TryParse` accepts: digits only, no sign, no point, no exponent. */
const UINT_GRAMMAR = /^\d+$/
/** What `float.TryParse(NumberStyles.Float, InvariantCulture)` accepts. */
const FLOAT_GRAMMAR = /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/

describe('quantisation', () => {
	test('u32 clamps, truncates and survives nonsense', () => {
		expect(u32(5)).toBe(5)
		expect(u32(-1)).toBe(0)
		expect(u32(3.9)).toBe(3)
		expect(u32(-3.9)).toBe(0)
		expect(u32(UINT32_MAX + 10)).toBe(UINT32_MAX)
		// Non-finite input degrades to 0, which the placement layer reads as "empty slot" — the
		// safe direction. It does NOT saturate to UINT32_MAX, which would invent a real sticker.
		expect(u32(Number.NaN)).toBe(0)
		expect(u32(Number.POSITIVE_INFINITY)).toBe(0)
		expect(u32(Number.NEGATIVE_INFINITY)).toBe(0)
	})

	test('f32 rounds to the precision the wire actually carries', () => {
		expect(f32(0.3)).toBe(Math.fround(0.3))
		expect(f32(Number.NaN)).toBe(0)
	})

	test('offsets are clamped to the shader range Range2(-0.5,-0.5, 0.5,0.5)', () => {
		expect(clampStickerOffset(2)).toBe(STICKER_OFFSET_MAX)
		expect(clampStickerOffset(-2)).toBe(STICKER_OFFSET_MIN)
		expect(clampStickerOffset(Number.NaN)).toBe(0)
	})

	test('normalised [0..1] and centred offsets are the same range, recentred', () => {
		expect(offsetFromNormalized(0)).toBe(-0.5)
		expect(offsetFromNormalized(0.5)).toBe(0)
		expect(offsetFromNormalized(1)).toBe(0.5)
		for (const n of [0, 0.25, 0.5, 0.75, 1]) {
			expect(normalizedFromOffset(offsetFromNormalized(n))).toBeCloseTo(n, 6)
		}
	})
})

describe('makeStickerPlacement', () => {
	test('a zero id normalises all the way to empty, dropping orphaned offsets', () => {
		// A real row from production: an unoccupied slot still carrying the offsets of a sticker
		// that was removed. No inspect link can represent it, so it must not survive normalisation.
		const orphan = makeStickerPlacement({ slot: 0, sticker_id: 0, offset_x: -0.0171815, offset_y: 0.1884339 })
		expect(orphan).toEqual(emptySticker(0))
	})

	test('scale 0 means "default", not "zero-sized"', () => {
		expect(makeStickerPlacement({ slot: 1, sticker_id: 5, scale: 0 }).scale).toBe(DEFAULT_STICKER_SCALE)
		expect(makeStickerPlacement({ slot: 1, sticker_id: 5, scale: -3 }).scale).toBe(DEFAULT_STICKER_SCALE)
		expect(makeStickerPlacement({ slot: 1, sticker_id: 5, scale: 0.5 }).scale).toBe(0.5)
	})

	test('a signed or fractional id cannot get through', () => {
		expect(makeStickerPlacement({ slot: 0, sticker_id: -7 })).toEqual(emptySticker(0))
		expect(makeStickerPlacement({ slot: 0, sticker_id: 12.9 }).sticker_id).toBe(12)
	})

	test('wear is clamped to [0,1]', () => {
		expect(makeStickerPlacement({ slot: 0, sticker_id: 1, wear: 5 }).wear).toBe(1)
		expect(makeStickerPlacement({ slot: 0, sticker_id: 1, wear: -5 }).wear).toBe(0)
	})

	test('there are five sticker slots', () => {
		expect(STICKER_SLOTS).toEqual([0, 1, 2, 3, 4])
	})
})

describe('makeKeychainPlacement', () => {
	test('a zero id empties the charm', () => {
		expect(makeKeychainPlacement({ sticker_id: 0, offset_x: 3, pattern: 9 })).toEqual(emptyKeychain())
	})

	test('offset_z and pattern are real fields, not placeholders', () => {
		const charm = makeKeychainPlacement({ sticker_id: 3, offset_x: 1.5, offset_y: -2, offset_z: 0.25, pattern: 41 })
		expect(charm.offset_z).toBe(f32(0.25))
		expect(charm.pattern).toBe(41)
		// A charm's offsets are NOT clamped to the sticker UV range — they are world-space.
		expect(charm.offset_x).toBe(f32(1.5))
	})
})

describe('WeaponPaints row format', () => {
	test('a sticker row round-trips exactly', () => {
		const placement = makeStickerPlacement({
			slot: 2,
			sticker_id: 7691,
			offset_x: 0.1234,
			offset_y: -0.4321,
			wear: 0.3,
			scale: 0.75,
			rotation: 42.5,
		})
		expect(parseStickerRow(formatStickerRow(placement), 2)).toEqual(placement)
	})

	test('a charm row round-trips exactly', () => {
		const charm = makeKeychainPlacement({ sticker_id: 21, offset_x: 1.25, offset_y: -3.5, offset_z: 0.125, pattern: 7 })
		expect(parseKeychainRow(formatKeychainRow(charm))).toEqual(charm)
	})

	test('every emitted field matches the grammar the C# parser accepts', () => {
		const row = formatStickerRow(
			makeStickerPlacement({ slot: 0, sticker_id: 4294967295, offset_x: 0.3, offset_y: -0.1, wear: 0.987654321, scale: 1.3, rotation: -90.5 }),
		)
		const fields = row.split(';')
		expect(fields).toHaveLength(7)
		expect(fields[0]).toMatch(UINT_GRAMMAR)
		expect(fields[1]).toBe('0') // schema — WeaponAction.cs hardcodes 0 whatever the column says
		for (const field of fields.slice(2)) expect(field).toMatch(FLOAT_GRAMMAR)

		const charm = formatKeychainRow(makeKeychainPlacement({ sticker_id: 9, offset_x: 0.3, offset_y: 0.7, offset_z: -0.2, pattern: 12345 }))
		const charmFields = charm.split(';')
		expect(charmFields).toHaveLength(5)
		expect(charmFields[0]).toMatch(UINT_GRAMMAR)
		expect(charmFields[4]).toMatch(UINT_GRAMMAR)
		for (const field of charmFields.slice(1, 4)) expect(field).toMatch(FLOAT_GRAMMAR)
	})

	test('rows fit the plugin varchar(128) column', () => {
		const worst = formatStickerRow(
			makeStickerPlacement({ slot: 0, sticker_id: UINT32_MAX, offset_x: 0.49999997, offset_y: -0.49999997, wear: 0.99999994, scale: 3.3333333, rotation: -359.99997 }),
		)
		expect(worst.length).toBeLessThanOrEqual(128)
	})

	test('shortFloat emits the shortest decimal that reads back as the same float32', () => {
		expect(shortFloat(f32(0.3))).toBe('0.3')
		expect(String(f32(0.3))).toBe('0.30000001192092896') // what it saves us from
		expect(shortFloat(1)).toBe('1')
		expect(shortFloat(-0.5)).toBe('-0.5')
		for (const raw of [0.1, 0.123456, -0.98765, 1.5, 42.25, 0.0001]) {
			expect(Math.fround(Number(shortFloat(f32(raw))))).toBe(f32(raw))
		}
	})

	test('a malformed or absent row degrades to empty rather than throwing', () => {
		expect(parseStickerRow(null, 3)).toEqual(emptySticker(3))
		expect(parseStickerRow(undefined, 3)).toEqual(emptySticker(3))
		expect(parseStickerRow('garbage', 3)).toEqual(emptySticker(3))
		expect(parseStickerRow('1;2;3', 3)).toEqual(emptySticker(3))
		expect(parseStickerRow(STICKER_SCHEMA, 3)).toEqual(emptySticker(3))
		expect(parseKeychainRow(KEYCHAIN_SCHEMA)).toEqual(emptyKeychain())
		expect(parseKeychainRow('x;y;z')).toEqual(emptyKeychain())
	})
})

describe('legacy charm migration', () => {
	test('rewrites id;-x;1;-y;seed into id;x;y;z;seed', () => {
		// The old writer stored x negated, pinned the y column to 1, put the vertical value in z.
		const legacy = '21;-0.25;1;-0.5;7'
		const migrated = migrateLegacyKeychainRow(legacy)
		expect(migrated).not.toBeNull()

		const parsed = parseKeychainRow(migrated as string)
		expect(parsed.sticker_id).toBe(21)
		expect(parsed.offset_x).toBe(f32(0.25))
		expect(parsed.offset_y).toBe(f32(0.5))
		expect(parsed.offset_z).toBe(0)
		expect(parsed.pattern).toBe(7)
	})

	test('is safe to re-run — an already-native row is left alone', () => {
		const native = formatKeychainRow(makeKeychainPlacement({ sticker_id: 21, offset_x: 0.25, offset_y: 0.5, offset_z: 0, pattern: 7 }))
		expect(migrateLegacyKeychainRow(native)).toBeNull()
		expect(migrateLegacyKeychainRow('0;0;1;0;0')).toBeNull()
		expect(migrateLegacyKeychainRow('nonsense')).toBeNull()
	})
})
