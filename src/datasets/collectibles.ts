/**
 * `data/collectibles.json` — 715 rows, 212 KB. Pins, coins, medals, service trophies.
 *
 * Named after the file rather than after any one consumer's word for it (the API this replaces
 * calls the same list `PINS_COINS`).
 *
 * `description` is `null` on 116 rows; `image` is `''` on 190 — 27% of the file, mostly tournament
 * coins Valve ships no icon for at the exported path.
 *
 * **`model` was added by the exporter after 0.1.2 shipped** and the type below did not describe it.
 * `test/types.test.ts` run against the current export failed with 715 unknown-key issues, which is
 * exactly what that test exists to catch. Measured on the current export: `model` is present on all
 * 715 rows — a string on 619 of them (350 distinct values) and `null` on 96, the operation passes,
 * which are inventory entries with no world model.
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
	/**
	 * The world model, extension stripped — `5_year_coin`. `null` on the 96 rows that have none.
	 *
	 * Added by the exporter after 0.1.2; a consumer pinned to that version will not see it on the
	 * type even though the bytes carry it.
	 */
	model: string | null
}

export type Collectibles = Collectible[]

/** `data/collectibles.json`. */
export const COLLECTIBLES_FILE = 'collectibles.json'

export const fetchCollectibles = (options: DatasetOptions<Collectibles> = {}): Promise<Collectibles> =>
	fetchCdnData<Collectibles>(COLLECTIBLES_FILE, options)
