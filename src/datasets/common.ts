/**
 * Types shared by more than one dataset.
 *
 * Every union here is written **open** — `'rare' | 'mythical' | … | (string & {})`. That form
 * autocompletes to the values actually present in the current export while still accepting a value
 * Valve adds tomorrow. A closed union would turn a new rarity token into a compile error in every
 * consumer, which is not what a data package should do to its users; a bare `string` would tell
 * them nothing.
 */

/** Lets a union autocomplete without closing the set. */
export type Open<T extends string> = T | (string & {})

/**
 * The raw `items_game` rarity token, lowercase.
 *
 * Measured across the current export: `stickers.json` uses all seven listed below,
 * `collectibles.json` and `keychains.json` five, `agents.json` five, and `music.json` has `null`
 * on every row. `uncommon` and `contraband` exist in `items_game` but appear on no row of any list
 * — they are here because the weapon rarity ids do carry them.
 */
export type RarityToken = Open<
	'common' | 'uncommon' | 'rare' | 'mythical' | 'legendary' | 'ancient' | 'immortal' | 'contraband'
>

/**
 * An absolute URL on the CDN, **or the empty string**.
 *
 * `''` is deliberate and load-bearing: the exporter emits it when Valve ships no icon for a row,
 * rather than a URL that would 404. It is not a bug to be normalised away, and it is common enough
 * to matter — 643 of 11,788 stickers, 190 of 715 collectibles, 56 collection icons and 16 crate
 * icons. Check for it before putting the value in an `<img src>`.
 */
export type ImageUrl = Open<''>
