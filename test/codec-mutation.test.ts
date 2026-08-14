/**
 * Proof that `test/codec.test.ts` can fail.
 *
 * An equivalence test between two implementations is worthless if it cannot tell them apart. The
 * failure mode is not hypothetical: if the corpus only carried average rows, an endianness flip on a
 * sticker offset or a dropped byte in the checksum would sail through, and the suite would report
 * "byte-identical" while shipping links that resolve to the wrong skin.
 *
 * So: take the real `src/codec.ts`, change **one token**, write the result to a temp file, import it,
 * and run the corpus against `cs2-inspect-lib` again. Every mutant below has to be caught — and the
 * test reports *which corpus entry* caught it and *how many* entries would have.
 *
 * Two of the mutants are **controls**: they change an error message and nothing else, and the corpus
 * must NOT flag them. Without those, a harness that always reports "caught" would look like a pass.
 *
 * Each mutation's search string must appear **exactly once** in the source, which also pins the shape
 * of `src/codec.ts`: rename a method or reformat a line and this test tells you, rather than silently
 * mutating nothing and reporting a green "caught 0 of 0".
 */

import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CS2Inspect, type EconItem as ReferenceItem } from 'cs2-inspect-lib'
import type { EconItem } from '../src/codec.js'
import { buildCorpus, CODEC_SOURCE, decodeCases, usesNativeCodec } from './corpus.js'

const reference = new CS2Inspect()
const WORK = mkdtempSync(join(tmpdir(), 'skinhub-codec-mutants-'))

type Mutation = {
	name: string
	find: string
	replace: string
	/** A control: the change cannot alter any byte, so the corpus must report it as NOT caught. */
	control?: true
}

