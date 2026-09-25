/**
 * Pets (CS2 1.41.8.2): the stage table, the `wp_player_pets` row codec, and the two data files.
 *
 * The row codec is the part a live server depends on, so it is tested the way `placement.test.ts`
 * tests the sticker column: as a grammar the plugin has to be able to read, and as a round trip
 * that settles on the first save - not as string equality against one golden row.
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { clearDefaultCache } from '../src/cache.js'
import {
	CHICKEN_EGG_DEFINDEX,
	CHICKEN_FEED_DEFINDEX,
	DEFAULT_PET_STAGE,
	fetchPets,
	fetchPetVariants,
	findPet,
	formatPetRow,
	isPetStage,
	LOADOUT_SLOT_PET,
	normalizePetName,
	PET_ITEM_DEFINDEX,
	PET_NAME_MAX_LENGTH,
	PET_ROW_COLUMNS,
	PET_STAGES,
	PET_VARIANTS_FILE,
	type PetSelection,
	petKindForStage,
	petLevelForStage,
	petModelVariants,
	PETS_FILE,
	type PetsJson,
	petStageForLevel,
	type PetVariantsJson,
	parsePetRow,
	WP_PETS_TABLE,
} from '../src/datasets/pets.js'
import type { FetchLike } from '../src/fetch.js'
import * as placement from '../src/placement.js'

const FIXTURES = join(import.meta.dir, 'fixtures')
const readJson = async <T>(file: string): Promise<T> => JSON.parse(await readFile(join(FIXTURES, file), 'utf8')) as T

/** `INT UNSIGNED` / `TINYINT` / `INT`: what the plugin's integer parse accepts. */
const UINT_GRAMMAR = /^\d+$/

describe('the stage table', () => {
	test('upgrade level 0..3 is egg, chick, pullet, hen', () => {
		expect(PET_STAGES).toEqual(['egg', 'chick', 'pullet', 'hen'])
		PET_STAGES.forEach((stage, level) => {
			expect(petStageForLevel(level)).toBe(stage)
			expect(petLevelForStage(stage)).toBe(level)
		})
	})

	test('anything else is null, never a guess', () => {
		for (const level of [-1, 4, 1.5, Number.NaN]) expect(petStageForLevel(level)).toBeNull()
		expect(petLevelForStage('rooster')).toBeNull()
		expect(isPetStage('hen')).toBe(true)
		expect(isPetStage('Hen')).toBe(false)
		expect(isPetStage(3)).toBe(false)
	})

	test('the pullet and the hen draw with the adult model', () => {
		expect(PET_STAGES.map(petKindForStage)).toEqual(['egg', 'chick', 'adult', 'adult'])
	})

	test('the item and slot numbers match items_game 1.41.8.2', () => {
		expect([PET_ITEM_DEFINDEX, CHICKEN_EGG_DEFINDEX, CHICKEN_FEED_DEFINDEX, LOADOUT_SLOT_PET]).toEqual([
			4681, 4948, 4949, 57,
		])
	})
})

