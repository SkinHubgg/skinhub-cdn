/**
 * The inspect-link changes CS2 1.41.8.2 (2026-09-22, the pets update) made to
 * `CEconItemPreviewDataBlock`, and the pet fields `SkinPlacement` gained for them.
 *
 * Proto diff at GameTracking-CS2 `10f3693c`:
 *
 *   -	optional string customname = 11;
 *   +	repeated string customnames = 11;
 *   +	optional uint32 pet_food_expiration_date = 24;
 *   +	optional bytes blobdata = 25;
 *
 * No real pet link has been decoded yet (no egg had hatched when this was written), so every
 * payload below is BUILT BY HAND, byte by byte, from the proto - which is the point: the wire rules
 * are fixed by the declaration, and a test that only round-tripped our own encoder through our own
 * decoder could agree with itself about a wrong byte.
 *
 * The compatibility rule is checked against `cs2-inspect-lib` too: for a payload that library reads
 * without loss, the decoded object is still identical to its output. Gated on `usesNativeCodec` like
 * the corpus tests, so the one-line fallback in `src/codec.ts` skips these rather than failing them.
 */

import { describe, expect, test } from 'bun:test'
import { CS2Inspect } from 'cs2-inspect-lib'
import { createInspectUrl, decodeMaskedUrl, type EconItem } from '../src/codec.js'
import { buildInspectUrl, readInspectUrl, toEconItem } from '../src/inspect.js'
import { CHICKEN_EGG_DEFINDEX, normalizePetName, PET_ITEM_DEFINDEX, PET_NAME_MAX_LENGTH } from '../src/pets.js'
import { emptyKeychain, emptySticker, makeSkinPlacement, type SkinPlacement, STICKER_SLOTS } from '../src/placement.js'
import { usesNativeCodec } from './corpus.js'

const reference = new CS2Inspect()

/**
 * The 1.41.8.2 fields, spelled out so this file still typechecks under the one-line
 * `cs2-inspect-lib` fallback `src/codec.ts` documents (whose `EconItem` predates them). With the
 * native codec the intersection adds nothing.
 */
type WireItem = EconItem & { customnames?: string[]; pet_food_expiration_date?: number; blobdata?: Uint8Array }

const decode = (url: string): WireItem => decodeMaskedUrl(url)
const encode = (item: WireItem): string => createInspectUrl(item)

const BASE = 'steam://rungame/730/76561202255233023/+csgo_econ_action_preview%20'

const hexOf = (bytes: number[]) => bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('')

/** Neither decoder verifies the trailer, so any four bytes will do. */
const link = (body: number[]) => BASE + hexOf([0x00, ...body, 0xde, 0xad, 0xbe, 0xef])

const utf8 = (text: string) => [...new TextEncoder().encode(text)]

/** A length-delimited field: tag, one-byte length (every payload here is short), bytes. */
const ld = (tag: number[], bytes: number[]) => [...tag, bytes.length, ...bytes]

/** defindex 4681 (varint C9 24), paintindex 0, paintwear 0, paintseed 300 (AC 02). */
const PET_BODY = [0x18, 0xc9, 0x24, 0x20, 0x00, 0x38, 0x00, 0x40, 0xac, 0x02]

const NAME = [0x5a] // field 11, wire type 2
const PETINDEX = [0x98, 0x01] // field 19, wire type 0
const UPGRADE_LEVEL = [0xb8, 0x01] // field 23, wire type 0
const FOOD = [0xc0, 0x01] // field 24, wire type 0
const BLOB = [0xca, 0x01] // field 25, wire type 2

