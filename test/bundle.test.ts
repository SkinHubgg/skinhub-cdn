/**
 * Tree-shaking and browser-safety, measured on real bundles of the real build output.
 *
 * Three claims this package makes are only worth making if something enforces them:
 *
 *   1. "Someone who wants only `gloves.json` must not pull the code for the other seven."
 *   2. "The inspect codec builds for a browser" — the payoff of dropping `cs2-inspect-lib`.
 *   3. "Nothing in the shipped package resolves `cs2-inspect-lib` at all" — it is a devDependency
 *      now, kept only as the reference for `test/codec.test.ts`, so a stray `dist` import of it
 *      would be a runtime failure in a consumer's install rather than a size problem.
 *
 * Grepping source for an import string would pass on a comment and fail on a re-export chain. These
 * bundle a **synthetic consumer** — a file that imports an entry point and keeps the binding
 * reachable, which is what a real app looks like — and inspect what survives.
 *
 * Three deliberate choices about how:
 *
 *   - **Against `dist/`, not `src/`.** `dist` is what npm ships and what a consumer's bundler
 *     resolves, so this measures the shipped artefact rather than a compile of it.
 *   - **A consumer, not the barrel itself.** Bundling a pure re-export file proves nothing: with no
 *     used bindings a tree-shaker correctly drops every body and emits a ~600-byte list of names.
 *   - **Out of process** (`bundle-probe.ts`) — see the note there; `Bun.build` misresolves inside a
 *     `bun test` process.
 *
 * ## What this measured on 2026-08-11, before and after the codec was written natively
 *
 * | consumer imports | target | before | after |
 * |---|---|---|---|
 * | `fetchGloves` from `/gloves` | browser | 4.5 KB | 4.5 KB |
 * | `fetchGloves` from the barrel | browser | 4.5 KB | 4.5 KB — the codec shakes off entirely |
 * | `formatStickerRow` from `/placement` | browser | 2.0 KB | 2.0 KB |
 * | `createInspectUrl` from `dist/codec.js` | browser | — | 12.8 KB (no subpath: `/inspect` is the surface) |
 * | `* as cdn` from the barrel | browser | 7.8 KB | 40.4 KB — the codec is in it now |
 * | `buildInspectUrl` from `/inspect` | node | **~29 MB** | 16.7 KB |
 * | `buildInspectUrl` from `/inspect` | **browser** | **did not build** | **16.7 KB** |
 *
 * That 29 MB was `steam-user` + `node-cs2` + `steam-appticket` + `websocket13` + `socks-proxy-agent`
 * — an entire Steam client, reached for a protobuf encode that never talked to Steam, through an
 * `await import()` inside a method that a bundler still follows. It is why the inspect layer was kept
 * out of the root barrel: `import { fetchSkins } from '@skinhub/cdn'` would not have built for the web
 * at all. `src/codec.ts` removed the reason, so the barrel now carries it.
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const DIST = join(ROOT, 'dist')

type Target = 'browser' | 'node' | 'bun'
type Case = { name: string; module: string; importLine: string; target: Target }
type Result = { ok: boolean; bytes: number; error?: string; code?: string }

const uses = (name: string) => `import { ${name} } from '@@'\nglobalThis.keep = ${name}`
const usesAll = `import * as cdn from '@@'\nglobalThis.keep = cdn`

const DATASETS: Record<string, [fn: string, json: string]> = {
	skins: ['fetchSkins', 'skins.json'],
	stickers: ['fetchStickers', 'stickers.json'],
	gloves: ['fetchGloves', 'gloves.json'],
	agents: ['fetchAgents', 'agents.json'],
	music: ['fetchMusicKits', 'music.json'],
	keychains: ['fetchKeychains', 'keychains.json'],
	collectibles: ['fetchCollectibles', 'collectibles.json'],
	'items-game': ['fetchItemsGame', 'items_game.json'],
}

const CASES: Case[] = [
	{ name: 'gloves', module: 'datasets/gloves.js', importLine: uses('fetchGloves'), target: 'browser' },
	{ name: 'barrel', module: 'index.js', importLine: usesAll, target: 'browser' },
	{ name: 'barrel-one-dataset', module: 'index.js', importLine: uses('fetchGloves'), target: 'browser' },
	{ name: 'barrel-inspect', module: 'index.js', importLine: uses('buildInspectUrl'), target: 'browser' },
	{ name: 'placement', module: 'placement.js', importLine: uses('formatStickerRow'), target: 'browser' },
	{ name: 'config', module: 'config.js', importLine: uses('resolveCdnOrigin'), target: 'browser' },
	{ name: 'codec', module: 'codec.js', importLine: uses('createInspectUrl'), target: 'browser' },
	{ name: 'inspect-node', module: 'inspect.js', importLine: uses('buildInspectUrl'), target: 'node' },
	{ name: 'inspect-browser', module: 'inspect.js', importLine: uses('buildInspectUrl'), target: 'browser' },
	{ name: 'inspect-read-browser', module: 'inspect.js', importLine: uses('readInspectUrl'), target: 'browser' },
	...Object.entries(DATASETS).map(([file, [fn]]): Case => ({
		name: `dataset-${file}`,
		module: `datasets/${file}.js`,
		importLine: uses(fn),
		target: 'browser',
	})),
]

let results: Record<string, Result> = {}

const codeOf = (name: string): string => {
	const result = results[name]
	if (!result) throw new Error(`no probe result for "${name}"`)
	if (!result.ok) throw new Error(`bundling "${name}" failed:\n${result.error}`)
	if (result.code === undefined) throw new Error(`"${name}" was too large to return (${result.bytes} bytes)`)
	return result.code
}

beforeAll(async () => {
	const build = Bun.spawnSync(['bun', 'run', 'build'], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' })
	if (!existsSync(join(DIST, 'index.js'))) {
		throw new Error(`build did not produce dist/index.js:\n${build.stderr.toString()}${build.stdout.toString()}`)
	}

	const probe = Bun.spawnSync(['bun', 'run', join(ROOT, 'test', 'bundle-probe.ts'), JSON.stringify({ cases: CASES })], {
		cwd: ROOT,
		stdout: 'pipe',
		stderr: 'pipe',
	})

	const stdout = probe.stdout.toString()
	if (!stdout) throw new Error(`bundle probe produced no output:\n${probe.stderr.toString()}`)
	results = JSON.parse(stdout) as Record<string, Result>
}, 120_000)

describe('the runtime dependency is gone', () => {
	test('no entry point resolves cs2-inspect-lib — it is a devDependency now', () => {
		// The strongest form of the claim: if any shipped module still imported it, a bundle would
		// either fail to resolve it or inline a Steam client. Checked on every case, not just one,
		// because a stray import in `dist` would be a broken install rather than a size regression.
		for (const name of Object.keys(results)) {
			const result = results[name]
			if (!result?.ok || result.code === undefined) continue
			expect({ name, mentionsLib: result.code.includes('cs2-inspect-lib') }).toEqual({ name, mentionsLib: false })
			expect({ name, mentionsSteam: result.code.includes('steam-user') }).toEqual({ name, mentionsSteam: false })
			expect({ name, mentionsClass: result.code.includes('CS2Inspect') }).toEqual({ name, mentionsClass: false })
		}
	})

	test('package.json declares no runtime dependencies at all', async () => {
		const pkg = (await Bun.file(join(ROOT, 'package.json')).json()) as {
			dependencies?: Record<string, string>
			devDependencies?: Record<string, string>
		}
		expect(pkg.dependencies ?? {}).toEqual({})
		// Kept as a devDependency on purpose: it is the reference `test/codec.test.ts` compares the
		// native codec against. Delete it and the equivalence stops being checkable.
		expect(pkg.devDependencies?.['cs2-inspect-lib']).toBeDefined()
	})
})

describe('the inspect codec is browser-safe', () => {
	test('the inspect entry point builds for a browser — the payoff of writing the codec natively', () => {
		// This case asserted `ok === false` until 2026-08-11, because cs2-inspect-lib dragged `tls`,
		// `dns` and `readline` in behind an `await import()`. That is the regression to watch.
		const result = results['inspect-browser']
		expect(result?.ok).toBe(true)
		expect(result?.bytes).toBeLessThan(60_000)
		expect(codeOf('inspect-browser')).not.toContain('node:')
		expect(codeOf('inspect-read-browser')).not.toContain('node:')
	})

	test('and for node, at four orders of magnitude less than the ~29 MB it used to cost', () => {
		const result = results['inspect-node']
		expect(result?.ok).toBe(true)
		expect(result?.bytes).toBeLessThan(60_000)
	})

	test('the codec module itself is small, self-contained and needs no globals a browser lacks', () => {
		const code = codeOf('codec')
		expect(code.length).toBeLessThan(30_000)
		expect(code).not.toContain('node:')
		expect(code).not.toContain('require(')
		// TextEncoder/TextDecoder and DataView are the only host APIs it touches, and all three exist
		// in every browser, worker, Node 18+ and Bun.
		expect(code).toContain('TextEncoder')
	})
})

describe('the barrel still shakes', () => {
	test('a consumer of one dataset from the barrel carries none of the codec', () => {
		// The reason the codec can live in the root barrel at all. A named import of `fetchGloves`
		// must not drag a protobuf encoder along with it.
		const code = codeOf('barrel-one-dataset')
		expect(code).not.toContain('createInspectUrl')
		expect(code).not.toContain('csgo_econ_action_preview')
		expect(code.length).toBeLessThan(8_000)
	})

	test('a consumer of buildInspectUrl from the barrel carries none of the datasets', () => {
		const code = codeOf('barrel-inspect')
		expect(code).toContain('csgo_econ_action_preview')
		for (const [, [, jsonName]] of Object.entries(DATASETS)) {
			expect(code).not.toContain(jsonName)
		}
	})

	test('the namespace import of the barrel DOES carry the codec — else the tests above prove nothing', () => {
		const code = codeOf('barrel')
		expect(code).toContain('csgo_econ_action_preview')
		expect(code).toContain('gloves.json')
	})

	test('the placement entry point is still dependency-free and carries no codec', () => {
		const code = codeOf('placement')
		expect(code).not.toContain('csgo_econ_action_preview')
		expect(code).not.toContain('createInspectUrl')
		expect(code.length).toBeLessThan(12_000)
	})
})

describe('per-dataset tree-shaking', () => {
	test('the gloves consumer carries no other dataset', () => {
		const code = codeOf('gloves')

		expect(code).toContain('gloves.json')
		for (const [file, [, jsonName]] of Object.entries(DATASETS)) {
			if (file === 'gloves') continue
			expect(code).not.toContain(jsonName)
		}
	})

	test('one dataset costs a fraction of the whole package', () => {
		const one = codeOf('gloves').length
		const all = codeOf('barrel').length

		// Measured 4.5 KB vs 40.4 KB. Not a byte budget — a check that the subpath is a real saving
		// rather than a label on the same bytes.
		expect(one).toBeLessThan(all * 0.4)
	})

	test('reaching that dataset through the barrel costs the same as the subpath does', () => {
		// The property that makes the subpaths a convenience rather than a requirement: a named import
		// from the barrel tree-shakes down to what the subpath would have given you anyway. Measured
		// 4,539 vs 4,540 bytes.
		const subpath = codeOf('gloves').length
		const barrel = codeOf('barrel-one-dataset').length

		expect(Math.abs(barrel - subpath)).toBeLessThan(500)
	})

	test('every dataset entry point bundles on its own and carries its own file name', () => {
		for (const [file, [, jsonName]] of Object.entries(DATASETS)) {
			expect(codeOf(`dataset-${file}`)).toContain(jsonName)
		}
	})
})

describe('browser safety', () => {
	test('the data layer needs no node: builtins and no require()', () => {
		const code = codeOf('barrel')
		expect(code).not.toContain('node:fs')
		expect(code).not.toContain('node:path')
		expect(code).not.toContain('require(')
	})

	test('the env var is read off globalThis, so a plain browser does not ReferenceError', () => {
		const code = codeOf('config')
		expect(code).toContain('globalThis')
		// A bare `process.env.` would throw in a browser with no process shim.
		expect(code).not.toMatch(/[^.\w]process\.env/)
	})
})

describe('the published artefact', () => {
	test('dist ships JS and declarations for every entry point', () => {
		for (const file of [
			'index',
			'config',
			'cache',
			'errors',
			'fetch',
			'placement',
			'inspect',
			'codec',
			...Object.keys(DATASETS).map(name => `datasets/${name}`),
		]) {
			expect(existsSync(join(DIST, `${file}.js`))).toBe(true)
			expect(existsSync(join(DIST, `${file}.d.ts`))).toBe(true)
		}
	})

	test('the declarations do not require @types/node or bun-types', async () => {
		// tsconfig.build.json sets `types: []` so this is enforced at build time; asserted here too
		// because it is the property a browser consumer actually depends on.
		const declaration = await Bun.file(join(DIST, 'config.d.ts')).text()
		expect(declaration).not.toContain('NodeJS')
		expect(declaration).not.toContain('bun-types')
	})

	test('every subpath in the exports map resolves to a file that exists', async () => {
		const pkg = (await Bun.file(join(ROOT, 'package.json')).json()) as {
			exports: Record<string, { types?: string; bun?: string; import?: string } | string>
		}

		for (const [subpath, entry] of Object.entries(pkg.exports)) {
			if (typeof entry === 'string') {
				expect(existsSync(join(ROOT, entry))).toBe(true)
				continue
			}
			for (const [condition, target] of Object.entries(entry)) {
				expect({ subpath, condition, exists: existsSync(join(ROOT, target)) }).toEqual({
					subpath,
					condition,
					exists: true,
				})
			}
		}
	})
})
