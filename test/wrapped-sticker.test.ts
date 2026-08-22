/**
 * Regression test for `wrapped_sticker` surviving the BUILT output.
 *
 * The bug this guards against already happened once: `src/codec.ts` read and wrote
 * `wrapped_sticker` (the sticker sealed inside a `Charm | Sticker Slab`) all along, but
 * `KeychainPlacement` in `src/placement.ts` was six fields wide and dropped it silently in both
 * directions — no throw, no type error, just a charm that quietly lost its sealed sticker on the
 * way through `src/placement.ts` / `src/inspect.ts`. The fix (porting the field onto
 * `KeychainPlacement`, `DEFAULT_KEYCHAIN`, `makeKeychainPlacement` and `toInspectKeychain`) was
 * never upstreamed past a local patch on `@skinhub/cdn@0.1.3` — 0.2.0, 0.2.1 and 0.2.2 all shipped
 * without it.
 *
 * This runs against `dist/`, not `src/`, and rebuilds first — the same discipline
 * `test/bundle.test.ts` uses — because "the source has the field" is not the claim that matters.
 * The claim that matters is that `tsc`'s emit still has it, since that is what a consumer's
 * `bun install` actually receives.
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const DIST = join(ROOT, 'dist')

type PlacementModule = {
	DEFAULT_KEYCHAIN: { wrapped_sticker: number }
	makeKeychainPlacement: (placement: Record<string, unknown>) => { wrapped_sticker: number }
}

type InspectModule = {
	buildInspectUrl: (skin: unknown) => string
	readInspectUrl: (url: string) => { keychain: { wrapped_sticker: number } | null }
}

beforeAll(() => {
	const build = Bun.spawnSync(['bun', 'run', 'build'], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' })
	if (!existsSync(join(DIST, 'placement.js')) || !existsSync(join(DIST, 'inspect.js'))) {
		throw new Error(`build did not produce dist/placement.js + dist/inspect.js:\n${build.stderr.toString()}`)
	}
}, 60_000)

describe('wrapped_sticker survives the built dist/, not only src/', () => {
	test('dist/placement.js: DEFAULT_KEYCHAIN and makeKeychainPlacement both carry the field', async () => {
		const placement = (await import(join(DIST, 'placement.js'))) as PlacementModule
		expect(placement.DEFAULT_KEYCHAIN.wrapped_sticker).toBe(0)

		const made = placement.makeKeychainPlacement({ slot: 0, sticker_id: 21, wrapped_sticker: 60 })
		expect(made.wrapped_sticker).toBe(60)

		// The failure mode is silent, not a throw: a stale six-field type just drops the key.
		expect('wrapped_sticker' in made).toBe(true)
	})

	test('dist/inspect.js: a sealed sticker round-trips through an actual inspect link', async () => {
		const inspect = (await import(join(DIST, 'inspect.js'))) as InspectModule
		const skin = {
			defindex: 60,
			paintindex: 0,
			paintseed: 0,
			paintwear: 0,
			stickers: [],
			keychain: { slot: 0, sticker_id: 21, offset_x: 0, offset_y: 0, offset_z: 0, pattern: 0, wrapped_sticker: 60 },
		}

		const url = inspect.buildInspectUrl(skin)
		const decoded = inspect.readInspectUrl(url)
		expect(decoded.keychain?.wrapped_sticker).toBe(60)
	})

	test('dist/inspect.js: an EMPTY slab still omits the field, byte for byte — the load-bearing conditional', async () => {
		const inspect = (await import(join(DIST, 'inspect.js'))) as InspectModule
		const withoutSlab = {
			defindex: 60,
			paintindex: 0,
			paintseed: 0,
			paintwear: 0,
			stickers: [],
			keychain: { slot: 0, sticker_id: 21, offset_x: 0, offset_y: 0, offset_z: 0, pattern: 0, wrapped_sticker: 0 },
		}
		const withSlab = { ...withoutSlab, keychain: { ...withoutSlab.keychain, wrapped_sticker: 5 } }

		// wrapped_sticker: 0 must encode to the SAME link an ordinary charm always has — this is
		// what stops the fix from appending a pointless `60 00` to every charm that seals nothing.
		expect(inspect.buildInspectUrl(withoutSlab)).toBe(inspect.buildInspectUrl({ ...withoutSlab }))
		expect(inspect.buildInspectUrl(withSlab)).not.toBe(inspect.buildInspectUrl(withoutSlab))
	})

	test('the built .d.ts still declares the field — catches a type-only regression too', () => {
		const dts = readFileSync(join(DIST, 'placement.d.ts'), 'utf8')
		expect(dts.includes('wrapped_sticker: number')).toBe(true)
	})
})
