/**
 * `market_hash_name` — the only identifier that joins this data to Steam.
 *
 * A marketplace holds Steam's string. This package holds Valve's rows. Neither side publishes the
 * other's key: `skins.json` has no `market_hash_name` column, and Steam publishes no defindex or
 * paint index on a listing. So the join has to be built, and it has to be built exactly, because
 * the two failure modes are indistinguishable from the outside — a name assembled in the wrong
 * order returns no listings, which looks precisely like an item nobody is selling.
 *
 * ## The composition, and where it comes from
 *
 * ```
 * [Souvenir ][★ ][StatTrak™ ]<name>[ (<exterior>)]
 * ```
 *
 * The `★` is **already in `skin.name`** — measured: all 670 melee and glove rows start with `★ `,
 * no non-melee row does, and no melee or glove row lacks it. So StatTrak™ has to be *inserted after*
 * the star, not prefixed to the whole thing: `★ StatTrak™ Karambit | Doppler (Factory New)`, never
 * `StatTrak™ ★ Karambit …`.
 *
 * That ordering is not guessed. Steam's own market endpoints rate-limit hard enough that they could
 * not be used as a reference here (every request 429'd), so it is taken from two independent pieces
 * of production code that parse **real** `description.market_hash_name` strings out of live Steam
 * inventory responses — one strips `/^★ StatTrak™ /`, the other peels `Souvenir`, then `★`, then
 * `StatTrak™`, in that order. Two codebases, same conclusion, both against real Steam bytes.
 *
 * ## `skin.souvenir` does not mean a Souvenir variant exists
 *
 * This is the trap in the raw data and the reason `canBeSouvenir` exists.
 *
 * `souvenir` is `true` on **1,456 of 2,161 rows**, including `AK-47 | Asiimov`, `AK-47 | Redline`
 * and `M4A4 | Howl` — none of which has ever had a Souvenir version. Worse, **698 rows have both
 * `stattrak: true` and `souvenir: true`**, and no real CS2 item is both. The flag describes what the
 * item's prefab permits, not what Valve ever shipped.
 *
 * The signal that does hold is the drop source. Measured: **319 rows drop from a crate whose name
 * ends `Souvenir Package`; all 319 also have `souvenir: true`, and exactly 0 of them have
 * `stattrak: true`.** Mutually exclusive, as the real items are. `canBeSouvenir` uses that, and
 * `marketHashNames` enumerates from it — so it emits ~319 Souvenir keys rather than 1,456, of which
 * roughly 1,100 would have matched nothing on Steam.
 */

import type { Skin, Skins } from '../datasets/skins.js'
import { paintIndexOf, wearsOf } from './skins.js'
import { type WearLike, type WearTier, wearTier } from './wear.js'

/** Steam spells it with the trademark sign. Anything else is a different, non-existent listing. */
export const STATTRAK_PREFIX = 'StatTrak™ '
export const SOUVENIR_PREFIX = 'Souvenir '
/** U+2605 BLACK STAR, then a space. Already present on every melee and glove `name`. */
export const STAR_PREFIX = '★ '

export type MarketHashNameOptions = {
	/** Which exterior. Required for a finish that has any; ignored for the 55 that have none. */
	wear?: WearLike | null
	stattrak?: boolean
	souvenir?: boolean
}

/**
 * `true` when the row can exist as StatTrak™.
 *
 * Straight off `skin.stattrak`, which spot-checks correct where the `souvenir` flag does not:
 * `M4A4 | Howl` true, `AWP | Dragon Lore` false, `Desert Eagle | Blaze` false, `Glock-18 | Fade`
 * false — all four match the market. 1,274 of 2,161 rows.
 *
 * No glove is StatTrak (measured: 0 of 94). Vanilla knives are (all 20).
 */
export const canBeStatTrak = (skin: Skin): boolean => skin.stattrak

/**
 * `true` when a Souvenir variant actually exists — derived from the drop source, not from
 * `skin.souvenir`.
 *
 * See the note at the top of this file: the raw flag is true on 1,456 rows and contradicts
 * `stattrak` on 698 of them. This is true on 319, and disjoint from `canBeStatTrak` on every one.
 */
export const canBeSouvenir = (skin: Skin): boolean =>
	skin.souvenir === true && skin.crates.some(crate => /souvenir/i.test(crate.name))

/**
 * `true` when the row has no Steam listing at all: the 35 vanilla guns.
 *
 * They are `rarity_default_weapon` — measured, exactly 35 rows, and every one of them carries
 * `paint_index: '0'`. `Desert Eagle | Default` is a loadout state, not an item; it has no market
 * hash name and never had one. Note this does **not** cover the 20 vanilla knives, which are
 * `rarity_ancient_weapon` and do sell, as `★ Bayonet`.
 */
