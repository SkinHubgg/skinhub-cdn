/**
 * Chicken pets - added to CS2 in 1.41.8.2 (2026-09-22) - as data, and as a WeaponPaints row.
 *
 * **This module has no imports.** Like `./placement.ts` it can be reached from
 * `@skinhub/cdn/placement` by a server that only writes database rows, so it must not pull in the
 * fetch layer or the protobuf codec. The fetchers for `data/pets.json` and `data/petVariants.json`
 * live in `./datasets/pets.ts`, which re-exports everything here.
 *
 * ## What a pet is, in the game's own terms
 *
 * One item definition, 4681 `pet`, carries three attributes that decide what you see:
 *
 * | attribute | id | meaning |
 * |---|---:|---|
 * | `pet id` | 296 | the `pet_definitions` row: 1 egg, 2 chick, 3 Catalana, 4 Silkie, 5 Polish |
 * | `upgrade level` | 268 | the life stage: 0 egg, 1 chick, 2 pullet, 3 hen |
 * | `pet seed` | 313 | a uint32 the client turns into a colour and body shape |
 *
 * plus one name per stage (`custom name attr` 111 for the chick, `... 2` 328 for the pullet, `... 3`
 * 329 for the hen). Eggs (4948) and feed (4949) are separate item definitions. All of that is in
 * `data/pets.json`, which the exporter writes from `items_game`; the numbers below are the few this
 * package needs without a fetch.
 *
 * ## What is NOT known yet, stated rather than guessed around
 *
 * - **How `pet seed` becomes a look.** The code is client-only (`CChickenPoseGenerator`, Windows
 *   `client.dll`). Nothing here interprets the seed; it is stored and carried as an opaque uint32.
 * - **Whether `pet id` changes at hatch**, i.e. whether an egg row (id 1) becomes a breed row (3-5)
 *   or stays 1 with a higher `upgrade level`. So the row codec below does NOT constrain which
 *   `pet_id` may sit at which stage.
 * - **Where the seed rides in an inspect link.** `CEconItemPreviewDataBlock` has `petindex` (19) and
 *   `upgrade_level` (23); `paintseed` (8) is the natural carrier and is what `SkinPlacement` uses,
 *   but no real pet link has been decoded yet.
 */

/* -------------------------------------------------------------------------------------------------
 * The shapes of data/pets.json and data/petVariants.json
 *
 * Mirrors the shared contract the exporter builds against, field for field. `test/types.test.ts`
 * validates the committed fixtures - and the real export, when `SKINHUB_CDN_FIXTURES` points at it -
 * against these, unknown keys included.
 * ---------------------------------------------------------------------------------------------- */

/** The four life stages, in `upgrade level` order. */
export type PetStage = 'egg' | 'chick' | 'pullet' | 'hen'

export type PetBreed = 'catalana' | 'silkie' | 'polish'

/** Which model a `pet_definitions` row renders with. Pullet and hen share the adult model. */
export type PetKind = 'egg' | 'chick' | 'adult'

/** `data/pets.json`. An object, not an array - the odd one out along with `items_game.json`. */
export type PetsJson = {
	/** Item def of the owned pet item, 4681 `pet`. */
	petItemDefindex: number
	/** 4948 `chicken_egg`. */
	eggItemDefindex: number
	/** 4949 `chicken_feed`. */
	feedItemDefindex: number
	/** `LOADOUT_SLOT_PET`, 57. */
	loadoutSlot: number
	/**
	 * English for `#CSGO_Type_Pet` (item 4681's `item_type_name`), `Pet`. Beyond the shared contract,
	 * so optional: the game references the token but csgo_english 1.41.8.2 does not define it, and the
	 * exporter writes its own fallback until Valve ships one.
	 */
	typeName?: string
	/** English for `#LoadoutSlot_Pet`, `Pet` - the same story as `typeName`. */
	loadoutSlotName?: string
	/** Attribute definition indices, by role. */
	attributes: {
		/** 268 `upgrade level`: 0 egg, 1 chick, 2 pullet, 3 hen. */
		upgradeLevel: number
		/** 296 `pet id` -> `pet_definitions` id. */
		petId: number
		/** 313 `pet seed`. */
		petSeed: number
		/** 303. */
		foodExpirationDate: number
		/** 304. */
		nextUpgradeDate: number
		/** 111 - the chick's name. */
		customName: number
		/** 328 - the pullet's name. */
		customName2: number
		/** 329 - the hen's name. */
		customName3: number
	}
	stages: { level: number; stage: PetStage; name: string }[]
	/** One row per `pet_definitions` entry. */
	pets: PetRow[]
}

