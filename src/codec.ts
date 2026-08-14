/**
 * The CS2 inspect-link codec: `CEconItemPreviewDataBlock` protobuf plus Valve's CRC framing.
 *
 * **This module has no imports.** It is pure maths — no network, no Steam, no Node built-ins — and
 * that is the whole point of it existing. It replaces `cs2-inspect-lib`, which did this job well but
 * arrived attached to `steam-user` + `node-cs2` for a Game Coordinator round trip this package never
 * makes — **89 MB and 60 packages in a consumer's `node_modules`, measured, for two pure functions** —
 * and which could not be bundled for a browser at all.
 *
 * ## The fallback, and why this is one module
 *
 * If the byte format ever turns out wrong, the entire body of this file is replaced by one line:
 *
 * ```ts
 * export { createInspectUrl, decodeMaskedUrl, type EconItem, type Sticker } from 'cs2-inspect-lib'
 * ```
 *
 * Those four names, with these signatures, are the only things this module exports and the only
 * things `inspect.ts` imports — so that one line is a complete revert, with no edit anywhere else,
 * and `test/corpus.ts` detects it so the codec tests skip rather than fail. That has been checked, not
 * assumed: with the line in place the typecheck is clean and the suite is green.
 *
 * `cs2-inspect-lib` stays a devDependency for exactly that reason, and `test/codec.test.ts` runs 2,326
 * real items and 41 raw URL forms through both implementations and asserts the hex is identical byte
 * for byte. Delete the dependency and that check goes with it.
 *
 * ## The format, read off `cs2-inspect-lib@4.1.0` and asserted against it
 *
 * Fields are written in ascending field number. The only surprising ones:
 *
 * - **`paintwear` (field 7) is a varint, not a float.** It is `optional uint32` in Valve's proto and
 *   carries the float32 **bit pattern**, so it is `setFloat32(big-endian) → getUint32(big-endian)`
 *   and then a plain varint. Writing it as a wire-type-5 float would produce a link that decodes to
 *   a nonsense wear rather than one that fails.
 * - **Floats inside a sticker are little-endian** (`wear`, `scale`, `rotation`, the offsets), unlike
 *   the big-endian bit pattern above. The asymmetry is real; both halves are pinned by the corpus.
 * - **Charms ride field 20 (`keychains`) as the same submessage as a sticker**, so `pattern` is the
 *   charm's seed and `offset_z` is a real coordinate rather than padding.
 *
 * The framing is a `0x00` prefix, the protobuf bytes, and four bytes of checksum:
 *
 * ```
 * crc      = crc32(0x00 ++ protoData)              // reflected IEEE 802.3, 0xEDB88320
 * checksum = (crc & 0xFFFF) ^ (protoData.length * crc)   // big-endian uint32
 * ```
 *
 * That second line is not a CRC in any standard sense; it is what Valve does, so it is what we do.
 *
 * ## Behaviour deliberately preserved from the wrapper this replaces
 *
 * - **The decoder does not verify the checksum.** It strips the last four bytes and never looks at
 *   them. Third-party links in the wild do not all agree on the checksum, and rejecting them would
 *   be a new failure mode rather than a fix.
 * - **Validation runs on encode and on decode**, matching the `new CS2Inspect()` default
 *   (`validateInput: true`) the wrapper used. Only the *errors* are reproduced: the old library also
 *   collected warnings ("paintseed is unusually high") that it then discarded without acting on, so
 *   they were never observable through this package's surface.
 * - **A nametag is length-checked in UTF-16 units on the way out and in bytes on the way in.** So 50
 *   emoji (100 units, 200 bytes) encode fine and then fail to decode. That is upstream's behaviour,
 *   it is pinned by a test, and changing it would silently alter which links are readable.
 *
 * Two deliberate divergences, both in unreachable surface: a `rarity` passed as a name string
 * (`'COVERT'`) is no longer accepted — it needed an enum this package does not ship, and `rarity` is
 * numeric in the type; and errors are plain `Error`s rather than upstream's four subclasses, which
 * this package never re-exported and so nothing could ever catch by class.
 */

/** The prefix every masked link carries. The account id in it is a constant, not a real user. */
const INSPECT_BASE = 'steam://rungame/730/76561202255233023/+csgo_econ_action_preview%20'

/** `DEFAULT_CONFIG.maxUrlLength` / `maxCustomNameLength` from the library this replaces. */
const MAX_URL_LENGTH = 2048
const MAX_CUSTOM_NAME_LENGTH = 100

