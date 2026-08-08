/**
 * `data/gloves.json` — 95 rows, 24 KB.
 *
 * **`paint` is a `string` on 94 rows and the number `0` on exactly one** — the `Gloves | Default`
 * row, which also carries `weapon_defindex: 0` and `image: ''`. Measured on the current export.
 * (An older comment in the code this replaces asserts the opposite, that `paint` is always a
 * number; against this export that is wrong for 94 of 95 rows. Hence `string | number`, and hence
 * the test that checks it.)
 *
 * `paint` is the same value as `Skin['paint_index']`, so the two lists join on it — but only after
 * `String()`, because of that one row.
 */

import type { DatasetOptions } from '../fetch.js'
import { fetchCdnData } from '../fetch.js'
import type { ImageUrl } from './common.js'

export type Glove = {
	/** Item definition index: `5027`…`5035`, `4725`, or `0` on the default row. */
	weapon_defindex: number
	/** Decimal string on 94 rows, the number `0` on the default row. */
	paint: string | number
	image: ImageUrl
	/** `★ Driver Gloves | Wave Chaser`. */
	paint_name: string
}

export type Gloves = Glove[]

/** `data/gloves.json`. */
export const GLOVES_FILE = 'gloves.json'

export const fetchGloves = (options: DatasetOptions<Gloves> = {}): Promise<Gloves> =>
	fetchCdnData<Gloves>(GLOVES_FILE, options)
