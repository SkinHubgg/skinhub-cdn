/**
 * `market_hash_name` — building it, parsing it, and joining on it.
 *
 * The reason this file is as long as it is: **a wrong market hash name and a genuinely unsold item
 * look identical from the outside.** Both return an empty listings page. There is no error to catch
 * and nothing in a stack trace, so the only place the difference can be caught is here.
 *
 * The ordering claim — `★ StatTrak™ …`, star before the badge — could not be checked against Steam
 * directly: every request to `steamcommunity.com/market/search/render` from this machine returned
 * HTTP 429. It is instead taken from two independent pieces of production code that parse **real**
 * `market_hash_name` strings out of live Steam inventory responses, one of which strips the literal
 * prefix `/^★ StatTrak™ /`. What this file adds is that the package's builder and its parser are
 * exact inverses of each other over every row of the real export, which is the part that can be
 * mechanised.
 */

import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Skin, Skins } from '../src/datasets/skins.js'
import {
	canBeSouvenir,
	canBeStatTrak,
	createSkinIndex,
	isUntradable,
	marketHashName,
	marketHashNameIndex,
	marketHashNames,
	paintIndexForMarketHashName,
	parseMarketHashName,
	skinsByMarketHashName,
	wearsOf,
} from '../src/query/index.js'

const FIXTURES = join(import.meta.dir, 'fixtures')
const readJson = async <T>(dir: string, file: string): Promise<T> =>
	JSON.parse(await readFile(join(dir, file), 'utf8')) as T

const fixtureSkins = await readJson<Skins>(FIXTURES, 'skins.json')
const named = (name: string): Skin => {
	const found = fixtureSkins.find(skin => skin.name === name)
	if (!found) throw new Error(`fixture has no row named ${name}`)
	return found
}

describe('building a market hash name', () => {
	test('a plain finish is weapon, finish and exterior', () => {
		expect(marketHashName(named('M4A4 | Howl'), { wear: 'Field-Tested' })).toBe('M4A4 | Howl (Field-Tested)')
	})

	test('StatTrak™ goes in front, with the trademark sign Steam actually uses', () => {
		expect(marketHashName(named('M4A4 | Howl'), { wear: 'FT', stattrak: true })).toBe(
			'StatTrak™ M4A4 | Howl (Field-Tested)',
		)
	})

	test('on a knife the star stays first and StatTrak™ goes after it', () => {
		// The whole point. `StatTrak™ ★ Bayonet …` is a name nothing is listed under.
		expect(marketHashName(named('★ Bayonet | Case Hardened'), { wear: 'FN', stattrak: true })).toBe(
			'★ StatTrak™ Bayonet | Case Hardened (Factory New)',
		)
	})

	test('a vanilla knife has no finish part and no exterior', () => {
		expect(marketHashName(named('★ Bayonet'))).toBe('★ Bayonet')
		expect(marketHashName(named('★ Bayonet'), { stattrak: true })).toBe('★ StatTrak™ Bayonet')
	})

	test('Souvenir is only offered where a souvenir package actually drops it', () => {
		const souvenir = named('Sawed-Off | Sage Spray')
		expect(canBeSouvenir(souvenir)).toBe(true)
		expect(marketHashName(souvenir, { wear: 'FT', souvenir: true })).toBe('Souvenir Sawed-Off | Sage Spray (Field-Tested)')

		// `souvenir: true` on the row, but no souvenir package drops it — so no such listing exists.
		const howl = named('M4A4 | Howl')
		expect(howl.souvenir).toBe(true)
		expect(canBeSouvenir(howl)).toBe(false)
		expect(marketHashName(howl, { wear: 'FT', souvenir: true })).toBeNull()
	})

	test('a variant that does not exist is null, not a string that finds nothing', () => {
		const gloves = named('★ Sport Gloves | Big Game')
		expect(canBeStatTrak(gloves)).toBe(false)
		expect(marketHashName(gloves, { wear: 'FT', stattrak: true })).toBeNull()

		// No item is both.
		expect(marketHashName(named('Sawed-Off | Sage Spray'), { wear: 'FT', stattrak: true, souvenir: true })).toBeNull()

		// A vanilla gun is a loadout state, not an item.
		expect(isUntradable(named('Desert Eagle | Default'))).toBe(true)
		expect(marketHashName(named('Desert Eagle | Default'), { wear: 'FT' })).toBeNull()
	})

	test('an exterior the finish cannot reach is null', () => {
		const narrow = fixtureSkins.find(skin => wearsOf(skin).length > 0 && wearsOf(skin).length < 5) as Skin
		const missing = ['Factory New', 'Minimal Wear', 'Field-Tested', 'Well-Worn', 'Battle-Scarred'].find(
			name => !wearsOf(narrow).some(tier => tier.name === name),
		) as string
		expect(marketHashName(narrow, { wear: missing })).toBeNull()
	})

	test('a missing or unrecognised exterior on a finish that has them is null', () => {
		expect(marketHashName(named('M4A4 | Howl'))).toBeNull()
		expect(marketHashName(named('M4A4 | Howl'), { wear: 'Pristine' })).toBeNull()
	})
})

