/**
 * The equivalence corpus — the acceptance test for replacing `cs2-inspect-lib` with `src/codec.ts`.
 *
 * A wrong byte in an inspect-link encoder does not throw. It produces a link that resolves to the
 * wrong skin, which looks like a data problem rather than a codec problem and can sit unnoticed for
 * months. "It compiles and one example round-trips" is therefore not an acceptance test; this is.
 *
 * ## What is in here
 *
 * `buildCorpus()` returns 2,326 items, each of which is handed to BOTH implementations:
 *
 *   - **2,126 rows from the real export.** `test/fixtures/inspect-corpus.json` carries every
 *     `[defindex, paintindex]` pair in `skins.json` — 63 distinct weapons, 1,480 distinct paint
 *     indices, and the 20 vanilla knives where `paint_index` is `null`. Wear, seed, stickers, charm,
 *     nametag and StatTrak are drawn per row from a seeded PRNG, so the corpus is large, varied and
 *     byte-for-byte reproducible. Sticker and charm ids are real too — 263 sticker ids and 140 charm
 *     ids across the corpus, sampled over the whole id range so both varint widths appear.
 *   - **200 named edge cases**, listed below, each one chosen because it is a place a codec can be
 *     wrong in a way an average row cannot see. 50 of them are raw wire-level items carrying fields
 *     the placement boundary cannot express at all.
 *   - **41 decode-only URLs** (`decodeCases()`), including forms no encoder produces: lowercase hex,
 *     a bare console command, a payload with no `00` prefix, an unknown protobuf field of every wire
 *     type, a deliberately wrong checksum, the unmasked market/inventory forms, and outright garbage.
 *
 * Together: 1,492 distinct paint indices, 922 distinct seeds, 26 distinct nametags, 356 items with
 * all five sticker slots filled, 539 with a charm, 728 with StatTrak.
 *
 * ## The edges, deliberately
 *
 * - **varint widths.** `paintseed` and `stattrak_count` at 0, 127/128, 16383/16384, 2097151/2097152,
 *   268435455/268435456 and 4294967295 — every boundary where a varint grows a byte.
 * - **float32 extremes.** `paintwear` at 0, `-0` (a different bit pattern that is not `< 0`, so it
 *   passes validation), the smallest subnormal, the smallest normal, the largest float32 below 1,
 *   and 1 exactly. Plus `NaN`, which `paintwear < 0 || paintwear > 1` does not reject.
 * - **all five sticker slots**: empty, each slot alone, and all five at once.
 * - **StatTrak on and off**, including the `killeatervalue: 0` case where the field is present and
 *   falsy — the one that a `if (value)` instead of `if (value !== undefined)` would drop.
 * - **nametags with unusual characters**: RTL Hebrew, CJK, emoji (surrogate pairs), a NUL byte, a
 *   lone unpaired surrogate, the 100-character limit and one character past it.
 * - **the vanilla rows**, where `paint_index` is `null` and the item has no finish at all.
 * - **the fields the placement boundary never emits** — `accountid`, `itemid` (number and bigint),
 *   `rarity`, `quality`, `inventory`, `origin`, `questid`, `dropreason`, `musicindex`, `entindex`
 *   (negative, so ten bytes of sign extension), `petindex`, `style`, `variations`, `upgrade_level`,
 *   and a sticker's `tint_id` / `offset_z` / `pattern` / `highlight_reel` / `wrapped_sticker`.
 * - **inputs both implementations must REJECT**, at the same stage: a negative id, a wear above 1, a
 *   charm in slot 5, a 101-character nametag. An equivalence test that only covers the happy path
 *   would let a divergence in a guard through.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EconItem, Sticker } from '../src/codec.js'
import { toEconItem } from '../src/inspect.js'
import {
	emptyKeychain,
	emptySticker,
	type KeychainPlacement,
	makeStickerPlacement,
	type SkinPlacement,
	STICKER_SLOTS,
	type StickerPlacement,
	UINT32_MAX,
} from '../src/placement.js'

/* -------------------------------------------------------------------------------------------------
 * Real ids, lifted from the export
 * ---------------------------------------------------------------------------------------------- */

