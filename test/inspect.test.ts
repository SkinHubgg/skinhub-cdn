/**
 * `@skinhub/cdn/inspect` — the encode/decode surface.
 *
 * The headline test is encode → decode → deep-equal on a fully-loaded item. That is only a
 * meaningful test because placement is stored in the game's own protobuf field names: if there were
 * a translation layer, this would be testing the translation rather than the format.
 */

import { describe, expect, test } from 'bun:test'
import {
	buildInspectUrl,
	type EconItem,
	fromEconItem,
	isLegacyInspectUrl,
	makeSkinPlacement,
	makeStickerPlacement,
	readInspectUrl,
	type SkinPlacement,
	STICKER_SLOTS,
	toEconItem,
	toGameCommand,
} from '../src/inspect.js'
import { emptyKeychain, emptySticker } from '../src/placement.js'

/**
 * AK-47 | Case Hardened, StatTrak, named, three stickers and a charm.
 *
 * `paintwear` is deliberately the plain double a human would type, NOT a value already rounded to
 * float32. That is the input that used to break the round trip, and `makeSkinPlacement` is what
 * makes it work — see the precision test below.
 */
const loaded = (): SkinPlacement => ({
	defindex: 7,
	paintindex: 44,
	paintseed: 661,
	paintwear: 0.154,
	nametag: 'blue gem',
	stattrak: true,
	stattrak_count: 1337,
	stickers: [
		makeStickerPlacement({ slot: 0, sticker_id: 7691, wear: 0.25, scale: 0.8, rotation: 12, offset_x: 0.1, offset_y: -0.2 }),
		makeStickerPlacement({ slot: 1, sticker_id: 5032, wear: 0, scale: 1, rotation: -45, offset_x: -0.25, offset_y: 0.25 }),
		emptySticker(2),
		makeStickerPlacement({ slot: 3, sticker_id: 1, wear: 1, scale: 2, rotation: 0, offset_x: 0.5, offset_y: -0.5 }),
		emptySticker(4),
	],
	keychain: { slot: 0, sticker_id: 21, offset_x: 1.5, offset_y: -2.25, offset_z: 0.125, pattern: 41 },
})

const bare = (): SkinPlacement => ({
	defindex: 9,
	paintindex: 0,
	paintseed: 0,
	paintwear: 0,
	nametag: null,
	stattrak: false,
	stattrak_count: 0,
	stickers: STICKER_SLOTS.map(emptySticker),
	keychain: emptyKeychain(),
})

describe('round trip', () => {
	test('a fully-loaded item survives encode → decode unchanged', () => {
		const before = makeSkinPlacement(loaded())
		const after = readInspectUrl(buildInspectUrl(before))
		expect(after).toEqual(before)
	})

	test('an item with nothing on it survives too', () => {
		const before = bare()
		const after = readInspectUrl(buildInspectUrl(before))
		expect(after).toEqual(before)
	})

	test('a raw float64 wear is quantised once, then is stable forever', () => {
		// The gap this closes: paintwear is a protobuf float, so an un-normalised 0.154 comes back
		// as 0.15399999916553497 and "what I built" never equals "what I decoded".
		const raw = loaded()
		expect(raw.paintwear).toBe(0.154)

		const once = readInspectUrl(buildInspectUrl(raw))
		expect(once.paintwear).toBe(Math.fround(0.154))

		// Idempotent from here on — a second and third trip change nothing.
		const twice = readInspectUrl(buildInspectUrl(once))
		expect(twice).toEqual(once)
		expect(readInspectUrl(buildInspectUrl(twice))).toEqual(once)
	})

	test('makeSkinPlacement alone is enough to make the input round-trip-stable', () => {
		const normalized = makeSkinPlacement(loaded())
		expect(makeSkinPlacement(normalized)).toEqual(normalized)
		expect(readInspectUrl(buildInspectUrl(normalized))).toEqual(normalized)
	})

	test('decode always returns all five slots, empty ones included', () => {
		const decoded = readInspectUrl(buildInspectUrl(loaded()))
		expect(decoded.stickers).toHaveLength(5)
		expect(decoded.stickers.map(s => s.slot)).toEqual([0, 1, 2, 3, 4])
		expect(decoded.stickers[2]).toEqual(emptySticker(2))
	})

	test('float32 precision is preserved through the wire', () => {
		const normalized = makeSkinPlacement(loaded())
		const decoded = readInspectUrl(buildInspectUrl(normalized))
		expect(decoded.paintwear).toBe(normalized.paintwear)
		expect(decoded.stickers[0]?.offset_x).toBe(normalized.stickers[0]?.offset_x)
		expect(decoded.paintseed).toBe(661)
	})
})

