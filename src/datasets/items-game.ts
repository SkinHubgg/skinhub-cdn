/**
 * `data/items_game.json` — 6.5 MB. **Valve's own schema**, and the odd one out in two ways.
 *
 * 1. **It is not an array.** Every other list is a top-level `[…]`; this is
 *    `{ "items_game": { …33 sections… } }`. The extra nesting is the file's own, kept verbatim.
 * 2. **It is not modelled.** It is Valve's KeyValues converted to JSON — 33 sections, thousands of
 *    prefabs, every value a string or a nested object, with `"1"`/`"0"` for booleans and repeated
 *    blocks deep-merged. Writing an interface for it would be inventing structure that the file
 *    does not guarantee and that changes with every CS2 update. The known section names are typed
 *    so `data.items_game.paint_kits` autocompletes; the values are `unknown` so a consumer has to
 *    look before it leaps.
 *
 * It is also the only file that is presently **live on the CDN** — as of 2026-08-08 the other
 * seven are still uploading.
 *
 * At 6.5 MB it is the wrong thing to pull into a browser. Everything a client needs is already
 * flattened into the seven lists; this is here for servers and for the exporter's own tooling.
 */

import type { DatasetOptions } from '../fetch.js'
import { fetchCdnData } from '../fetch.js'
import type { Open } from './common.js'

/** The 33 sections present in the current export. Open — Valve adds and removes them. */
export type ItemsGameSection = Open<
	| 'game_info'
	| 'rarities'
	| 'qualities'
	| 'colors'
	| 'graffiti_tints'
	| 'player_loadout_slots'
	| 'alternate_icons2'
	| 'prefabs'
	| 'items'
	| 'attributes'
	| 'sticker_kits'
	| 'paint_kits'
	| 'paint_kits_rarity'
	| 'item_sets'
	| 'client_loot_lists'
>

/** A KeyValues node: a string leaf, or a block of them. */
export type KeyValuesNode = string | { [key: string]: KeyValuesNode }

export type ItemsGame = {
	items_game: Partial<Record<ItemsGameSection, Record<string, unknown>>> & Record<string, unknown>
}

/** `data/items_game.json`. */
export const ITEMS_GAME_FILE = 'items_game.json'

export const fetchItemsGame = (options: DatasetOptions<ItemsGame> = {}): Promise<ItemsGame> =>
	fetchCdnData<ItemsGame>(ITEMS_GAME_FILE, options)
