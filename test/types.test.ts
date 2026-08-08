/**
 * "Types must match reality."
 *
 * Two tiers:
 *
 *   1. **Fixtures** (`test/fixtures/`) — a small sample of each real file, committed, chosen so
 *      that every edge case the types describe is present in it: the vanilla skins with their two
 *      different flavours of missing field, the glove whose `paint` is a number, the agents whose
 *      `model` is the string `"null"`, empty-string images, every nullable field null at least
 *      once. Runs everywhere, needs no network and no exporter checkout.
 *
 *   2. **The full files** — all 2,126 skins and all 11,788 stickers, when
 *      `SKINHUB_CDN_FIXTURES` points at an `asset-export/out/data` directory. This is the tier that
 *      catches an exporter change, and it is skipped rather than failed when the directory is not
 *      there, because a stranger cloning this repo does not have 16 MB of CS2 exports.
 *
 * The fixture tier also asserts that the edge cases are actually *in* the fixture. A validator that
 * passes because the sample contains only easy rows would be worse than no test.
 */

import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Agents } from '../src/datasets/agents.js'
import type { Collectibles } from '../src/datasets/collectibles.js'
import type { Gloves } from '../src/datasets/gloves.js'
import type { ItemsGame } from '../src/datasets/items-game.js'
import type { Keychains } from '../src/datasets/keychains.js'
import type { MusicKits } from '../src/datasets/music.js'
import type { Skins } from '../src/datasets/skins.js'
import type { Stickers } from '../src/datasets/stickers.js'
import {
	agentShape,
	arrayOf,
	collectibleShape,
	gloveShape,
	itemsGameShape,
	keychainShape,
	musicKitShape,
	skinShape,
	stickerShape,
	validate,
} from './validate.js'

const FIXTURES = join(import.meta.dir, 'fixtures')

const readJson = async <T>(dir: string, file: string): Promise<T> => JSON.parse(await readFile(join(dir, file), 'utf8')) as T

const DATASETS = [
	{ file: 'skins.json', shape: arrayOf(skinShape) },
	{ file: 'stickers.json', shape: arrayOf(stickerShape) },
	{ file: 'collectibles.json', shape: arrayOf(collectibleShape) },
	{ file: 'keychains.json', shape: arrayOf(keychainShape) },
	{ file: 'music.json', shape: arrayOf(musicKitShape) },
	{ file: 'gloves.json', shape: arrayOf(gloveShape) },
	{ file: 'agents.json', shape: arrayOf(agentShape) },
	{ file: 'items_game.json', shape: itemsGameShape },
] as const

describe('committed fixtures validate against the exported types', () => {
	for (const { file, shape } of DATASETS) {
		test(file, async () => {
			const data = await readJson<unknown>(FIXTURES, file)
			expect(validate(shape, data, file)).toEqual([])
		})
	}
})

