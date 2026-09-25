/**
 * `data/pets.json` and `data/petVariants.json` - the chicken pets CS2 added in 1.41.8.2.
 *
 * **Both are objects, not arrays**, like `items_game.json`. `pets.json` is a handful of item and
 * attribute ids plus one row per `pet_definitions` entry (5 today: egg, chick, and three adult
 * breeds). `petVariants.json` is per-model render data - material groups, roll weights, the
 * body-shape pose ranges and the vmat expressions a viewer needs to draw a particular chicken.
 *
 * `pets.json` is the small one and the one most consumers want. `petVariants.json` is only for a
 * renderer; fetch it when you draw, not when you list.
 *
 * Paths inside both files (`glb`, `icon`, texture slots) are CDN paths relative to the origin, not
 * absolute URLs. Turn them into URLs with `cdnUrl(path)`, which honours the configured origin.
 *
 * Everything that needs no fetch - the types, the stage table, the WeaponPaints row codec - is in
 * `../pets.ts` and re-exported here, so `@skinhub/cdn/pets` is a complete surface on its own.
 */

import type { DatasetOptions } from '../fetch.js'
import { fetchCdnData } from '../fetch.js'
import type { PetsJson, PetVariantsJson } from '../pets.js'

export * from '../pets.js'

/** `data/pets.json`. */
export const PETS_FILE = 'pets.json'

/** `data/petVariants.json`. */
export const PET_VARIANTS_FILE = 'petVariants.json'

export const fetchPets = (options: DatasetOptions<PetsJson> = {}): Promise<PetsJson> =>
	fetchCdnData<PetsJson>(PETS_FILE, options)

export const fetchPetVariants = (options: DatasetOptions<PetVariantsJson> = {}): Promise<PetVariantsJson> =>
	fetchCdnData<PetVariantsJson>(PET_VARIANTS_FILE, options)
