/**
 * `src/codec.ts` against `cs2-inspect-lib` — the acceptance test for dropping the runtime dependency.
 *
 * The whole risk of writing the inspect-link codec natively is that a wrong byte **does not throw**.
 * It produces a link that resolves to the wrong skin, which reads as a data problem rather than a
 * codec problem. So the bar is not "it compiles and one example round-trips": all 2,326 items in the
 * corpus, plus 41 raw URL forms, have to encode to the **same hex string** under both implementations
 * and decode to the **same object** under both — including the ones both must refuse.
 *
 * `cs2-inspect-lib` is kept as a devDependency for exactly this. It is constructed here the way the
 * old wrapper constructed it — `new CS2Inspect()`, i.e. `DEFAULT_CONFIG` with `validateInput: true` —
 * so the reference is the behaviour that actually shipped, not a more permissive corner of the API.
 *
 * `test/codec-mutation.test.ts` proves this file can fail: it perturbs one token of `src/codec.ts` at
 * a time and requires the corpus to catch every perturbation. A comparison that passes because both
 * sides run the same code would be worthless, and that is the test which rules it out.
 *
 * Everything here is gated on `usesNativeCodec`, so taking the one-line fallback in `src/codec.ts`
 * skips these rather than failing them — see the note on that constant in `corpus.ts`.
 */

import { describe, expect, test } from 'bun:test'
import { CS2Inspect, type EconItem as ReferenceItem } from 'cs2-inspect-lib'
import { createInspectUrl, decodeMaskedUrl } from '../src/codec.js'
import { buildInspectUrl, readInspectUrl } from '../src/inspect.js'
import { makeSkinPlacement } from '../src/placement.js'
import { buildCorpus, type CorpusEntry, decodeCases, seed, usesNativeCodec } from './corpus.js'

/** Constructed exactly as the wrapper this replaces constructed it. */
const reference = new CS2Inspect()

type Attempt<T> = { ok: true; value: T } | { ok: false; error: string }

const attempt = <T>(fn: () => T): Attempt<T> => {
	try {
		return { ok: true, value: fn() }
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) }
	}
}

/**
 * `Object.is` on the leaves, so `-0` and `0` are NOT interchangeable and `NaN` equals itself. Both
 * matter here: `-0` is a distinct float32 bit pattern that survives validation, and a NaN `paintwear`
 * is a real encodable state. `expect(...).toEqual` is looser than that on both counts.
 */
const deepEqual = (a: unknown, b: unknown): boolean => {
	if (Object.is(a, b)) return true
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
	if (Array.isArray(a) !== Array.isArray(b)) return false
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((value, index) => deepEqual(value, b[index]))
	}
	const left = a as Record<string, unknown>
	const right = b as Record<string, unknown>
	const keys = Object.keys(left)
	if (keys.length !== Object.keys(right).length) return false
	return keys.every(key => key in right && deepEqual(left[key], right[key]))
}

const show = (value: unknown) =>
	JSON.stringify(value, (_key, inner) => (typeof inner === 'bigint' ? `${inner}n` : inner))

type Outcome = {
	entry: CorpusEntry
	oldUrl: Attempt<string>
	newUrl: Attempt<string>
	oldDecoded?: Attempt<ReferenceItem>
	newDecoded?: Attempt<EconItemLike>
}

type EconItemLike = ReturnType<typeof decodeMaskedUrl>

const corpus = buildCorpus()
const urlCases = decodeCases()

const outcomes: Outcome[] = corpus.map(entry => {
	const oldUrl = attempt(() => reference.createInspectUrl(entry.item as ReferenceItem))
	const newUrl = attempt(() => createInspectUrl(entry.item))
	if (!oldUrl.ok || !newUrl.ok) return { entry, oldUrl, newUrl }

	// Both decoders are pointed at the OLD encoder's output, so a decode divergence cannot be masked
	// by an encode divergence. Encode equality is asserted separately.
	return {
		entry,
		oldUrl,
		newUrl,
		oldDecoded: attempt(() => reference.decodeMaskedUrl(oldUrl.value)),
		newDecoded: attempt(() => decodeMaskedUrl(oldUrl.value)),
	}
})

