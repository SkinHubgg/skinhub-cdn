/**
 * `@skinhub/cdn/query` — everything you can ask of the data, once you have it.
 *
 * **This entry point never fetches.** It imports nothing from `fetch.js`, `cache.js` or `config.js`,
 * so importing a filter cannot drag a network stack into a bundle — the same property
 * `@skinhub/cdn/placement` has, and `test/query.test.ts` asserts it by walking the import graph
 * rather than by trusting this paragraph.
 *
 * Every function takes the rows as its first argument. That is what makes the surface work
 * unchanged over the CDN's copy, a `fallback` copy, a database mirror, or a list you have already
 * narrowed — and it is why there is no `fetchSkinsForWeapon`, which would hide a 4.2 MB download
 * behind something spelled like a filter.
 *
 * If you want the one-liner, `@skinhub/cdn/catalog` fetches once and hands back a built index. It
 * is a separate entry point on purpose.
 *
 * Measured for a browser target on 2026-08-15: importing `listKnifeTypes` costs **1,724 bytes**, and
 * costs the same through the root barrel as through this subpath. The whole surface, namespace-
 * imported, is 19,801 bytes and still contains no origin string, no `fetch` options and no cache.
 *
 * ```ts
 * import { fetchSkins } from '@skinhub/cdn'
 * import { listKnifeTypes, skinsForWeapon, findSkin, marketHashName } from '@skinhub/cdn/query'
 *
 * const skins = await fetchSkins()
 *
 * listKnifeTypes(skins)                             // the 20 knife types
 * skinsForWeapon(skins, 'AK-47')                    // every AK-47 finish
 * findSkin(skins, { defindex: 7, paintindex: 801 }) // AK-47 | Asiimov
 * ```
 */

export {
	createSkinIndex,
	type MarketEntry,
	type SkinIndex,
} from './lookup.js'
export {
	canBeSouvenir,
	canBeStatTrak,
	isUntradable,
	type MarketHashNameOptions,
	type MarketVariant,
	marketHashName,
	marketHashNameIndex,
	marketHashNames,
	type ParsedMarketHashName,
	parseMarketHashName,
	paintIndexForMarketHashName,
	skinsByMarketHashName,
	SOUVENIR_PREFIX,
	STAR_PREFIX,
	STATTRAK_PREFIX,
} from './market.js'
export {
	compareByRarity,
	type RarityBearer,
	type RarityLike,
	type RarityObject,
	type RarityRank,
	RARITY_RANKS,
	rarityRank,
	WEAPON_RARITY_RANKS,
} from './rarity.js'
export {
	hasKeychain,
	hasStickers,
	type ItemCatalogs,
	type ItemFinders,
	type ResolvedItem,
	type ResolvedKeychain,
	type ResolvedSticker,
	resolveItem,
	resolveItemWith,
} from './resolve.js'
export {
	clampFloat,
	findSkin,
	findSkinById,
	floatRangeOf,
	gloveSkins,
	gunSkins,
	knifeSkins,
	listCollections,
	listCrates,
	type NamedGroup,
	paintIndexOf,
	phasesOf,
	type SkinRef,
	skinsByName,
	skinsByPaintIndex,
	skinsForWeapon,
	skinsInCategory,
	skinsInCollection,
	skinsInCrate,
	skinsWithWear,
	souvenirSkins,
	statTrakSkins,
	vanillaSkins,
	type WeaponSelector,
	wearsOf,
} from './skins.js'
export {
	type CategorySummary,
	defindexForWeaponId,
	isEquipment,
	isGlove,
	isGun,
	isKnife,
	isVanilla,
	listCategories,
	listGloveTypes,
	listGunTypes,
	listKnifeTypes,
	listWeaponTypes,
	normalizeWeaponId,
	type ResolvedWeapon,
	SKIN_CATEGORIES,
	SKIN_CATEGORY_IDS,
	type SkinCategoryKey,
	skinCategory,
	weaponDefindexes,
	weaponIdForDefindex,
	weaponIdsByDefindex,
	type WeaponRef,
	type WeaponType,
	weaponOf,
} from './taxonomy.js'
export {
	type WearLike,
	type WearName,
	type WearShort,
	type WearTier,
	type WearTierId,
	WEAR_TIERS,
	wearTier,
	wearTierForFloat,
} from './wear.js'