/** Guards against a malformed link driving an unbounded read. Upstream's limits, kept. */
const MAX_BUFFER_BYTES = 10 * 1024 * 1024
const MAX_EMBEDDED_BYTES = 1024
const MAX_ITEM_FIELDS = 100
const MAX_STICKER_FIELDS = 20

/**
 * `CEconItemPreviewDataBlock.Sticker` — also the message a charm (`keychains`) and a style
 * (`variations`) travel in, which is why one type covers all three.
 */
export type Sticker = {
	slot: number
	sticker_id: number
	wear?: number
	scale?: number
	rotation?: number
	tint_id?: number
	offset_x?: number
	offset_y?: number
	offset_z?: number
	pattern?: number
	highlight_reel?: number
	wrapped_sticker?: number
}

/** `CEconItemPreviewDataBlock` — every field the wire format carries, in field-number order. */
export type EconItem = {
	accountid?: number
	itemid?: number | bigint
	defindex: number
	paintindex: number
	rarity?: number
	quality?: number
	/** A float32 in [0..1]. Encoded as the varint of its bit pattern — see the module comment. */
	paintwear: number
	paintseed: number
	killeaterscoretype?: number
	killeatervalue?: number
	customname?: string
	stickers?: Sticker[]
	inventory?: number
	origin?: number
	questid?: number
	dropreason?: number
	musicindex?: number
	/** Signed on the wire: protobuf `int32`, so a negative value costs ten bytes. */
	entindex?: number
	petindex?: number
	keychains?: Sticker[]
	style?: number
	variations?: Sticker[]
	upgrade_level?: number
}

/* -------------------------------------------------------------------------------------------------
 * Validation
 *
 * Errors only. Upstream also produced warnings and threw none of them away usefully — they were
 * returned from a function whose caller looked at `valid` and nothing else.
 * ---------------------------------------------------------------------------------------------- */

const notUint = (value: unknown) => typeof value !== 'number' || value < 0

const validateSticker = (sticker: Sticker | null | undefined): string[] => {
	const errors: string[] = []
	if (!sticker || typeof sticker !== 'object') return ['Sticker must be a non-null object']

	if (typeof sticker.slot !== 'number' || sticker.slot < 0 || sticker.slot > 4) {
		errors.push('slot must be a number between 0 and 4')
	}
	if (notUint(sticker.sticker_id)) errors.push('sticker_id must be a positive number')

	if (sticker.wear !== undefined && (typeof sticker.wear !== 'number' || sticker.wear < 0 || sticker.wear > 1)) {
		errors.push('wear must be a number between 0 and 1')
	}
	if (sticker.scale !== undefined && (typeof sticker.scale !== 'number' || sticker.scale <= 0)) {
		errors.push('scale must be a positive number')
	}
	if (sticker.rotation !== undefined && typeof sticker.rotation !== 'number') {
		errors.push('rotation must be a number')
	}
	if (sticker.tint_id !== undefined && notUint(sticker.tint_id)) errors.push('tint_id must be a non-negative number')

	for (const field of ['offset_x', 'offset_y', 'offset_z'] as const) {
		if (sticker[field] !== undefined && typeof sticker[field] !== 'number') errors.push(`${field} must be a number`)
	}

	if (sticker.pattern !== undefined && notUint(sticker.pattern)) errors.push('pattern must be a non-negative number')
	if (sticker.highlight_reel !== undefined && notUint(sticker.highlight_reel)) {
		errors.push('highlight_reel must be a non-negative number')
	}
	if (sticker.wrapped_sticker !== undefined && notUint(sticker.wrapped_sticker)) {
		errors.push('wrapped_sticker must be a non-negative number')
	}

	return errors
}

const validateStickerArray = (stickers: Sticker[], label: string): string[] => {
	if (!Array.isArray(stickers)) return [`${label}s must be an array`]
	return stickers.flatMap((sticker, index) => validateSticker(sticker).map(error => `${label}[${index}]: ${error}`))
}