export const isUntradable = (skin: Skin): boolean => skin.rarity.id === 'rarity_default_weapon'

/**
 * The Steam `market_hash_name` for one variant of a row, or `null` when that variant does not exist.
 *
 * `null` is returned — rather than a string nobody can look up — when:
 *   - the row is one of the 35 vanilla guns (no listing exists at any wear);
 *   - `stattrak` was asked for and `canBeStatTrak` is false;
 *   - `souvenir` was asked for and `canBeSouvenir` is false;
 *   - both `stattrak` and `souvenir` were asked for (no CS2 item is both);
 *   - the finish has exteriors and `wear` was missing, unrecognised, or one this finish cannot
 *     reach — `AK-47 | Asiimov` has no Factory New variant below its `min_float`, and asking for
 *     one should not produce a key that returns an empty listing page.
 *
 * ```ts
 * marketHashName(asiimov, { wear: 'Field-Tested' })                    // 'AK-47 | Asiimov (Field-Tested)'
 * marketHashName(asiimov, { wear: 'FT', stattrak: true })              // 'StatTrak™ AK-47 | Asiimov (Field-Tested)'
 * marketHashName(doppler, { wear: 'FN', stattrak: true })              // '★ StatTrak™ Karambit | Doppler (Factory New)'
 * marketHashName(vanillaBayonet)                                       // '★ Bayonet'
 * marketHashName(defaultDeagle, { wear: 'FT' })                        // null
 * ```
 */
export const marketHashName = (skin: Skin, options: MarketHashNameOptions = {}): string | null => {
	if (isUntradable(skin)) return null

	const stattrak = options.stattrak === true
	const souvenir = options.souvenir === true
	if (stattrak && souvenir) return null
	if (stattrak && !canBeStatTrak(skin)) return null
	if (souvenir && !canBeSouvenir(skin)) return null

	const available = wearsOf(skin)
	let suffix = ''
	if (available.length > 0) {
		const tier = wearTier(options.wear ?? undefined)
		if (!tier || !available.some(candidate => candidate.id === tier.id)) return null
		suffix = ` (${tier.name})`
	}

	const star = skin.name.startsWith(STAR_PREFIX)
	const base = star ? skin.name.slice(STAR_PREFIX.length) : skin.name

	return `${souvenir ? SOUVENIR_PREFIX : ''}${star ? STAR_PREFIX : ''}${stattrak ? STATTRAK_PREFIX : ''}${base}${suffix}`
}

export type MarketVariant = {
	marketHashName: string
	wear: WearTier | null
	stattrak: boolean
	souvenir: boolean
}

/**
 * Every `market_hash_name` this row can be sold under.
 *
 * This is the catalogue-building call: run it over the list and you have the full set of Steam keys
 * to join a price feed or an inventory against, with the defindex and paint index still attached.
 *
 * A five-exterior finish that is StatTrak-able yields 10 variants; a vanilla knife yields 2
 * (`★ Bayonet`, `★ StatTrak™ Bayonet`); a vanilla gun yields none. Over the whole export it emits
 * 16,067 variants across 15,455 distinct keys — 4,984 StatTrak™, 1,482 Souvenir.
 *
 * Phase-sharing rows each yield the same strings on purpose. All 7 `★ Bayonet | Doppler` rows
 * produce `★ Bayonet | Doppler (Factory New)` because Steam sells all 7 phases under that one key —
 * see `skinsByName` for why a market hash name identifies a listing, not an item.
 */
export const marketHashNames = (skin: Skin): MarketVariant[] => {
	if (isUntradable(skin)) return []

	const wears: (WearTier | null)[] = wearsOf(skin)
	const tiers = wears.length > 0 ? wears : [null]
	const qualities: { stattrak: boolean; souvenir: boolean }[] = [{ stattrak: false, souvenir: false }]
	if (canBeStatTrak(skin)) qualities.push({ stattrak: true, souvenir: false })
	if (canBeSouvenir(skin)) qualities.push({ stattrak: false, souvenir: true })

	const variants: MarketVariant[] = []
	for (const quality of qualities) {
		for (const tier of tiers) {
			const name = marketHashName(skin, { wear: tier, ...quality })
			if (name) variants.push({ marketHashName: name, wear: tier, ...quality })
		}
	}
	return variants
}

export type ParsedMarketHashName = {
	/** Everything but the badges, the star and the exterior: `AK-47 | Asiimov`, `Karambit | Doppler`. */
	base: string
	/** `base` with the `★ ` put back — this is what `Skin['name']` holds. */
	name: string
	/** The part before the first ` | `, or `null` on a vanilla knife, which has no finish part. */
	weapon: string | null
	/** The finish on its own, or `null` on a vanilla knife. */
	finish: string | null
	wear: WearTier | null
	star: boolean
	stattrak: boolean
	souvenir: boolean
}

