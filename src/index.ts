/**
 * `@skinhub/cdn` — a typed data layer over the JSON the CS2 asset exporter publishes, plus the CS2
 * inspect-link codec.
 *
 * Nothing is bundled. The eight files are 16 MB; they are fetched at runtime, and a caller that
 * wants an offline copy supplies its own `fallback`.
 *
 * **The inspect codec is in this barrel because it is now browser-safe.** It used to be excluded on
 * purpose: it wrapped `cs2-inspect-lib`, whose dependency list dragged `steam-user` and `node-cs2`
 * along for a Game Coordinator round trip it never made, so `import { fetchSkins } from '@skinhub/cdn'`
 * would have failed to build for the web at all. `src/codec.ts` replaced that with ~16 KB of pure
 * maths and no imports, and `test/bundle.test.ts` measures both halves of the claim: the inspect
 * entry point builds for a browser, and a consumer that imports only `fetchGloves` from this barrel
 * still carries none of the codec.
 *
 * Every dataset also has its own entry point (`@skinhub/cdn/gloves`, …), as do the codec
 * (`@skinhub/cdn/inspect`) and the dependency-free placement layer (`@skinhub/cdn/placement`), so a
 * consumer that wants one thing does not have to trust a bundler to shake off the rest.
 *
 * **The query layer (`@skinhub/cdn/query`) is re-exported here for the same reason the codec is.**
 * It is pure — it imports nothing from `fetch`/`cache`/`config`, so it carries no network code — and
 * an integrator's first instinct is to type `listKnifeTypes` and see whether the editor offers it.
 * `test/query.test.ts` asserts the no-network property by walking the import graph, and
 * `test/bundle.test.ts` asserts that importing only `fetchGloves` still carries none of it.
 *
 * The one part of the query work that *does* fetch, `loadSkinIndex`, lives in `@skinhub/cdn/catalog`
 * and is re-exported here too — it is `fetchSkins` plus an index, so it belongs with the fetchers.
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
export { type Catalog, loadCatalog, loadSkinIndex, type LoadSkinIndexOptions } from './catalog.js'
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
export {
	buildInspectUrl,
	type EconItem,
	fromEconItem,
	isLegacyInspectUrl,
	readInspectUrl,
	toEconItem,
	toGameCommand,
} from './inspect.js'
export * from './query/index.js'
export {
	clamp,
	clampStickerOffset,
	DEFAULT_KEYCHAIN,
	DEFAULT_STICKER,
	DEFAULT_STICKER_SCALE,
	emptyKeychain,
	emptySticker,
	f32,
	formatKeychainRow,
	formatStickerRow,
	KEYCHAIN_SCHEMA,
	type KeychainPlacement,
	makeKeychainPlacement,
	makeSkinPlacement,
	makeStickerPlacement,
	migrateLegacyKeychainRow,
	normalizedFromOffset,
	offsetFromNormalized,
	parseKeychainRow,
	parseStickerRow,
	shortFloat,
	type SkinPlacement,
	STICKER_OFFSET_MAX,
	STICKER_OFFSET_MIN,
	STICKER_SCHEMA,
	STICKER_SLOTS,
	type StickerPlacement,
	type StickerSlot,
	u32,
	UINT32_MAX,
} from './placement.js'