describe.skipIf(!usesNativeCodec)('field 11 is repeated since 1.41.8.2', () => {
	test('three names decode as customnames in wire order, and customname keeps the last', () => {
		const url = link([
			...PET_BODY,
			...ld(NAME, utf8('Nugget')),
			...ld(NAME, utf8('Drumstick')),
			...ld(NAME, utf8('Hen Solo')),
		])
		const item = decode(url)
		expect(item.customnames).toEqual(['Nugget', 'Drumstick', 'Hen Solo'])
		expect(item.customname).toBe('Hen Solo')
	})

	test('the old reading - last name wins - is exactly what cs2-inspect-lib does, so customname did not change', () => {
		const url = link([...PET_BODY, ...ld(NAME, utf8('Nugget')), ...ld(NAME, utf8('Drumstick'))])
		expect(reference.decodeMaskedUrl(url).customname).toBe('Drumstick')
		expect(decode(url).customname).toBe('Drumstick')
	})

	test('an empty name in the middle is kept, because its position is the stage', () => {
		const url = link([...PET_BODY, ...ld(NAME, []), ...ld(NAME, utf8('Drumstick'))])
		expect(decode(url).customnames).toEqual(['', 'Drumstick'])
	})

	test('ONE name decodes exactly as before: no customnames key, and identical to the reference', () => {
		const url = link([...PET_BODY, ...ld(NAME, utf8('blue gem'))])
		const item = decode(url)
		expect('customnames' in item).toBe(false)
		expect(JSON.stringify(item)).toBe(JSON.stringify(reference.decodeMaskedUrl(url)))
	})

	test('customnames encode as repeated field 11, one tag per name, in order', () => {
		const item: WireItem = { defindex: 7, paintindex: 0, paintwear: 0, paintseed: 0, customnames: ['a', '', 'b'] }
		const hex = encode(item).slice(BASE.length)
		expect(hex).toContain(hexOf([0x5a, 0x01, 0x61, 0x5a, 0x00, 0x5a, 0x01, 0x62]))
		expect(decode(encode(item)).customnames).toEqual(['a', '', 'b'])
	})

	test('a link we write with several names is still readable by an old decoder - it just sees the last one', () => {
		const url = encode({ defindex: 4681, paintindex: 0, paintwear: 0, paintseed: 0, customnames: ['x', 'y'] })
		expect(reference.decodeMaskedUrl(url).customname).toBe('y')
	})

	test('a non-empty customnames wins over customname on encode', () => {
		const url = encode({
			defindex: 7,
			paintindex: 0,
			paintwear: 0,
			paintseed: 0,
			customname: 'ignored',
			customnames: ['kept'],
		})
		expect(decode(url).customname).toBe('kept')
	})

	test('an empty customnames array falls back to customname, so [] never erases a name', () => {
		const url = encode({ defindex: 7, paintindex: 0, paintwear: 0, paintseed: 0, customname: 'kept', customnames: [] })
		expect(decode(url).customname).toBe('kept')
	})

	test('validation covers every entry', () => {
		const base = { defindex: 7, paintindex: 0, paintwear: 0, paintseed: 0 }
		expect(() => encode({ ...base, customnames: ['ok', 'a'.repeat(101)] })).toThrow('customnames[1]')
		expect(() => encode({ ...base, customnames: [5 as unknown as string] })).toThrow('customnames[0] must be a string')
		expect(() => encode({ ...base, customnames: 'x' as unknown as string[] })).toThrow('customnames must be an array')
	})
})

