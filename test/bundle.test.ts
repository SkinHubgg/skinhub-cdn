/**
 * Tree-shaking and the dependency seam, measured on real bundles of the real build output.
 *
 * Two claims this package makes are only worth making if something enforces them:
 *
 *   1. "Someone who wants only `gloves.json` must not pull the code for the other seven."
 *   2. "A data-only consumer never resolves `cs2-inspect-lib`."
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
 * ## What this measured on 2026-08-08
 *
 * | consumer imports | target | result |
 * |---|---|---|
 * | `fetchGloves` | browser | ~4.5 KB, no other dataset, no `cs2-inspect-lib` |
 * | the whole data barrel | browser | ~7.8 KB |
 * | `buildInspectUrl` | node | **~29 MB** |
 * | `buildInspectUrl` | browser | **does not build** — Node builtins (`tls`, `dns`, `readline`, …) |
 *
 * That 29 MB is `steam-user` + `node-cs2` + `steam-appticket` + `websocket13` + `socks-proxy-agent`
 * — an entire Steam client, reached for a protobuf encode that never talks to Steam.
 * `cs2-inspect-lib` gets there through an `await import()` inside a method, which a bundler still
 * follows. It is the strongest argument for the seam: had the inspect layer been re-exported from
 * the root barrel, `import { fetchSkins } from '@skinhub/cdn'` would not build for the web at all.
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
	{ name: 'placement', module: 'placement.js', importLine: uses('formatStickerRow'), target: 'browser' },
	{ name: 'config', module: 'config.js', importLine: uses('resolveCdnOrigin'), target: 'browser' },
	{ name: 'inspect-node', module: 'inspect.js', importLine: uses('buildInspectUrl'), target: 'node' },
	{ name: 'inspect-browser', module: 'inspect.js', importLine: uses('buildInspectUrl'), target: 'browser' },
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

describe('the inspect seam', () => {
	test('a consumer of one dataset does not pull cs2-inspect-lib', () => {
		const code = codeOf('gloves')
		expect(code).not.toContain('cs2-inspect-lib')
		expect(code).not.toContain('steam-user')
		expect(code).not.toContain('CS2Inspect')
	})

	test('a consumer of the whole data barrel does not pull it either', () => {
		const code = codeOf('barrel')
		expect(code).not.toContain('cs2-inspect-lib')
		expect(code).not.toContain('steam-user')
		expect(code).not.toContain('CS2Inspect')
	})

	test('the placement entry point is dependency-free', () => {
		const code = codeOf('placement')
		expect(code).not.toContain('cs2-inspect-lib')
		expect(code).not.toContain('CS2Inspect')
		expect(code.length).toBeLessThan(12_000)
	})

	test('the inspect entry point DOES pull it — otherwise the tests above prove nothing', () => {
		const result = results['inspect-node']
		expect(result?.ok).toBe(true)
		// Too big to hand back as a string; the size IS the finding.
		expect(result?.bytes).toBeGreaterThan(1_000_000)
	})

	test('and it is server-only: cs2-inspect-lib drags Steam transports a browser cannot have', () => {
		// The constraint the README documents, pinned so it cannot regress silently. If
		// cs2-inspect-lib ever drops its steam-user path this fails, and the docs get corrected.
		const result = results['inspect-browser']
		expect(result?.ok).toBe(false)
		expect(result?.error).toContain('Node.js builtin')
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

	test('one dataset costs meaningfully less than all eight', () => {
		const one = codeOf('gloves').length
		const all = codeOf('barrel').length

		expect(one).toBeLessThan(all)
		// Measured ~4.5 KB vs ~7.8 KB. Not a byte budget — a check that the subpath is a real saving
		// rather than a label on the same bytes.
		expect(one).toBeLessThan(all * 0.75)
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
