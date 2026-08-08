import { afterEach, describe, expect, test } from 'bun:test'
import {
	cdnUrl,
	configureCdn,
	dataUrl,
	getConfiguredOrigin,
	normalizeOrigin,
	resolveCdnOrigin,
	SKINHUB_CDN_DEFAULT_ORIGIN,
	SKINHUB_CDN_ENV_VAR,
} from '../src/config.js'

const withEnv = (value: string | undefined, run: () => void) => {
	const previous = process.env[SKINHUB_CDN_ENV_VAR]
	if (value === undefined) delete process.env[SKINHUB_CDN_ENV_VAR]
	else process.env[SKINHUB_CDN_ENV_VAR] = value
	try {
		run()
	} finally {
		if (previous === undefined) delete process.env[SKINHUB_CDN_ENV_VAR]
		else process.env[SKINHUB_CDN_ENV_VAR] = previous
	}
}

afterEach(() => configureCdn({ origin: undefined }))

describe('origin precedence', () => {
	test('falls back to cdn.skinhub.gg', () => {
		withEnv(undefined, () => expect(resolveCdnOrigin()).toBe('https://cdn.skinhub.gg'))
		expect(SKINHUB_CDN_DEFAULT_ORIGIN).toBe('https://cdn.skinhub.gg')
	})

	test('SKINHUB_CDN_URL beats the default', () => {
		withEnv('https://env.example', () => expect(resolveCdnOrigin()).toBe('https://env.example'))
	})

	test('configureCdn beats the environment', () => {
		withEnv('https://env.example', () => {
			configureCdn({ origin: 'https://code.example' })
			expect(resolveCdnOrigin()).toBe('https://code.example')
		})
	})

	test('an explicit argument beats configureCdn and the environment', () => {
		withEnv('https://env.example', () => {
			configureCdn({ origin: 'https://code.example' })
			expect(resolveCdnOrigin('https://call.example')).toBe('https://call.example')
		})
	})

	test('configureCdn({ origin: undefined }) clears it again', () => {
		configureCdn({ origin: 'https://code.example' })
		expect(getConfiguredOrigin()).toBe('https://code.example')
		configureCdn({ origin: undefined })
		expect(getConfiguredOrigin()).toBeUndefined()
	})

	test('an empty string does not count as a configured origin', () => {
		withEnv('', () => expect(resolveCdnOrigin()).toBe('https://cdn.skinhub.gg'))
		expect(resolveCdnOrigin('')).toBe('https://cdn.skinhub.gg')
	})
})

describe('url building', () => {
	test('trailing and leading slashes never double up', () => {
		expect(normalizeOrigin('https://x.example///')).toBe('https://x.example')
		expect(cdnUrl('manifest.json', 'https://x.example/')).toBe('https://x.example/manifest.json')
		expect(cdnUrl('/manifest.json', 'https://x.example')).toBe('https://x.example/manifest.json')
	})

	test('dataUrl points at data/', () => {
		expect(dataUrl('skins.json', 'https://x.example')).toBe('https://x.example/data/skins.json')
	})

	test('works for a local origin with a port and a path prefix', () => {
		configureCdn({ origin: 'http://localhost:8787/cdn/' })
		expect(dataUrl('gloves.json')).toBe('http://localhost:8787/cdn/data/gloves.json')
	})
})
