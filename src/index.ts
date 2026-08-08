/**
 * `@skinhub/cdn` — a typed data layer over the JSON the CS2 asset exporter publishes.
 *
 * Nothing is bundled. The eight files are 16 MB; they are fetched at runtime, and a caller that
 * wants an offline copy supplies its own `fallback`.
 *
 * This barrel re-exports the data layer only. Two things are deliberately **not** here:
 *
 *   - `@skinhub/cdn/inspect` — the inspect-link codec. It pulls `cs2-inspect-lib`, which a browser
 *     bundle asking for `fetchSkins` should never resolve.
 *   - `@skinhub/cdn/placement` — the placement types and the WeaponPaints row format, dependency-
 *     free, for a server that stores placement but never encodes a link.
 *
 * Every dataset also has its own entry point (`@skinhub/cdn/gloves`, …) so a consumer that wants
 * one list does not have to trust a bundler to shake off the other seven.
 */

export {
	type CdnCache,
	clearDefaultCache,
	createMemoryCache,
	DEFAULT_TTL_MS,
	getDefaultCache,
	type MemoryCache,
	type MemoryCacheOptions,
} from './cache.js'
export {
	type CdnConfig,
	cdnUrl,
	configureCdn,
	dataUrl,
	getConfiguredOrigin,
	normalizeOrigin,
	resolveCdnOrigin,
	SKINHUB_CDN_DEFAULT_ORIGIN,
	SKINHUB_CDN_ENV_VAR,
} from './config.js'
export { AGENTS_FILE, type Agent, type Agents, type AgentTeam, AGENT_TEAM_CT, AGENT_TEAM_T, fetchAgents } from './datasets/agents.js'
export { COLLECTIBLES_FILE, type Collectible, type Collectibles, fetchCollectibles } from './datasets/collectibles.js'
export type { ImageUrl, Open, RarityToken } from './datasets/common.js'
export { fetchGloves, GLOVES_FILE, type Glove, type Gloves } from './datasets/gloves.js'
export {
	fetchItemsGame,
	ITEMS_GAME_FILE,
	type ItemsGame,
	type ItemsGameSection,
	type KeyValuesNode,
} from './datasets/items-game.js'
export { fetchKeychains, KEYCHAINS_FILE, type Keychain, type Keychains } from './datasets/keychains.js'
export { fetchMusicKits, MUSIC_FILE, type MusicKit, type MusicKits } from './datasets/music.js'
export {
	fetchSkins,
	SKINS_FILE,
	type Skin,
	type SkinCategory,
	type SkinCollection,
	type SkinCrate,
	type SkinPattern,
	type SkinPhase,
	type SkinRarity,
	type Skins,
	type SkinTeam,
	type SkinWear,
	type SkinWeapon,
} from './datasets/skins.js'
export { fetchStickers, STICKERS_FILE, type Sticker, type Stickers } from './datasets/stickers.js'
export { CdnError, isCdnError } from './errors.js'
export {
	type CdnFetchOptions,
	type DatasetOptions,
	fetchCdnData,
	fetchCdnJson,
	type FetchLike,
	inFlightCount,
} from './fetch.js'