/** One `pet_definitions` entry. */
export type PetRow = {
	/** The `pet_definitions` id (1..5 today) - the value of the `pet id` attribute. */
	id: number
	/** `chicken_silkie_01`. */
	name: string
	/**
	 * English: the localised `loc_name` with the game's leading `Pet ` dropped and the breed in front
	 * for adults - `Chicken Egg`, `Chick`, `Silkie Chicken`.
	 */
	displayName: string
	/** The `loc_name` token as authored, `#pet_chicken` - not English; that is `displayName`. */
	locName: string
	kind: PetKind
	/** `null` for the egg and the chick. */
	breed: PetBreed | null
	/** VPK model path, `models/chicken/chicken_silkie.vmdl`. */
	model: string
	/** Key into `PetVariantsJson['models']` - the model file's basename, `chicken_silkie`. */
	modelKey: string
	/** CDN path of the GLB, relative to the origin. Resolve it with `cdnUrl`. */
	glb: string
	/** CDN path of the econ icon, or `null` - Valve ships one for the egg only. */
	icon: string | null
}

/** `data/petVariants.json`, read by the exporter straight out of the game's model files. */
export type PetVariantsJson = {
	generatedFrom: string
	/**
	 * The exporter's own prose on how to read the file, keyed by field (`shapes`, `presets`,
	 * `matgrpWeights`, `seedExpressions`, `features`, `textures`). Beyond the contract, so optional.
	 */
	notes?: Record<string, string>
	/** Keyed by `PetRow['modelKey']`: `chicken`, `chicken_silkie`, `chicken_polish`, `chick`, `egg_pristine`. */
	models: Record<string, PetModelVariants>
}

export type PetModelVariants = {
	model: string
	/** Every material group, in model order (index 0 is `default`). Empty for the chick and the egg. */
	materialGroups: PetMaterialGroup[]
	/**
	 * `chicken_metadata.matgrps` - roll weights, only the entries that carry a `freq`. A group missing
	 * here has no weight in the data; whether the game reads that as 0 or 1 is unknown, and the
	 * contract says treat it as 0. Group 0 (`default`) is never listed - it duplicates another group.
	 */
	matgrpWeights: { matgrp: number; freq: number }[]
	/**
	 * `chicken_metadata.matparams` - which random slot feeds each render attribute. Two names can
	 * share a slot (the Silkie maps `$ChickenBrightness` and `$ChickenIridescence` both to 7), so roll
	 * per slot and fan out to names.
	 */
	matparams: { name: string; slot: number }[]
	/** `procedural_geometry_poses` characteristics. */
	characteristics: { name: string; sequenceMin: string; sequenceMax: string }[]
	/** Preset ranges per characteristic, `[min, max]` in 0..1. */
	presets: { adolescent?: Record<string, [number, number]>; adult?: Record<string, [number, number]> }
	/**
	 * Per characteristic, per bone, an ADDITIVE delta applied after the animation mixer, with the
	 * characteristic's value `v` in 0..1: `position += lerp(tMin, tMax, v)`, `quaternion *=
	 * slerp(rMin, rMax, v)` (post-multiply), `scale *= lerp(sMin, sMax, v)`. Only the channels that
	 * differ between the min and max poses are present, and bones a characteristic leaves alone are
	 * omitted. Translations are metres in the bone's parent space (the GLB node space); quaternions are
	 * `[x, y, z, w]`; bone names are GLB node names. `{}` for the egg. (The contract first described
	 * these as absolute poses; the exporter measured them as deltas, and `notes.shapes` says so too.)
	 */
	shapes: Record<string, { bones: Record<string, PetBoneRange> }>
	/** The materials, for a model with no material groups (the chick, the egg). */
	materials?: PetMaterial[]
}

export type PetBoneRange = {
	tMin?: [number, number, number]
	tMax?: [number, number, number]
	rMin?: [number, number, number, number]
	rMax?: [number, number, number, number]
	sMin?: [number, number, number]
	sMax?: [number, number, number]
}

export type PetMaterialGroup = PetMaterial & {
	index: number
	/** As authored: `default`, `1`, `2`, ... or a real name. Map colours by this, not by index. */
	name: string
	/** Human label from the vmat file name, `Black With White Head`. */
	label: string
}