const validateEconItem = (item: EconItem): string[] => {
	if (!item || typeof item !== 'object') return ['Item must be a non-null object']
	const errors: string[] = []

	if (notUint(item.defindex)) errors.push('defindex must be a positive number')
	if (notUint(item.paintindex)) errors.push('paintindex must be a non-negative number')
	if (notUint(item.paintseed)) errors.push('paintseed must be a non-negative number')
	// NaN passes: `NaN < 0` and `NaN > 1` are both false. Upstream let it through and encoded the
	// quiet-NaN bit pattern; a corpus row pins that so it cannot change by accident.
	if (typeof item.paintwear !== 'number' || item.paintwear < 0 || item.paintwear > 1) {
		errors.push('paintwear must be a number between 0 and 1')
	}

	if (item.accountid !== undefined && notUint(item.accountid)) errors.push('accountid must be a positive number')
	if (item.itemid !== undefined) {
		if (typeof item.itemid !== 'number' && typeof item.itemid !== 'bigint') {
			errors.push('itemid must be a number or bigint')
		} else if (typeof item.itemid === 'number' && item.itemid < 0) {
			errors.push('itemid must be positive')
		}
	}
	if (item.rarity !== undefined && typeof item.rarity !== 'number') errors.push('rarity must be a number')
	if (item.quality !== undefined && notUint(item.quality)) errors.push('quality must be a non-negative number')
	if (item.customname !== undefined) {
		if (typeof item.customname !== 'string') errors.push('customname must be a string')
		else if (item.customname.length > MAX_CUSTOM_NAME_LENGTH) {
			errors.push('customname must be 100 characters or less')
		}
	}
	if (item.entindex !== undefined && typeof item.entindex !== 'number') {
		errors.push('entindex must be a number (can be negative)')
	}

	if (item.stickers !== undefined) errors.push(...validateStickerArray(item.stickers, 'sticker'))
	if (item.keychains !== undefined) errors.push(...validateStickerArray(item.keychains, 'keychain'))
	if (item.variations !== undefined) errors.push(...validateStickerArray(item.variations, 'variation'))

	return errors
}

const assertValidItem = (item: EconItem) => {
	const errors = validateEconItem(item)
	if (errors.length > 0) throw new Error(`Item validation failed: ${errors.join(', ')}`)
}

const assertValidHex = (hex: string) => {
	const errors: string[] = []
	if (typeof hex !== 'string') throw new Error('Hex data validation failed: Hex data must be a string')
	if (hex.length === 0) throw new Error('Hex data validation failed: Hex data cannot be empty')

	if (hex.length % 2 !== 0) errors.push('Hex data must have even length')
	if (!/^[0-9A-Fa-f]+$/.test(hex)) errors.push('Hex data contains invalid characters (must be 0-9, A-F, a-f)')
	if (hex.length < 16) errors.push('Hex data is too short (minimum 8 bytes)')
	if (hex.length > 4096) errors.push('Hex data is too long (maximum 2048 bytes)')

	if (errors.length > 0) throw new Error(`Hex data validation failed: ${errors.join(', ')}`)
}

/* -------------------------------------------------------------------------------------------------
 * Encode
 * ---------------------------------------------------------------------------------------------- */

/** Reflected IEEE 802.3 CRC-32. `-306674912` is `0xEDB88320` as a signed int32. */
const CRC32_TABLE = ((): Int32Array => {
	const table = new Int32Array(256)
	for (let i = 0; i < 256; i++) {
		let c = i
		for (let j = 0; j < 8; j++) c = c & 1 ? -306674912 ^ (c >>> 1) : c >>> 1
		table[i] = c
	}
	return table
})()

const crc32 = (data: Uint8Array): number => {
	let crc = -1
	for (let i = 0; i < data.length; i++) {
		crc = (crc >>> 8) ^ (CRC32_TABLE[(crc ^ (data[i] as number)) & 0xff] as number)
	}
	return (crc ^ -1) >>> 0
}

/** The float32 bit pattern as an unsigned integer — what field 7 actually carries. */
const floatToBits = (value: number): number => {
	const view = new DataView(new ArrayBuffer(4))
	view.setFloat32(0, value, false)
	return view.getUint32(0, false)
}

const bitsToFloat = (bits: number): number => {
	const view = new DataView(new ArrayBuffer(4))
	view.setUint32(0, bits, false)
	return view.getFloat32(0, false)
}

/**
 * A growable byte sink. Written as a class rather than a closure because every method is a distinct
 * wire rule and the corpus test mutates them one at a time.
 */
class Writer {
	private bytes: Uint8Array
	private capacity: number
	private pos = 0

	constructor(initialCapacity: number) {
		this.capacity = initialCapacity
		this.bytes = new Uint8Array(this.capacity)
	}

