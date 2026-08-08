/**
 * One error class, so a caller can `catch (e) { if (e instanceof CdnError) … }` without importing
 * three of them.
 *
 * `contentType` is on here for a specific reason. The origin sits behind Cloudflare, and a missing
 * key comes back as a **27 KB HTML page** with `content-type: text/html` — measured 2026-08-08 on
 * `data/skins.json` while the bucket was mid-upload. Code that goes straight to `response.json()`
 * reports that as `SyntaxError: Unexpected token '<'`, which sends you looking at your parser
 * instead of at the 404. Checking `response.ok` first and carrying the content type through means
 * the message says what actually happened.
 */
export class CdnError extends Error {
	override readonly name = 'CdnError'
	readonly url: string
	/** HTTP status, or `undefined` when the request never completed (DNS, offline, abort). */
	readonly status: number | undefined
	readonly contentType: string | undefined

	constructor(
		message: string,
		details: { url: string; status?: number | undefined; contentType?: string | undefined; cause?: unknown },
	) {
		super(message, details.cause === undefined ? undefined : { cause: details.cause })
		this.url = details.url
		this.status = details.status
		this.contentType = details.contentType
	}
}

export const isCdnError = (error: unknown): error is CdnError => error instanceof CdnError
