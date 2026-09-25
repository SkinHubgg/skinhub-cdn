/**
 * The C4 (defindex 49, paint 0), which takes stickers and a charm since CS2 1.41.8.2 but has no
 * `skins.json` row. The claims under test:
 *
 *   - nothing in the placement or row layer filters it out - it was never keyed on a weapon list,
 *     and this pins that it stays that way;
 *   - it gets no fifth-slot anchor here, so a writer stores a fifth sticker with anchor 0 - the
 *     WeaponPaints plugin anchors the C4's fifth itself - and `stickerSlotsFor` offers all five;
 *   - `resolveItem` names it with or without a row; the exporter's own row (from 1.41.8.2 on,
 *     `skin-vanilla-weapon_c4` in `equipment`) wins when present, and the constants agree with it.
 */

import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Skins } from '../src/datasets/skins.js'
import { buildInspectUrl, readInspectUrl } from '../src/inspect.js'
import {
	C4_DEFINDEX,
	C4_PAINT_INDEX,
	C4_STICKER_SLOTS,
	C4_WEAPON,
	emptySticker,
	formatKeychainRow,
	formatStickerRow,
	isC4,
	makeKeychainPlacement,
	makeSkinPlacement,
	makeStickerPlacement,
	NO_STICKER_ANCHOR,
	parseStickerRow,
	type SkinPlacement,
	stickerAnchorLookup,
	stickerSlotsFor,
} from '../src/placement.js'
import {
	createSkinIndex,
	isUntradable,
	isVanilla,
	listWeaponTypes,
	resolveItem,
	skinCategory,
	weaponIdForDefindex,
} from '../src/query/index.js'
import { usesNativeCodec } from './corpus.js'

const skins = JSON.parse(await readFile(join(import.meta.dir, 'fixtures', 'skins.json'), 'utf8')) as Skins

/**
 * The row the exporter emits for the C4 from 1.41.8.2 on, copied field for field from its first
 * staged `data/skins.json` (the description shortened). The committed fixture predates it, which is
 * the older-export case the constants exist for.
 */
const exportedC4Row: Skins[number] = {
	id: 'skin-vanilla-weapon_c4',
	name: 'C4 Explosive | Default',
	description: 'Stable and resistant to most physical shocks, this improvised plastic explosive…',
	weapon: { id: 'weapon_c4', weapon_id: 49, name: 'C4 Explosive' },
	category: { id: 'loadoutslot_equipment', name: 'Equipment' },
	pattern: null,
	min_float: null,
	max_float: null,
	rarity: { id: 'rarity_default_weapon', name: 'Stock', color: '#ded6cc' },
	stattrak: false,
	paint_index: '0',
	crates: [],
	team: { id: 'terrorists', name: 'Terrorist' },
	legacy_model: false,
	image: 'https://cdn.skinhub.gg/econicons/panorama/images/econ/weapons/base_weapons/weapon_c4_png.png',
	color: '#bea86f',
	original: { name: 'weapon_c4' },
}

const c4 = (): SkinPlacement =>
	makeSkinPlacement({
		defindex: C4_DEFINDEX,
		paintindex: C4_PAINT_INDEX,
		paintseed: 0,
		paintwear: 0,
		nametag: 'tick tock',
		stickers: [
			makeStickerPlacement({ slot: 0, sticker_id: 7691, wear: 0.1, rotation: 15, offset_x: 0.05, offset_y: -0.1 }),
			makeStickerPlacement({ slot: 3, sticker_id: 5032, offset_x: -0.2, offset_y: 0.2 }),
		],
		keychain: makeKeychainPlacement({ sticker_id: 21, offset_x: 0.5, offset_y: -0.25, offset_z: 0.1, pattern: 4242 }),
	})