	private ensureCapacity(needed: number) {
		if (this.pos + needed > this.capacity) {
			const next = Math.max(this.capacity * 2, this.pos + needed)
			const grown = new Uint8Array(next)
			grown.set(this.bytes.subarray(0, this.pos))
			this.bytes = grown
			this.capacity = next
		}
	}

	/** Unsigned base-128, little-endian groups. `&`/`>>>` truncate, so a fractional id loses its tail. */
	writeVarint(value: number) {
		if (value < 0) throw new Error(`Cannot encode negative number as varint: ${value}`)
		this.ensureCapacity(5)
		while (value > 0x7f) {
			this.bytes[this.pos++] = (value & 0x7f) | 0x80
			value >>>= 7
		}
		this.bytes[this.pos++] = value
	}

	writeVarint64(value: number | bigint) {
		let remaining = typeof value === 'bigint' ? value : BigInt(value)
		if (remaining < 0n) throw new Error(`Cannot encode negative number as varint64: ${value}`)
		this.ensureCapacity(10)
		while (remaining > 0x7fn) {
			this.bytes[this.pos++] = Number((remaining & 0x7fn) | 0x80n)
			remaining >>= 7n
		}
		this.bytes[this.pos++] = Number(remaining)
	}

	/** Protobuf `int32`: a negative value is sign-extended to 64 bits, so it costs ten bytes. */
	writeInt32(value: number) {
		if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
			throw new Error(`Int32 value must be an integer within signed 32-bit range: ${value}`)
		}
		if (value >= 0) this.writeVarint(value)
		else this.writeVarint64(BigInt.asUintN(64, BigInt(value)))
	}

	writeTag(fieldNumber: number, wireType: number) {
		this.writeVarint((fieldNumber << 3) | wireType)
	}

	/** Little-endian, unlike `paintwear`'s big-endian bit pattern. */
	writeFloat(value: number) {
		if (!Number.isFinite(value)) throw new Error(`Float value must be finite: ${value}`)
		this.ensureCapacity(4)
		const view = new DataView(new ArrayBuffer(4))
		view.setFloat32(0, value, true)
		for (let i = 0; i < 4; i++) this.bytes[this.pos++] = view.getUint8(i)
	}

	/**
	 * The length prefix is in BYTES; the limit below is checked in UTF-16 UNITS. Upstream's
	 * asymmetry, kept deliberately — see the module comment.
	 */
	writeString(value: string) {
		if (typeof value !== 'string') throw new Error(`Value must be a string: ${typeof value}`)
		if (value.length > MAX_CUSTOM_NAME_LENGTH) {
			throw new Error(`String too long: ${value.length} > ${MAX_CUSTOM_NAME_LENGTH}`)
		}
		const encoded = new TextEncoder().encode(value)
		this.writeVarint(encoded.length)
		this.ensureCapacity(encoded.length)
		this.bytes.set(encoded, this.pos)
		this.pos += encoded.length
	}

	writeLengthDelimited(bytes: Uint8Array) {
		this.writeVarint(bytes.length)
		this.ensureCapacity(bytes.length)
		this.bytes.set(bytes, this.pos)
		this.pos += bytes.length
	}

	getBytes(): Uint8Array {
		return this.bytes.subarray(0, this.pos)
	}
}

/**
 * The sticker submessage. Every optional field is written only when it is literally a number, so
 * `undefined` means absent rather than zero — which is what makes an unoccupied slot cost nothing.
 */
const encodeSticker = (sticker: Sticker): Uint8Array => {
	const errors = validateSticker(sticker)
	if (errors.length > 0) throw new Error(`Sticker validation failed: ${errors.join(', ')}`)

	const writer = new Writer(256)

	writer.writeTag(1, 0)
	writer.writeVarint(sticker.slot)
	writer.writeTag(2, 0)
	writer.writeVarint(sticker.sticker_id)

	if (typeof sticker.wear === 'number') {
		writer.writeTag(3, 5)
		writer.writeFloat(sticker.wear)
	}
	if (typeof sticker.scale === 'number') {
		writer.writeTag(4, 5)
		writer.writeFloat(sticker.scale)
	}
	if (typeof sticker.rotation === 'number') {
		writer.writeTag(5, 5)
		writer.writeFloat(sticker.rotation)
	}
	if (typeof sticker.tint_id === 'number') {
		writer.writeTag(6, 0)
		writer.writeVarint(sticker.tint_id)
	}
	if (typeof sticker.offset_x === 'number') {
		writer.writeTag(7, 5)
		writer.writeFloat(sticker.offset_x)
	}
	if (typeof sticker.offset_y === 'number') {
		writer.writeTag(8, 5)
		writer.writeFloat(sticker.offset_y)
	}
	if (typeof sticker.offset_z === 'number') {
		writer.writeTag(9, 5)
		writer.writeFloat(sticker.offset_z)
	}
	if (typeof sticker.pattern === 'number') {
		writer.writeTag(10, 0)
		writer.writeVarint(sticker.pattern)
	}
	if (typeof sticker.highlight_reel === 'number') {
		writer.writeTag(11, 0)
		writer.writeVarint(sticker.highlight_reel)
	}
	if (typeof sticker.wrapped_sticker === 'number') {
		writer.writeTag(12, 0)
		writer.writeVarint(sticker.wrapped_sticker)
	}

	return writer.getBytes()
}

