/**
 * `data/collectibles.json` — 715 rows, 212 KB. Pins, coins, medals, service trophies.
 *
 * Named after the file rather than after any one consumer's word for it (the API this replaces
 * calls the same list `PINS_COINS`).
 *
 * `description` is `null` on 116 rows; `image` is `''` on 190 — 27% of the file, mostly tournament
 * coins Valve ships no icon for at the exported path.
 */

import type { DatasetOptions } from '../fetch.js'
import { fetchCdnData } from '../fetch.js'
import type { ImageUrl, RarityToken } from './common.js'

export type Collectible = {
	/** A decimal string, `'874'`. Unique across the file. */
	id: string
	/** `5 Year Veteran Coin`. */
	name: string
	image: ImageUrl
	/** Non-null on every row of the current export, but nullable in the shared shape. */
	rarity: RarityToken | null
	description: string | null
}

export type Collectibles = Collectible[]

/** `data/collectibles.json`. */
export const COLLECTIBLES_FILE = 'collectibles.json'

export const fetchCollectibles = (options: DatasetOptions<Collectibles> = {}): Promise<Collectibles> =>
	fetchCdnData<Collectibles>(COLLECTIBLES_FILE, options)
