/**
 * Runtime validators that mirror the exported types, field for field.
 *
 * These exist so `types.test.ts` can make a claim it can actually check: that the types describe
 * the bytes the exporter publishes. A type is a compile-time assertion about data nobody compiled,
 * so without something like this "the types match" is an opinion.
 *
 * Two properties make the check able to FAIL, which is the only reason it is worth running:
 *
 *   - **Unknown keys are errors.** If the exporter adds a field, the type is now incomplete and the
 *     test says so, rather than silently passing because extra data is structurally compatible.
 *   - **Optional and nullable are distinguished.** `skins.json` has both — `pattern` is `null` on
 *     the 20 vanilla rows while `wears` is an *absent key* on those same rows — and a validator
 *     that treated them alike would accept either type for either field.
 *
 * Hand-rolled rather than zod: a schema library in `dependencies` for a test is a cost every
 * consumer pays, and in `devDependencies` it would still be a second description of the same
 * shapes that can drift from the first.
 */

export type Issue = string

type Check = (value: unknown, path: string, issues: Issue[]) => void

const typeName = (value: unknown) =>
	value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value

const fail = (issues: Issue[], path: string, expected: string, value: unknown) => {
	const shown = typeof value === 'string' ? JSON.stringify(value.slice(0, 40)) : JSON.stringify(value)
	issues.push(`${path}: expected ${expected}, got ${typeName(value)} ${String(shown).slice(0, 60)}`)
}

export const str: Check = (v, p, i) => {
	if (typeof v !== 'string') fail(i, p, 'string', v)
}

export const num: Check = (v, p, i) => {
	if (typeof v !== 'number' || !Number.isFinite(v)) fail(i, p, 'finite number', v)
}

export const bool: Check = (v, p, i) => {
	if (typeof v !== 'boolean') fail(i, p, 'boolean', v)
}

/** Any JSON value. Used for `items_game`, whose interior is deliberately not modelled. */
export const unknownValue: Check = () => {}

export const nullable =
	(check: Check): Check =>
	(v, p, i) => {
		if (v === null) return
		check(v, p, i)
	}

export const union =
	(...checks: Check[]): Check =>
	(v, p, i) => {
		for (const check of checks) {
			const local: Issue[] = []
			check(v, p, local)
			if (local.length === 0) return
		}
		fail(i, p, 'one of the permitted types', v)
	}

export const oneOf =
	(...allowed: readonly (string | number | boolean)[]): Check =>
	(v, p, i) => {
		if (!allowed.includes(v as string)) fail(i, p, `one of ${allowed.map(a => JSON.stringify(a)).join(' | ')}`, v)
	}

export const arrayOf =
	(check: Check): Check =>
	(v, p, i) => {
		if (!Array.isArray(v)) return fail(i, p, 'array', v)
		v.forEach((item, index) => check(item, `${p}[${index}]`, i))
	}

/** A record whose values all satisfy `check`. Keys are unconstrained. */
export const recordOf =
	(check: Check): Check =>
	(v, p, i) => {
		if (v === null || typeof v !== 'object' || Array.isArray(v)) return fail(i, p, 'object', v)
		for (const [key, value] of Object.entries(v)) check(value, `${p}.${key}`, i)
	}

export type Shape = {
	/** Keys that must be present. */
	required: Record<string, Check>
	/** Keys that may be absent entirely. Present-but-null is only OK if the check allows it. */
	optional?: Record<string, Check>
}

export const obj =
	(shape: Shape): Check =>
	(v, p, i) => {
		if (v === null || typeof v !== 'object' || Array.isArray(v)) return fail(i, p, 'object', v)
		const row = v as Record<string, unknown>

		for (const [key, check] of Object.entries(shape.required)) {
			if (!(key in row)) {
				i.push(`${p}.${key}: required key is missing`)
				continue
			}
			check(row[key], `${p}.${key}`, i)
		}

		for (const [key, check] of Object.entries(shape.optional ?? {})) {
			if (!(key in row)) continue
			check(row[key], `${p}.${key}`, i)
		}

		const known = new Set([...Object.keys(shape.required), ...Object.keys(shape.optional ?? {})])
		for (const key of Object.keys(row)) {
			if (!known.has(key)) i.push(`${p}.${key}: unknown key — the exported type does not describe it`)
		}
	}

/** Runs a check over a whole file and returns every problem found, capped so output stays readable. */
export const validate = (check: Check, value: unknown, label: string, cap = 25): Issue[] => {
	const issues: Issue[] = []
	check(value, label, issues)
	return issues.length > cap ? [...issues.slice(0, cap), `… and ${issues.length - cap} more`] : issues
}

/* ---------------------------------------------------------------------------------------------
 * The shapes, one per exported type.
 * ------------------------------------------------------------------------------------------ */

/** `RarityToken` is an open union, so at runtime it is any string — but never `undefined`. */
const rarityToken = str

const namedIcon = obj({ required: { id: str, name: str, image: str } })

export const skinShape = obj({
	required: {
		id: str,
		name: str,
		description: str,
		weapon: obj({ required: { id: str, weapon_id: num, name: str } }),
		category: obj({ required: { id: str, name: str } }),
		pattern: nullable(obj({ required: { id: str, name: str } })),
		min_float: nullable(num),
		max_float: nullable(num),
		rarity: obj({ required: { id: str, name: str, color: str } }),
		stattrak: bool,
		paint_index: nullable(str),
		crates: arrayOf(namedIcon),
		team: obj({ required: { id: oneOf('both', 'terrorists', 'counter-terrorists'), name: str } }),
		legacy_model: bool,
		image: str,
		original: obj({ required: { name: str } }),
	},
	optional: {
		souvenir: bool,
		wears: arrayOf(obj({ required: { id: str, name: str } })),
		collections: arrayOf(namedIcon),
		phase: str,
	},
})

export const stickerShape = obj({
	required: {
		id: str,
		name: str,
		image: str,
		rarity: nullable(rarityToken),
		description: nullable(str),
		material: str,
		is_patch: bool,
		tournament_event_id: nullable(num),
		tournament_team_id: nullable(num),
		tournament_player_id: nullable(num),
	},
})

/** The five fields `keychains.json` and `music.json` share. `collectibles.json` adds `model`. */
const namedRow = {
	id: str,
	name: str,
	image: str,
	rarity: nullable(rarityToken),
	description: nullable(str),
}

export const collectibleShape = obj({ required: { ...namedRow, model: nullable(str) } })

export const keychainShape = obj({ required: namedRow })
export const musicKitShape = keychainShape

export const gloveShape = obj({
	required: { weapon_defindex: num, paint: union(str, num), image: str, paint_name: str },
})

export const agentShape = obj({
	required: {
		team: oneOf(2, 3),
		image: str,
		model: str,
		agent_name: str,
		id: nullable(str),
		rarity: nullable(rarityToken),
		description: nullable(str),
	},
})

export const itemsGameShape = obj({ required: { items_game: recordOf(unknownValue) } })