const encodeItemData = (item: EconItem): Uint8Array => {
	assertValidItem(item)
	const writer = new Writer(2048)

	if (typeof item.accountid !== 'undefined') {
		writer.writeTag(1, 0)
		writer.writeVarint(item.accountid)
	}
	if (typeof item.itemid !== 'undefined') {
		writer.writeTag(2, 0)
		writer.writeVarint64(item.itemid)
	}

	writer.writeTag(3, 0)
	writer.writeVarint(item.defindex)
	writer.writeTag(4, 0)
	writer.writeVarint(item.paintindex)

	if (typeof item.rarity !== 'undefined') {
		writer.writeTag(5, 0)
		writer.writeVarint(item.rarity)
	}
	if (typeof item.quality !== 'undefined') {
		writer.writeTag(6, 0)
		writer.writeVarint(item.quality)
	}

	// Field 7 is `uint32` carrying the float32 bit pattern — NOT a wire-type-5 float.
	writer.writeTag(7, 0)
	writer.writeVarint(floatToBits(item.paintwear))
	writer.writeTag(8, 0)
	writer.writeVarint(item.paintseed)

	if (typeof item.killeaterscoretype !== 'undefined') {
		writer.writeTag(9, 0)
		writer.writeVarint(item.killeaterscoretype)
	}
	if (typeof item.killeatervalue !== 'undefined') {
		writer.writeTag(10, 0)
		writer.writeVarint(item.killeatervalue)
	}
	// Truthiness, not `!== undefined`: an empty nametag is omitted rather than sent as "".
	if (item.customname) {
		writer.writeTag(11, 2)
		writer.writeString(item.customname)
	}
	if (item.stickers && item.stickers.length > 0) {
		for (const sticker of item.stickers) {
			writer.writeTag(12, 2)
			writer.writeLengthDelimited(encodeSticker(sticker))
		}
	}
	if (typeof item.inventory !== 'undefined') {
		writer.writeTag(13, 0)
		writer.writeVarint(item.inventory)
	}
	if (typeof item.origin !== 'undefined') {
		writer.writeTag(14, 0)
		writer.writeVarint(item.origin)
	}
	if (typeof item.questid !== 'undefined') {
		writer.writeTag(15, 0)
		writer.writeVarint(item.questid)
	}
	if (typeof item.dropreason !== 'undefined') {
		writer.writeTag(16, 0)
		writer.writeVarint(item.dropreason)
	}
	if (typeof item.musicindex !== 'undefined') {
		writer.writeTag(17, 0)
		writer.writeVarint(item.musicindex)
	}
	if (typeof item.entindex !== 'undefined') {
		writer.writeTag(18, 0)
		writer.writeInt32(item.entindex)
	}
	if (typeof item.petindex !== 'undefined') {
		writer.writeTag(19, 0)
		writer.writeVarint(item.petindex)
	}
	if (item.keychains && item.keychains.length > 0) {
		for (const keychain of item.keychains) {
			writer.writeTag(20, 2)
			writer.writeLengthDelimited(encodeSticker(keychain))
		}
	}
	if (typeof item.style !== 'undefined') {
		writer.writeTag(21, 0)
		writer.writeVarint(item.style)
	}
	if (item.variations && item.variations.length > 0) {
		for (const variation of item.variations) {
			writer.writeTag(22, 2)
			writer.writeLengthDelimited(encodeSticker(variation))
		}
	}
	if (typeof item.upgrade_level !== 'undefined') {
		writer.writeTag(23, 0)
		writer.writeVarint(item.upgrade_level)
	}

	return writer.getBytes()
}

