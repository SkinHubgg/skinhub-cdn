/**
 * `data/stickers.json` — 11,788 rows, 5.5 MB. The largest list, and a superset of the community
 * one it replaces (10,461 rows there).
 *
 * Every nullable field below is null on rows that were counted, not on rows that were guessed at:
 * `rarity` on 12, `description` on 2,950, `tournament_event_id` on 1,174, `tournament_team_id` on
 * 1,292, `tournament_player_id` on 3,813. `image` is `''` on 643.
 */

import type { DatasetOptions } from '../fetch.js'
import { fetchCdnData } from '../fetch.js'
import type { ImageUrl, RarityToken } from './common.js'

export type Sticker = {
	/** A decimal string, `'1'`. Unique across the file. */
	id: string
	/** `Sticker | Shooter (Foil)`. */
	name: string
	image: ImageUrl
	rarity: RarityToken | null
	description: string | null
	/** `dreamhack/dh_gologo1` — the sticker material, which is also its CDN path segment. */
	material: string
	/** 112 of the kits in `sticker_kits` are patches, not stickers. */
	is_patch: boolean
	tournament_event_id: number | null
	tournament_team_id: number | null
	tournament_player_id: number | null
}

export type Stickers = Sticker[]

/** `data/stickers.json`. */
export const STICKERS_FILE = 'stickers.json'

export const fetchStickers = (options: DatasetOptions<Stickers> = {}): Promise<Stickers> =>
	fetchCdnData<Stickers>(STICKERS_FILE, options)