describe('enumerating every variant', () => {
	test('a five-exterior StatTrak finish is 10 keys', () => {
		const variants = marketHashNames(named('★ Bayonet | Case Hardened'))
		expect(variants.length).toBe(10)
		expect(variants.filter(variant => variant.stattrak).length).toBe(5)
		expect(new Set(variants.map(variant => variant.marketHashName)).size).toBe(10)
	})

	test('a vanilla knife is 2 keys and a vanilla gun is none', () => {
		expect(marketHashNames(named('★ Bayonet')).map(variant => variant.marketHashName)).toEqual([
			'★ Bayonet',
			'★ StatTrak™ Bayonet',
		])
		expect(marketHashNames(named('Desert Eagle | Default'))).toEqual([])
	})

	test('gloves get no StatTrak keys', () => {
		for (const variant of marketHashNames(named('★ Sport Gloves | Big Game'))) {
			expect(variant.stattrak).toBe(false)
			expect(variant.marketHashName.startsWith('★ ')).toBe(true)
		}
	})

	test('every emitted key round-trips through the parser', () => {
		for (const skin of fixtureSkins) {
			for (const variant of marketHashNames(skin)) {
				const parsed = parseMarketHashName(variant.marketHashName)
				expect({ name: variant.marketHashName, base: parsed.name }).toEqual({
					name: variant.marketHashName,
					base: skin.name,
				})
				expect(parsed.stattrak).toBe(variant.stattrak)
				expect(parsed.souvenir).toBe(variant.souvenir)
				expect(parsed.wear?.id ?? null).toBe(variant.wear?.id ?? null)
			}
		}
	})
})

describe('parsing a market hash name', () => {
	test('the badges come off in Steam’s order', () => {
		const parsed = parseMarketHashName('★ StatTrak™ Karambit | Doppler (Factory New)')
		expect(parsed).toMatchObject({
			base: 'Karambit | Doppler',
			name: '★ Karambit | Doppler',
			weapon: 'Karambit',
			finish: 'Doppler',
			star: true,
			stattrak: true,
			souvenir: false,
		})
		expect(parsed.wear?.short).toBe('FN')
	})

	test('a vanilla knife has no weapon/finish split', () => {
		expect(parseMarketHashName('★ Bayonet')).toMatchObject({
			base: 'Bayonet',
			name: '★ Bayonet',
			weapon: null,
			finish: null,
			star: true,
			stattrak: false,
		})
	})

	test('only a KNOWN exterior is stripped, so a name that ends in brackets survives', () => {
		// This is why the parser does not just regex the last parenthesis off.
		const parsed = parseMarketHashName('Sticker | Titan (Holo) | Katowice 2014')
		expect(parsed.wear).toBeNull()
		expect(parsed.base).toBe('Sticker | Titan (Holo) | Katowice 2014')
	})

	test('hand-typed input is tolerated and canonicalised', () => {
		const parsed = parseMarketHashName('  stattrak AK-47 | Asiimov (FT) ')
		expect(parsed.stattrak).toBe(true)
		expect(parsed.base).toBe('AK-47 | Asiimov')
		expect(parsed.wear?.name).toBe('Field-Tested')
	})
})

describe('joining on a market hash name', () => {
	test('a key resolves to its row', () => {
		const matches = skinsByMarketHashName(fixtureSkins, 'StatTrak™ M4A4 | Howl (Field-Tested)')
		expect(matches.map(skin => skin.name)).toEqual(['M4A4 | Howl'])
	})

	test('a Doppler key resolves to every phase, because Steam sells them as one listing', () => {
		const matches = skinsByMarketHashName(fixtureSkins, '★ Paracord Knife | Doppler (Factory New)')
		expect(matches.length).toBe(2)
		expect(new Set(matches.map(skin => skin.phase))).toEqual(new Set(['Black Pearl', 'Phase 4']))
		// …and that is exactly why the paint index cannot be recovered from the name alone.
		expect(paintIndexForMarketHashName(fixtureSkins, '★ Paracord Knife | Doppler (Factory New)')).toBeUndefined()
	})

	test('a unique key does yield a paint index', () => {
		expect(paintIndexForMarketHashName(fixtureSkins, 'M4A4 | Howl (Field-Tested)')).toBe(309)
	})

	test('a key for a quality the row cannot have matches nothing', () => {
		expect(skinsByMarketHashName(fixtureSkins, 'Souvenir M4A4 | Howl (Field-Tested)')).toEqual([])
		expect(skinsByMarketHashName(fixtureSkins, 'StatTrak™ ★ Sport Gloves | Big Game (Field-Tested)')).toEqual([])
	})

	test('an exterior the finish cannot reach matches nothing', () => {
		const narrow = named('★ Paracord Knife | Doppler')
		const missing = ['Factory New', 'Minimal Wear', 'Field-Tested', 'Well-Worn', 'Battle-Scarred'].find(
			name => !wearsOf(narrow).some(tier => tier.name === name),
		) as string
		expect(skinsByMarketHashName(fixtureSkins, `★ Paracord Knife | Doppler (${missing})`)).toEqual([])
	})

	test('the index and the scan agree', () => {
		const table = marketHashNameIndex(fixtureSkins)
		const index = createSkinIndex(fixtureSkins)
		for (const [key, entry] of table) {
			expect(entry.skins.length).toBe(skinsByMarketHashName(fixtureSkins, key).length)
			expect(index.findByMarketHashName(key)?.skins.length).toBe(entry.skins.length)
			// Case-insensitive on the way in.
			expect(index.findByMarketHashName(key.toUpperCase())?.skins.length).toBe(entry.skins.length)
		}
		expect(index.findByMarketHashName('AK-47 | Nothing (Factory New)')).toBeUndefined()
	})
})