const MUTATIONS: Mutation[] = [
	/* --- the encoder's byte layout --------------------------------------------------------------- */
	{
		name: 'sticker floats written big-endian instead of little-endian',
		find: 'view.setFloat32(0, value, true)',
		replace: 'view.setFloat32(0, value, false)',
	},
	{
		name: 'paintwear bit pattern taken little-endian instead of big-endian',
		find: 'view.setFloat32(0, value, false)\n\treturn view.getUint32(0, false)',
		replace: 'view.setFloat32(0, value, true)\n\treturn view.getUint32(0, false)',
	},
	{
		name: 'paintwear bit pattern read out little-endian',
		find: 'return view.getUint32(0, false)',
		replace: 'return view.getUint32(0, true)',
	},
	{
		name: 'paintwear written as a wire-type-5 float instead of a varint',
		find: 'writer.writeTag(7, 0)\n\twriter.writeVarint(floatToBits(item.paintwear))',
		replace: 'writer.writeTag(7, 5)\n\twriter.writeVarint(floatToBits(item.paintwear))',
	},
	{
		name: 'stickers written on field 13 instead of 12',
		find: 'writer.writeTag(12, 2)',
		replace: 'writer.writeTag(13, 2)',
	},
	{
		name: 'charms written on field 19 instead of 20',
		find: 'writer.writeTag(20, 2)',
		replace: 'writer.writeTag(19, 2)',
	},
	{
		name: "a sticker's offset_y written on offset_z's field number",
		find: 'writer.writeTag(8, 5)',
		replace: 'writer.writeTag(9, 5)',
	},
	{
		name: 'the varint continuation bit set to 0x40 instead of 0x80',
		find: 'this.bytes[this.pos++] = (value & 0x7f) | 0x80',
		replace: 'this.bytes[this.pos++] = (value & 0x7f) | 0x40',
	},
	{
		name: 'the varint group boundary moved from 7 bits to 8',
		find: 'while (value > 0x7f) {',
		replace: 'while (value > 0xff) {',
	},
	{
		name: 'an empty customname sent as "" instead of being omitted',
		find: 'if (item.customname) {',
		replace: 'if (item.customname !== undefined) {',
	},

	/* --- the framing ---------------------------------------------------------------------------- */
	{
		name: 'the 0x00 payload prefix written as 0x01',
		find: 'framed[0] = 0',
		replace: 'framed[0] = 1',
	},
	{
		name: 'one bit dropped from the CRC polynomial',
		find: 'c = c & 1 ? -306674912 ^ (c >>> 1) : c >>> 1',
		replace: 'c = c & 1 ? -306674911 ^ (c >>> 1) : c >>> 1',
	},
	{
		name: 'the CRC shifted by 7 instead of 8',
		find: 'crc = (crc >>> 8) ^',
		replace: 'crc = (crc >>> 7) ^',
	},
	{
		name: 'one bit dropped from the checksum mask',
		find: 'const checksum = (crc & 0xffff) ^ (protoData.length * crc)',
		replace: 'const checksum = (crc & 0xfffe) ^ (protoData.length * crc)',
	},
	{
		name: 'the checksum length term added instead of multiplied',
		find: 'const checksum = (crc & 0xffff) ^ (protoData.length * crc)',
		replace: 'const checksum = (crc & 0xffff) ^ (protoData.length + crc)',
	},
	{
		name: 'the hex nibble pair not zero-padded',
		find: "i.toString(16).padStart(2, '0').toUpperCase()",
		replace: "i.toString(16).padStart(1, '0').toUpperCase()",
	},
	{
		name: 'the hex emitted lowercase',
		find: "i.toString(16).padStart(2, '0').toUpperCase()",
		replace: "i.toString(16).padStart(2, '0')",
	},

	/* --- the decoder ---------------------------------------------------------------------------- */
	{
		name: 'sticker floats read big-endian',
		find: 'const value = this.view.getFloat32(this.pos, true)',
		replace: 'const value = this.view.getFloat32(this.pos, false)',
	},
	{
		name: 'three bytes of checksum stripped instead of four',
		find: 'hex = hex.slice(0, -8)',
		replace: 'hex = hex.slice(0, -6)',
	},
	{
		name: 'two bytes stripped for the 0x00 prefix instead of one',
		find: "if (hex.startsWith('00')) hex = hex.slice(2)",
		replace: "if (hex.startsWith('00')) hex = hex.slice(4)",
	},
	{
		name: 'the varint payload mask narrowed to six bits on read',
		find: 'result |= (byte & 0x7f) << shift',
		replace: 'result |= (byte & 0x3f) << shift',
	},
	{
		name: 'the read shift advanced by 8 bits instead of 7',
		find: 'shift += 7\n',
		replace: 'shift += 8\n',
	},
	{
		name: 'the decoder skips the top-level validation it used to run',
		find: '\tassertValidItem(item)\n\treturn item',
		replace: '\treturn item',
	},

	/* --- controls: provably cannot change a byte ------------------------------------------------- */
	{
		name: 'CONTROL: an error message reworded',
		find: "throw new Error('Buffer cannot be empty')",
		replace: "throw new Error('the buffer is empty')",
		control: true,
	},
	{
		name: 'CONTROL: a different error message reworded',
		find: 'Too many fields in sticker, possible corruption',
		replace: 'this sticker has too many fields',
		control: true,
	},
]

type MutantCodec = {
	createInspectUrl: (item: EconItem) => string
	decodeMaskedUrl: (url: string) => EconItem
}

/** Where the corpus first disagreed with the reference, and how much of it disagreed overall. */
type Verdict = { caught: number; total: number; first?: string }

const attempt = <T>(fn: () => T): { ok: true; value: T } | { ok: false } => {
	try {
		return { ok: true, value: fn() }
	} catch {
		return { ok: false }
	}
}

/**
 * Serialised comparison, deliberately stricter than a deep equal: it also notices **key order**, so a
 * mutation that swaps two field numbers is caught by the shape of the decoded object and not only by
 * its values. `-0`, `NaN` and bigints are spelled out because `JSON.stringify` flattens all three.
 */
const serialize = (value: unknown) =>
	JSON.stringify(value, (_key, inner) => {
		if (typeof inner === 'bigint') return `${inner}n`
		if (Object.is(inner, -0)) return '-0'
		if (typeof inner === 'number' && !Number.isFinite(inner)) return String(inner)
		return inner
	})

const corpus = buildCorpus()
const urlCases = decodeCases()