describe.skipIf(!usesNativeCodec)('fields 24 and 25, new in 1.41.8.2', () => {
	test('pet_food_expiration_date decodes as a uint32', () => {
		// 1760000000 = 0x68E77800 -> varint 80 F0 9D C7 06
		const url = link([...PET_BODY, ...FOOD, 0x80, 0xf0, 0x9d, 0xc7, 0x06])
		expect(decode(url).pet_food_expiration_date).toBe(1760000000)
	})

	test('blobdata decodes as the raw bytes', () => {
		const url = link([...PET_BODY, ...ld(BLOB, [0x08, 0x01, 0xff, 0x00])])
		const item = decode(url)
		expect(item.blobdata).toBeInstanceOf(Uint8Array)
		expect([...(item.blobdata as Uint8Array)]).toEqual([0x08, 0x01, 0xff, 0x00])
	})

	test('the reference skips both - and agrees with us on every other field', () => {
		const url = link([...PET_BODY, ...PETINDEX, 0x04, ...UPGRADE_LEVEL, 0x03, ...FOOD, 0x05, ...ld(BLOB, [0x01])])
		const ours = decode(url)
		const theirs = reference.decodeMaskedUrl(url) as unknown as Record<string, unknown>
		expect(theirs.pet_food_expiration_date).toBeUndefined()
		expect(theirs.blobdata).toBeUndefined()
		const { pet_food_expiration_date, blobdata, ...rest } = ours
		expect(pet_food_expiration_date).toBe(5)
		expect(blobdata).toEqual(new Uint8Array([1]))
		expect(JSON.stringify(rest)).toBe(JSON.stringify(theirs))
	})

	test('both round-trip through the encoder, in field order after upgrade_level', () => {
		const item: WireItem = {
			defindex: PET_ITEM_DEFINDEX,
			paintindex: 0,
			paintwear: 0,
			paintseed: 300,
			petindex: 4,
			upgrade_level: 3,
			pet_food_expiration_date: 1760000000,
			blobdata: new Uint8Array([9, 8, 7]),
		}
		const url = encode(item)
		const hex = url.slice(BASE.length)
		expect(hex).toContain(
			hexOf([0xb8, 0x01, 0x03, 0xc0, 0x01, 0x80, 0xf0, 0x9d, 0xc7, 0x06, 0xca, 0x01, 0x03, 9, 8, 7]),
		)
		const decoded = decode(url)
		expect(decoded.pet_food_expiration_date).toBe(1760000000)
		expect([...(decoded.blobdata as Uint8Array)]).toEqual([9, 8, 7])
	})

	test('empty blobdata is still present - optional bytes is about presence, not length', () => {
		const url = encode({ defindex: 7, paintindex: 0, paintwear: 0, paintseed: 0, blobdata: new Uint8Array() })
		expect(url.slice(BASE.length)).toContain('CA0100')
		expect(decode(url).blobdata).toEqual(new Uint8Array())
	})

	test('bad values are refused on encode', () => {
		const base = { defindex: 7, paintindex: 0, paintwear: 0, paintseed: 0 }
		expect(() => encode({ ...base, pet_food_expiration_date: -1 })).toThrow('pet_food_expiration_date')
		expect(() => encode({ ...base, blobdata: [1, 2] as unknown as Uint8Array })).toThrow(
			'blobdata must be a Uint8Array',
		)
	})
})

/* -------------------------------------------------------------------------------------------------
 * The placement boundary
 * ---------------------------------------------------------------------------------------------- */

const pet = (overrides: Partial<SkinPlacement> = {}): SkinPlacement => ({
	defindex: PET_ITEM_DEFINDEX,
	paintindex: 0,
	paintseed: 3141592653,
	paintwear: 0,
	nametag: 'Nugget',
	nametag2: 'Drumstick',
	nametag3: 'Hen Solo',
	stickers: STICKER_SLOTS.map(emptySticker),
	keychain: emptyKeychain(),
	petindex: 4,
	upgrade_level: 3,
	...overrides,
})

describe('SkinPlacement carries a pet', () => {
	test('makeSkinPlacement keeps the pet fields and quantises them like every other uint32', () => {
		const normalized = makeSkinPlacement(pet({ petindex: 4.9, upgrade_level: -2, paintseed: 2 ** 33 }))
		expect(normalized.petindex).toBe(4)
		expect(normalized.upgrade_level).toBe(0)
		expect(normalized.paintseed).toBe(4294967295)
		expect(normalized.nametag2).toBe('Drumstick')
		expect(normalized.nametag3).toBe('Hen Solo')
		expect(makeSkinPlacement(normalized)).toEqual(normalized)
	})

	test('a weapon placement gains no keys, so nothing that compares placements sees a change', () => {
		const weapon = makeSkinPlacement({
			defindex: 7,
			paintindex: 44,
			paintseed: 661,
			paintwear: 0.2,
			stickers: [],
			keychain: null,
		})
		expect(Object.keys(weapon).sort()).toEqual(
			[
				'defindex',
				'keychain',
				'nametag',
				'paintindex',
				'paintseed',
				'paintwear',
				'stattrak',
				'stattrak_count',
				'stickers',
			].sort(),
		)
	})

	test('null names are not keys either', () => {
		const normalized = makeSkinPlacement(pet({ nametag2: null, nametag3: null }))
		expect('nametag2' in normalized).toBe(false)
		expect('nametag3' in normalized).toBe(false)
	})
})