export type PetMaterial = {
	vmat: string
	/** `csgo_character.vfx`. */
	shader: string
	/**
	 * `F_*` feature flags as raw ints - `F_TINT_MASK`, `F_IRIDESCENCE`, `F_DETAIL_TEXTURE`, ... For
	 * `F_DETAIL_TEXTURE`, 1 is Replace and an absent flag is Multiply.
	 */
	features: Record<string, number>
	/**
	 * Texture slot -> CDN path, already `.png`: `pettex/<vpk path>.png`, or `defaults/...` for the
	 * engine's shared `materials/default/` textures, which the existing `defaults` root already serves.
	 */
	textures: Record<string, string>
	/** Float params, vector params as 4-lane arrays, and the non-`F_` int params (mask switches) from the vmat. */
	params: Record<string, number | number[]>
	/**
	 * Dynamic expressions as normalised source: `{ g_fHueShift: 'return lerp(-5, 55, ...);' }`. A key
	 * can also be a TEXTURE slot (`g_tDetail`, on some Silkie groups) returning a float2 whose use is
	 * unknown - skip `g_t*` keys unless a render proves what they do.
	 */
	seedExpressions: Record<string, string>
	renderAttributesUsed: string[]
}

/* -------------------------------------------------------------------------------------------------
 * The few numbers that are needed without a fetch
 * ---------------------------------------------------------------------------------------------- */

/** Item definition 4681 `pet` - what an owned chick, pullet or hen is. Also `PetsJson['petItemDefindex']`. */
export const PET_ITEM_DEFINDEX = 4681
/** Item definition 4948 `chicken_egg`. */
export const CHICKEN_EGG_DEFINDEX = 4948
/** Item definition 4949 `chicken_feed`. */
export const CHICKEN_FEED_DEFINDEX = 4949
/** `LOADOUT_SLOT_PET`, new in 1.41.8.2 (`LOADOUT_SLOT_COUNT` is now 58). */
export const LOADOUT_SLOT_PET = 57

/** The stages in `upgrade level` order, so `PET_STAGES[level]` is the stage. */
export const PET_STAGES: readonly PetStage[] = ['egg', 'chick', 'pullet', 'hen'] as const

/** The `wp_player_pets.pet_stage` column default, 3 - a hen. */
export const DEFAULT_PET_STAGE: PetStage = 'hen'

/** `upgrade level` -> stage, or `null` for anything outside 0..3. */
export const petStageForLevel = (level: number): PetStage | null =>
	Number.isInteger(level) ? (PET_STAGES[level] ?? null) : null

/** Stage -> `upgrade level`, or `null` for a string that is not a stage. */
export const petLevelForStage = (stage: string): number | null => {
	const level = PET_STAGES.indexOf(stage as PetStage)
	return level === -1 ? null : level
}

export const isPetStage = (value: unknown): value is PetStage =>
	typeof value === 'string' && PET_STAGES.includes(value as PetStage)

/** Which model a stage draws with - the pullet and the hen are both the adult breed model. */
export const petKindForStage = (stage: PetStage): PetKind =>
	stage === 'egg' ? 'egg' : stage === 'chick' ? 'chick' : 'adult'

/** The `pet_definitions` row for an id, or `undefined`. */
export const findPet = (pets: PetsJson, id: number): PetRow | undefined => pets.pets.find(pet => pet.id === id)

/** A pet's variants out of `petVariants.json`, or `undefined` when the file has no entry for its model. */
export const petModelVariants = (
	variants: PetVariantsJson,
	pet: Pick<PetRow, 'modelKey'>,
): PetModelVariants | undefined => variants.models[pet.modelKey]

/* -------------------------------------------------------------------------------------------------
 * WeaponPaints: wp_player_pets
 *
 *   CREATE TABLE IF NOT EXISTS wp_player_pets (
 *     steamid     VARCHAR(18)  NOT NULL PRIMARY KEY,   -- one pet per player; pets are "noteam"
 *     pet_id      INT          NOT NULL,               -- pet_definitions id
 *     pet_stage   TINYINT      NOT NULL DEFAULT 3,     -- upgrade level: 0 egg, 1 chick, 2 pullet, 3 hen
 *     pet_variant INT          NULL,                   -- item style = material group index; NULL = no style, the default group
 *     pet_seed    INT UNSIGNED NOT NULL DEFAULT 0,     -- the "pet seed" attribute
 *     pet_name    VARCHAR(32)  NULL                    -- name tag for the current stage
 *   )
 *
 * The table belongs to SkinHub's WeaponPaints fork, so the columns are fixed by the plugin, the
 * same way `wp_player_skins` fixes the sticker column format in `./placement.ts`. `steamid` is not
 * part of the row here: it is the key the writer already holds, not a property of the pet.
 * ---------------------------------------------------------------------------------------------- */

