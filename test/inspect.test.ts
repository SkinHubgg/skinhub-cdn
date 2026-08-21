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

/**
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * *** XOR-MASKED PAYLOADS — see the block comment on `unmaskHex` in `src/codec.ts`. ***
 *
 * These used to report themselves as TRUNCATED links ("Buffer underrun while skipping
 * length-delimited field"), which sent everyone who hit one off to re-copy a link that was already
 * complete. They are not in `codec.test.ts` because they are the one place this codec deliberately
 * DIVERGES from `cs2-inspect-lib`: the reference refuses them, and that suite exists to assert the two
 * agree. So the behaviour is pinned here, on the package's own surface.
 */
describe('XOR-masked inspect links', () => {
	/** Mask a payload the way the wild does: XOR every byte, including the frame prefix and trailer. */
	const mask = (url: string, key: number): string => {
		const hex = url.split('%20')[1] as string
		let out = ''
		for (let i = 0; i < hex.length; i += 2) {
			const byte = Number.parseInt(hex.slice(i, i + 2), 16) ^ key
			out += byte.toString(16).padStart(2, '0').toUpperCase()
		}
		return out
	}

	/**
	 * THE PROPERTY, over every key a payload can carry.
	 *
	 * Encode a fully-loaded item — StatTrak, a nametag, three stickers at their placements and a charm
	 * — mask it, and require the decode to come back byte-equal to the unmasked one. Round-tripping
	 * through all 255 non-zero keys is what proves the key is READ rather than guessed at, and it is
	 * cheap: 255 decodes of a 130-byte payload.
	 */
	test('a masked payload decodes to exactly what the unmasked one does, for every key', () => {
		const url = buildInspectUrl(loaded())
		const expected = readInspectUrl(url)

		for (let key = 1; key < 256; key++) {
			expect(readInspectUrl(mask(url, key))).toEqual(expected)
		}
	})

	/** Key 0 IS the unmasked form, so masking with it must be the identity rather than a special case. */
	test('key 0 is the ordinary link, untouched', () => {
		const url = buildInspectUrl(loaded())
		expect(readInspectUrl(mask(url, 0))).toEqual(readInspectUrl(url))
	})

	/**
	 * *** THE CAPTURED PAYLOADS, which is the half a generated one cannot cover. ***
	 *
	 * The property test above masks OUR OWN encoder's output, so it would pass even if the wild used a
	 * different scheme entirely. These three are real links, and their decoded values were checked
	 * against the published `skins.json` and `stickers.json` rather than eyeballed — see the block
	 * comment in `src/codec.ts` for the lookups.
	 */
	test.each([
		{
			name: 'MP9 | Arctic Tri-Tone, one sticker and a charm',
			hex: 'B6A6795F273770B7AE94967DB49EB286B28E7E1A7958B5F651B7D4A2BEB6A62DF0AB3974C3898BE800C508F3B6EC600CDEF6C6A114B7A1BEB6A6A58BF6C6C589F3F58BFA89FBECB326F6E66D6FB46716C7F2',
			defindex: 34,
			paintindex: 331,
			paintseed: 231,
			stickers: [8987],
			charm: 19,
		},
		{
			name: 'AWP | Black Nile, two stickers',
			hex: 'EEFE0E167C747EEFF6E7CE39E7C6EDDEEAD6327E001AEDAECD8CE1E6ECFE55C0D32EA36E53ABA21667538CFAE6EEFE3DD6C3EEEEAEAED3A7F36A50ABBE9D445386EF9EE65CA43A6A',
			defindex: 9,
			paintindex: 1239,
			paintseed: 35,
			stickers: [7251, 5947],
			charm: 0,
		},
		{
			// Sticker | Gaimin Gladiators (Foil) | Cologne 2026 — defindex 1209 is the sticker TOOL
			// item, so the kit rides the sticker list and there is no weapon here at all.
			name: 'a lone sticker item',
			hex: '4353435BFA4A63436B47734721464B4353AD122B4333415A5C67A0',
			defindex: 1209,
			paintindex: 0,
			paintseed: 0,
			stickers: [10478],
			charm: 0,
		},
	])('$name', ({ hex, defindex, paintindex, paintseed, stickers, charm }) => {
		const placement = readInspectUrl(`steam://run/730//+csgo_econ_action_preview%20${hex}`)

		expect(placement.defindex).toBe(defindex)
		expect(placement.paintindex).toBe(paintindex)
		expect(placement.paintseed).toBe(paintseed)
		expect(placement.stickers.filter(one => one.sticker_id > 0).map(one => one.sticker_id)).toEqual([...stickers])
		expect(placement.keychain?.sticker_id ?? 0).toBe(charm)
	})

	/**
	 * *** AND THE RETRY MUST NOT TURN GARBAGE INTO AN ITEM. *** The unmask fires only after the reader
	 * has refused, so the failure mode to guard against is a second, stranger acceptance — and the
	 * error that comes out has to be the one about the payload the caller actually passed, not about
	 * the byte string the retry invented.
	 */
	test('a payload that is broken either way still throws, with its own error', () => {
		// Non-zero first byte, so the retry is attempted; nothing decodes under either reading.
		expect(() => readInspectUrl('AB'.repeat(20))).toThrow()
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