/** The same comparison `codec.test.ts` makes, run against a mutant instead of `src/codec.ts`. */
const judge = (mutant: MutantCodec): Verdict => {
	let caught = 0
	let first: string | undefined

	for (const entry of corpus) {
		const expected = attempt(() => reference.createInspectUrl(entry.item as ReferenceItem))
		const actual = attempt(() => mutant.createInspectUrl(entry.item))
		const differs = expected.ok !== actual.ok || (expected.ok && actual.ok && expected.value !== actual.value)
		if (differs) {
			caught++
			first ??= `encode: ${entry.name}`
			continue
		}
		if (!expected.ok || !actual.ok) continue

		const referenceDecoded = attempt(() => reference.decodeMaskedUrl(expected.value))
		const mutantDecoded = attempt(() => mutant.decodeMaskedUrl(expected.value))
		if (referenceDecoded.ok !== mutantDecoded.ok) {
			caught++
			first ??= `decode: ${entry.name}`
			continue
		}
		if (
			referenceDecoded.ok &&
			mutantDecoded.ok &&
			serialize(referenceDecoded.value) !== serialize(mutantDecoded.value)
		) {
			caught++
			first ??= `decode: ${entry.name}`
		}
	}

	for (const { name, url } of urlCases) {
		const expected = attempt(() => reference.decodeMaskedUrl(url))
		const actual = attempt(() => mutant.decodeMaskedUrl(url))
		if (expected.ok !== actual.ok) {
			caught++
			first ??= `url: ${name}`
			continue
		}
		if (expected.ok && actual.ok && serialize(expected.value) !== serialize(actual.value)) {
			caught++
			first ??= `url: ${name}`
		}
	}

	return { caught, total: corpus.length + urlCases.length, ...(first ? { first } : {}) }
}

describe.skipIf(!usesNativeCodec)('the corpus can fail: one perturbed token at a time', () => {
	test('every byte-level mutation of src/codec.ts is caught, and neither control is', async () => {
		const source = await readFile(CODEC_SOURCE, 'utf8')
		const verdicts: { name: string; control: boolean; caught: number; total: number; first?: string }[] = []
		const brokenMutations: string[] = []

		for (const [index, mutation] of MUTATIONS.entries()) {
			const occurrences = source.split(mutation.find).length - 1
			if (occurrences !== 1) {
				brokenMutations.push(`${mutation.name}: found ${occurrences} occurrences of its search string, expected 1`)
				continue
			}

			const path = join(WORK, `codec-${index}.ts`)
			await writeFile(path, source.replace(mutation.find, mutation.replace))
			const mutant = (await import(path)) as MutantCodec

			verdicts.push({ name: mutation.name, control: mutation.control === true, ...judge(mutant) })
		}

		// A mutation whose search string no longer matches would silently test nothing.
		expect(brokenMutations).toEqual([])

		const escaped = verdicts.filter(verdict => !verdict.control && verdict.caught === 0)
		const falsePositives = verdicts.filter(verdict => verdict.control && verdict.caught > 0)

		expect(escaped.map(verdict => verdict.name)).toEqual([])
		expect(falsePositives.map(verdict => verdict.name)).toEqual([])
		expect(verdicts).toHaveLength(MUTATIONS.length)

		// Printed rather than asserted: the numbers are the finding, and pinning them would turn a
		// harmless corpus edit into a failing test.
		const width = Math.max(...verdicts.map(verdict => verdict.name.length))
		for (const verdict of verdicts) {
			const share = ((verdict.caught / verdict.total) * 100).toFixed(1).padStart(5)
			const label = verdict.control ? 'not caught (control)' : `caught by ${verdict.caught}/${verdict.total} (${share}%)`
			console.log(`  ${verdict.name.padEnd(width)}  ${label}${verdict.first ? `  first: ${verdict.first}` : ''}`)
		}
	}, 120_000)

	test('the unmutated source passes the same judgement with zero disagreements', async () => {
		// The other direction of the same claim: the harness is not simply reporting everything as
		// caught. src/codec.ts itself, run through `judge`, must disagree with the reference nowhere.
		const codec = (await import('../src/codec.js')) as MutantCodec
		expect(judge(codec)).toMatchObject({ caught: 0, total: corpus.length + urlCases.length })
	}, 60_000)
})