type CorpusSeed = {
	/** `[defindex, paintindex]` for every row in `skins.json`. `null` is a vanilla knife. */
	skins: [number, number | null][]
	/** Real sticker ids, sampled across the full range. */
	stickers: number[]
	/** Every real charm id. */
	keychains: number[]
}

export const CODEC_SOURCE = join(import.meta.dir, '..', 'src', 'codec.ts')

/**
 * Whether `src/codec.ts` is still the native implementation, or has been reverted to the one-line
 * re-export of `cs2-inspect-lib` its header documents as the fallback.
 *
 * Both codec tests are gated on this, and that is the point: the revert is meant to be **one line
 * with no other edit anywhere**. Left ungated, that one line would turn the suite red — the corpus
 * would be comparing the library against itself, and the mutation harness would find none of its
 * search strings — and the cheap fallback would stop being cheap.
 */
export const usesNativeCodec = readFileSync(CODEC_SOURCE, 'utf8').includes('const CRC32_TABLE')

const SEED_FILE = join(import.meta.dir, 'fixtures', 'inspect-corpus.json')

export const seed: CorpusSeed = existsSync(SEED_FILE)
	? (JSON.parse(readFileSync(SEED_FILE, 'utf8')) as CorpusSeed)
	: { skins: [[7, 44]], stickers: [1], keychains: [1] }

/* -------------------------------------------------------------------------------------------------
 * Entries
 * ---------------------------------------------------------------------------------------------- */

export type CorpusEntry = {
	name: string
	/** The wire-level item both codecs are handed. */
	item: EconItem
	/** Set when the entry came through the package's own boundary, which enables the identity check. */
	placement?: SkinPlacement
	/** Set when encode → decode legitimately cannot be an identity, with the reason why. */
	lossy?: string
}

