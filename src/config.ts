/**
 * Where the CDN lives, and how a caller says so.
 *
 * Three ways to set the origin, highest priority first:
 *
 *   1. `{ origin }` on the call            — `fetchSkins({ origin: 'http://localhost:8787' })`
 *   2. `configureCdn({ origin })`          — a process-wide default set in code
 *   3. `SKINHUB_CDN_URL` in the environment
 *   4. otherwise `https://cdn.skinhub.gg`
 *
 * (2) exists because (3) does not work in a browser. Bundlers only inline the environment
 * variables they are told to — Next.js inlines `NEXT_PUBLIC_*` and nothing else, Vite inlines
 * `VITE_*` — so a client bundle that relied on `process.env.SKINHUB_CDN_URL` would silently fall
 * through to the default. Setting it in code at startup is the supported client-side path, not a
 * workaround.
 */

const DEFAULT_ORIGIN = 'https://cdn.skinhub.gg'

/** The origin used when nothing else is configured. */
export const SKINHUB_CDN_DEFAULT_ORIGIN = DEFAULT_ORIGIN

/** The environment variable read on the server. */
export const SKINHUB_CDN_ENV_VAR = 'SKINHUB_CDN_URL'

/** Trailing slashes are stripped so `${origin}/data/x.json` never doubles up. */
export const normalizeOrigin = (origin: string) => origin.trim().replace(/\/+$/, '')

let configuredOrigin: string | undefined

export type CdnConfig = {
	/** Absolute origin, with or without a trailing slash. Pass `undefined` to clear. */
	origin?: string | undefined
}

/**
 * Set the process-wide default origin. Call it once at startup; it wins over the environment and
 * loses to an `origin` passed on an individual call.
 */
export const configureCdn = (config: CdnConfig) => {
	configuredOrigin = config.origin === undefined ? undefined : normalizeOrigin(config.origin)
}

/** Whatever `configureCdn` was last given, or `undefined`. Mostly useful in tests. */
export const getConfiguredOrigin = () => configuredOrigin

/**
 * Reads `SKINHUB_CDN_URL` without assuming `process` exists — this package also runs in a browser.
 *
 * Deliberately `globalThis.process?.env` and not a bare `process.env`:
 *   - a bare reference is a `ReferenceError` in a plain browser, not `undefined`;
 *   - it would make the published `.d.ts` depend on `@types/node`, which a browser consumer should
 *     not have to install to typecheck;
 *   - `process` can exist with no `env` (some edge runtimes), which `typeof process` misses.
 *
 * The dynamic key also means no bundler can statically inline this — which is not a regression but
 * the reason `configureCdn` exists. See the precedence note at the top of the file.
 */
const originFromEnv = (): string | undefined => {
	const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
	const value = env?.[SKINHUB_CDN_ENV_VAR]
	return value ? normalizeOrigin(value) : undefined
}

/** Applies the precedence documented above. */
export const resolveCdnOrigin = (origin?: string): string => {
	if (origin) return normalizeOrigin(origin)
	if (configuredOrigin) return configuredOrigin
	return originFromEnv() ?? DEFAULT_ORIGIN
}

/** Absolute URL for any path on the CDN — textures, models, `manifest.json`, anything. */
export const cdnUrl = (path: string, origin?: string): string =>
	`${resolveCdnOrigin(origin)}/${path.replace(/^\/+/, '')}`

/** Absolute URL for a file under `data/`. `dataUrl('skins.json')`. */
export const dataUrl = (file: string, origin?: string): string => cdnUrl(`data/${file}`, origin)