export const WP_PETS_TABLE = 'wp_player_pets'

/** The columns `formatPetRow` fills and `parsePetRow` reads, in table order after `steamid`. */
export const PET_ROW_COLUMNS = ['pet_id', 'pet_stage', 'pet_variant', 'pet_seed', 'pet_name'] as const

/** `VARCHAR(32)` counts characters (code points), not bytes. */
export const PET_NAME_MAX_LENGTH = 32

/**
 * A pet as a site holds it for the `wp_player_pets` row. The field names follow the shared contract,
 * so the pet is `petId` here; the viewer's `pet` subject (`ViewerPetSubject` in the viewer package)
 * calls the same value `id`, and has no `name` - map `{ id: petId, stage, variant, petSeed }` across.
 */
export type PetSelection = {
	/** The `pet_definitions` id. */
	petId: number
	stage: PetStage
	/** The item's style: a material group index, or `null` for no style (the model's default group). The seed never picks the colour. */
	variant: number | null
	/** The `pet seed` attribute, uint32. */
	petSeed: number
	/** The name tag for the current stage, or `null`. */
	name: string | null
}

/** What `formatPetRow` accepts: only the pet and its stage are required. */
export type PetSelectionInput = Pick<PetSelection, 'petId' | 'stage'> & Partial<Omit<PetSelection, 'petId' | 'stage'>>

/** One `wp_player_pets` row without its `steamid` key - column names verbatim. */
export type WeaponPaintsPetRow = {
	pet_id: number
	pet_stage: number
	pet_variant: number | null
	pet_seed: number
	pet_name: string | null
}

/** `pet_seed` is `INT UNSIGNED`, and the plugin reads it with `Convert.ToUInt32`. */
const UINT32_MAX = 4294967295
/**
 * `pet_id` and `pet_variant` are plain signed `INT`, and the plugin reads them with `Convert.ToInt32`.
 * Strict MySQL refuses a larger value (ERROR 1264) and a non-strict one stores this instead.
 */
const INT32_MAX = 2147483647

/** A non-negative integer no larger than `max` - never negative, fractional or exponent-formatted. */
const clampInt = (value: number, max: number) =>
	Number.isFinite(value) ? Math.min(max, Math.max(0, Math.trunc(value))) : 0
const int32 = (value: number) => clampInt(value, INT32_MAX)
const uint32 = (value: number) => clampInt(value, UINT32_MAX)

/** A database driver hands a column back as a number, a numeric string or a bigint. */
const columnNumber = (value: unknown): number | null => {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null
	if (typeof value === 'bigint') return Number(value)
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value)
		return Number.isFinite(parsed) ? parsed : null
	}
	return null
}

/**
 * What the plugin's `SanitizePetName` strips: control characters (`char.IsControl` is exactly
 * Unicode `Cc`), and `{ } < >`, which its chat colour tags and centre-HTML image would read as markup.
 */
const PET_NAME_STRIPPED = /[\p{Cc}{}<>]/gu

/**
 * .NET's `string.Trim()`: `char.IsWhiteSpace`, which with `Cc` already gone is Unicode `Z*`. Not JS
 * `trim`, which also eats U+FEFF - a character the plugin keeps.
 */
const trimLikeDotNet = (text: string) => text.replace(/^\p{Z}+|\p{Z}+$/gu, '')

/**
 * User-perceived characters - `StringInfo.GetTextElementEnumerator`, extended grapheme clusters -
 * so a cut never splits a ZWJ emoji sequence, a flag or a letter from its accent. Code points where
 * the runtime has no `Intl.Segmenter` (Firefox before 125, Node before 16).
 */
const textElements = (text: string): string[] => {
	if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
		return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), part => part.segment)
	}
	return Array.from(text)
}

/**
 * A name as the WeaponPaints plugin stores and shows it - a line-for-line port of `SanitizePetName`
 * in its `Pets.cs`, so the site and the game write the same string for the same input:
 *
 * 1. control characters and `{ } < >` removed, then trimmed;
 * 2. whole text elements kept while the total stays within the column's 32 code points (the
 *    `VARCHAR(32)` counts code points) - the first element that does not fit ends the name;
 * 3. trimmed again, and `null` when nothing is left.
 *
 * Cutting rather than throwing matches what a non-strict MySQL does with an over-long string, so the
 * row the writer thinks it wrote is the row the table holds. The in-game rename box stops at 20.
 *
 * *** 32 CODE POINTS CAN STILL BE MORE THAN AN INSPECT LINK CAN READ BACK. *** The codec checks a
 * name in UTF-16 units on encode and in UTF-8 bytes (100) on decode - upstream's asymmetry, kept on
 * purpose in `./codec.ts`. 32 four-byte emoji are 128 bytes: `buildInspectUrl` writes them and
 * `readInspectUrl` refuses the link. Only a pasted-in name gets there; the game's own box cannot.
 */
