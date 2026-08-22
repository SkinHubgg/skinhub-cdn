/**
 * WHICH AUTHORED HOME THE FIFTH STICKER HANGS OFF, and how far from it to sit.
 *
 * `sticker slot N schema` is a real items_game econ attribute (ids 290-295, `stored_as_integer 1`),
 * and the CS2 WeaponPaints plugin's `WeaponAction.cs` reads it as an ANCHOR: `uint stickerAnchor =
 * sticker.Schema != 0 ? sticker.Schema : (uint)stickerSlot`. 0 means "use the slot's own index".
 *
 * 29 of the 69 weapon+mesh variants author only four `StickerMarkup` homes on their model, so a
 * fifth sticker anchored to its own index (schema 0) points at a home that does not exist: the
 * material bakes `g_vSticker4Scale [0 0]`, the pixel shader treats a zero scale as a SKIP, and the
 * sticker draws nothing at all. Naming a home the weapon DOES author is what makes it draw.
 *
 * VERIFIED IN GAME, on a live server, on the owner's own AK-47 - a measurement, not a reading of
 * the files:
 *
 *     weapon_sticker_4 = '60;0;0;0;0;1;0'          -> NOTHING renders
 *     weapon_sticker_4 = '60;1;0.147;0.029;0;1;0'  -> the sticker RENDERS
 *
 * and `weapon_ak47.hd` below is that pair, at the precision the source generator prints.
 *
 * THE TABLE IS GENERATED, out of the weapon markup SkinHub's own 3D viewer renders from and the
 * fifth-slot home it derives for a weapon that authors none (`deriveFifthSlot`, in the SkinHub app
 * repo's `stickerSlots.ts`). Re-run `tools/skin-bench/dump-sticker-anchors.ts` there after a CS2
 * update moves a weapon's authored homes; do not edit a number here by hand.
 *
 * WHICH HOME THE RULE PICKS. Candidates are the authored homes 1..3 - home 0 is not one, because
 * the column's 0 already means "unset" and cannot name home 0. Among the rest: prefer the home
 * whose authored SCALE equals the size the viewer draws the fifth sticker at, then whose ROTATION
 * matches, then the nearest. Scale is the criterion because it is the one thing the row cannot
 * fix - a WeaponPaints sticker's own `scale` field is not read as a size at all (see
 * `DEFAULT_STICKER_SCALE` in `./placement.ts`), so the anchor home's authored scale is what the
 * sticker draws at, and POSITION is the part the row CAN move.
 *
 * 28 of the 29 borrow a home of exactly the right size; the Galil's legacy mesh is 2.5% out.
 *
 * WHAT OFFSET. `dx, dy` is the viewer's derived home MINUS the anchor home. A writer adds it to the
 * placement's own delta on the way into the column, and a reader subtracts it back off, so anchor
 * plus offset lands the sticker in game exactly where the viewer drew it.
 *
 * A VARIANT THAT AUTHORS ITS OWN FIFTH HOME IS ABSENT FROM THIS TABLE, and the absence is load
 * bearing: 40 of the 69 variants author all five homes, they already work, and no entry means a
 * caller keeps writing anchor 0 - the slot's own index, unchanged. The AWP is the shape to keep in
 * mind: its LEGACY mesh authors a real fifth home and its hd mesh does not, so only `hd` is listed.
 */

/** What a writer puts in the row for a slot the weapon authors no home for. */
export type StickerAnchor = {
	/** The authored home to hang the slot off. Never 0 - see above. */
	anchor: number
	/** The viewer's derived home minus the anchor home, in `g_vStickerNOffset` UV space. */
	dx: number
	dy: number
}

/**
 * Keyed by econ weapon id (`weapon_ak47`), then by mesh variant, because each mesh variant binds
 * its own material and its own markup - the two disagree by a few thousandths of a uv and by about
 * 8% of scale, and on five weapons they do not even want the same anchor.
 *
 * Ported verbatim from the Deduction (Next-il) site's own copy of this table -
 * `packages/config/utils/cs2/data/skins/stickerAnchors.ts` - which is the one already writing it
 * into a live `wp_player_skins` table. Keep the two in sync; the numbers must match to the digit.
 */
