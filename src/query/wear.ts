/**
 * Exteriors — the five wear tiers, their float boundaries, and the two directions between them.
 *
 * ## Why the boundaries are here and not read from the data
 *
 * They are not in `items_game.json`. Measured against the current export, the strings `0.07`,
 * `0.15`, `0.38` and `0.45` appear **zero** times in that 6.5 MB file; the tier cut points live in
 * the CS2 client, not in the schema Valve ships. So a package that wants to turn a `paintwear`
 * float into the word a marketplace prints has to carry them.
 *
 * They are still *checked* against the data rather than asserted. Every `skins.json` row that has a
 * `wears` array also has a `min_float`/`max_float` pair, and the set of tiers those bounds overlap
 * has to be exactly the `wears` array the exporter wrote. It is, on **2,106 of 2,106 rows with 0
 * mismatches** — see `test/query-wear.test.ts`, which recomputes it from the fixture rather than
 * trusting this comment.
 *
 * ## The half-open interval, and the one row it matters for
 *
 * A tier is `[min, max)` — `max` exclusive — except Battle-Scarred, which is `[0.45, 1]` closed so
 * that a float of exactly `1` has somewhere to go. Without that, the 19 rows whose `max_float` is
 * `1` would fall out of every tier at their worst possible float.
 */

/** `SFUI_InvTooltip_Wear_Amount_0` … `_4`, in ascending wear order. */
export type WearTierId =
	| 'SFUI_InvTooltip_Wear_Amount_0'
	| 'SFUI_InvTooltip_Wear_Amount_1'
	| 'SFUI_InvTooltip_Wear_Amount_2'
	| 'SFUI_InvTooltip_Wear_Amount_3'
	| 'SFUI_InvTooltip_Wear_Amount_4'

/** The exterior exactly as a Steam `market_hash_name` spells it. */
export type WearName = 'Factory New' | 'Minimal Wear' | 'Field-Tested' | 'Well-Worn' | 'Battle-Scarred'

/** The two-letter form marketplaces put next to a skin name. */
export type WearShort = 'FN' | 'MW' | 'FT' | 'WW' | 'BS'

export type WearTier = {
	/** The `id` on a `Skin['wears']` entry, so the two join without a lookup table. */
	id: WearTierId
	/** `Factory New` — what goes in the parentheses of a market hash name. */
	name: WearName
	short: WearShort
	/** Inclusive. */
	min: number
	/** Exclusive, except on Battle-Scarred where it is inclusive so `1` lands somewhere. */
	max: number
}

/** The five tiers, ascending. Index equals the numeric suffix on `WearTierId`. */
export const WEAR_TIERS: readonly WearTier[] = [
	{ id: 'SFUI_InvTooltip_Wear_Amount_0', name: 'Factory New', short: 'FN', min: 0, max: 0.07 },
	{ id: 'SFUI_InvTooltip_Wear_Amount_1', name: 'Minimal Wear', short: 'MW', min: 0.07, max: 0.15 },
	{ id: 'SFUI_InvTooltip_Wear_Amount_2', name: 'Field-Tested', short: 'FT', min: 0.15, max: 0.38 },
	{ id: 'SFUI_InvTooltip_Wear_Amount_3', name: 'Well-Worn', short: 'WW', min: 0.38, max: 0.45 },
	{ id: 'SFUI_InvTooltip_Wear_Amount_4', name: 'Battle-Scarred', short: 'BS', min: 0.45, max: 1 },
] as const

/** Anything that names an exterior: the tier, its name, its short form, or its `wears[].id`. */
export type WearLike = WearTier | WearName | WearShort | WearTierId | (string & {})

/**
 * The tier a float falls into. Never `undefined` — a float below 0 clamps to Factory New and one
 * above 1 to Battle-Scarred, because a caller handing this a value out of range wants a tier back,
 * not a crash.
 */
export const wearTierForFloat = (float: number): WearTier => {
	// Reverse scan, so the closed upper bound on Battle-Scarred needs no special case.
	for (let index = WEAR_TIERS.length - 1; index > 0; index--) {
		const tier = WEAR_TIERS[index]
		if (tier && float >= tier.min) return tier
	}
	return WEAR_TIERS[0] as WearTier
}

/** The tier a name refers to, by `name`, `short` or `wears[].id`. Case-insensitive on the first two. */
export const wearTier = (wear: WearLike | null | undefined): WearTier | undefined => {
	if (!wear) return undefined
	if (typeof wear === 'object') return WEAR_TIERS.find(tier => tier.id === wear.id)
	const needle = wear.trim()
	const lower = needle.toLowerCase()
	return WEAR_TIERS.find(
		tier => tier.id === needle || tier.name.toLowerCase() === lower || tier.short.toLowerCase() === lower,
	)
}
