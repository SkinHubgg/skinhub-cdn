/**
 * `data/agents.json` — 81 rows, 52 KB. A superset of the community list's 65: the extra 16 are the
 * untradable agents.
 *
 * **`model` is the four-character string `"null"` on 2 rows** — not `null`, not `''`. Those are
 * the two default-loadout rows, which also carry `id`, `rarity` and `description` as real `null`.
 * A consumer rendering a model path has to test for the string.
 */

import type { DatasetOptions } from '../fetch.js'
import { fetchCdnData } from '../fetch.js'
import type { ImageUrl, RarityToken } from './common.js'

/** From `used_by_classes`, the only place the side is actually stored. */
export const AGENT_TEAM_T = 2
export const AGENT_TEAM_CT = 3

export type AgentTeam = typeof AGENT_TEAM_T | typeof AGENT_TEAM_CT

export type Agent = {
	/** `2` = Terrorist, `3` = Counter-Terrorist. */
	team: AgentTeam
	image: ImageUrl
	/**
	 * `tm_professional/tm_professional_varf5` — relative to the agent model root, extension
	 * stripped. The literal string `'null'` on the two default rows.
	 */
	model: string
	/** `Bloody Darryl The Strapped | The Professionals`. */
	agent_name: string
	/** The item definition index as a decimal string. `null` on the two default rows. */
	id: string | null
	rarity: RarityToken | null
	description: string | null
}

export type Agents = Agent[]

/** `data/agents.json`. */
export const AGENTS_FILE = 'agents.json'

export const fetchAgents = (options: DatasetOptions<Agents> = {}): Promise<Agents> =>
	fetchCdnData<Agents>(AGENTS_FILE, options)