const HEX = ((): string[] => {
	const table: string[] = []
	for (let i = 0; i < 256; i++) table.push(i.toString(16).padStart(2, '0').toUpperCase())
	return table
})()

/**
 * `steam://rungame/730/…+csgo_econ_action_preview <hex>` for the item as configured.
 *
 * The checksum is `(crc & 0xFFFF) ^ (length * crc)`. `length * crc` stays under 2^48 so it is exact
 * as a double, and `^` then narrows it to int32 — which is what makes the JS expression agree with
 * Valve's 32-bit arithmetic without any explicit masking.
 */
export const createInspectUrl = (item: EconItem): string => {
	const protoData = encodeItemData(item)

	const framed = new Uint8Array(protoData.length + 5)
	framed[0] = 0
	framed.set(protoData, 1)

	const crc = crc32(framed.subarray(0, framed.length - 4))
	const checksum = (crc & 0xffff) ^ (protoData.length * crc)
	new DataView(framed.buffer).setUint32(framed.length - 4, checksum, false)

	let hex = ''
	for (let i = 0; i < framed.length; i++) hex += HEX[framed[i] as number] as string

	const url = INSPECT_BASE + hex
	if (url.length > MAX_URL_LENGTH) {
		throw new Error(`Generated URL exceeds maximum length: ${url.length} > ${MAX_URL_LENGTH}`)
	}
	return url
}

/* -------------------------------------------------------------------------------------------------
 * Decode
 * ---------------------------------------------------------------------------------------------- */

const hexToBytes = (hex: string): Uint8Array => {
	assertValidHex(hex)
	const bytes = new Uint8Array(hex.length / 2)
	for (let i = 0; i < bytes.length; i++) {
		const pair = hex.slice(i * 2, i * 2 + 2)
		const byte = Number.parseInt(pair, 16)
		if (Number.isNaN(byte)) throw new Error(`Invalid hex byte at ${i * 2}: ${pair}`)
		bytes[i] = byte
	}
	return bytes
}

class Reader {
	private readonly bytes: Uint8Array
	private readonly view: DataView
	private pos = 0

	constructor(bytes: Uint8Array) {
		if (bytes.length === 0) throw new Error('Buffer cannot be empty')
		if (bytes.length > MAX_BUFFER_BYTES) throw new Error(`Buffer too large: ${bytes.length}`)
		this.bytes = bytes
		this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	}

	hasMore() {
		return this.pos < this.bytes.length
	}

	/** 32-bit: five bytes at most, and the fifth contributes only its low four bits. */
	readVarint(): number {
		if (this.pos >= this.bytes.length) throw new Error(`Unexpected end of buffer while reading varint at ${this.pos}`)
		let result = 0
		let shift = 0
		let read = 0
		while (this.pos < this.bytes.length && read < 5) {
			const byte = this.bytes[this.pos++] as number
			result |= (byte & 0x7f) << shift
			read++
			if ((byte & 0x80) === 0) return result >>> 0
			shift += 7
		}
		throw new Error(`Invalid varint encoding at ${this.pos}`)
	}

	readVarint64(): bigint {
		if (this.pos >= this.bytes.length) throw new Error(`Unexpected end of buffer while reading varint64 at ${this.pos}`)
		let result = 0n
		let shift = 0n
		let read = 0
		while (this.pos < this.bytes.length && read < 10) {
			const byte = BigInt(this.bytes[this.pos++] as number)
			result |= (byte & 0x7fn) << shift
			read++
			if ((byte & 0x80n) === 0n) return result
			shift += 7n
		}
		throw new Error(`Invalid varint64 encoding at ${this.pos}`)
	}

	readInt32(): number {
		return Number(BigInt.asIntN(32, this.readVarint64()))
	}

	readFloat(): number {
		if (this.pos + 4 > this.bytes.length) throw new Error(`Buffer underrun while reading float at ${this.pos}`)
		const value = this.view.getFloat32(this.pos, true)
		this.pos += 4
		return value
	}

	readString(): string {
		const length = this.readVarint()
		if (length > MAX_CUSTOM_NAME_LENGTH) {
			throw new Error(`String length ${length} exceeds maximum allowed length ${MAX_CUSTOM_NAME_LENGTH}`)
		}
		if (this.pos + length > this.bytes.length) throw new Error(`String extends beyond buffer boundary at ${this.pos}`)
		let value: string
		try {
			value = new TextDecoder('utf-8', { fatal: true }).decode(this.bytes.slice(this.pos, this.pos + length))
		} catch (cause) {
			throw new Error(`Invalid UTF-8 string encoding at ${this.pos}`, { cause })
		}
		this.pos += length
		return value
	}