/* -------------------------------------------------------------------------------------------------
 * The corpus itself — asserted, so it cannot quietly shrink into a corpus of easy rows
 * ---------------------------------------------------------------------------------------------- */

describe.skipIf(!usesNativeCodec)('the corpus', () => {
	test('is built from the real export: 2,126 rows, 63 weapons, 1,480 paint indices, 20 vanilla', () => {
		expect(seed.skins).toHaveLength(2126)
		expect(new Set(seed.skins.map(([defindex]) => defindex)).size).toBe(63)
		expect(new Set(seed.skins.map(([, paintindex]) => paintindex)).size).toBe(1480)
		expect(seed.skins.filter(([, paintindex]) => paintindex === null)).toHaveLength(20)
		expect(seed.stickers.length).toBeGreaterThan(200)
		expect(seed.keychains).toHaveLength(143)
	})

	test('is large enough to be a corpus rather than a handful of examples', () => {
		expect(corpus.length).toBeGreaterThan(2300)
		expect(urlCases.length).toBeGreaterThan(35)
	})

	test('covers the float32 corners: 0, -0, 1, subnormals, and the largest value below 1', () => {
		// Deliberately an array rather than a Set: a Set uses SameValueZero, which would fold -0 into
		// 0 and hide the one bit pattern this case exists to check.
		const wears = corpus.map(entry => entry.item.paintwear)
		expect(wears.some(wear => Object.is(wear, 0))).toBe(true)
		expect(wears.some(wear => Object.is(wear, -0))).toBe(true)
		expect(wears).toContain(1)
		expect(wears).toContain(Math.fround(1.401298464324817e-45))
		expect(wears).toContain(Math.fround(0.9999999403953552))
		expect(wears.some(Number.isNaN)).toBe(true)
	})

	test('covers every varint width boundary, on a seed and on a StatTrak count', () => {
		const seeds = new Set(corpus.map(entry => entry.item.paintseed))
		const counts = new Set(corpus.map(entry => entry.item.killeatervalue))
		for (const edge of [0, 127, 128, 16383, 16384, 2097151, 2097152, 268435455, 268435456, 4294967295]) {
			expect(seeds.has(edge)).toBe(true)
			expect(counts.has(edge)).toBe(true)
		}
	})

	test('covers every sticker slot, empty and full sets, and a gap in the middle', () => {
		const slotCounts = corpus.map(entry => entry.item.stickers?.length ?? 0)
		expect(slotCounts).toContain(0)
		expect(slotCounts).toContain(5)
		for (const slot of [0, 1, 2, 3, 4]) {
			expect(corpus.some(entry => entry.item.stickers?.some(s => s.slot === slot))).toBe(true)
		}
		expect(
			corpus.some(entry => {
				const slots = entry.item.stickers?.map(s => s.slot) ?? []
				return slots.includes(0) && slots.includes(4) && !slots.includes(2)
			}),
		).toBe(true)
	})

	test('covers StatTrak on and off, including a present-but-zero kill count', () => {
		expect(corpus.some(entry => entry.item.killeaterscoretype === undefined)).toBe(true)
		expect(corpus.some(entry => entry.item.killeatervalue === 0)).toBe(true)
		expect(corpus.some(entry => entry.item.killeatervalue === 4294967295)).toBe(true)
	})

	test('covers nametags with unusual characters, the 100-char limit and one past it', () => {
		const names = corpus.map(entry => entry.item.customname).filter((name): name is string => name !== undefined)
		expect(names.some(name => name.length === 100)).toBe(true)
		expect(names.some(name => name.length === 101)).toBe(true)
		expect(names.some(name => /[֐-׿]/.test(name))).toBe(true) // Hebrew
		expect(names.some(name => /[一-鿿]/.test(name))).toBe(true) // CJK
		expect(names.some(name => /\p{Extended_Pictographic}/u.test(name))).toBe(true) // emoji
		expect(names.some(name => name.includes('\u0000'))).toBe(true)
		expect(names.some(name => name.includes('\ud800'))).toBe(true) // lone surrogate
	})

	test('covers the vanilla rows, where the export has no paint index at all', () => {
		expect(corpus.filter(entry => entry.name.includes('vanilla'))).toHaveLength(20)
		expect(corpus.some(entry => entry.item.paintindex === 0)).toBe(true)
	})

	test('covers charms: absent, present, pattern 0 and pattern at the uint32 ceiling', () => {
		expect(corpus.some(entry => entry.item.keychains === undefined)).toBe(true)
		expect(corpus.some(entry => entry.item.keychains?.[0]?.pattern === 0)).toBe(true)
		expect(corpus.some(entry => entry.item.keychains?.[0]?.pattern === 4294967295)).toBe(true)
	})

	test('covers the wire fields the placement boundary never emits', () => {
		const present = (key: keyof EconItemLike) => corpus.some(entry => entry.item[key] !== undefined)
		for (const key of [
			'accountid',
			'itemid',
			'rarity',
			'quality',
			'inventory',
			'origin',
			'questid',
			'dropreason',
			'musicindex',
			'entindex',
			'petindex',
			'style',
			'variations',
			'upgrade_level',
		] as const) {
			expect({ key, present: present(key) }).toEqual({ key, present: true })
		}
		expect(corpus.some(entry => entry.item.stickers?.some(s => s.tint_id !== undefined))).toBe(true)
		expect(corpus.some(entry => entry.item.stickers?.some(s => s.offset_z !== undefined))).toBe(true)
		expect(corpus.some(entry => entry.item.stickers?.some(s => s.highlight_reel !== undefined))).toBe(true)
		expect(corpus.some(entry => entry.item.stickers?.some(s => s.wrapped_sticker !== undefined))).toBe(true)
		expect(corpus.some(entry => entry.item.entindex !== undefined && entry.item.entindex < 0)).toBe(true)
	})

	test('includes items both implementations must refuse, so the guards are compared too', () => {
		const refused = outcomes.filter(outcome => !outcome.oldUrl.ok)
		expect(refused.length).toBeGreaterThanOrEqual(15)
	})

	test('includes links only one side can decode, so the decode guards are compared too', () => {
		const failed = outcomes.filter(outcome => outcome.oldDecoded && !outcome.oldDecoded.ok)
		expect(failed.length).toBeGreaterThanOrEqual(1)
	})
})

