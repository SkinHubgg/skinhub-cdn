/**
 * `data/keychains.json` — 143 rows, 40 KB. Charms. A superset of the community list's 78: the
 * extra 65 are the highlight-reel charms, which carry `base` in `items_game` and inherit their art
 * from the charm they name.
 *
 * `description` is `null` on 78 rows; `image` is `''` on 1.
 */

import type { DatasetOptions } from '../fetch.js'
import { fetchCdnData } from '../fetch.js'
import type { ImageUrl, RarityToken } from './common.js'

export type Keychain = {
	/** A decimal string, `'1'`. Unique across the file. This is the charm's `sticker_id`. */
	id: string
	/** `Charm | Lil' Ava`. */
	name: string
	image: ImageUrl
	rarity: RarityToken | null
	description: string | null
}

export type Keychains = Keychain[]

/** `data/keychains.json`. */
export const KEYCHAINS_FILE = 'keychains.json'

export const fetchKeychains = (options: DatasetOptions<Keychains> = {}): Promise<Keychains> =>
	fetchCdnData<Keychains>(KEYCHAINS_FILE, options)