describe('formatPetRow', () => {
	test('writes the columns verbatim, stage as its upgrade level', () => {
		expect(formatPetRow({ petId: 4, stage: 'pullet', variant: 7, petSeed: 3141592653, name: 'Drumstick' })).toEqual({
			pet_id: 4,
			pet_stage: 2,
			pet_variant: 7,
			pet_seed: 3141592653,
			pet_name: 'Drumstick',
		})
		expect(Object.keys(formatPetRow({ petId: 1, stage: 'egg' }))).toEqual([...PET_ROW_COLUMNS])
		expect(WP_PETS_TABLE).toBe('wp_player_pets')
	})

	test('only the pet and the stage are required; the rest takes the column defaults', () => {
		expect(formatPetRow({ petId: 1, stage: 'egg' })).toEqual({
			pet_id: 1,
			pet_stage: 0,
			pet_variant: null,
			pet_seed: 0,
			pet_name: null,
		})
	})

	test('every integer is quantised onto the unsigned grammar the plugin parses', () => {
		const row = formatPetRow({ petId: 3.9, stage: 'hen', variant: 2.5, petSeed: -5 })
		expect(row).toMatchObject({ pet_id: 3, pet_variant: 2, pet_seed: 0 })
		expect(formatPetRow({ petId: 3, stage: 'hen', petSeed: 2 ** 40 }).pet_seed).toBe(4294967295)
		expect(formatPetRow({ petId: 3, stage: 'hen', petSeed: Number.NaN }).pet_seed).toBe(0)
		for (const value of [row.pet_id, row.pet_stage, row.pet_variant, row.pet_seed]) {
			expect(String(value)).toMatch(UINT_GRAMMAR)
		}
	})

	test('pet_id and pet_variant stop at the signed INT ceiling; only pet_seed is INT UNSIGNED', () => {
		const INT_MAX = 2147483647
		expect(formatPetRow({ petId: INT_MAX, stage: 'hen', variant: INT_MAX }).pet_id).toBe(INT_MAX)
		expect(formatPetRow({ petId: INT_MAX, stage: 'hen', variant: INT_MAX }).pet_variant).toBe(INT_MAX)
		expect(formatPetRow({ petId: INT_MAX + 1, stage: 'hen' }).pet_id).toBe(INT_MAX)
		expect(formatPetRow({ petId: 3e9, stage: 'hen' }).pet_id).toBe(INT_MAX)
		expect(formatPetRow({ petId: 3, stage: 'hen', variant: 3e9 }).pet_variant).toBe(INT_MAX)
		expect(formatPetRow({ petId: 3, stage: 'hen', petSeed: 3e9 }).pet_seed).toBe(3e9)
		// A driver can only hand back what the column holds, but the reader clamps the same way.
		expect(parsePetRow({ pet_id: '3000000000', pet_stage: 3, pet_variant: 3e9, pet_seed: 3e9 })).toMatchObject({
			petId: INT_MAX,
			variant: INT_MAX,
			petSeed: 3e9,
		})
	})

	test('no pet in, no row out: null means delete the row, the inverse of parsePetRow(null)', () => {
		const none: null = formatPetRow(null)
		expect(none).toBeNull()
		expect(formatPetRow(undefined)).toBeNull()
		expect(formatPetRow(parsePetRow(null))).toBeNull()
		expect(formatPetRow(parsePetRow({ pet_id: 0, pet_stage: 3 }))).toBeNull()
	})

	test('a variant that is absent, negative or not a number is NULL - the seed decides', () => {
		for (const variant of [undefined, null, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(formatPetRow({ petId: 5, stage: 'hen', variant }).pet_variant).toBeNull()
		}
		expect(formatPetRow({ petId: 5, stage: 'hen', variant: 0 }).pet_variant).toBe(0)
	})

	test('an unknown stage string falls back to the column default, the hen', () => {
		expect(DEFAULT_PET_STAGE).toBe('hen')
		expect(formatPetRow({ petId: 3, stage: 'rooster' as PetSelection['stage'] }).pet_stage).toBe(3)
	})

	test('refuses a row that names no pet, rather than writing a meaningless one', () => {
		for (const petId of [0, -3, Number.NaN, 0.5]) {
			expect(() => formatPetRow({ petId, stage: 'hen' })).toThrow(RangeError)
		}
	})

	test('names are trimmed, cut to 32 characters by code point, and empty means NULL', () => {
		expect(normalizePetName('  Hen Solo  ')).toBe('Hen Solo')
		expect(normalizePetName('   ')).toBeNull()
		expect(normalizePetName('')).toBeNull()
		expect(normalizePetName(null)).toBeNull()
		expect(normalizePetName('a'.repeat(40))).toBe('a'.repeat(PET_NAME_MAX_LENGTH))
		// 33 emoji: 66 UTF-16 units. A `.slice(0, 32)` would cut the 16th emoji in half.
		const emoji = '🐔'.repeat(33)
		const cut = normalizePetName(emoji) as string
		expect(Array.from(cut)).toHaveLength(32)
		expect(cut).toBe('🐔'.repeat(32))
	})
})

/**
 * `normalizePetName` ports the plugin's `SanitizePetName` (WeaponPaints `Pets.cs`), so the site
 * writes the same string the game would have: the expectations below are what that C# returns.
 */
describe('names match the plugin sanitiser', () => {
	test('control characters and { } < > are stripped, as the plugin strips them before showing a name', () => {
		expect(normalizePetName('<b>Hen</b>{x}')).toBe('bHen/bx')
		expect(normalizePetName('Hen\u0000\u0007\u001b\u007f\u0085 Solo')).toBe('Hen Solo')
		expect(normalizePetName('Line\nbreak\tand\rtab')).toBe('Linebreakandtab')
		expect(normalizePetName('<>{}')).toBeNull()
		expect(normalizePetName('\u0001 \u0002')).toBeNull()
	})

	test('the cut keeps whole text elements, so a ZWJ sequence or a flag is never split', () => {
		// 👨‍👩‍👧 is five code points (three people, two ZWJs): 30 + 5 = 35 does not fit, so it goes whole.
		expect(normalizePetName(`${'a'.repeat(30)}👨‍👩‍👧`)).toBe('a'.repeat(30))
		expect(normalizePetName(`${'a'.repeat(27)}👨‍👩‍👧`)).toBe(`${'a'.repeat(27)}👨‍👩‍👧`)
		// 🇮🇱 is two regional indicators. A code-point cut would keep the first and leave half a flag.
		expect(normalizePetName(`${'a'.repeat(31)}🇮🇱`)).toBe('a'.repeat(31))
		// é as e + U+0301 is one element of two code points.
		expect(normalizePetName(`${'a'.repeat(31)}e\u0301`)).toBe('a'.repeat(31))
	})

	test('the first element that does not fit ends the name - later, smaller ones are not squeezed in', () => {
		expect(normalizePetName(`${'a'.repeat(30)}👨‍👩‍👧bb`)).toBe('a'.repeat(30))
	})

	test('trimmed with .NET whitespace rules, before and after the cut', () => {
		expect(normalizePetName('  Hen  ')).toBe('Hen')
		expect(normalizePetName(`${'a'.repeat(31)} b`)).toBe('a'.repeat(31))
		// U+FEFF is not whitespace to .NET, so the plugin keeps it; JS `trim` would not.
		expect(normalizePetName('\uFEFFHen')).toBe('\uFEFFHen')
	})

	test('without Intl.Segmenter it still never splits a code point', () => {
		const intl = Intl as { Segmenter?: unknown }
		const saved = intl.Segmenter
		try {
			intl.Segmenter = undefined
			expect(normalizePetName('🐔'.repeat(40))).toBe('🐔'.repeat(32))
			expect(normalizePetName('<Hen>')).toBe('Hen')
		} finally {
			intl.Segmenter = saved
		}
		expect(normalizePetName(`${'a'.repeat(31)}🇮🇱`)).toBe('a'.repeat(31))
	})

	test('the row codec reads and writes through it', () => {
		expect(formatPetRow({ petId: 3, stage: 'hen', name: ' <i>Hen</i> ' }).pet_name).toBe('iHen/i')
		expect(parsePetRow({ pet_id: 3, pet_stage: '2', pet_name: '<b>Hen</b>{x}' })?.name).toBe('bHen/bx')
	})
})

describe('parsePetRow', () => {
	test('reads what a MySQL driver hands back: numbers, numeric strings or bigints', () => {
		expect(
			parsePetRow({ pet_id: '4', pet_stage: 2, pet_variant: null, pet_seed: 4000000000n, pet_name: 'Drumstick' }),
		).toEqual({
			petId: 4,
			stage: 'pullet',
			variant: null,
			petSeed: 4000000000,
			name: 'Drumstick',
		})
	})

	test('no row, or a row with no pet in it, is null', () => {
		expect(parsePetRow(null)).toBeNull()
		expect(parsePetRow(undefined)).toBeNull()
		expect(parsePetRow({ pet_id: 0, pet_stage: 3 })).toBeNull()
		expect(parsePetRow({ pet_id: 'abc', pet_stage: 3 })).toBeNull()
		expect(parsePetRow({ pet_stage: 3 })).toBeNull()
	})

	test('a stage outside 0..3 reads as the column default, and a negative variant as NULL', () => {
		expect(parsePetRow({ pet_id: 3, pet_stage: 9, pet_variant: -1, pet_seed: 1 })).toMatchObject({
			stage: 'hen',
			variant: null,
		})
		expect(parsePetRow({ pet_id: 3, pet_stage: null })?.stage).toBe('hen')
	})
})

describe('the row round trip', () => {
	const selections: PetSelection[] = [
		{ petId: 1, stage: 'egg', variant: null, petSeed: 0, name: null },
		{ petId: 2, stage: 'chick', variant: null, petSeed: 17, name: 'Nugget' },
		{ petId: 3, stage: 'pullet', variant: 12, petSeed: 2147483648, name: 'Drumstick' },
		{ petId: 5, stage: 'hen', variant: 0, petSeed: 4294967295, name: '🐔 Hen Solo 🐔' },
		{ petId: 2147483647, stage: 'hen', variant: 2147483647, petSeed: 1, name: '👨‍👩‍👧 🇮🇱' },
	]

	test('parse(format(selection)) is the selection', () => {
		for (const selection of selections) expect(parsePetRow(formatPetRow(selection))).toEqual(selection)
	})

	test('format(parse(row)) is the row, so a load-and-save touches nothing', () => {
		for (const selection of selections) {
			const row = formatPetRow(selection)
			expect(formatPetRow(parsePetRow(row) as PetSelection)).toEqual(row)
		}
	})

	test('an unnormalised selection settles on the first save', () => {
		const once = formatPetRow({ petId: 4.2, stage: 'hen', variant: 3.7, petSeed: -1, name: `  ${'x'.repeat(50)} ` })
		expect(formatPetRow(parsePetRow(once) as PetSelection)).toEqual(once)
	})
})

describe('@skinhub/cdn/placement carries the row codec', () => {
	test('a WeaponPaints writer needs no dataset import for it', () => {
		expect(placement.formatPetRow).toBe(formatPetRow)
		expect(placement.parsePetRow).toBe(parsePetRow)
		expect(placement.PET_STAGES).toBe(PET_STAGES)
	})
})

describe('the data files', () => {
	beforeEach(() => clearDefaultCache())

	const serving = (body: unknown) => {
		const urls: string[] = []
		const fetch: FetchLike = async url => {
			urls.push(url)
			return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
		}
		return { fetch, urls }
	}

	test('fetchPets reads data/pets.json on the configured origin', async () => {
		const fixture = await readJson<PetsJson>('pets.json')
		const { fetch, urls } = serving(fixture)
		const pets = await fetchPets({ origin: 'https://test.invalid/', fetch, cache: false })
		expect(urls).toEqual([`https://test.invalid/data/${PETS_FILE}`])
		expect(pets).toEqual(fixture)
	})

	test('fetchPetVariants reads data/petVariants.json', async () => {
		const fixture = await readJson<PetVariantsJson>('petVariants.json')
		const { fetch, urls } = serving(fixture)
		await fetchPetVariants({ origin: 'https://test.invalid', fetch, cache: false })
		expect(urls).toEqual([`https://test.invalid/data/${PET_VARIANTS_FILE}`])
	})

	test('it goes through the shared cache like every other dataset', async () => {
		const { fetch, urls } = serving(await readJson<PetsJson>('pets.json'))
		const first = await fetchPets({ origin: 'https://test.invalid', fetch })
		const second = await fetchPets({ origin: 'https://test.invalid', fetch })
		expect(urls).toHaveLength(1)
		expect(second).toBe(first)
	})

	test('findPet and petModelVariants join a pet to its render data by modelKey', async () => {
		const pets = await readJson<PetsJson>('pets.json')
		const variants = await readJson<PetVariantsJson>('petVariants.json')
		const polish = findPet(pets, 5)
		expect(polish?.breed).toBe('polish')
		expect(petModelVariants(variants, polish as NonNullable<typeof polish>)?.model).toBe(polish?.model)
		expect(findPet(pets, 99)).toBeUndefined()
		expect(petModelVariants(variants, { modelKey: 'rooster' })).toBeUndefined()
	})
})