export const STICKER_ANCHORS: Record<string, { hd?: StickerAnchor; legacy?: StickerAnchor }> = {
	weapon_ak47: {
		hd: { anchor: 1, dx: 0.14699425, dy: 0.028994253 },
		legacy: { anchor: 1, dx: 0.12881461, dy: 0.03781461 },
	},
	weapon_awp: { hd: { anchor: 1, dx: 0.26138917, dy: 0.041389152 } },
	weapon_bizon: {
		hd: { anchor: 1, dx: -0.16905054, dy: -0.00005054744 },
		legacy: { anchor: 1, dx: 0.11569809, dy: 0.054698095 },
	},
	weapon_deagle: { legacy: { anchor: 1, dx: 0.13099661, dy: 0.031996623 } },
	weapon_elite: {
		hd: { anchor: 2, dx: -0.017009478, dy: 0.09099052 },
		legacy: { anchor: 2, dx: -0.034058955, dy: 0.06794105 },
	},
	weapon_galilar: {
		hd: { anchor: 1, dx: 0.3629775, dy: 0.0299775 },
		legacy: { anchor: 3, dx: 0.079801366, dy: 0.011801365 },
	}, // legacy borrows a home 12.5 against 12.2
	weapon_glock: { hd: { anchor: 1, dx: 0.31375384, dy: -0.07624616 } },
	weapon_m249: {
		hd: { anchor: 2, dx: -0.26837832, dy: 0.1806217 },
		legacy: { anchor: 3, dx: 0.0037358073, dy: 0.047735807 },
	},
	weapon_m4a1: { hd: { anchor: 1, dx: 0.33399266, dy: 0.015992647 } },
	weapon_mac10: { legacy: { anchor: 3, dx: 0.12097203, dy: 0.06197203 } },
	weapon_mag7: {
		hd: { anchor: 3, dx: -0.11744954, dy: 0.0085504595 },
		legacy: { anchor: 2, dx: -0.22446628, dy: 0.0075337263 },
	},
	weapon_mp9: { hd: { anchor: 2, dx: -0.05625756, dy: 0.13074245 } },
	weapon_negev: {
		hd: { anchor: 1, dx: 0.032989472, dy: 0.051989473 },
		legacy: { anchor: 3, dx: -0.15602273, dy: -0.016022725 },
	},
	weapon_scar20: {
		hd: { anchor: 3, dx: -0.0620967, dy: 0.013903301 },
		legacy: { anchor: 2, dx: 0.28459403, dy: -0.011405965 },
	},
	weapon_sg556: {
		hd: { anchor: 2, dx: -0.06719466, dy: -0.02519466 },
		legacy: { anchor: 2, dx: -0.061953463, dy: -0.015953463 },
	},
	weapon_ssg08: {
		hd: { anchor: 1, dx: 0.0839881, dy: 0.024988096 },
		legacy: { anchor: 3, dx: -0.041737854, dy: -0.0067378553 },
	},
	weapon_tec9: { hd: { anchor: 1, dx: 0.16984202, dy: 0.13384202 } },
	weapon_ump45: {
		hd: { anchor: 2, dx: -0.060853533, dy: 0.06014647 },
		legacy: { anchor: 3, dx: -0.15774709, dy: -0.008747093 },
	},
}

/** The slot this is for. Slots 0-3 are authored on every sticker-capable weapon. */
export const FIFTH_STICKER_SLOT = 4

/** The column's "unset", which makes the plugin fall back to the slot's own index. */
export const NO_STICKER_ANCHOR = 0

/**
 * The anchor for a slot, or `null` when a caller must keep writing/reading 0.
 *
 * `null` is the answer for every slot but the fifth, for every weapon whose rendered variant
 * authors its own fifth home, and for anything this table has never heard of - all three of which
 * must keep behaving as if no anchor exists, because 0 is what every row written before this table
 * existed already carries, and it is what the plugin has always done with them.
 */
export const stickerAnchorFor = (
	weaponId: string | null | undefined,
	legacy: boolean,
	slot: number,
): StickerAnchor | null => {
	if (slot !== FIFTH_STICKER_SLOT || !weaponId) return null
	const entry = STICKER_ANCHORS[weaponId]
	if (!entry) return null
	return (legacy ? entry.legacy : entry.hd) ?? null
}

/** The fields of a catalogue row the lookup below needs - `@skinhub/cdn`'s own `Skin` satisfies it. */
export type AnchorCatalogSkin = {
	weapon: { id: string; weapon_id: number }
	paint_index: string | null
	legacy_model: boolean
}

/** defindex -> weapon item id, never a `sfui_wpnhud_*` alias when a real name exists. */
const weaponIdsByDefindex = (skins: readonly AnchorCatalogSkin[]) => {
	const map = new Map<number, string>()
	for (const skin of skins) {
		const alias = skin.weapon.id.startsWith('sfui_')
		if (!alias || !map.has(skin.weapon.weapon_id)) map.set(skin.weapon.weapon_id, skin.weapon.id)
	}
	return map
}

/**
 * `(defindex, paint, slot) -> the anchor that row needs`, built once over a skins catalogue such as
 * `@skinhub/cdn`'s own `fetchSkins()` result.
 *
 * WHICH MESH IS PART OF THE ANSWER. Each mesh variant binds its own material and its own markup, so
 * the two disagree by a few thousandths of a uv and by about 8% of scale, and on five weapons they
 * do not even want the same anchor. The rule for which one CS2 draws is the plugin's, character for
 * character - `WeaponAction.cs` does `isLegacyModel = skinInfo.Count <= 0 ||
 * SkinIsLegacyModel(skinInfo[0])`, matching on defindex AND paint - so a paint flagged
 * `legacy_model` renders legacy, and so does a paint the catalogue has never heard of: a kit
 * borrowed onto a weapon it was never made for matches no row, and the game draws it on the legacy
 * mesh.
 */
export const stickerAnchorLookup = (skins: readonly AnchorCatalogSkin[]) => {
	const weaponIds = weaponIdsByDefindex(skins)
	const legacyByPaint = new Map<string, boolean>()
	for (const skin of skins) legacyByPaint.set(`${skin.weapon.weapon_id}:${Number(skin.paint_index)}`, skin.legacy_model)

	return (weapon_defindex: number, weapon_paint_id: number, slot: number): StickerAnchor | null => {
		const known = legacyByPaint.get(`${weapon_defindex}:${weapon_paint_id}`)
		return stickerAnchorFor(weaponIds.get(weapon_defindex), known === undefined || known, slot)
	}
}
