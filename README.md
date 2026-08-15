# @skinhub/cdn

Typed data layer over the CS2 game data published to the SkinHub CDN — skins, stickers, gloves,
agents, music kits, charms, collectibles and Valve's own `items_game` — plus the CS2 inspect-link
codec.

The data is **fetched at runtime, never bundled**. The eight files are about 16 MB; shipping them
inside a dependency would be worse than the problem they solve. If you want an offline copy, you
supply it (see [Fallbacks](#fallbacks)).

```bash
bun add @skinhub/cdn
```

```ts
import { fetchSkins } from '@skinhub/cdn'
import { listKnifeTypes, skinsForWeapon, findSkin } from '@skinhub/cdn/query'

const skins = await fetchSkins()
skins.length                                       // 2161 — guns, knives and gloves, one file

listKnifeTypes(skins)                              // the 20 knife types
skinsForWeapon(skins, 'AK-47')                     // every AK-47 finish
findSkin(skins, { defindex: 7, paintindex: 801 })  // AK-47 | Asiimov
```

Works on a server and in a browser — **the inspect codec included**. No runtime dependencies, no Node
built-ins, no top-level `await` on import, no global state you did not ask for.

---

## Contents

- [What it serves](#what-it-serves)
- [Querying](#querying)
- [Configuring the origin](#configuring-the-origin)
- [Fetching](#fetching)
- [Caching](#caching)
- [Fallbacks](#fallbacks)
- [Errors](#errors)
- [Entry points and bundle size](#entry-points-and-bundle-size)
- [The types](#the-types)
- [Inspect links and placement](#inspect-links-and-placement)
- [API reference](#api-reference)
- [Development](#development)

---

## What it serves

Eight files under `data/` on the CDN. Row counts are from the export current at the time of writing.

| helper | file | rows | size | shape |
|---|---|---:|---:|---|
| `fetchSkins` | `skins.json` | 2,161 | 4.2 MB | `Skin[]` |
| `fetchStickers` | `stickers.json` | 11,788 | 5.5 MB | `Sticker[]` |
| `fetchCollectibles` | `collectibles.json` | 715 | 212 KB | `Collectible[]` |
| `fetchKeychains` | `keychains.json` | 143 | 40 KB | `Keychain[]` |
| `fetchMusicKits` | `music.json` | 101 | 40 KB | `MusicKit[]` |
| `fetchGloves` | `gloves.json` | 95 | 24 KB | `Glove[]` |
| `fetchAgents` | `agents.json` | 81 | 52 KB | `Agent[]` |
| `fetchItemsGame` | `items_game.json` | — | 6.5 MB | `{ items_game: … }` |

Anything else on the CDN — `manifest.json`, a file added after this release — is reachable with
`fetchCdnJson(path)` and `fetchCdnData(file)`, so you are never blocked on a release here.

```ts
import { fetchCdnJson, fetchCdnData } from '@skinhub/cdn'

await fetchCdnJson<Manifest>('manifest.json')  // <origin>/manifest.json
await fetchCdnData<Row[]>('something-new.json') // <origin>/data/something-new.json
```

---

## Querying

`skins.json` **is the whole weapon catalogue**. Counted on the current export: 1,483 gun rows, 576
melee, 94 glove and 8 Zeus. Knives and gloves are already in it, so answering "what exists" is one
4.2 MB fetch, not three.

`@skinhub/cdn/query` is what you ask it with. **Every function takes the rows as its first
argument and none of them fetch.** That is deliberate: `skinsForWeapon(skins, 'AK-47')` is honest
about the fact that the download already happened, where a `fetchSkinsForWeapon('AK-47')` would hide
4.2 MB behind something spelled like a filter and invite you to call it once per row of a picker.
The subpath imports nothing from the fetch, cache or config layers — a browser build of
`listKnifeTypes` is 1.7 KB with no origin string in it, and `test/bundle.test.ts` checks the built
bundle rather than the source.

### Enumerate

```ts
import { fetchSkins } from '@skinhub/cdn'
import { listCategories, listWeaponTypes, listKnifeTypes, listGloveTypes } from '@skinhub/cdn/query'

const skins = await fetchSkins()

listCategories(skins)
// [{ key: 'rifles', name: 'Rifles', skinCount: 500, weaponCount: 11 }, … 7 in all]

listWeaponTypes(skins)            // 63 — every weapon, ascending by defindex
listWeaponTypes(skins, 'pistols') // 10
listKnifeTypes(skins)             // 20
listGloveTypes(skins)             // 8
// { defindex: 500, id: 'weapon_bayonet', name: 'Bayonet', category: 'knives', skinCount: 35, hasVanilla: true }
```

`SkinCategoryKey` is a closed union — `'rifles' | 'pistols' | 'smgs' | 'heavy' | 'knives' | 'gloves'
| 'equipment'` — so a `switch` over it is exhaustively checked. It is the only closed union in the
package; the ones describing Valve's own tokens stay open.

**A weapon type is keyed on `weapon.weapon_id`, never on `weapon.id`.** There are 83 distinct
`weapon.id` values against 63 defindexes, because each vanilla knife row carries a `sfui_wpnhud_*`
alias instead of the item name. Group a picker by `weapon.id` and every knife splits in two.

That alias survives a lookup, because the lookups hand back the exporter's row untouched. So when
you need the weapon's identity — a model path, a route, a group key — read it through `weaponOf`
rather than off the row:

```ts
import { findSkin, weaponOf } from '@skinhub/cdn/query'

const bayonet = findSkin(skins, { defindex: 500, paintindex: 0 })
bayonet?.weapon.id                  // 'sfui_wpnhud_knifebayonet' — a HUD string. No model has this name.
weaponOf(skins, bayonet!).id        // 'weapon_bayonet' ✔
resolveItem(placement, { skins }).weapon?.id  // same, straight off a decoded inspect link
```

It bites on the 20 vanilla knives and nowhere else. `weaponOf` also reports `aliased: true` in the
one case it cannot resolve — a list you have already filtered down to just the vanilla row — so
"resolved" and "nothing to resolve with" stay distinguishable.

### Query within one

```ts
import { skinsForWeapon, skinsInCategory, knifeSkins, gloveSkins, statTrakSkins } from '@skinhub/cdn/query'

skinsForWeapon(skins, 7)               // by defindex — the key
skinsForWeapon(skins, 'weapon_ak47')   // by item id
skinsForWeapon(skins, 'AK-47')         // by display name, case-insensitively
skinsForWeapon(skins, decodedLink)     // by anything with a `defindex`

skinsInCategory(skins, 'knives')       // 576
knifeSkins(skins)                      // the same 576
gloveSkins(skins)                      // 94 — "all gloves", no second fetch
statTrakSkins(skins)                   // 1274

listCollections(skins)                 // 94, with counts
listCrates(skins)                      // 196
skinsInCrate(skins, 'crate-4089')
```

### Look up one thing

Return types say what was measured. Single where the key is unique, an array where it is not.

| you hold | call | returns | why |
|---|---|---|---|
| defindex + paint index | `findSkin(skins, ref)` | `Skin \| undefined` | the pair is unique across all 2,161 rows |
| the export's row id | `findSkinById(skins, id)` | `Skin \| undefined` | 2,161 distinct ids |
| a paint index alone | `skinsByPaintIndex(skins, i)` | `Skin[]` | 113 of 1,480 are worn by more than one weapon |
| a display name | `skinsByName(skins, name)` | `Skin[]` | 29 names cover 181 rows — the Doppler phases |
| a Steam `market_hash_name` | `skinsByMarketHashName(skins, n)` | `Skin[]` | same 29, for the same reason |

```ts
findSkin(skins, { defindex: 7, paintindex: 801 })   // AK-47 | Asiimov
findSkin(skins, readInspectUrl(link))               // a decoded link satisfies the shape as-is
```

**A defindex is not an item id and a paint index is not either.** Only the pair is. That matters
because it is the one identity every source agrees on — an inspect link, a Steam inventory row and a
WeaponPaints database row all carry both numbers.

### Sorting by grade

`Skin['rarity']` is `{ id, name, color }` with no ordinal and the other six lists carry a bare word,
so neither sorts on its own. `rarityRank` puts both on Valve's own ladder — the `value` field of
`items_game.rarities`, 0 (`default`) through 7 (`immortal`, which the UI calls Contraband).

```ts
import { compareByRarity, rarityRank } from '@skinhub/cdn/query'

skins.sort(compareByRarity)                  // commonest first
skins.sort((a, b) => compareByRarity(b, a))  // rarest first
stickers.sort(compareByRarity)               // same call, different list

rarityRank(skin)         // reads skin.rarity for you
rarityRank(skin.rarity)  // identical
rarityRank(musicKit)     // undefined — music.json has rarity: null on all 101 rows
```

Both take the row *or* the rarity. `undefined` rather than `-1` for an unranked value, so "no
rarity" stays distinguishable from "the lowest rarity".

### `market_hash_name`, the Steam join key

Steam publishes no defindex on a listing and `skins.json` has no `market_hash_name` column, so the
join has to be built — exactly, because a name assembled in the wrong order returns no listings,
which looks precisely like an item nobody is selling.

```ts
import { marketHashName, marketHashNames, parseMarketHashName } from '@skinhub/cdn/query'

marketHashName(asiimov, { wear: 'Field-Tested' })            // 'AK-47 | Asiimov (Field-Tested)'
marketHashName(asiimov, { wear: 'FT', stattrak: true })      // 'StatTrak™ AK-47 | Asiimov (Field-Tested)'
marketHashName(karambit, { wear: 'FN', stattrak: true })     // '★ StatTrak™ Karambit | Doppler (Factory New)'
marketHashName(vanillaBayonet)                               // '★ Bayonet'
marketHashName(defaultDeagle, { wear: 'FT' })                // null — a vanilla gun has no listing

marketHashNames(asiimov)  // all 10 keys this row sells under, with their wear/quality flags
```

The star comes **before** StatTrak™, and it is already in `skin.name` — all 670 melee and glove rows
start with `★ `. `null` comes back for any variant that does not exist rather than a string that
would find nothing: a StatTrak glove, a Souvenir AK, an exterior below the finish's `min_float`.

> **`skin.souvenir` does not mean a Souvenir version exists.** It is `true` on 1,456 rows including
> `AK-47 | Asiimov` and `M4A4 | Howl`, and it contradicts `stattrak` on 698 of them — no CS2 item is
> both. `canBeSouvenir` uses the drop source instead: 319 rows drop from a `… Souvenir Package`, and
> exactly 0 of those are StatTrak-able. Enumerating from the raw flag would emit roughly 1,100 keys
> that match nothing on Steam.

### Inspect link in, renderable item out

```ts
import { readInspectUrl } from '@skinhub/cdn/inspect'
import { fetchSkins, fetchStickers } from '@skinhub/cdn'
import { resolveItem, hasStickers } from '@skinhub/cdn/query'

const placement = readInspectUrl(link)

const skins = await fetchSkins()
const stickers = hasStickers(placement) ? await fetchStickers() : undefined

const item = resolveItem(placement, { skins, stickers })

item.name             // 'AK-47 | Asiimov'
item.category         // 'rifles'
item.float            // clamped into the finish's own [min_float, max_float]
item.rawFloat         // what the wire actually said, so the clamp is visible
item.wear.name        // 'Field-Tested'
item.marketHashName   // 'StatTrak™ AK-47 | Asiimov (Field-Tested)'
item.stickers[0]?.sticker?.image
item.keychain?.keychain?.name
```

Every catalogue is optional. `resolveItem(placement, {})` still gives you the wire values and the
wear tier. `hasStickers`/`hasKeychain` let you decide whether the 5.5 MB `stickers.json` is worth
fetching *before* you fetch it.

### If you are resolving more than a handful

```ts
import { loadSkinIndex } from '@skinhub/cdn/catalog'

const index = await loadSkinIndex()        // fetch + build, memoised on the fetched array

index.weaponTypes('knives')
index.forWeapon(7)
index.find({ defindex: 7, paintindex: 801 })
index.findByMarketHashName('AK-47 | Asiimov (Field-Tested)')
index.resolve(readInspectUrl(link))
```

`createSkinIndex(skins)` is the same thing without the fetch. **No index is ever shipped in the
tarball** — one would be stale the moment the exporter runs, and the failure would be silent: a new
finish live on the CDN, missing from your picker, with nothing to show for it. The index is built
from the rows you fetched and lives exactly as long as they do.

---

## Configuring the origin

Four sources, highest priority first:

| # | source | example |
|---|---|---|
| 1 | the call | `fetchSkins({ origin: 'http://localhost:8787' })` |
| 2 | `configureCdn` | `configureCdn({ origin: 'https://cdn.example' })` |
| 3 | environment | `SKINHUB_CDN_URL=https://cdn.example` |
| 4 | default | `https://cdn.skinhub.gg` |

**On the client, use (1) or (2).** Bundlers only inline the environment variables they are told to —
Next.js inlines `NEXT_PUBLIC_*`, Vite inlines `VITE_*` — so a browser bundle relying on
`SKINHUB_CDN_URL` silently falls through to the default. This is not a limitation to work around;
`configureCdn` is the supported path.

```ts
// app/providers.tsx — once, at startup
import { configureCdn } from '@skinhub/cdn'

configureCdn({ origin: process.env.NEXT_PUBLIC_CDN_URL })
```

`configureCdn({ origin: undefined })` clears it again. The environment is read off
`globalThis.process?.env`, so nothing throws in a browser that has no `process` at all.

URL builders, if you need to point an `<img>` or a `<link rel="preload">` at the CDN yourself:

```ts
import { cdnUrl, dataUrl, resolveCdnOrigin } from '@skinhub/cdn'

resolveCdnOrigin()                  // 'https://cdn.skinhub.gg'
cdnUrl('manifest.json')             // 'https://cdn.skinhub.gg/manifest.json'
dataUrl('skins.json')               // 'https://cdn.skinhub.gg/data/skins.json'
cdnUrl('x.png', 'https://a.test/')  // 'https://a.test/x.png'  — slashes never double up
```

---

## Fetching

Every dataset helper takes the same options, all optional:

```ts
await fetchSkins({
  origin: 'https://cdn.example',  // this call only
  cache: myCache,                 // or `false` to disable; default is a shared in-memory cache
  ttlMs: 5 * 60_000,              // default 1 hour
  fallback: bundledSkins,         // returned instead of throwing
  onError: err => log(err),       // called when a fallback absorbs an error
  fetch: instrumentedFetch,       // inject your own
  signal: controller.signal,
  init: { headers: { … } },       // merged into the RequestInit, wins over our defaults
})
```

Two behaviours worth knowing:

- **Requests are sent with `cache: 'no-cache'`.** `data/*.json` keeps the same filename across every
  export and the origin serves it `max-age=60, stale-while-revalidate=300`, so a plain `fetch` can
  hand back a heuristically-fresh copy and never see a new export. `no-cache` forces a conditional
  request and reuses the cached body on a `304` — one round trip, no payload. Override with
  `init: { cache: 'default' }`.
- **Concurrent calls for the same URL share one request.** Three components asking for `skins.json`
  on the same tick cost one 4.2 MB download.

---

## Caching

Caching is yours, not ours. The interface is two methods:

```ts
interface CdnCache {
  get(key: string): unknown | undefined | Promise<unknown | undefined>
  set(key: string, value: unknown, ttlMs: number): void | Promise<void>
}
```

The default is a shared in-memory cache with a 1-hour TTL and a 32-entry cap, created lazily. Good
enough for a browser tab or a single-process server, and it needs no configuration.

**Redis:**

```ts
import Redis from 'ioredis'
import { fetchSkins, type CdnCache } from '@skinhub/cdn'

const redis = new Redis(process.env.REDIS_URL!)

const redisCache: CdnCache = {
  async get(key) {
    const raw = await redis.get(key)
    return raw === null ? undefined : JSON.parse(raw)
  },
  async set(key, value, ttlMs) {
    await redis.set(key, JSON.stringify(value), 'PX', ttlMs)
  },
}

const skins = await fetchSkins({ cache: redisCache, ttlMs: 24 * 60 * 60 * 1000 })
```

**Next.js**, letting the framework cache instead:

```ts
import { unstable_cache } from 'next/cache'
import { fetchSkins } from '@skinhub/cdn'

export const getSkins = unstable_cache(() => fetchSkins({ cache: false }), ['skins'], {
  revalidate: 3600,
})
```

**None at all:** `fetchSkins({ cache: false })`.

Other knobs: `createMemoryCache({ ttlMs, max })` for an isolated instance, `getDefaultCache()` and
`clearDefaultCache()` for the shared one — the latter is what you call after an export lands.

> A cached value is the **parsed** array, shared by reference between callers. Treat it as
> read-only, or pass `cache: false` if you intend to mutate.

---

## Fallbacks

Pass `fallback` and a failure returns it instead of throwing. This is how you keep the CDN off your
startup critical path:

```ts
import bundledGloves from './gloves.snapshot.json'
import { fetchGloves } from '@skinhub/cdn'

const gloves = await fetchGloves({
  fallback: bundledGloves,
  onError: err => logger.warn({ err }, 'gloves: serving the bundled snapshot'),
})
```

Without `onError` the error goes to `console.warn`. A fallback is **not** cached, so the next call
retries the CDN.

---

## Errors

One error class. `CdnError` carries the URL, the HTTP status, and the response's content type.

```ts
import { fetchSkins, isCdnError } from '@skinhub/cdn'

try {
  await fetchSkins()
} catch (error) {
  if (isCdnError(error)) {
    error.url          // 'https://cdn.skinhub.gg/data/skins.json'
    error.status       // 404, or undefined if the request never completed
    error.contentType  // 'text/html'
  }
}
```

`contentType` is on there for a reason: the origin is behind Cloudflare, and a **missing key returns
a 27 KB HTML page**, not JSON. Code that goes straight to `response.json()` reports that as
`SyntaxError: Unexpected token '<'`, which sends you debugging your parser instead of reading the
404. This package checks the status first and tells you what actually happened.

---

## Entry points and bundle size

`sideEffects: false`, ESM, and a subpath per dataset. Import one list and you get one list.

| import | contents |
|---|---|
| `@skinhub/cdn` | everything: config, cache, errors, fetch, all eight dataset helpers, the query layer, the inspect codec and the placement layer |
| `@skinhub/cdn/skins` | `fetchSkins` + the skin types |
| `@skinhub/cdn/stickers` `…/gloves` `…/agents` `…/music` `…/keychains` `…/collectibles` `…/items-game` | one dataset each |
| `@skinhub/cdn/query` | every filter, lookup and market-hash-name helper — **pure, fetches nothing** |
| `@skinhub/cdn/catalog` | `loadSkinIndex` / `loadCatalog` — fetch and index in one call |
| `@skinhub/cdn/placement` | placement types, normalisation, the WeaponPaints row format |
| `@skinhub/cdn/inspect` | inspect-link encode/decode — works in a browser |

**This package has no runtime dependencies.** Nothing to audit, nothing to resolve, and nothing that
needs a Node built-in.

Measured with a real bundler against `dist`:

| a consumer that imports | target | result |
|---|---|---|
| `fetchGloves` from `@skinhub/cdn/gloves` | browser | 4.5 KB, and no trace of the other seven datasets |
| `fetchGloves` from `@skinhub/cdn` | browser | 4.5 KB — a named import off the barrel costs the same |
| `formatStickerRow` from `@skinhub/cdn/placement` | browser | 2.0 KB |
| `listKnifeTypes` from `@skinhub/cdn/query` | browser | 1.7 KB, with no origin, fetch or cache in it |
| `listKnifeTypes` from `@skinhub/cdn` | browser | 1.7 KB — again the same through the barrel |
| `marketHashName` from `@skinhub/cdn/query` | browser | 2.5 KB |
| `resolveItem` from `@skinhub/cdn/query` | browser | 5.5 KB |
| `import * as query` from `@skinhub/cdn/query` | browser | 19.3 KB — the whole surface, still network-free |
| `loadSkinIndex` from `@skinhub/cdn/catalog` | browser | 14.8 KB — this one does fetch, by design |
| `buildInspectUrl` from `@skinhub/cdn/inspect` | browser | 16.7 KB |
| `buildInspectUrl` from `@skinhub/cdn/inspect` | node | 16.7 KB |
| `import * as cdn` from `@skinhub/cdn` | browser | 59.8 KB — everything, because a namespace import keeps everything |

### The inspect codec used to be server-only. It is not any more.

Earlier versions wrapped [`cs2-inspect-lib`](https://www.npmjs.com/package/cs2-inspect-lib), whose
dependency list includes `steam-user` and `node-cs2` for a Game Coordinator round trip this package
never makes. Installing this package used to put **89 MB across 60 packages** in your `node_modules`;
it now puts **512 KB across one**. And because `cs2-inspect-lib` reached its Steam transports through
an `await import()` inside a method, which bundlers still follow, bundling the codec for a browser
**failed** on `tls`, `dns` and `readline`, while bundling it for Node produced about **29 MB** — an
entire Steam client, for a protobuf encode that never talks to Steam. That is why the codec was kept
out of the root export.

The two functions actually needed from it, `createInspectUrl` and `decodeMaskedUrl`, are pure maths —
a protobuf message and a CRC, no network and no Steam anywhere in them. They are now written natively
in one module with **no imports at all**, `cs2-inspect-lib` is gone from the dependency list, and the
same consumer that would not build now bundles to 16.7 KB for a browser. So the codec is in the root
export too; `@skinhub/cdn/inspect` stays as a subpath for anyone who wants the guarantee without
relying on a bundler.

Because a wrong byte in an inspect link does not throw — it produces a link that resolves to the
wrong skin, which reads as a data problem rather than a codec problem — the port is held to a corpus
rather than to an example. `cs2-inspect-lib` is kept as a **devDependency**, and **2,326 items plus 41
URL forms are encoded and decoded by both implementations on every test run** and asserted identical
byte for byte, including the ones both must refuse. The corpus is built from the real export: every
`[defindex, paintindex]` pair in `skins.json`, real sticker and charm ids, and deliberate edges —
float32 extremes, every varint width boundary, seed 0 and 4294967295, all five sticker slots, StatTrak
on and off, nametags in Hebrew, CJK and emoji, and the 20 vanilla rows where `paint_index` is `null`.
A second test perturbs one token of the codec at a time and requires the corpus to catch every
perturbation, so the comparison cannot pass by accident.

`@skinhub/cdn/placement` is still the smallest useful piece — placement types, normalisation and the
WeaponPaints row format, no protobuf, 2 KB — for a server that stores placement but never encodes a
link.

---

## The types

Derived from the real exported files and checked against them by the test suite, which validates
every row and **fails on a field the types do not describe**. Some consequences you should know
about, because each one is a bug waiting in code written against a looser type:

**`skins.json` has 55 "vanilla" rows, in two different spellings.** On all 55, `pattern`,
`min_float` and `max_float` are **`null`**, and `souvenir`, `wears` and `collections` are **absent
keys**, not `null`. The difference is what "no finish" looks like:

- the **20 vanilla knives** (`skin-vanilla-weapon_bayonet` and friends) have `paint_index: null`;
- the **35 vanilla guns** (`skin-vanilla-weapon_deagle`, …) have `paint_index: '0'` and
  `rarity.id === 'rarity_default_weapon'`.

That second group is why `skin.wears.length` is the most likely crash in code written against the
raw type — it throws on 55 of 2,161 rows.

```ts
import { isVanilla, wearsOf, paintIndexOf } from '@skinhub/cdn/query'

const skins = await fetchSkins()
for (const skin of skins) {
  wearsOf(skin)         // [] on all 55, instead of throwing on a missing key
  paintIndexOf(skin)    // 0 for both spellings, matching what a decoded link carries
  isVanilla(skin)       // true for both
}
```

**`phase` is on 181 of 2,161 rows**, and absent — never null — on the rest. It is
`'Phase 1' | … | 'Black Pearl'` widened so a new phase is not a compile error. Those 181 rows are
also the only reason `name` is not unique: 29 names cover all of them.

**`souvenir` is not "a Souvenir version exists".** See [Querying](#querying) — use `canBeSouvenir`.

**`gloves.json` has one row where `paint` is a `number`** (the `Gloves | Default` row); the other 94
are strings. Join it against `Skin['paint_index']` through `String()`.

**`agents.json` has two rows where `model` is the four-character string `"null"`**, not `null` and
not `''`. Check for it before building a model path.

**`music.json` has `rarity: null` on every row.** The field exists for shape compatibility; do not
branch on it.

**Images can be the empty string.** `''` means the export has no icon for that row and is
deliberate — a URL that 404s would be worse. It is common: 643 of 11,788 stickers, 190 of 715
collectibles, and some collection and crate icons.

```ts
{sticker.image ? <img src={sticker.image} /> : <Placeholder />}
```

**`items_game.json` is not an array.** It is `{ items_game: { …33 sections… } }` — Valve's KeyValues
converted to JSON. The section names are typed so `data.items_game.paint_kits` autocompletes; the
values are `unknown`, because writing an interface for a file that changes with every CS2 update
would be inventing structure the file does not guarantee.

Rarity tokens (`'rare' | 'mythical' | …`) and other string unions are **open** — they autocomplete
to the values in the current export but still accept a new one, so a CS2 update does not become a
compile error in your app.

---

## Inspect links and placement

Encode and decode CS2 inspect links, and read/write the placement format the
[CS2 WeaponPaints plugin](https://github.com/Nereziel/cs2-WeaponPaints) stores.

```ts
// or from '@skinhub/cdn' — same functions, and a named import tree-shakes to the same bytes
import { buildInspectUrl, readInspectUrl, toGameCommand, isLegacyInspectUrl } from '@skinhub/cdn/inspect'

const url = buildInspectUrl({
  defindex: 7,          // AK-47
  paintindex: 44,       // Case Hardened
  paintseed: 661,
  paintwear: 0.154,
  stattrak: true,
  stattrak_count: 1337,
  nametag: 'blue gem',
  stickers: [{ slot: 0, sticker_id: 7691, wear: 0.25, scale: 0.8, rotation: 12, offset_x: 0.1, offset_y: -0.2 }],
  keychain: { slot: 0, sticker_id: 21, offset_x: 1.5, offset_y: -2.25, offset_z: 0.125, pattern: 41 },
})
// 'steam://rungame/730/…/+csgo_econ_action_preview%2000180720…'

toGameCommand(url)  // 'csgo_econ_action_preview 00180720…' — paste into the CS2 console
readInspectUrl(url) // back to a SkinPlacement, all five sticker slots present
```

`readInspectUrl` handles **masked** links only — the `+csgo_econ_action_preview <hex>` form that
carries the item data. The unmasked `S…A…D…` / `M…A…D…` market and inventory links needed a Game
Coordinator round trip Valve has shut down, so there is nothing to read out of them. Check first:

```ts
if (isLegacyInspectUrl(input)) {
  // no item data in this link — ask the user for a masked one
}
```

### Placement is stored in the game's own field names

`slot`, `sticker_id`, `wear`, `scale`, `rotation`, `offset_x`, `offset_y`, `offset_z`, `pattern` —
`CEconItemPreviewDataBlock.Sticker` verbatim, nothing renamed or negated. Offsets are UV space
centred on the slot anchor, `-0.5 … 0.5`, which is the shader's own `g_vStickerNOffset` range. If
your UI works in `0 … 1`, convert with `offsetFromNormalized` / `normalizedFromOffset`.

### Everything is quantised at the boundary

`makeSkinPlacement` runs on the way into `toEconItem`, so a caller cannot hand the wire a value the
game will reject:

- ids and seeds (`defindex`, `paintindex`, `paintseed`, `sticker_id`, `pattern`, `stattrak_count`)
  go through `u32` — truncated, clamped, unsigned. The WeaponPaints plugin parses these with
  `uint.TryParse`, which **silently skips** an item whose id carries a sign, a decimal point or an
  exponent: the sticker just never appears in game, with no error anywhere.
- floats go through `Math.fround`, because they are protobuf `float`s.
- a `sticker_id` of `0` normalises the whole slot to empty, dropping offsets left behind by a
  removed sticker — a state no inspect link can represent.

A practical consequence: `paintwear: 0.154` is a float64, and the wire holds float32. Normalise once
and the value is stable forever after:

```ts
import { makeSkinPlacement } from '@skinhub/cdn/placement'

const item = makeSkinPlacement(fromYourForm)  // paintwear becomes 0.15399999916553497
readInspectUrl(buildInspectUrl(item))         // deep-equals `item`
```

### WeaponPaints database rows

`wp_player_skins` column formats, `id;schema;x;y;wear;scale;rotation` and `id;x;y;z;seed`:

```ts
import { formatStickerRow, parseStickerRow, formatKeychainRow, parseKeychainRow } from '@skinhub/cdn/placement'

formatStickerRow(placement)      // '7691;0;0.1;-0.2;0.25;0.8;12'
parseStickerRow(row, slot)       // -> StickerPlacement; malformed or null input gives an empty slot
```

Floats are written at the shortest decimal that reads back as the same float32 — `0.3`, not
`0.30000001192092896` — because seven of the latter overflow the plugin's `varchar(128)` column and
the extra digits carry no information.

`migrateLegacyKeychainRow(row)` rewrites charm rows written by the pre-2026 schema, which stored
`id;-x;1;-y;seed` into an `id;x;y;z;seed` column. It returns `null` for rows that are already
correct, so a migration using it is safe to re-run.

---

## API reference

### Config
`configureCdn` · `resolveCdnOrigin` · `getConfiguredOrigin` · `normalizeOrigin` · `cdnUrl` ·
`dataUrl` · `SKINHUB_CDN_DEFAULT_ORIGIN` · `SKINHUB_CDN_ENV_VAR`

### Fetching
`fetchSkins` · `fetchStickers` · `fetchGloves` · `fetchAgents` · `fetchMusicKits` ·
`fetchKeychains` · `fetchCollectibles` · `fetchItemsGame` · `fetchCdnData` · `fetchCdnJson` ·
`inFlightCount`

File-name constants, if you are keying a cache or a preload by them: `SKINS_FILE`, `STICKERS_FILE`,
`GLOVES_FILE`, `AGENTS_FILE`, `MUSIC_FILE`, `KEYCHAINS_FILE`, `COLLECTIBLES_FILE`,
`ITEMS_GAME_FILE`.

### Caching
`createMemoryCache` · `getDefaultCache` · `clearDefaultCache` · `DEFAULT_TTL_MS` · `CdnCache`

### Errors
`CdnError` · `isCdnError`

### Types
`Skin` · `Skins` · `SkinPhase` · `SkinWeapon` · `SkinCategory` · `SkinPattern` · `SkinRarity` ·
`SkinWear` · `SkinCollection` · `SkinCrate` · `SkinTeam` · `Sticker` · `Stickers` · `Glove` ·
`Gloves` · `Agent` · `Agents` · `AgentTeam` · `MusicKit` · `MusicKits` · `Keychain` · `Keychains` ·
`Collectible` · `Collectibles` · `ItemsGame` · `ItemsGameSection` · `RarityToken` · `ImageUrl` ·
`CdnFetchOptions` · `DatasetOptions` · `FetchLike`

### `@skinhub/cdn/query`

Taxonomy — `listCategories` · `listWeaponTypes` · `listKnifeTypes` · `listGloveTypes` ·
`listGunTypes` · `skinCategory` · `isKnife` · `isGlove` · `isGun` · `isEquipment` · `isVanilla` ·
`SKIN_CATEGORIES` · `SKIN_CATEGORY_IDS`

Filters — `skinsForWeapon` · `skinsInCategory` · `knifeSkins` · `gloveSkins` · `gunSkins` ·
`vanillaSkins` · `statTrakSkins` · `souvenirSkins` · `skinsWithWear` · `skinsInCollection` ·
`skinsInCrate` · `listCollections` · `listCrates` · `phasesOf`

Lookups — `findSkin` · `findSkinById` · `skinsByName` · `skinsByPaintIndex` ·
`skinsByMarketHashName` · `paintIndexForMarketHashName` · `createSkinIndex`

Fields — `weaponOf` · `paintIndexOf` · `wearsOf` · `floatRangeOf` · `clampFloat`

Market — `marketHashName` · `marketHashNames` · `marketHashNameIndex` · `parseMarketHashName` ·
`canBeStatTrak` · `canBeSouvenir` · `isUntradable` · `STATTRAK_PREFIX` · `SOUVENIR_PREFIX` ·
`STAR_PREFIX`

Wear and rarity — `WEAR_TIERS` · `wearTier` · `wearTierForFloat` · `rarityRank` ·
`compareByRarity` · `RARITY_RANKS` · `WEAPON_RARITY_RANKS`

Resolve — `resolveItem` · `resolveItemWith` · `hasStickers` · `hasKeychain`

Types — `SkinCategoryKey` · `WeaponRef` · `WeaponType` · `ResolvedWeapon` · `WeaponSelector` ·
`CategorySummary` · `NamedGroup` · `SkinRef` · `SkinIndex` · `MarketEntry` · `MarketVariant` ·
`MarketHashNameOptions` · `ParsedMarketHashName` · `ResolvedItem` · `ResolvedSticker` ·
`ResolvedKeychain` · `ItemCatalogs` · `ItemFinders` · `WearTier` · `WearTierId` · `WearName` ·
`WearShort` · `WearLike` · `RarityRank` · `RarityLike` · `RarityObject` · `RarityBearer`

### `@skinhub/cdn/catalog`
`loadSkinIndex` · `loadCatalog` · `LoadSkinIndexOptions` · `Catalog`

### `@skinhub/cdn/placement`
`makeSkinPlacement` · `makeStickerPlacement` · `makeKeychainPlacement` · `emptySticker` ·
`emptyKeychain` · `formatStickerRow` · `parseStickerRow` · `formatKeychainRow` · `parseKeychainRow` ·
`migrateLegacyKeychainRow` · `offsetFromNormalized` · `normalizedFromOffset` · `f32` · `u32` ·
`clamp` · `clampStickerOffset` · `shortFloat` · `STICKER_SLOTS` · `SkinPlacement` ·
`StickerPlacement` · `KeychainPlacement`

### `@skinhub/cdn/inspect`
`buildInspectUrl` · `readInspectUrl` · `toEconItem` · `fromEconItem` · `toGameCommand` ·
`isLegacyInspectUrl` · `EconItem` — plus everything from `/placement`, re-exported.

Everything in this section and the one above it is also on the root `@skinhub/cdn` export.

---

## Development

```bash
bun install
bun run typecheck   # tsc --noEmit, over src + test + scripts
bun test            # offline; fixtures + unit + bundle tests
bun run build       # rm -rf dist && tsc -p tsconfig.build.json
```

Two extra tiers, both opt-in because they need something the repo does not carry:

```bash
# Validate the types against the full 16 MB export rather than the committed fixtures
SKINHUB_CDN_FIXTURES=/path/to/asset-export/out/data bun test

# Hit the real CDN
bun run test:live
```

`test/fixtures/` holds a small sample of each real file, chosen so every edge case documented above
appears in it — the vanilla skins, the numeric glove `paint`, the `"null"` agent models, an empty
image, every nullable field null at least once. `test/types.test.ts` asserts both that the fixtures
validate and that those edge cases are actually present, so the validator cannot pass by being fed
easy rows.

`test/fixtures/inspect-corpus.json` is the other kind of fixture: the real ids the inspect corpus is
generated from — every `[defindex, paintindex]` pair in `skins.json`, a sample of sticker ids across
the whole range, and every charm id. `test/corpus.ts` crosses those with a seeded PRNG and a list of
named edge cases; `test/codec.test.ts` runs the result through `src/codec.ts` and through
`cs2-inspect-lib` and asserts the hex matches byte for byte; `test/codec-mutation.test.ts` perturbs
one token of the codec at a time and requires the corpus to catch every perturbation, plus two
controls it must not flag. That is what makes `cs2-inspect-lib` worth keeping as a devDependency:
remove it and the equivalence stops being checkable.

### Releasing

```bash
bun run release              # patch
bun run release minor
bun run release 1.2.0
bun run release patch --dry-run
```

Bumps the version, publishes, then commits and tags — and deliberately does **not** push; it prints
the command. It refuses to run on a dirty tree, refuses a version already on the registry, and
restores the previous version if typecheck, build or publish fails. `prepublishOnly` runs typecheck
and a clean build, so `npm publish` by hand cannot ship a broken package either.

## License

MIT
