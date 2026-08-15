/**
 * Rarity, ranked.
 *
 * Sorting a picker by grade is the single most common thing a marketplace does with this data, and
 * it is the one thing the exported rows cannot do on their own: `Skin['rarity']` is
 * `{ id, name, color }` with no ordinal, and the other six lists carry a bare `RarityToken` word.
 * Two different spellings of the same ladder, neither of them sortable.
 *
 * ## The ranks are Valve's, not invented here
 *
 * `items_game.json` has a `rarities` section, and every entry in it carries a `value`. Measured on
 * the current export, all nine: `default` 0, `common` 1, `uncommon` 2, `rare` 3, `mythical` 4,
 * `legendary` 5, `ancient` 6, `immortal` 7 — and `unusual` **99**, a sentinel far above the ladder
 * that no row of any exported list actually uses. That is the table below, and `test/query.test.ts`
 * reads it back out of the real `items_game.json` rather than taking this comment's word for it.
 *
 * ## The one join that is not mechanical
 *
 * A weapon's `rarity.id` is built from the *localisation* key, not the token — `rarity_ancient` and
 * `rarity_ancient_weapon` are both the `ancient` rung. That mapping is almost "strip `rarity_`, strip
 * `_weapon`", and it is exactly once not: `rarity_contraband_weapon` is the `immortal` rung, because
 * Valve named the token and the loc key differently. Hard-coding the nine ids the export actually
 * uses is what keeps that from being a silent off-by-one; the generic strip is only the fallback for
 * an id nobody has seen yet.
 */

import type { RarityToken } from '../datasets/common.js'

/**
 * The rungs of `items_game.rarities`, ascending. `immortal` is what the UI calls Contraband.
 *
 * `99` is `unusual`, and it is Valve's number, not a sentinel invented here. Nothing in the seven
 * exported lists carries it, so in practice a sort only ever sees 0-7 — but the value is left alone
 * rather than squashed to 8, because the moment Valve does ship an unusual item, a rank that lied
 * about the gap would sort it into the middle of the ladder.
 */
export type RarityRank = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 99

/** Token → rank, straight out of `items_game.rarities[*].value`. */
export const RARITY_RANKS: Record<string, RarityRank> = {
	default: 0,
	common: 1,
	uncommon: 2,
	rare: 3,
	mythical: 4,
	legendary: 5,
	ancient: 6,
	immortal: 7,
	unusual: 99,
	// Not a rung of its own — the word the UI prints for `immortal`. Accepted so a caller that
	// reads the ladder off a UI label lands on the same number.
	contraband: 7,
}

/**
 * The nine `Skin['rarity'].id` values the current export uses, mapped to the same ladder.
 *
 * Counted across 2,161 rows: ancient_weapon 687, rare_weapon 446, mythical_weapon 311,
 * uncommon_weapon 204, common_weapon 200, legendary_weapon 183, `rarity_ancient` 94 (that is every
 * glove), default_weapon 35 (that is every vanilla gun), contraband_weapon 1.
 */
export const WEAPON_RARITY_RANKS: Record<string, RarityRank> = {
	rarity_default_weapon: 0,
	rarity_common_weapon: 1,
	rarity_uncommon_weapon: 2,
	rarity_rare_weapon: 3,
	rarity_mythical_weapon: 4,
	rarity_legendary_weapon: 5,
	rarity_ancient_weapon: 6,
	rarity_ancient: 6,
	rarity_contraband_weapon: 7,
}

/**
 * A `rarity` object as `skins.json` writes it — `{ id, name, color }`.
 *
 * Spelled out here rather than imported as `SkinRarity` so this module stays a leaf, and **all three
 * fields are required on purpose**. See the note on `RarityLike`.
 */
export type RarityObject = { id: string; name: string; color: string }

/** A row that carries a rarity: a `Skin`, a `Sticker`, an `Agent`, a `Keychain`, a `MusicKit`. */
export type RarityBearer = { rarity: RarityObject | string | null | undefined }

/**
 * Anything that names a rung.
 *
 * Four accepted shapes: a token or `rarity.id` string, a whole `{ id, name, color }` rarity, **a row
 * that carries one**, or `null`/`undefined`.
 *
 * ## Why the object arm demands `name` and `color`
 *
 * It used to be `{ id: string }`, and that was a trap with the worst possible failure shape.
 * `Skin` has an `id` — `skin-b2a5203033ee` — so `compareByRarity(skinA, skinB)` typechecked, looked
 * exactly right, and returned **0 for every pair**: neither row id ranks, both come back
 * `undefined`, and the sort silently became a no-op. No error, no warning, a plausible-looking
 * output. Zero is indistinguishable from an answer.
 *
 * Two changes close it. The `RarityBearer` arm is checked **first**, so passing a whole row now does
 * the obviously-intended thing and reads its `.rarity`. And the bare-object arm was narrowed to the
 * full `{ id, name, color }` shape, which only a real rarity satisfies — so `NamedGroup`,
 * `SkinCollection` and `SkinCrate`, all of which are `{ id, name, … }`, are now compile errors here
 * instead of silent zeroes.
 */
export type RarityLike = RarityToken | string | RarityObject | RarityBearer | null | undefined

const rankOfId = (id: string): RarityRank | undefined => {
	const direct = WEAPON_RARITY_RANKS[id] ?? RARITY_RANKS[id]
	if (direct !== undefined) return direct

	// An id Valve added after this was written. Strip the shape the other nine share and try again.
	return RARITY_RANKS[id.replace(/^rarity_/, '').replace(/_(weapon|character)$/, '')]
}

/**
 * The rung, or `undefined` when the value names nothing on the ladder.
 *
 * Takes a rarity **or the row that carries one** — `rarityRank(skin)` and `rarityRank(skin.rarity)`
 * agree, and so do `rarityRank(sticker)` and `rarityRank(sticker.rarity)`.
 *
 * `undefined` and not `-1`: `music.json` has `rarity: null` on all 101 rows, and a caller sorting
 * that list needs to be able to tell "no rarity" from "the lowest rarity". A number would hide it.
 */
export const rarityRank = (rarity: RarityLike): RarityRank | undefined => {
	if (rarity === null || rarity === undefined) return undefined
	if (typeof rarity === 'string') return rarity ? rankOfId(rarity) : undefined

	// A row that carries a rarity wins over anything else on the object — a `Sticker` has BOTH an
	// `id` (its own, `'1'`) and a `rarity`, and reading the id would rank the sticker number.
	if ('rarity' in rarity) return rarityRank(rarity.rarity)

	return rankOfId(rarity.id)
}

/**
 * Ascending comparator — Consumer Grade first, Contraband last. Rows with no rank sort to the front.
 *
 * Pass the rows themselves; it reads their `.rarity` for you.
 *
 * ```ts
 * skins.sort(compareByRarity)                        // commonest first
 * skins.sort((a, b) => compareByRarity(b, a))        // rarest first
 * stickers.sort(compareByRarity)                     // same call, different list
 * skins.sort((a, b) => compareByRarity(b.rarity, a.rarity)) // also fine — identical result
 * ```
 *
 * `skins.sort(compareByRarity)` used to compile and sort **nothing**, silently — see the note on
 * `RarityLike` for what changed and why that failure shape is the one worth engineering against.
 */
export const compareByRarity = (a: RarityLike, b: RarityLike): number =>
	(rarityRank(a) ?? -1) - (rarityRank(b) ?? -1)