/* -------------------------------------------------------------------------------------------------
 * Equivalence
 * ---------------------------------------------------------------------------------------------- */

describe.skipIf(!usesNativeCodec)('byte equivalence with cs2-inspect-lib', () => {
	test('every item encodes to the same hex, or is refused by both', () => {
		const mismatches = outcomes
			.filter(({ oldUrl, newUrl }) => oldUrl.ok !== newUrl.ok || (oldUrl.ok && newUrl.ok && oldUrl.value !== newUrl.value))
			.map(({ entry, oldUrl, newUrl }) => ({
				entry: entry.name,
				old: oldUrl.ok ? oldUrl.value : `THREW: ${oldUrl.error}`,
				new: newUrl.ok ? newUrl.value : `THREW: ${newUrl.error}`,
			}))

		expect(mismatches.slice(0, 5)).toEqual([])
		expect(mismatches).toHaveLength(0)
	})

	test('every link decodes to the same item, or is refused by both', () => {
		const mismatches = outcomes
			.filter(({ oldDecoded, newDecoded }) => {
				if (!oldDecoded || !newDecoded) return false
				if (oldDecoded.ok !== newDecoded.ok) return true
				return oldDecoded.ok && newDecoded.ok && !deepEqual(oldDecoded.value, newDecoded.value)
			})
			.map(({ entry, oldDecoded, newDecoded }) => ({
				entry: entry.name,
				old: oldDecoded?.ok ? show(oldDecoded.value) : `THREW: ${oldDecoded?.error}`,
				new: newDecoded?.ok ? show(newDecoded.value) : `THREW: ${newDecoded?.error}`,
			}))

		expect(mismatches.slice(0, 5)).toEqual([])
		expect(mismatches).toHaveLength(0)
	})

	test('the new decoder reads the old encoder, and the old decoder reads the new one', () => {
		const mismatches: unknown[] = []

		for (const { entry, oldUrl, newUrl } of outcomes) {
			if (!oldUrl.ok || !newUrl.ok) continue
			const crossed = attempt(() => reference.decodeMaskedUrl(newUrl.value))
			const native = attempt(() => decodeMaskedUrl(oldUrl.value))
			if (crossed.ok !== native.ok) {
				mismatches.push({ entry: entry.name, crossed: crossed.ok, native: native.ok })
				continue
			}
			if (crossed.ok && native.ok && !deepEqual(crossed.value, native.value)) {
				mismatches.push({ entry: entry.name, old: show(crossed.value), new: show(native.value) })
			}
		}

		expect(mismatches.slice(0, 5)).toEqual([])
	})

	test('field order on the wire is identical, not merely the field set', () => {
		// The decoded objects are built by assigning in field-number order, so JSON key order is a
		// cheap witness that both decoders walked the message the same way.
		const loaded = corpus.find(entry => entry.name.startsWith('everything at once'))
		expect(loaded).toBeDefined()
		const url = createInspectUrl((loaded as CorpusEntry).item)
		expect(JSON.stringify(decodeMaskedUrl(url))).toBe(JSON.stringify(reference.decodeMaskedUrl(url)))
	})

	test('decode-only URL forms agree, including the ones no encoder here produces', () => {
		const mismatches: unknown[] = []

		for (const { name, url } of urlCases) {
			const old = attempt(() => reference.decodeMaskedUrl(url))
			const now = attempt(() => decodeMaskedUrl(url))
			if (old.ok !== now.ok) {
				mismatches.push({
					name,
					old: old.ok ? show(old.value) : `THREW: ${old.error}`,
					new: now.ok ? show(now.value) : `THREW: ${now.error}`,
				})
				continue
			}
			if (old.ok && now.ok && !deepEqual(old.value, now.value)) {
				mismatches.push({ name, old: show(old.value), new: show(now.value) })
			}
		}

		expect(mismatches.slice(0, 5)).toEqual([])
		expect(mismatches).toHaveLength(0)
	})
})