/** Deterministic, so a failure is reproducible and a corpus diff is reviewable. */
const mulberry32 = (state: number) => () => {
	state = (state + 0x6d2b79f5) | 0
	let t = state
	t = Math.imul(t ^ (t >>> 15), t | 1)
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const placementEntry = (name: string, placement: SkinPlacement, lossy?: string): CorpusEntry => ({
	name,
	item: toEconItem(placement),
	placement,
	...(lossy ? { lossy } : {}),
})

/**
 * An entry whose item the boundary REJECTS, so `toEconItem` cannot build it. The point is that both
 * implementations must refuse it at the same stage; the corpus compares thrown-ness, not messages.
 */
const rawEntry = (name: string, item: EconItem): CorpusEntry => ({ name, item })

const base = (over: Partial<SkinPlacement> = {}): SkinPlacement => ({
	defindex: 7,
	paintindex: 44,
	paintseed: 661,
	paintwear: 0.154,
	nametag: null,
	stattrak: false,
	stattrak_count: 0,
	stickers: STICKER_SLOTS.map(emptySticker),
	keychain: emptyKeychain(),
	...over,
})

const sticker = (over: Partial<StickerPlacement> & { slot: number }): StickerPlacement =>
	makeStickerPlacement({ sticker_id: 7691, wear: 0.2, scale: 1, rotation: 0, offset_x: 0, offset_y: 0, ...over })

const withStickers = (...placed: StickerPlacement[]): StickerPlacement[] =>
	STICKER_SLOTS.map(slot => placed.find(p => p.slot === slot) ?? emptySticker(slot))

const encoder = new TextEncoder()
const UNPAIRED_SURROGATE = /[\ud800-\udfff]/

/**
 * Whether a nametag makes encode → decode something other than an identity, and why.
 *
 * Three separate reasons, all of them upstream behaviour this port preserves rather than fixes:
 *
 * - **`''`** is omitted from the wire entirely (field 11 is written on truthiness), so it decodes
 *   back as `null`. The game has no empty name tag, so there is nothing to disagree with.
 * - **the encoder counts UTF-16 units and the decoder counts bytes**, both against 100. So a nametag
 *   over 100 units is refused on the way out, and one under 100 units but over 100 bytes — 50 emoji,
 *   or 100 accented Latin characters — encodes cleanly and then fails to decode.
 * - **an unpaired surrogate** is replaced with U+FFFD by `TextEncoder`, so the bytes are not what
 *   went in.
 */
const nametagLossiness = (nametag: string | null | undefined): string | undefined => {
	if (nametag === null || nametag === undefined) return undefined
	if (nametag === '') return 'an empty nametag is omitted from the wire, so it decodes as null'
	if (nametag.length > 100) return 'over the encoder 100-UTF-16-unit limit, so both implementations refuse it'
	if (encoder.encode(nametag).length > 100) {
		return 'under the encoder UTF-16-unit limit but over the decoder 100-byte limit, so it encodes and then fails to decode'
	}
	if (UNPAIRED_SURROGATE.test(nametag.replace(/[\ud800-\udbff][\udc00-\udfff]/g, ''))) {
		return 'an unpaired surrogate becomes U+FFFD on the way out, so the byte form cannot round-trip'
	}
	return undefined
}

/** Every boundary at which a base-128 varint grows a byte, plus the 32-bit ceiling. */
const VARINT_EDGES = [
	0, 1, 127, 128, 129, 16383, 16384, 16385, 2097151, 2097152, 2097153, 268435455, 268435456, 268435457, UINT32_MAX,
]

/**
 * float32 corners that survive `paintwear < 0 || paintwear > 1`. `-0` is here because it is a
 * different bit pattern from `0` and `-0 < 0` is false, so it reaches the encoder.
 */
const WEAR_EDGES = [
	0,
	-0,
	1,
	1.401298464324817e-45, // smallest float32 subnormal
	1.1754943508222875e-38, // smallest float32 normal
	5e-324, // smallest double subnormal — rounds to 0 in float32
	0.9999999403953552, // largest float32 below 1
	0.06,
	0.07,
	0.15,
	0.154,
	0.38,
	0.45,
	0.5,
	0.75,
	0.99,
	1 / 3,
	0.1 + 0.2,
	Number.EPSILON,
	1e-10,
]

const NAMETAGS: [name: string, value: string][] = [
	['ascii', 'blue gem'],
	['empty', ''],
	['one char', 'a'],
	['hebrew rtl', 'סקין כחול'],
	['cjk', '蓝宝石'],
	['emoji', '🔥💎🐉'],
	['zwj family', '👨‍👩‍👧‍👦'],
	['combining', 'é́́'],
	['nul byte in the middle', 'a\u0000b'],
	['control chars', 'a\nb\tc\rd'],
	['url metacharacters', 'a;b%20c+d&e=f?g#h'],
	['quotes and backslash', `he said "hi" \\ 'bye'`],
	['latin-1 high', 'ÿÿÿ café naïve'],
	['spaces only', '   '],
	['leading zero digits', '007'],
	['100 chars exactly', 'a'.repeat(100)],
	['99 chars', 'a'.repeat(99)],
	['100 utf-16 units of 2-byte chars', 'é'.repeat(100)],
	['math symbols', '∑∏√∞≠±'],
	['box drawing', '╔═╗║╚╝'],
]

export const buildCorpus = (): CorpusEntry[] => {
	const entries: CorpusEntry[] = []
	const random = mulberry32(0x5c11f00d)
	const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)] as T

	/* --- 2,126 rows from the real export ------------------------------------------------------- */

	seed.skins.forEach(([defindex, paintindex], index) => {
		const count = index % 6 // 0..5 stickers
		const placed = Array.from({ length: count }, (_, slot) =>
			sticker({
				slot,
				sticker_id: pick(seed.stickers),
				wear: Math.round(random() * 1000) / 1000,
				scale: 0.1 + Math.round(random() * 190) / 100,
				rotation: Math.round((random() * 720 - 360) * 100) / 100,
				offset_x: Math.round((random() - 0.5) * 1000) / 1000,
				offset_y: Math.round((random() - 0.5) * 1000) / 1000,
			}),
		)

		const nametagCase = index % 7 === 0 ? (NAMETAGS[index % NAMETAGS.length] as [string, string])[1] : null
		const stattrak = index % 3 === 0
		const placement = base({
			defindex,
			// The 20 vanilla rows have no finish at all: `paint_index` is null in the export.
			paintindex: paintindex ?? 0,
			paintseed: index % 11 === 0 ? (VARINT_EDGES[index % VARINT_EDGES.length] as number) : index % 1001,
			paintwear: WEAR_EDGES[index % WEAR_EDGES.length] as number,
			nametag: nametagCase,
			stattrak,
			stattrak_count: stattrak ? (VARINT_EDGES[index % VARINT_EDGES.length] as number) : 0,
			stickers: withStickers(...placed),
			keychain:
				index % 4 === 0
					? {
							slot: 0,
							sticker_id: pick(seed.keychains),
							offset_x: Math.round((random() - 0.5) * 400) / 100,
							offset_y: Math.round((random() - 0.5) * 400) / 100,
							offset_z: Math.round((random() - 0.5) * 400) / 100,
							pattern: Math.floor(random() * 100000),
							wrapped_sticker: 0,
						}
					: emptyKeychain(),
		})

		entries.push(
			placementEntry(
				`export row ${index} defindex=${defindex} paintindex=${paintindex ?? 'null (vanilla)'}`,
				placement,
				nametagLossiness(nametagCase),
			),
		)
	})

	/* --- float32 corners ----------------------------------------------------------------------- */

	for (const wear of WEAR_EDGES) {
		entries.push(placementEntry(`paintwear ${wear} (${Object.is(wear, -0) ? '-0' : wear})`, base({ paintwear: wear })))
	}
	entries.push(rawEntry('paintwear NaN — passes `< 0 || > 1`, encodes the quiet-NaN pattern', {
		defindex: 7,
		paintindex: 44,
		paintseed: 0,
		paintwear: Number.NaN,
	}))

	/* --- varint widths ------------------------------------------------------------------------- */

	for (const value of VARINT_EDGES) {
		entries.push(placementEntry(`paintseed ${value}`, base({ paintseed: value })))
		entries.push(
			placementEntry(`stattrak_count ${value}`, base({ stattrak: true, stattrak_count: value })),
		)
		entries.push(placementEntry(`paintindex ${value}`, base({ paintindex: value })))
		entries.push(placementEntry(`defindex ${Math.max(value, 1)}`, base({ defindex: Math.max(value, 1) })))
	}

	/* --- sticker slots ------------------------------------------------------------------------- */

	entries.push(placementEntry('no stickers at all', base()))
	for (const slot of STICKER_SLOTS) {
		entries.push(placementEntry(`only slot ${slot} occupied`, base({ stickers: withStickers(sticker({ slot })) })))
	}
	entries.push(
		placementEntry(
			'all five slots occupied',
			base({ stickers: STICKER_SLOTS.map(slot => sticker({ slot, sticker_id: seed.stickers[slot] ?? 1 })) }),
		),
	)
	entries.push(
		placementEntry(
			'slots 0 and 4 only — a gap the wire has to omit rather than zero-fill',
			base({ stickers: withStickers(sticker({ slot: 0 }), sticker({ slot: 4 })) }),
		),
	)

	/* --- sticker field extremes ---------------------------------------------------------------- */

	const stickerFieldCases: [string, Partial<StickerPlacement>][] = [
		['offset at the positive shader corner', { offset_x: 0.5, offset_y: 0.5 }],
		['offset at the negative shader corner', { offset_x: -0.5, offset_y: -0.5 }],
		['offset at zero', { offset_x: 0, offset_y: 0 }],
		['offset at negative zero', { offset_x: -0, offset_y: -0 }],
		['offset clamped from far outside', { offset_x: 99, offset_y: -99 }],
		['offset subnormal', { offset_x: 1.401298464324817e-45, offset_y: -1.401298464324817e-45 }],
		['wear 0', { wear: 0 }],
		['wear 1', { wear: 1 }],
		['wear largest below 1', { wear: 0.9999999403953552 }],
		['scale 0 becomes the default 1', { scale: 0 }],
		['scale 0.01', { scale: 0.01 }],
		['scale 2', { scale: 2 }],
		['scale 10 — upstream warns above this but still encodes', { scale: 10 }],
		['scale 10.5', { scale: 10.5 }],
		['rotation 0', { rotation: 0 }],
		['rotation 180', { rotation: 180 }],
		['rotation -180', { rotation: -180 }],
		['rotation 360', { rotation: 360 }],
		['rotation -359.9', { rotation: -359.9 }],
		['rotation 1e-7', { rotation: 1e-7 }],
		['rotation 720 — outside upstream warning range', { rotation: 720 }],
		['sticker_id 1', { sticker_id: 1 }],
		['sticker_id 127', { sticker_id: 127 }],
		['sticker_id 128', { sticker_id: 128 }],
		['sticker_id at the uint32 ceiling', { sticker_id: UINT32_MAX }],
		['sticker_id 0 normalises the slot to empty', { sticker_id: 0 }],
	]
	for (const [name, over] of stickerFieldCases) {
		entries.push(placementEntry(`sticker: ${name}`, base({ stickers: withStickers(sticker({ slot: 2, ...over })) })))
	}

	/* --- charms -------------------------------------------------------------------------------- */

	const keychainCases: [string, KeychainPlacement][] = [
		['absent', emptyKeychain()],
		['id 1, everything zero', { slot: 0, sticker_id: 1, offset_x: 0, offset_y: 0, offset_z: 0, pattern: 0, wrapped_sticker: 0 }],
		[
			'pattern at the uint32 ceiling',
			{ slot: 0, sticker_id: 21, offset_x: 0, offset_y: 0, offset_z: 0, pattern: UINT32_MAX, wrapped_sticker: 0 },
		],
		[
			'negative offsets, which are NOT clamped for a charm',
			{ slot: 0, sticker_id: 21, offset_x: -12.5, offset_y: -0.001, offset_z: 34.75, pattern: 41, wrapped_sticker: 0 },
		],
		[
			'the real charm id range, highest id',
			{
				slot: 0,
				sticker_id: seed.keychains[seed.keychains.length - 1] ?? 145,
				offset_x: 1.5,
				offset_y: -2.25,
				offset_z: 0.125,
				pattern: 7,
				wrapped_sticker: 0,
			},
		],
		[
			'a Charm | Sticker Slab that seals a sticker',
			{
				slot: 0,
				sticker_id: seed.keychains[0] ?? 1,
				offset_x: 0,
				offset_y: 0,
				offset_z: 0,
				pattern: 0,
				wrapped_sticker: seed.stickers[0] ?? 1,
			},
		],
	]
	for (const [name, keychain] of keychainCases) {
		entries.push(placementEntry(`charm: ${name}`, base({ keychain })))
	}

	/* --- nametags ------------------------------------------------------------------------------ */

	const extraNametags: [string, string][] = [
		['lone unpaired surrogate', 'a\ud800b'],
		['50 emoji — 100 UTF-16 units but 200 bytes', '🔥'.repeat(50)],
		['100 two-byte characters — 200 bytes', 'ÿ'.repeat(100)],
		['101 chars — one past the encoder limit', 'a'.repeat(101)],
		['1000 chars', 'a'.repeat(1000)],
	]
	for (const [name, nametag] of [...NAMETAGS, ...extraNametags]) {
		entries.push(placementEntry(`nametag: ${name}`, base({ nametag }), nametagLossiness(nametag)))
	}

	/* --- StatTrak ------------------------------------------------------------------------------ */

	entries.push(placementEntry('stattrak off', base({ stattrak: false, stattrak_count: 0 })))
	entries.push(placementEntry('stattrak on with a zero count — a present, falsy field', base({ stattrak: true })))
	entries.push(placementEntry('stattrak on, count 1', base({ stattrak: true, stattrak_count: 1 })))
	entries.push(
		placementEntry('stattrak on, count at the ceiling', base({ stattrak: true, stattrak_count: UINT32_MAX })),
	)
	entries.push(
		placementEntry(
			'stattrak off but a count supplied — the boundary drops it',
			base({ stattrak: false, stattrak_count: 999 }),
		),
	)

	/* --- fully loaded -------------------------------------------------------------------------- */

	entries.push(
		placementEntry(
			'everything at once: five stickers, a charm, a nametag and StatTrak',
			base({
				defindex: 7,
				paintindex: 44,
				paintseed: 661,
				paintwear: 0.154,
				nametag: 'blue gem 💎',
				stattrak: true,
				stattrak_count: 1337,
				stickers: STICKER_SLOTS.map(slot =>
					sticker({
						slot,
						sticker_id: seed.stickers[slot * 7] ?? 1,
						wear: slot / 4,
						scale: 0.5 + slot / 4,
						rotation: slot * 45 - 90,
						offset_x: -0.5 + slot / 8,
						offset_y: 0.5 - slot / 8,
					}),
				),
				keychain: { slot: 0, sticker_id: 21, offset_x: 1.5, offset_y: -2.25, offset_z: 0.125, pattern: 41, wrapped_sticker: 0 },
			}),
		),
	)

	/* --- the wire fields the boundary never emits ---------------------------------------------- */

	const wireBase: EconItem = { defindex: 7, paintindex: 44, paintseed: 661, paintwear: 0.154 }
	const wireOnly: [string, Partial<EconItem>][] = [
		['accountid', { accountid: 123456789 }],
		['accountid 0', { accountid: 0 }],
		['itemid as a number', { itemid: 40368145986 }],
		['itemid as a bigint', { itemid: 18446744073709551615n }],
		['itemid 0', { itemid: 0 }],
		['rarity', { rarity: 6 }],
		['quality', { quality: 4 }],
		['inventory', { inventory: 3221225475 }],
		['origin', { origin: 8 }],
		['questid', { questid: 42 }],
		['dropreason', { dropreason: 1 }],
		['musicindex', { musicindex: 34 }],
		['entindex positive', { entindex: 2147483647 }],
		['entindex negative — ten bytes of sign extension', { entindex: -1 }],
		['entindex at the signed floor', { entindex: -2147483648 }],
		['petindex', { petindex: 9 }],
		['style', { style: 2 }],
		['upgrade_level', { upgrade_level: 5 }],
		['an empty customname, which truthiness omits', { customname: '' }],
		['every optional scalar at once', {
			accountid: 1,
			itemid: 2n,
			rarity: 3,
			quality: 4,
			inventory: 5,
			origin: 6,
			questid: 7,
			dropreason: 8,
			musicindex: 9,
			entindex: -10,
			petindex: 11,
			style: 12,
			upgrade_level: 13,
		}],
	]
	for (const [name, over] of wireOnly) {
		entries.push(rawEntry(`wire field: ${name}`, { ...wireBase, ...over }))
	}

	const wireStickers: [string, Sticker][] = [
		['tint_id', { slot: 0, sticker_id: 5, tint_id: 7 }],
		['tint_id 0', { slot: 0, sticker_id: 5, tint_id: 0 }],
		['offset_z on a sticker, which the placement type has no room for', { slot: 1, sticker_id: 5, offset_z: -0.25 }],
		['pattern on a sticker', { slot: 2, sticker_id: 5, pattern: 900 }],
		['highlight_reel', { slot: 3, sticker_id: 5, highlight_reel: 3 }],
		['wrapped_sticker', { slot: 4, sticker_id: 5, wrapped_sticker: 11 }],
		['every sticker field at once', {
			slot: 2,
			sticker_id: 7691,
			wear: 0.5,
			scale: 1.25,
			rotation: -33.5,
			tint_id: 4,
			offset_x: 0.25,
			offset_y: -0.25,
			offset_z: 0.125,
			pattern: 66,
			highlight_reel: 1,
			wrapped_sticker: 2,
		}],
		['a sticker with nothing but slot and id', { slot: 0, sticker_id: 1 }],
	]
	for (const [name, only] of wireStickers) {
		entries.push(rawEntry(`wire sticker: ${name}`, { ...wireBase, stickers: [only] }))
	}
	entries.push(rawEntry('wire field: variations, which ride field 22 as sticker submessages', {
		...wireBase,
		variations: [{ slot: 0, sticker_id: 1, pattern: 2 }],
	}))
	entries.push(rawEntry('wire field: two charms, which the placement type cannot express', {
		...wireBase,
		keychains: [
			{ slot: 0, sticker_id: 1, pattern: 2 },
			{ slot: 1, sticker_id: 3, pattern: 4 },
		],
	}))
	entries.push(rawEntry('wire field: six stickers, one more than a weapon has slots', {
		...wireBase,
		stickers: [0, 1, 2, 3, 4, 4].map(slot => ({ slot, sticker_id: 100 + slot })),
	}))
	entries.push(rawEntry('wire field: an empty stickers array, which must not emit a tag', {
		...wireBase,
		stickers: [],
	}))

	/* --- inputs both implementations must refuse ----------------------------------------------- */

	const rejected: [string, EconItem][] = [
		['negative defindex', { ...wireBase, defindex: -1 }],
		['negative paintindex', { ...wireBase, paintindex: -1 }],
		['negative paintseed', { ...wireBase, paintseed: -1 }],
		['paintwear above 1', { ...wireBase, paintwear: 1.0000001 }],
		['paintwear below 0', { ...wireBase, paintwear: -0.5 }],
		['paintwear Infinity', { ...wireBase, paintwear: Number.POSITIVE_INFINITY }],
		['a 101-character customname', { ...wireBase, customname: 'a'.repeat(101) }],
		['a sticker in slot 5', { ...wireBase, stickers: [{ slot: 5, sticker_id: 1 }] }],
		['a sticker with a negative id', { ...wireBase, stickers: [{ slot: 0, sticker_id: -1 }] }],
		['a sticker with wear above 1', { ...wireBase, stickers: [{ slot: 0, sticker_id: 1, wear: 1.5 }] }],
		['a sticker with scale 0', { ...wireBase, stickers: [{ slot: 0, sticker_id: 1, scale: 0 }] }],
		['a sticker with a non-finite offset', { ...wireBase, stickers: [{ slot: 0, sticker_id: 1, offset_x: Number.NaN }] }],
		['a charm in slot 5', { ...wireBase, keychains: [{ slot: 5, sticker_id: 1 }] }],
		['a negative killeatervalue, which no validator catches but the varint refuses', {
			...wireBase,
			killeatervalue: -1,
		}],
		['a negative accountid', { ...wireBase, accountid: -1 }],
		['a negative entindex outside int32', { ...wireBase, entindex: -2147483649 }],
		['a negative itemid', { ...wireBase, itemid: -1 }],
	]
	for (const [name, item] of rejected) {
		entries.push(rawEntry(`refused: ${name}`, item))
	}

	return entries
}