describe('the fixtures actually contain the edge cases the types describe', () => {
	test('skins: vanilla rows are null in four fields and missing three keys', async () => {
		const skins = await readJson<Skins>(FIXTURES, 'skins.json')
		const vanilla = skins.filter(s => s.pattern === null)
		expect(vanilla.length).toBeGreaterThan(0)

		for (const row of vanilla) {
			expect(row.min_float).toBeNull()
			expect(row.max_float).toBeNull()
			expect(row.paint_index).toBeNull()
			// Absent keys, not null ones — the distinction the type makes.
			expect('souvenir' in row).toBe(false)
			expect('wears' in row).toBe(false)
			expect('collections' in row).toBe(false)
		}
	})

	test('skins: phase is absent, never null, on rows that have none', async () => {
		const skins = await readJson<Skins>(FIXTURES, 'skins.json')
		expect(skins.some(s => typeof s.phase === 'string')).toBe(true)
		expect(skins.some(s => !('phase' in s))).toBe(true)
		expect(skins.every(s => s.phase !== null)).toBe(true)
	})

	test('skins: an image field is the empty string rather than a URL that 404s', async () => {
		const skins = await readJson<Skins>(FIXTURES, 'skins.json')
		const images = skins.flatMap(s => [...(s.collections ?? []), ...s.crates]).map(entry => entry.image)
		expect(images).toContain('')
	})

	test('gloves: paint is a number on the default row and a string elsewhere', async () => {
		const gloves = await readJson<Gloves>(FIXTURES, 'gloves.json')
		expect(gloves.some(g => typeof g.paint === 'number')).toBe(true)
		expect(gloves.some(g => typeof g.paint === 'string')).toBe(true)
	})

	test('agents: model is the four-character string "null", not null', async () => {
		const agents = await readJson<Agents>(FIXTURES, 'agents.json')
		const defaults = agents.filter(a => a.model === 'null')
		expect(defaults.length).toBeGreaterThan(0)
		for (const agent of defaults) {
			expect(agent.model).not.toBeNull()
			expect(agent.id).toBeNull()
			expect(agent.rarity).toBeNull()
		}
	})

	test('music: rarity is null', async () => {
		const music = await readJson<MusicKits>(FIXTURES, 'music.json')
		expect(music.every(m => m.rarity === null)).toBe(true)
	})

	test('stickers: every nullable field is null on at least one row', async () => {
		const stickers = await readJson<Stickers>(FIXTURES, 'stickers.json')
		expect(stickers.some(s => s.rarity === null)).toBe(true)
		expect(stickers.some(s => s.description === null)).toBe(true)
		expect(stickers.some(s => s.tournament_event_id === null)).toBe(true)
		expect(stickers.some(s => s.tournament_player_id === null)).toBe(true)
		expect(stickers.some(s => s.image === '')).toBe(true)
		expect(stickers.some(s => s.is_patch)).toBe(true)
	})

	test('keychains and collectibles have a null description and an empty image', async () => {
		const keychains = await readJson<Keychains>(FIXTURES, 'keychains.json')
		const collectibles = await readJson<Collectibles>(FIXTURES, 'collectibles.json')
		expect(keychains.some(k => k.description === null)).toBe(true)
		expect(keychains.some(k => k.image === '')).toBe(true)
		expect(collectibles.some(c => c.description === null)).toBe(true)
		expect(collectibles.some(c => c.image === '')).toBe(true)
	})

	test('items_game is an object with one top-level key, not an array', async () => {
		const data = await readJson<ItemsGame>(FIXTURES, 'items_game.json')
		expect(Array.isArray(data)).toBe(false)
		expect(Object.keys(data)).toEqual(['items_game'])
		expect(Object.keys(data.items_game).length).toBeGreaterThan(20)
		expect(data.items_game.paint_kits).toBeDefined()
	})
})

describe('the validator can fail', () => {
	test('an unknown key is reported', () => {
		const rows = [{ weapon_defindex: 0, paint: 0, image: '', paint_name: 'x', surprise: 1 }]
		const issues = validate(arrayOf(gloveShape), rows, 'gloves')
		expect(issues.length).toBe(1)
		expect(issues[0]).toContain('unknown key')
	})

	test('a missing required key is reported', () => {
		const issues = validate(arrayOf(gloveShape), [{ weapon_defindex: 0, paint: 0, image: '' }], 'gloves')
		expect(issues[0]).toContain('paint_name: required key is missing')
	})

	test('null where the type is not nullable is reported', () => {
		const rows = [{ weapon_defindex: 0, paint: 0, image: null, paint_name: 'x' }]
		expect(validate(arrayOf(gloveShape), rows, 'gloves')[0]).toContain('expected string, got null')
	})

	test('an out-of-set team id is reported', () => {
		const issues = validate(arrayOf(agentShape), [{ team: 4, image: '', model: 'm', agent_name: 'a', id: null, rarity: null, description: null }], 'agents')
		expect(issues[0]).toContain('one of 2 | 3')
	})
})

/* --------------------------------------------------------------------------------------------
 * Tier 2 — the full export, when it is on this machine.
 * ------------------------------------------------------------------------------------------ */

const FULL = process.env.SKINHUB_CDN_FIXTURES
const hasFull = Boolean(FULL && existsSync(join(FULL, 'skins.json')))

describe.skipIf(!hasFull)('the full export validates against the exported types', () => {
	const EXPECTED_ROWS: Record<string, number> = {
		'skins.json': 2126,
		'stickers.json': 11788,
		'collectibles.json': 715,
		'keychains.json': 143,
		'music.json': 101,
		'gloves.json': 95,
		'agents.json': 81,
	}

	for (const { file, shape } of DATASETS) {
		test(file, async () => {
			const data = await readJson<unknown>(FULL as string, file)
			expect(validate(shape, data, file)).toEqual([])

			const expected = EXPECTED_ROWS[file]
			if (expected !== undefined) {
				// Not an assertion that the count is frozen — a diagnostic, so a wildly different
				// file is visible in the failure message rather than only in the validator output.
				expect(Array.isArray(data) ? data.length : 0).toBeGreaterThan(expected * 0.5)
			}
		})
	}
})