/* --------------------------------------------------------------------------------------------
 * The full export.
 * ------------------------------------------------------------------------------------------ */

const FULL = process.env.SKINHUB_CDN_FIXTURES
const hasFull = Boolean(FULL && existsSync(join(FULL, 'skins.json')))

describe.skipIf(!hasFull)('market hash names over the whole export', () => {
	let skins: Skins = []

	test('load', async () => {
		skins = await readJson<Skins>(FULL as string, 'skins.json')
	})

	test('build → parse is an exact inverse on every key the export can produce', () => {
		let keys = 0
		for (const skin of skins) {
			for (const variant of marketHashNames(skin)) {
				const parsed = parseMarketHashName(variant.marketHashName)
				expect({ key: variant.marketHashName, name: parsed.name }).toEqual({
					key: variant.marketHashName,
					name: skin.name,
				})
				expect({ key: variant.marketHashName, st: parsed.stattrak, sv: parsed.souvenir }).toEqual({
					key: variant.marketHashName,
					st: variant.stattrak,
					sv: variant.souvenir,
				})
				keys++
			}
		}
		expect(keys).toBe(16_067)
	})

	test('every key resolves back to the row that produced it', () => {
		const index = createSkinIndex(skins)
		for (const skin of skins) {
			for (const variant of marketHashNames(skin)) {
				const entry = index.findByMarketHashName(variant.marketHashName)
				expect(entry?.skins.some(candidate => candidate.id === skin.id)).toBe(true)
			}
		}
	})

	test('a key covers more than one row only when the rows are phases of one finish', () => {
		const table = marketHashNameIndex(skins)
		const shared = [...table.values()].filter(entry => entry.skins.length > 1)
		for (const entry of shared) {
			expect(new Set(entry.skins.map(skin => skin.name)).size).toBe(1)
			expect(entry.skins.every(skin => skin.phase !== undefined)).toBe(true)
			expect(new Set(entry.skins.map(skin => skin.phase)).size).toBe(entry.skins.length)
		}
		expect(shared.length).toBe(117)
		expect(table.size).toBe(15_455)
	})

	test('the Souvenir signal is disjoint from StatTrak, which the raw flag is not', () => {
		const derived = skins.filter(canBeSouvenir)
		const raw = skins.filter(skin => skin.souvenir === true)

		// What the drop source says: 319 rows, none of them StatTrak-able.
		expect(derived.length).toBe(319)
		expect(derived.filter(skin => skin.stattrak).length).toBe(0)
		// Every one of them also carries the raw flag — this narrows the flag, it does not contradict it.
		expect(derived.every(skin => skin.souvenir === true)).toBe(true)

		// What the raw flag says, and why it cannot be used: 1,456 rows, 698 of which claim to be
		// StatTrak as well. No CS2 item is both.
		expect(raw.length).toBe(1456)
		expect(raw.filter(skin => skin.stattrak).length).toBe(698)
	})

	test('the untradable rows are exactly the vanilla guns', () => {
		const untradable = skins.filter(isUntradable)
		expect(untradable.length).toBe(35)
		for (const skin of untradable) {
			expect(skin.paint_index).toBe('0')
			expect(marketHashNames(skin)).toEqual([])
		}
		// And the vanilla knives are NOT untradable — `★ Bayonet` is a real listing.
		const vanillaKnives = skins.filter(skin => skin.paint_index === null)
		expect(vanillaKnives.length).toBe(20)
		for (const skin of vanillaKnives) expect(marketHashNames(skin).length).toBe(2)
	})

	test('the StatTrak and Souvenir key counts', () => {
		const table = marketHashNameIndex(skins)
		const entries = [...table.values()]
		expect(entries.filter(entry => entry.stattrak).length).toBe(4984)
		expect(entries.filter(entry => entry.souvenir).length).toBe(1482)
	})

	test('no key is ever built with StatTrak in front of the star', () => {
		for (const skin of skins) {
			for (const variant of marketHashNames(skin)) {
				expect(variant.marketHashName.startsWith('StatTrak™ ★')).toBe(false)
				if (skin.name.startsWith('★ ')) expect(variant.marketHashName.startsWith('★ ')).toBe(true)
			}
		}
	})
})