	readBytes(): Uint8Array {
		const length = this.readVarint()
		if (length > MAX_EMBEDDED_BYTES) throw new Error(`Bytes length ${length} exceeds reasonable limit`)
		if (this.pos + length > this.bytes.length) throw new Error(`Bytes extend beyond buffer boundary at ${this.pos}`)
		const slice = this.bytes.slice(this.pos, this.pos + length)
		this.pos += length
		return slice
	}

	readTag(): [fieldNumber: number, wireType: number] {
		const tag = this.readVarint()
		const wireType = tag & 0x7
		if (wireType > 5) throw new Error(`Invalid wire type: ${wireType}`)
		return [tag >>> 3, wireType]
	}

	skipField(wireType: number) {
		switch (wireType) {
			case 0:
				this.readVarint()
				return
			case 1:
				if (this.pos + 8 > this.bytes.length) throw new Error('Buffer underrun while skipping 64-bit field')
				this.pos += 8
				return
			case 2: {
				const length = this.readVarint()
				if (this.pos + length > this.bytes.length) {
					throw new Error('Buffer underrun while skipping length-delimited field')
				}
				this.pos += length
				return
			}
			case 5:
				if (this.pos + 4 > this.bytes.length) throw new Error('Buffer underrun while skipping 32-bit field')
				this.pos += 4
				return
			default:
				throw new Error(`Cannot skip unknown wire type: ${wireType}`)
		}
	}
}

/** Wire types are checked inside the submessage but not at the top level — upstream's asymmetry. */
const decodeSticker = (reader: Reader): Sticker => {
	const sticker: Sticker = { slot: 0, sticker_id: 0 }
	let fields = 0

	while (reader.hasMore() && fields < MAX_STICKER_FIELDS) {
		const [fieldNumber, wireType] = reader.readTag()
		fields++
		const expect = (want: number, name: string) => {
			if (wireType !== want) throw new Error(`Invalid wire type for ${name}: ${wireType}`)
		}

		switch (fieldNumber) {
			case 1:
				expect(0, 'slot')
				sticker.slot = reader.readVarint()
				break
			case 2:
				expect(0, 'sticker_id')
				sticker.sticker_id = reader.readVarint()
				break
			case 3:
				expect(5, 'wear')
				sticker.wear = reader.readFloat()
				break
			case 4:
				expect(5, 'scale')
				sticker.scale = reader.readFloat()
				break
			case 5:
				expect(5, 'rotation')
				sticker.rotation = reader.readFloat()
				break
			case 6:
				expect(0, 'tint_id')
				sticker.tint_id = reader.readVarint()
				break
			case 7:
				expect(5, 'offset_x')
				sticker.offset_x = reader.readFloat()
				break
			case 8:
				expect(5, 'offset_y')
				sticker.offset_y = reader.readFloat()
				break
			case 9:
				expect(5, 'offset_z')
				sticker.offset_z = reader.readFloat()
				break
			case 10:
				expect(0, 'pattern')
				sticker.pattern = reader.readVarint()
				break
			case 11:
				expect(0, 'highlight_reel')
				sticker.highlight_reel = reader.readVarint()
				break
			case 12:
				expect(0, 'wrapped_sticker')
				sticker.wrapped_sticker = reader.readVarint()
				break
			default:
				reader.skipField(wireType)
				break
		}
	}

	if (fields >= MAX_STICKER_FIELDS) throw new Error('Too many fields in sticker, possible corruption')
	return sticker
}

/**
 * Decode the hex payload of a masked link.
 *
 * The last four bytes are dropped without being checked. That is not an oversight — see the module
 * comment on why verifying the checksum would be a new failure mode rather than a fix.
 */