describe('toEconItem', () => {
	test('empty slots are omitted, not sent as sticker_id 0 — the game omits them', () => {
		const item = toEconItem(loaded())
		expect(item.stickers).toHaveLength(3)
		expect(item.stickers?.map(s => s.slot)).toEqual([0, 1, 3])
	})

	test('an item with no stickers and no charm sends neither field', () => {
		const item = toEconItem(bare())
		expect(item.stickers).toBeUndefined()
		expect(item.keychains).toBeUndefined()
	})

	test('StatTrak rides killeaterscoretype/killeatervalue, and is absent when off', () => {
		expect(toEconItem(loaded()).killeaterscoretype).toBe(0)
		expect(toEconItem(loaded()).killeatervalue).toBe(1337)
		expect(toEconItem(bare()).killeaterscoretype).toBeUndefined()
		expect(toEconItem(bare()).killeatervalue).toBeUndefined()
	})

	test('an empty nametag is omitted rather than sent as ""', () => {
		expect(toEconItem({ ...bare(), nametag: '' }).customname).toBeUndefined()
		expect(toEconItem({ ...bare(), nametag: 'gg' }).customname).toBe('gg')
	})

	test('the boundary quantises — a signed or fractional id cannot reach the encoder', () => {
		// The WeaponPaints plugin parses ids with uint.TryParse and SILENTLY SKIPS anything else,
		// so an id like this would make the sticker vanish in game with no error anywhere.
		const dirty: SkinPlacement = {
			...bare(),
			stickers: [
				{ slot: 0, sticker_id: -5, wear: 0, scale: 1, rotation: 0, offset_x: 0, offset_y: 0 },
				{ slot: 1, sticker_id: 12.9, wear: 0, scale: 1, rotation: 0, offset_x: 0, offset_y: 0 },
				emptySticker(2),
				emptySticker(3),
				emptySticker(4),
			],
		}

		const item = toEconItem(dirty)
		expect(item.stickers).toHaveLength(1)
		expect(item.stickers?.[0]?.sticker_id).toBe(12)
		expect(Number.isInteger(item.stickers?.[0]?.sticker_id)).toBe(true)
	})

	test('offsets outside the shader range are clamped on the way out', () => {
		const item = toEconItem({
			...bare(),
			stickers: [
				{ slot: 0, sticker_id: 4, wear: 0, scale: 1, rotation: 0, offset_x: 9, offset_y: -9 },
				...STICKER_SLOTS.slice(1).map(emptySticker),
			],
		})
		expect(item.stickers?.[0]?.offset_x).toBe(0.5)
		expect(item.stickers?.[0]?.offset_y).toBe(-0.5)
	})
})

describe('fromEconItem', () => {
	test('an item with no sticker or charm fields decodes to five empty slots and an empty charm', () => {
		const item: EconItem = { defindex: 7, paintindex: 44, paintseed: 0, paintwear: 0 }
		const placement = fromEconItem(item)
		expect(placement.stickers).toEqual(STICKER_SLOTS.map(emptySticker))
		expect(placement.keychain).toEqual(emptyKeychain())
		expect(placement.nametag).toBeNull()
		expect(placement.stattrak).toBe(false)
	})
})

describe('url helpers', () => {
	test('buildInspectUrl produces a steam:// masked preview link', () => {
		const url = buildInspectUrl(loaded())
		expect(url.startsWith('steam://rungame/730/')).toBe(true)
		expect(url).toContain('+csgo_econ_action_preview')
	})

	test('toGameCommand extracts the console form', () => {
		const command = toGameCommand(buildInspectUrl(loaded()))
		expect(command.startsWith('csgo_econ_action_preview ')).toBe(true)
		expect(command).toMatch(/^csgo_econ_action_preview [0-9A-F]+$/i)
	})

	test('toGameCommand passes anything it cannot parse straight through', () => {
		expect(toGameCommand('not a link')).toBe('not a link')
	})

	test('isLegacyInspectUrl separates unmasked market links from masked ones', () => {
		// The two unmasked forms: S<steamid>A<assetid>D<d> from an inventory, M<listingid>A…D… from
		// the market. Neither carries item data — they needed a Game Coordinator round trip Valve
		// has shut down — so readInspectUrl cannot do anything with either.
		const inventory = 'steam://rungame/730/76561202255233023/+csgo_econ_action_preview S76561198084749846A6768243D12345678'
		const market = 'steam://rungame/730/76561202255233023/+csgo_econ_action_preview M4079342885663254123A12345D6789'

		expect(isLegacyInspectUrl(inventory)).toBe(true)
		expect(isLegacyInspectUrl(market)).toBe(true)
		expect(isLegacyInspectUrl(buildInspectUrl(loaded()))).toBe(false)
	})

	test('a masked link is what readInspectUrl can actually decode', () => {
		const url = buildInspectUrl(loaded())
		expect(isLegacyInspectUrl(url)).toBe(false)
		expect(() => readInspectUrl(url)).not.toThrow()
	})
})

/* Three things this file deliberately does NOT test, because they belong elsewhere:
 *
 *   - the **byte format**. `codec.test.ts` runs 2,326 items and 41 URL forms through `src/codec.ts`
 *     and through `cs2-inspect-lib` and asserts the hex is identical; `codec-mutation.test.ts` proves
 *     that comparison can fail. The cases here are the readable examples, not the coverage.
 *   - the **module graph** — that a data-only consumer carries none of the codec, and that the codec
 *     builds for a browser. `bundle.test.ts` measures real bundles rather than source text.
 *   - the **row format**, which is `placement.test.ts`.
 */