describe('the constants', () => {
	test('defindex 49 is weapon_c4, and it offers five sticker slots like the viewer', () => {
		expect(C4_WEAPON).toEqual({ defindex: 49, id: 'weapon_c4', name: 'C4 Explosive', category: 'equipment' })
		expect(isC4(49)).toBe(true)
		expect(isC4(31)).toBe(false)
		expect([...C4_STICKER_SLOTS]).toEqual([0, 1, 2, 3, 4])
		expect(stickerSlotsFor(C4_DEFINDEX)).toEqual([...C4_STICKER_SLOTS])
		expect(stickerSlotsFor(7)).toEqual([0, 1, 2, 3, 4])
	})

	test('an export older than 1.41.8.2 has no C4 row, so the row-derived lookups cannot see it', () => {
		expect(skins.some(skin => skin.weapon.weapon_id === C4_DEFINDEX)).toBe(false)
		expect(weaponIdForDefindex(skins, C4_DEFINDEX)).toBeUndefined()
	})

	test("the constants agree with the exporter's C4 row, field for field", () => {
		const withRow = [...skins, exportedC4Row]
		expect(exportedC4Row.weapon.weapon_id).toBe(C4_WEAPON.defindex)
		expect(exportedC4Row.weapon.id).toBe(C4_WEAPON.id)
		expect(exportedC4Row.weapon.name).toBe(C4_WEAPON.name)
		expect(Number(exportedC4Row.paint_index)).toBe(C4_PAINT_INDEX)
		expect(skinCategory(exportedC4Row)).toBe(C4_WEAPON.category)
		expect(weaponIdForDefindex(withRow, C4_DEFINDEX)).toBe(C4_WEAPON.id)
		expect(listWeaponTypes(withRow, 'equipment').map(type => type.id)).toContain('weapon_c4')
		// A vanilla gun in every way that matters: finish-less, and no Steam listing.
		expect(isVanilla(exportedC4Row)).toBe(true)
		expect(isUntradable(exportedC4Row)).toBe(true)
	})
})

describe('the placement and row layer takes a C4 like any gun', () => {
	test('makeSkinPlacement keeps defindex 49, paint 0 and every sticker', () => {
		const placement = c4()
		expect(placement.defindex).toBe(49)
		expect(placement.paintindex).toBe(0)
		expect(placement.stickers.filter(sticker => sticker.sticker_id > 0).map(sticker => sticker.slot)).toEqual([0, 3])
		expect(placement.keychain?.sticker_id).toBe(21)
	})

	test('the sticker and charm columns round-trip, with no anchor on any slot', () => {
		const anchorFor = stickerAnchorLookup(skins)
		for (const sticker of c4().stickers) {
			const anchor = anchorFor(C4_DEFINDEX, C4_PAINT_INDEX, sticker.slot)
			expect(anchor).toBeNull()
			const row = formatStickerRow(sticker, anchor)
			expect(row.split(';')[1]).toBe(String(NO_STICKER_ANCHOR))
			expect(parseStickerRow(row, sticker.slot, anchor)).toEqual(sticker)
		}
		const keychain = c4().keychain as NonNullable<SkinPlacement['keychain']>
		expect(formatKeychainRow(keychain)).toBe('21;0.5;-0.25;0.1;4242')
	})

	test('a fifth sticker is carried, not dropped', () => {
		const placement = makeSkinPlacement({
			...c4(),
			stickers: [makeStickerPlacement({ slot: 4, sticker_id: 1 })],
		})
		expect(placement.stickers[4]?.sticker_id).toBe(1)
		expect(placement.stickers[3]).toEqual(emptySticker(3))
	})
})

describe.skipIf(!usesNativeCodec)('a C4 inspect link', () => {
	test('round-trips stickers, charm and name', () => {
		const before = c4()
		expect(readInspectUrl(buildInspectUrl(before))).toEqual(before)
	})
})

describe('resolveItem names the C4 without a row', () => {
	test('with no lists at all', () => {
		const item = resolveItem(c4())
		expect(item.weapon).toEqual({ ...C4_WEAPON, aliased: false })
		expect(item.name).toBe('C4 Explosive')
		expect(item.category).toBe('equipment')
		expect(item.vanilla).toBe(true)
		expect(item.skin).toBeUndefined()
		expect(item.marketHashName).toBeNull()
		expect(item.stickers.map(sticker => sticker.slot)).toEqual([0, 3])
		expect(item.keychain?.keychainId).toBe(21)
	})

	test('with the skins list, and through an index', () => {
		expect(resolveItem(c4(), { skins }).weapon?.id).toBe('weapon_c4')
		expect(createSkinIndex(skins).resolve(c4()).weapon?.id).toBe('weapon_c4')
	})

	test('only paint 0 is the C4 - a painted 49 is an unknown item, as before', () => {
		const item = resolveItem({ ...c4(), paintindex: 44 }, { skins })
		expect(item.weapon).toBeUndefined()
		expect(item.name).toBeUndefined()
		expect(item.vanilla).toBe(false)
	})

	test("the exporter's row wins over the constant when the list has it", () => {
		const withRow = [...skins, exportedC4Row]
		for (const item of [resolveItem(c4(), { skins: withRow }), createSkinIndex(withRow).resolve(c4())]) {
			expect(item.skin).toBe(exportedC4Row)
			expect(item.name).toBe('C4 Explosive | Default')
			// Same weapon, same category, same vanilla-ness as without the row.
			expect(item.weapon).toEqual({ ...C4_WEAPON, aliased: false })
			expect(item.category).toBe('equipment')
			expect(item.vanilla).toBe(true)
			expect(item.marketHashName).toBeNull()
		}
	})
})
