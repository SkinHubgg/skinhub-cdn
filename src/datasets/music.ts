/**
 * `data/music.json` — 101 rows, 40 KB.
 *
 * **`rarity` is `null` on all 101 rows.** Neither `music_definitions` nor the music-kit item
 * carries one. The field is kept because the shape is shared with the other lists, but nothing
 * should branch on it.
 */

import type { DatasetOptions } from '../fetch.js'
import { fetchCdnData } from '../fetch.js'
import type { ImageUrl, RarityToken } from './common.js'

export type MusicKit = {
	/** A decimal string, `'1'`. Unique across the file. */
	id: string
	name: string
	/** Non-empty on every row of the current export. */
	image: ImageUrl
	/** `null` on every row. */
	rarity: RarityToken | null
	/** `null` on 1 of 101. */
	description: string | null
}

export type MusicKits = MusicKit[]

/** `data/music.json`. */
export const MUSIC_FILE = 'music.json'

export const fetchMusicKits = (options: DatasetOptions<MusicKits> = {}): Promise<MusicKits> =>
	fetchCdnData<MusicKits>(MUSIC_FILE, options)