const decodeMaskedData = (hexData: string): EconItem => {
	let hex = hexData.trim().toUpperCase()
	if (hex.startsWith('00')) hex = hex.slice(2)
	if (hex.length < 16) throw new Error(`Hex data too short after processing: ${hex.length}`)
	hex = hex.slice(0, -8)

	const reader = new Reader(hexToBytes(hex))
	const item: EconItem = {
		defindex: 0,
		paintindex: 0,
		paintseed: 0,
		paintwear: 0,
		stickers: [],
		keychains: [],
		variations: [],
	}

	let fields = 0
	while (reader.hasMore() && fields < MAX_ITEM_FIELDS) {
		const [fieldNumber, wireType] = reader.readTag()
		fields++

		switch (fieldNumber) {
			case 1:
				item.accountid = reader.readVarint()
				break
			case 2:
				item.itemid = reader.readVarint64()
				break
			case 3:
				item.defindex = reader.readVarint()
				break
			case 4:
				item.paintindex = reader.readVarint()
				break
			case 5:
				item.rarity = reader.readVarint()
				break
			case 6:
				item.quality = reader.readVarint()
				break
			case 7:
				item.paintwear = bitsToFloat(reader.readVarint())
				break
			case 8:
				item.paintseed = reader.readVarint()
				break
			case 9:
				item.killeaterscoretype = reader.readVarint()
				break
			case 10:
				item.killeatervalue = reader.readVarint()
				break
			case 11:
				item.customname = reader.readString()
				break
			case 12:
				item.stickers?.push(decodeSticker(new Reader(reader.readBytes())))
				break
			case 13:
				item.inventory = reader.readVarint()
				break
			case 14:
				item.origin = reader.readVarint()
				break
			case 15:
				item.questid = reader.readVarint()
				break
			case 16:
				item.dropreason = reader.readVarint()
				break
			case 17:
				item.musicindex = reader.readVarint()
				break
			case 18:
				item.entindex = reader.readInt32()
				break
			case 19:
				item.petindex = reader.readVarint()
				break
			case 20:
				item.keychains?.push(decodeSticker(new Reader(reader.readBytes())))
				break
			case 21:
				item.style = reader.readVarint()
				break
			case 22:
				item.variations?.push(decodeSticker(new Reader(reader.readBytes())))
				break
			case 23:
				item.upgrade_level = reader.readVarint()
				break
			default:
				reader.skipField(wireType)
				break
		}
	}

	if (fields >= MAX_ITEM_FIELDS) throw new Error('Too many fields processed, possible corruption')

	assertValidItem(item)
	return item
}

/** Everything before the hex: the four spellings of the console command, and a bare payload. */
const PREVIEW_VARIANTS = [
	'csgo_econ_action_preview ',
	'csgo_econ_action_preview%20',
	'+csgo_econ_action_preview ',
	'+csgo_econ_action_preview%20',
]

/**
 * Decode a MASKED inspect link into an `EconItem`.
 *
 * Accepts a full `steam://` link, a bare `csgo_econ_action_preview <hex>` command, or raw hex.
 * Throws for the unmasked `S…A…D…` / `M…A…D…` market and inventory forms: those carry no item data
 * at all — they needed a Game Coordinator round trip Valve has shut down.
 */
export const decodeMaskedUrl = (url: string): EconItem => {
	if (typeof url !== 'string') throw new Error('URL validation failed: URL must be a string')
	if (url.length === 0) throw new Error('URL validation failed: URL cannot be empty')
	if (url.length > MAX_URL_LENGTH) throw new Error('URL validation failed: URL is too long (maximum 2048 characters)')

	let cleaned = url.trim()
	if (!cleaned.startsWith('steam://')) {
		for (const variant of PREVIEW_VARIANTS) {
			if (cleaned.startsWith(variant)) {
				cleaned = INSPECT_BASE + cleaned.slice(variant.length)
				break
			}
		}
		if (!cleaned.startsWith('steam://')) {
			if (cleaned.startsWith('M') || cleaned.startsWith('S') || /^[0-9A-F]+$/i.test(cleaned)) {
				cleaned = INSPECT_BASE + cleaned
			}
		}
	}
	if (!cleaned.includes('%20')) cleaned = cleaned.replaceAll(' ', '%20')

	const payload = cleaned.split('csgo_econ_action_preview%20')[1]
	if (payload === undefined) throw new Error(`URL does not contain valid preview command: ${url}`)
	if (payload === '') throw new Error(`URL payload is empty: ${url}`)

	if (/^([SM])(\d+)A(\d+)D(\d+)$/.test(payload)) {
		throw new Error(
			'This is an unmasked URL (market/inventory link) and carries no item data. Check isLegacyInspectUrl() first.',
		)
	}
	if (!/^[0-9A-Fa-f]+$/.test(payload)) {
		throw new Error(`URL payload does not match any known format: ${payload.slice(0, 32)}`)
	}

	assertValidHex(payload)
	return decodeMaskedData(payload.toUpperCase())
}