/* -------------------------------------------------------------------------------------------------
 * The property the wrapper was written to fix
 * ---------------------------------------------------------------------------------------------- */

describe.skipIf(!usesNativeCodec)('the boundary keeps encode → decode an identity', () => {
	test('every placement in the corpus round-trips to itself', () => {
		const failures: unknown[] = []

		for (const entry of outcomes) {
			const { placement, lossy, name } = entry.entry
			if (!placement || lossy) continue
			const normalized = makeSkinPlacement(placement)
			const result = attempt(() => readInspectUrl(buildInspectUrl(normalized)))
			if (!result.ok) {
				failures.push({ name, error: result.error })
				continue
			}
			if (!deepEqual(result.value, normalized)) {
				failures.push({ name, before: show(normalized), after: show(result.value) })
			}
		}

		expect(failures.slice(0, 5)).toEqual([])
		expect(failures).toHaveLength(0)
	})

	test('a plain float64 wear is quantised once by makeSkinPlacement and then never moves again', () => {
		// The bug the boundary fixes: paintwear is a protobuf float, and only the stickers used to be
		// normalised, so `buildInspectUrl → readInspectUrl` was not an identity — 0.154 came back as
		// 0.15399999916553497 and "what I built" never equalled "what I decoded".
		const raw = makeSkinPlacement({
			defindex: 7,
			paintindex: 44,
			paintseed: 661,
			paintwear: 0.154,
			stickers: [],
			keychain: null,
		})

		expect(raw.paintwear).toBe(Math.fround(0.154))
		expect(raw.paintwear).not.toBe(0.154)

		const once = readInspectUrl(buildInspectUrl(raw))
		expect(once.paintwear).toBe(raw.paintwear)
		expect(once).toEqual(raw)
		expect(readInspectUrl(buildInspectUrl(once))).toEqual(raw)
	})

	test('the corpus actually exercises that identity on thousands of placements', () => {
		const checked = corpus.filter(entry => entry.placement && !entry.lossy)
		expect(checked.length).toBeGreaterThan(2000)
	})
})
