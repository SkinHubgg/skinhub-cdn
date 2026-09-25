/**
 * The C4 - stickers since CS2 1.41.8.2, and the one weapon older exports have no `skins.json` row for.
 *
 * CS2 1.41.8.2 (2026-09-22) gave the `c4` prefab `weapon_supports_stickers`, so a C4 now carries
 * stickers and a charm like any gun: defindex 49, `weapon_c4`, paint 0 (it has no finishes at all).
 *
 * **Why it is a constant here when every other weapon is derived from the rows.** Everything in
 * `./query/taxonomy.ts` is a function of `skins.json`, deliberately, so a knife Valve ships next
 * month appears without a release of this package. Exports made before 1.41.8.2 have no C4 row: the
 * exporter classifies rows by prefab category, the C4's prefab chain reaches `weapon_base` and
 * stops, and it has no paint kits. From 1.41.8.2 the exporter emits one vanilla row for it -
 * `skin-vanilla-weapon_c4`, `C4 Explosive | Default`, paint `'0'`, category `loadoutslot_equipment`
 * next to the Zeus - and the row-derived functions pick it up like any other weapon. These constants
 * are what a consumer holding an OLDER `skins.json` (a fallback copy, a database mirror) still needs,
 * and they agree with that row field for field; `test/c4.test.ts` holds them to it.
 *
 * **Five sticker slots, the fifth borrowed.** The rebuilt `weapon_c4.vmdl` authors four
 * `StickerMarkup` homes (Autograph, Team1, Team2, Map), all on the keypad face, so the C4 is one
 * more four-home weapon: a fifth sticker anchored to its own index draws nothing (see
 * `./stickerAnchors.ts`). The SkinHub viewer keeps five slots on it and derives the fifth home on the
 * side of the brick, and the WeaponPaints plugin carries the matching anchor for defindex 49 itself
 * (`StickerAnchors.cs`), so a writer stores slot 4 with anchor 0 like any other slot and the plugin
 * does the shift. `STICKER_ANCHORS` here has no C4 row for that reason. Whether the game's own C4
 * has a fifth sticker is unconfirmed (community sites say five, the model says four).
 * `stickerSlotsFor` is what a UI or a WeaponPaints writer should offer. Nothing in this package
 * drops a fifth sticker on its own - a placement is carried as given.
 *
 * No imports, so it can sit behind `@skinhub/cdn/placement` as well as `@skinhub/cdn/query`.
 */

/** Item definition index of `weapon_c4`. */
export const C4_DEFINDEX = 49

/** The item name, `weapon_c4` - what a model path keys on. */
export const C4_WEAPON_ID = 'weapon_c4'

/** `#SFUI_WPNHUD_C4`, in English. */
export const C4_NAME = 'C4 Explosive'

/** The C4 has no finishes; paint 0 is the only paint it can have. */
export const C4_PAINT_INDEX = 0

/** The C4's sticker slots: its four authored homes plus the borrowed fifth, like every other weapon. */
export const C4_STICKER_SLOTS = [0, 1, 2, 3, 4] as const

/** Every other sticker-capable weapon: slots 0-4, the fifth via its anchor when it has no home of its own. */
const ALL_STICKER_SLOTS = [0, 1, 2, 3, 4] as const

/**
 * The C4 as a weapon reference, shaped like `WeaponRef` in `@skinhub/cdn/query`. `category` is
 * `'equipment'` because that is where the exporter's C4 row sits (`loadoutslot_equipment`, beside the
 * Zeus), so a consumer gets the same answer with or without that row.
 */
export const C4_WEAPON = {
	defindex: C4_DEFINDEX,
	id: C4_WEAPON_ID,
	name: C4_NAME,
	category: 'equipment',
} as const

export const isC4 = (defindex: number): boolean => defindex === C4_DEFINDEX

/** The sticker slots worth offering on a weapon: five everywhere, the C4 included since the plugin anchors its fifth. */
export const stickerSlotsFor = (defindex: number): readonly number[] =>
	defindex === C4_DEFINDEX ? C4_STICKER_SLOTS : ALL_STICKER_SLOTS