/**
 * Split a Steam market hash name back into its parts.
 *
 * The exterior is only stripped when the trailing parenthesis holds a **known** exterior, so names
 * whose own text ends in brackets survive intact — `Sticker | Titan (Holo)` keeps its `(Holo)`,
 * and a graffiti keeps its colour. That is the whole reason this does not just regex off the last
 * `(...)`.
 *
 * Tolerant on input: `StatTrak` without the trademark sign and any casing on the badges are
 * accepted, because that is what hand-typed and CSV-imported data looks like. Output is always the
 * canonical spelling.
 */
export const parseMarketHashName = (marketHashName: string): ParsedMarketHashName => {
	let rest = marketHashName.trim()

	const souvenir = /^souvenir\s+/i.test(rest)
	if (souvenir) rest = rest.replace(/^souvenir\s+/i, '')

	// The star comes off before StatTrak™ — Steam writes `★ StatTrak™ Karambit …`, never the reverse.
	const star = rest.startsWith('★')
	if (star) rest = rest.replace(/^★\s*/, '')

	const stattrak = /^stattrak™?\s+/i.test(rest)
	if (stattrak) rest = rest.replace(/^stattrak™?\s+/i, '')

	let wear: WearTier | null = null
	const trailing = /\(([^()]+)\)$/.exec(rest)
	if (trailing) {
		const tier = wearTier(trailing[1])
		if (tier) {
			wear = tier
			rest = rest.slice(0, trailing.index).trim()
		}
	}

	const separator = rest.indexOf(' | ')
	return {
		base: rest,
		name: star ? `${STAR_PREFIX}${rest}` : rest,
		weapon: separator === -1 ? null : rest.slice(0, separator),
		finish: separator === -1 ? null : rest.slice(separator + 3),
		wear,
		star,
		stattrak,
		souvenir,
	}
}

/**
 * The rows a Steam market hash name refers to.
 *
 * An array, and the length is the point. It is 1 for almost everything, and 5 or 7 for a Doppler or
 * Gamma Doppler — Steam sells every phase of `★ Bayonet | Doppler (Factory New)` under that single
 * key, so the name genuinely cannot tell you which of the 7 paint indexes you are holding. Only an
 * inspect link can; `findSkin` is the call that does. Measured across the export: 29 names collide
 * this way, covering 181 rows.
 *
 * Returns `[]` for a name whose exterior the finish cannot reach, so a bad join is visibly empty
 * rather than quietly wrong.
 */
export const skinsByMarketHashName = (skins: Skins, marketHashName: string): Skins => {
	const parsed = parseMarketHashName(marketHashName)
	const needle = parsed.name.toLowerCase()

	return skins.filter(skin => {
		if (skin.name.toLowerCase() !== needle) return false
		if (parsed.stattrak && !canBeStatTrak(skin)) return false
		if (parsed.souvenir && !canBeSouvenir(skin)) return false
		const available = wearsOf(skin)
		if (parsed.wear === null) return available.length === 0
		return available.some(tier => tier.id === parsed.wear?.id)
	})
}

/**
 * One row per Steam key, for building a join table.
 *
 * ```ts
 * const table = marketHashNameIndex(skins)
 * table.get('StatTrak™ AK-47 | Asiimov (Field-Tested)') // → { defindex: 7, paintindex: 801, … }
 * ```
 *
 * Where a key covers several phases the entry keeps all of them in `skins`, and `skin` is the first
 * — because a price is per listing, and a listing is per key. Measured on the current export:
 * 15,455 keys, of which 117 cover more than one row.
 */
export const marketHashNameIndex = (skins: Skins): Map<string, MarketVariant & { skin: Skin; skins: Skin[] }> => {
	const table = new Map<string, MarketVariant & { skin: Skin; skins: Skin[] }>()
	for (const skin of skins) {
		for (const variant of marketHashNames(skin)) {
			const existing = table.get(variant.marketHashName)
			if (existing) existing.skins.push(skin)
			else table.set(variant.marketHashName, { ...variant, skin, skins: [skin] })
		}
	}
	return table
}

/** Convenience: the paint index a market hash name resolves to, when it resolves to exactly one. */
export const paintIndexForMarketHashName = (skins: Skins, marketHashName: string): number | undefined => {
	const matches = skinsByMarketHashName(skins, marketHashName)
	return matches.length === 1 && matches[0] ? paintIndexOf(matches[0]) : undefined
}