export const normalizePetName = (name: string | null | undefined): string | null => {
	if (typeof name !== 'string') return null
	const clean = trimLikeDotNet(name.replace(PET_NAME_STRIPPED, ''))

	let kept = ''
	let codePoints = 0
	for (const element of textElements(clean)) {
		const size = Array.from(element).length
		if (codePoints + size > PET_NAME_MAX_LENGTH) break
		kept += element
		codePoints += size
	}

	const result = trimLikeDotNet(kept)
	return result === '' ? null : result
}

/**
 * A selection -> the `wp_player_pets` columns.
 *
 * Every number is quantised onto its column's own range - non-negative and integral, at most
 * 2147483647 for the signed `INT` columns `pet_id` and `pet_variant` and 4294967295 for the
 * `INT UNSIGNED` `pet_seed` - for the same reason `makeSkinPlacement` does it: the plugin drops a
 * value it cannot parse rather than failing loudly, and MySQL refuses or silently caps one that does
 * not fit. An unknown stage string falls back to the column default (hen). A `variant` that is
 * absent, negative or not a number is `NULL`, which means "no style": the default colour group.
 *
 * **`null` in, `null` out: no pet means DELETE the row.** "No pet" is the absence of a row - the
 * plugin deletes it on `!pet off` - so there is no row to format, and this is the inverse of
 * `parsePetRow` answering `null` for a missing row. A writer does
 * `const row = formatPetRow(selection); row ? upsert(steamid, row) : remove(steamid)`.
 *
 * **Throws for a `petId` below 1.** `pet_id` is `NOT NULL` and 0 names no pet; a selection that
 * claims a pet and names none is a bug, and writing a row that means nothing would hide it in game.
 */
export function formatPetRow(selection: PetSelectionInput): WeaponPaintsPetRow
export function formatPetRow(selection: null | undefined): null
export function formatPetRow(selection: PetSelectionInput | null | undefined): WeaponPaintsPetRow | null
export function formatPetRow(selection: PetSelectionInput | null | undefined): WeaponPaintsPetRow | null {
	if (selection === null || selection === undefined) return null
	const pet_id = int32(selection.petId)
	if (pet_id < 1) throw new RangeError(`petId must be a pet_definitions id (1 or more), got ${selection.petId}`)

	const variant = selection.variant
	return {
		pet_id,
		pet_stage: petLevelForStage(selection.stage) ?? (petLevelForStage(DEFAULT_PET_STAGE) as number),
		pet_variant: typeof variant === 'number' && Number.isFinite(variant) && variant >= 0 ? int32(variant) : null,
		pet_seed: uint32(selection.petSeed ?? 0),
		pet_name: normalizePetName(selection.name),
	}
}

/**
 * A `wp_player_pets` row -> a selection, or `null` when there is no usable pet in it (no row, or a
 * `pet_id` below 1). Accepts whatever the driver returned: numbers, numeric strings or bigints.
 *
 * `parsePetRow(formatPetRow(x))` is `x` normalised, and `formatPetRow(parsePetRow(row))` is `row`
 * for every row `formatPetRow` can produce - `test/pets.test.ts` holds both directions.
 */
export const parsePetRow = (
	row: Partial<Record<keyof WeaponPaintsPetRow, unknown>> | null | undefined,
): PetSelection | null => {
	if (!row) return null
	const petId = columnNumber(row.pet_id)
	if (petId === null || int32(petId) < 1) return null

	const level = columnNumber(row.pet_stage)
	const variant = columnNumber(row.pet_variant)
	return {
		petId: int32(petId),
		stage: (level === null ? null : petStageForLevel(Math.trunc(level))) ?? DEFAULT_PET_STAGE,
		variant: variant === null || variant < 0 ? null : int32(variant),
		petSeed: uint32(columnNumber(row.pet_seed) ?? 0),
		name: normalizePetName(typeof row.pet_name === 'string' ? row.pet_name : null),
	}
}