describe.skipIf(!usesNativeCodec)('a pet round-trips through an inspect link', () => {
	test('all three names, the pet id, the stage and the seed come back', () => {
		const before = makeSkinPlacement(pet())
		expect(readInspectUrl(buildInspectUrl(before))).toEqual(before)
	})

	test('the names ride field 11 in stage order: chick, pullet, hen', () => {
		const item = toEconItem(pet()) as WireItem
		expect(item.customnames).toEqual(['Nugget', 'Drumstick', 'Hen Solo'])
		// The chick name rides `customname` too - for the cs2-inspect-lib fallback, see the next test.
		expect(item.customname).toBe('Nugget')
		expect(item.petindex).toBe(4)
		expect(item.upgrade_level).toBe(3)
		expect(item.paintseed).toBe(3141592653)
	})

	test('the extra customname changes no byte, and the reference library keeps the chick name from it', () => {
		const item = toEconItem(pet()) as WireItem
		const { customname: _chick, ...namesOnly } = item
		expect(encode(item)).toBe(encode(namesOnly))
		// What the documented one-line fallback would write: the one name it knows, the chick's.
		const fallback = reference.decodeMaskedUrl(reference.createInspectUrl(item))
		expect(fallback.customname).toBe('Nugget')
		expect(fallback.petindex).toBe(4)
	})

	test('a pet named only as a hen keeps its name in the hen position', () => {
		const before = makeSkinPlacement(pet({ nametag: null, nametag2: null }))
		expect((toEconItem(before) as WireItem).customnames).toEqual(['', '', 'Hen Solo'])
		const after = readInspectUrl(buildInspectUrl(before))
		expect(after.nametag).toBeNull()
		expect('nametag2' in after).toBe(false)
		expect(after.nametag3).toBe('Hen Solo')
		expect(after).toEqual(before)
	})

	test('a pet with only its chick name uses the plain single-name form', () => {
		const before = makeSkinPlacement(pet({ nametag2: null, nametag3: null }))
		const item = toEconItem(before) as WireItem
		expect(item.customnames).toBeUndefined()
		expect(item.customname).toBe('Nugget')
		expect(readInspectUrl(buildInspectUrl(before))).toEqual(before)
	})

	test('an egg: its own item definition, stage 0, no names', () => {
		const before = makeSkinPlacement(
			pet({
				defindex: CHICKEN_EGG_DEFINDEX,
				petindex: 1,
				upgrade_level: 0,
				nametag: null,
				nametag2: null,
				nametag3: null,
			}),
		)
		const after = readInspectUrl(buildInspectUrl(before))
		expect(after).toEqual(before)
		expect(after.upgrade_level).toBe(0)
	})

	test('a hand-built pet link reads into a placement: first name is the nametag, not the last', () => {
		const url = link([
			...PET_BODY,
			...ld(NAME, utf8('Nugget')),
			...ld(NAME, utf8('Drumstick')),
			...PETINDEX,
			0x05,
			...UPGRADE_LEVEL,
			0x02,
		])
		const placement = readInspectUrl(url)
		expect(placement.defindex).toBe(4681)
		expect(placement.paintseed).toBe(300)
		expect(placement.petindex).toBe(5)
		expect(placement.upgrade_level).toBe(2)
		expect(placement.nametag).toBe('Nugget')
		expect(placement.nametag2).toBe('Drumstick')
		expect('nametag3' in placement).toBe(false)
	})

	test('a weapon link with one nametag decodes to the same placement it always did', () => {
		const url = link([0x18, 0x07, 0x20, 0x2c, 0x38, 0x00, 0x40, 0x95, 0x05, ...ld(NAME, utf8('blue gem'))])
		const placement = readInspectUrl(url)
		expect(placement.nametag).toBe('blue gem')
		expect('nametag2' in placement).toBe(false)
		expect('petindex' in placement).toBe(false)
		expect('upgrade_level' in placement).toBe(false)
	})

	// Pins the limit the README's Pets section and `normalizePetName` document, so the note goes
	// stale loudly if the codec's write/read name checks are ever made to agree.
	test('a name the column accepts can still be too long to read back: 100 UTF-16 units out, 100 UTF-8 bytes in', () => {
		const column = normalizePetName('🐔'.repeat(40)) as string
		expect(Array.from(column)).toHaveLength(PET_NAME_MAX_LENGTH)
		const url = buildInspectUrl(pet({ nametag2: column }))
		expect(() => readInspectUrl(url)).toThrow('exceeds maximum allowed length 100')
		// What the in-game rename box can produce (20 characters) always comes back.
		const inGame = pet({ nametag2: '🐔'.repeat(20) })
		expect(readInspectUrl(buildInspectUrl(inGame))).toEqual(makeSkinPlacement(inGame))
	})
})