/* -------------------------------------------------------------------------------------------------
 * Decode-only URLs — forms no encoder in this package produces
 * ---------------------------------------------------------------------------------------------- */

const hexOf = (bytes: number[]) => bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('')

/** A minimal valid body: defindex=7, paintindex=44, paintwear=0, paintseed=661. */
const MINIMAL_BODY = [0x18, 0x07, 0x20, 0x2c, 0x38, 0x00, 0x40, 0x95, 0x05]

/** Any four bytes will do — neither implementation verifies the checksum. */
const framed = (body: number[]) => hexOf([0x00, ...body, 0xde, 0xad, 0xbe, 0xef])

export const decodeCases = (): { name: string; url: string }[] => {
	const hex = framed(MINIMAL_BODY)
	const base = 'steam://rungame/730/76561202255233023/+csgo_econ_action_preview%20'

	return [
		{ name: 'a full steam:// link', url: base + hex },
		{ name: 'lowercase hex', url: base + hex.toLowerCase() },
		{ name: 'mixed-case hex', url: base + hex.slice(0, 10).toLowerCase() + hex.slice(10) },
		{ name: 'the console command with a space', url: `csgo_econ_action_preview ${hex}` },
		{ name: 'the console command with %20', url: `csgo_econ_action_preview%20${hex}` },
		{ name: 'the +prefixed command with a space', url: `+csgo_econ_action_preview ${hex}` },
		{ name: 'the +prefixed command with %20', url: `+csgo_econ_action_preview%20${hex}` },
		{ name: 'raw hex with no command at all', url: hex },
		{ name: 'raw hex with surrounding whitespace', url: `  ${hex}\n` },
		{ name: 'a steam:// link with a space instead of %20', url: base.replace('%20', ' ') + hex },
		// The decoder strips a leading `00` only if present, so a payload without one still decodes —
		// by eating the first two bytes of the body instead. Wrong, and identical in both.
		{ name: 'a payload with no 00 prefix', url: base + hexOf([...MINIMAL_BODY, 0xde, 0xad, 0xbe, 0xef]) },
		{ name: 'a deliberately wrong checksum, which neither implementation verifies', url: base + framed(MINIMAL_BODY) },
		{ name: 'an unknown varint field (30)', url: base + framed([...MINIMAL_BODY, 0xf0, 0x01, 0x7f]) },
		{ name: 'an unknown 64-bit field (30)', url: base + framed([...MINIMAL_BODY, 0xf1, 0x01, 1, 2, 3, 4, 5, 6, 7, 8]) },
		{ name: 'an unknown length-delimited field (30)', url: base + framed([...MINIMAL_BODY, 0xf2, 0x01, 3, 1, 2, 3]) },
		{ name: 'an unknown 32-bit field (30)', url: base + framed([...MINIMAL_BODY, 0xf5, 0x01, 1, 2, 3, 4]) },
		{ name: 'an unknown field beyond 50', url: base + framed([...MINIMAL_BODY, 0xc0, 0x04, 0x01]) },
		{ name: 'an unknown field inside a sticker submessage', url: base + framed([...MINIMAL_BODY, 0x62, 0x07, 0x08, 0x00, 0x10, 0x01, 0xf0, 0x01, 0x09]) },
		{ name: 'a sticker with the wrong wire type for wear', url: base + framed([...MINIMAL_BODY, 0x62, 0x06, 0x08, 0x00, 0x10, 0x01, 0x18, 0x01]) },
		{ name: 'a wire type of 6, which does not exist', url: base + framed([...MINIMAL_BODY, 0xf6, 0x01, 0x01]) },
		{ name: 'a wire type of 7, which does not exist', url: base + framed([...MINIMAL_BODY, 0xf7, 0x01, 0x01]) },
		{ name: 'a truncated varint at the end', url: base + framed([...MINIMAL_BODY, 0x40, 0xff]) },
		{ name: 'a length-delimited field claiming more bytes than remain', url: base + framed([...MINIMAL_BODY, 0x62, 0x7f, 0x08]) },
		{ name: 'a customname claiming 200 bytes', url: base + framed([...MINIMAL_BODY, 0x5a, 0xc8, 0x01, 0x61]) },
		{ name: 'a customname that is not valid UTF-8', url: base + framed([...MINIMAL_BODY, 0x5a, 0x02, 0xff, 0xfe]) },
		{ name: 'a decoded paintwear above 1, which the validator rejects', url: base + framed([0x18, 0x07, 0x20, 0x2c, 0x38, 0x80, 0x80, 0x80, 0xfc, 0x03, 0x40, 0x00]) },
		{ name: 'a decoded sticker in slot 9', url: base + framed([...MINIMAL_BODY, 0x62, 0x04, 0x08, 0x09, 0x10, 0x01]) },
		{ name: 'an unmasked inventory link', url: `${base}S76561198084749846A6768243D12345678` },
		{ name: 'an unmasked market link', url: `${base}M4079342885663254123A12345D6789` },
		{ name: 'an unmasked link with an absurd id', url: `${base}S${'9'.repeat(25)}A1D1` },
		{ name: 'an empty string', url: '' },
		{ name: 'plain prose', url: 'not a link' },
		{ name: 'the command with no payload', url: 'csgo_econ_action_preview ' },
		{ name: 'odd-length hex', url: base + hex.slice(0, -1) },
		{ name: 'hex with a non-hex character', url: `${base + hex.slice(0, -1)}Z` },
		{ name: 'hex too short to hold anything', url: `${base}00112233` },
		{ name: 'exactly 16 hex characters — one below the post-CRC floor', url: base + '0'.repeat(16) },
		{ name: 'exactly 24 hex characters — the smallest that decodes', url: base + framed([0x18, 0x07, 0x20, 0x00, 0x38, 0x00, 0x40, 0x00]) },
		{ name: 'a payload of only a 00 prefix and a checksum', url: base + hexOf([0x00, 0xde, 0xad, 0xbe, 0xef]) },
		{ name: 'a URL longer than 2048 characters', url: base + 'AB'.repeat(1100) },
		{ name: 'two preview commands in one string', url: `${base + hex}+csgo_econ_action_preview%20${hex}` },
	]
}
