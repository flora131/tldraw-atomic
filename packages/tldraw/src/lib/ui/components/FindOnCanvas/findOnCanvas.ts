import { Editor, TLBookmarkAsset, TLBookmarkShape, TLPageId, TLShapeId } from '@tldraw/editor'
import { getResolvedBookmarkAssetId } from '../../../shapes/bookmark/bookmarks'
import { convertCommonTitleHTMLEntities } from '../../../utils/text/text'

/**
 * The shape types that find on canvas reads text from. Other shape utils implement `getText` too
 * (arrows, frames, embeds), but the feature deliberately searches only these sources.
 *
 * @internal
 */
export const FIND_ON_CANVAS_SHAPE_TYPES = ['text', 'note', 'geo', 'bookmark'] as const

/** @internal */
export type TLUiFindOnCanvasShapeType = (typeof FIND_ON_CANVAS_SHAPE_TYPES)[number]

/**
 * A page name that matches the current find on canvas query.
 *
 * @internal
 */
export interface TLUiFindOnCanvasPageResult {
	/** Stable id for the result, of the form `page:<pageId>`. */
	id: string
	kind: 'page'
	pageId: TLPageId
	pageName: string
	/** The text that was searched — for a page result, its name. */
	text: string
	/** Index of the first match within `text`. */
	matchStart: number
	/** Index just past the first match within `text`. */
	matchEnd: number
}

/**
 * A shape whose text matches the current find on canvas query.
 *
 * @internal
 */
export interface TLUiFindOnCanvasShapeResult {
	/** Stable id for the result, of the form `shape:<shapeId>`. */
	id: string
	kind: 'shape'
	pageId: TLPageId
	pageName: string
	shapeId: TLShapeId
	shapeType: TLUiFindOnCanvasShapeType
	/** The translation key describing what kind of thing matched, eg `geo-style.rectangle`. */
	kindKey: string
	/** The icon shown next to the result. */
	icon: string
	text: string
	matchStart: number
	matchEnd: number
}

/** @internal */
export type TLUiFindOnCanvasResult = TLUiFindOnCanvasPageResult | TLUiFindOnCanvasShapeResult

/** @internal */
export interface TLUiFindOnCanvasGroup {
	pageId: TLPageId
	pageName: string
	results: TLUiFindOnCanvasResult[]
}

function getSearchableShapeText(editor: Editor, shapeId: TLShapeId) {
	const shape = editor.getShape(shapeId)
	if (!shape) return null
	if (!(FIND_ON_CANVAS_SHAPE_TYPES as readonly string[]).includes(shape.type)) return null

	const shapeType = shape.type as TLUiFindOnCanvasShapeType

	if (shapeType === 'bookmark') {
		const bookmark = shape as TLBookmarkShape
		const url = bookmark.props.url
		const assetId = getResolvedBookmarkAssetId(editor, bookmark.props.assetId, url)
		const asset = (assetId ? editor.getAsset(assetId) : null) as TLBookmarkAsset | null
		const title = asset?.props.title ? convertCommonTitleHTMLEntities(asset.props.title) : ''
		// One result per bookmark, searching its title and its url.
		const text = title ? `${title} — ${url}` : url
		return { shapeType, text, kindKey: 'tool.bookmark', icon: 'bookmark' }
	}

	const text = editor.getShapeUtil(shape).getText(shape) ?? ''

	if (shapeType === 'geo') {
		const geo = (shape.props as { geo: string }).geo
		return { shapeType, text, kindKey: `geo-style.${geo}`, icon: `geo-${geo}` }
	}

	return { shapeType, text, kindKey: `tool.${shapeType}`, icon: `tool-${shapeType}` }
}

/**
 * A case-folded copy of a string, plus a map from each folded UTF-16 code unit back to the source
 * range it came from.
 *
 * Folding is not length-preserving: `'İ'.toLowerCase()` is two code units, so folded offsets cannot
 * be used against the source directly.
 */
interface TLUiFindOnCanvasFoldedText {
	folded: string
	/** Source index where the code point behind folded unit `i` starts. */
	sourceStart: number[]
	/** Source index just past the code point behind folded unit `i`. */
	sourceEnd: number[]
}

/**
 * Case-fold `text` one code point at a time, recording where each folded code unit came from.
 *
 * @internal
 */
export function foldTextForFind(text: string): TLUiFindOnCanvasFoldedText {
	let folded = ''
	const sourceStart: number[] = []
	const sourceEnd: number[] = []

	for (let index = 0; index < text.length; ) {
		const codePoint = text.codePointAt(index)!
		const source = String.fromCodePoint(codePoint)
		const next = index + source.length
		// Locale-independent, so the same query matches the same text for every user.
		const lowered = source.toLowerCase()
		for (let unit = 0; unit < lowered.length; unit++) {
			sourceStart.push(index)
			sourceEnd.push(next)
		}
		folded += lowered
		index = next
	}

	// Sentinel, so a match that ends at the end of the string maps back cleanly.
	sourceStart.push(text.length)
	sourceEnd.push(text.length)

	return { folded, sourceStart, sourceEnd }
}

/** @internal */
export interface TLUiFindOnCanvasMatchRange {
	start: number
	end: number
}

/**
 * Every case-insensitive occurrence of `query` in `text`, as ranges into the original `text`.
 *
 * @internal
 */
export function getFindMatchRanges(text: string, query: string): TLUiFindOnCanvasMatchRange[] {
	const needle = foldTextForFind(query).folded
	if (!needle) return []

	const { folded, sourceStart, sourceEnd } = foldTextForFind(text)
	const ranges: TLUiFindOnCanvasMatchRange[] = []

	let at = folded.indexOf(needle)
	while (at !== -1) {
		ranges.push({ start: sourceStart[at], end: sourceEnd[at + needle.length - 1] })
		at = folded.indexOf(needle, at + needle.length)
	}

	return ranges
}

/**
 * Find every page name and supported shape text that contains `query` as a case-insensitive
 * substring.
 *
 * Results are deterministic: pages come in page-index order, and within a page the page-name result
 * (if any) comes first, followed by shapes in index preorder.
 *
 * @internal
 */
export function getFindOnCanvasResults(editor: Editor, query: string): TLUiFindOnCanvasResult[] {
	const results: TLUiFindOnCanvasResult[] = []
	if (!foldTextForFind(query).folded) return results

	const matchIn = (text: string) => {
		const first = getFindMatchRanges(text, query)[0]
		if (!first) return null
		return { matchStart: first.start, matchEnd: first.end }
	}

	for (const page of editor.getPages()) {
		const pageMatch = matchIn(page.name)
		if (pageMatch) {
			results.push({
				id: `page:${page.id}`,
				kind: 'page',
				pageId: page.id,
				pageName: page.name,
				text: page.name,
				...pageMatch,
			})
		}

		const visit = (shapeId: TLShapeId) => {
			const searchable = getSearchableShapeText(editor, shapeId)
			if (searchable) {
				const match = matchIn(searchable.text)
				if (match) {
					results.push({
						id: `shape:${shapeId}`,
						kind: 'shape',
						pageId: page.id,
						pageName: page.name,
						shapeId,
						shapeType: searchable.shapeType,
						kindKey: searchable.kindKey,
						icon: searchable.icon,
						text: searchable.text,
						...match,
					})
				}
			}
			for (const childId of editor.getSortedChildIdsForParent(shapeId)) {
				visit(childId)
			}
		}

		for (const childId of editor.getSortedChildIdsForParent(page.id)) {
			visit(childId)
		}
	}

	return results
}

/**
 * Group a flat result list by page, preserving the order the results came in.
 *
 * @internal
 */
export function groupFindOnCanvasResults(results: TLUiFindOnCanvasResult[]) {
	const groups: TLUiFindOnCanvasGroup[] = []
	for (const result of results) {
		let group = groups[groups.length - 1]
		if (!group || group.pageId !== result.pageId) {
			group = { pageId: result.pageId, pageName: result.pageName, results: [] }
			groups.push(group)
		}
		group.results.push(result)
	}
	return groups
}

/** @internal */
export interface TLUiFindOnCanvasSnippetSegment {
	text: string
	isMatch: boolean
}

/** How many characters of a long result we show around the first match. */
const SNIPPET_MAX_LENGTH = 64
/** How much of a long result we keep before the first match. */
const SNIPPET_LEAD = 20

/** Move `index` back off the trailing half of a surrogate pair, so slices never split one. */
function alignToCodePointStart(text: string, index: number) {
	if (index <= 0) return 0
	if (index >= text.length) return text.length
	const code = text.charCodeAt(index)
	// A low surrogate here means we landed inside a pair.
	if (code >= 0xdc00 && code <= 0xdfff) return index - 1
	return index
}

/**
 * Trim a long result down to the text around its first match, browser-find style, and split it into
 * matched and unmatched segments so the UI can emphasise the matches without injecting HTML.
 *
 * The segments always concatenate back to the visible snippet, and every non-ellipsis character
 * comes verbatim from `text`.
 *
 * @internal
 */
export function getFindOnCanvasSnippet(
	text: string,
	query: string
): TLUiFindOnCanvasSnippetSegment[] {
	const ranges = getFindMatchRanges(text, query)
	if (ranges.length === 0) return text ? [{ text, isMatch: false }] : []

	// The window of `text` we show, in source indices.
	let windowStart = 0
	let windowEnd = text.length
	if (text.length > SNIPPET_MAX_LENGTH) {
		windowStart = alignToCodePointStart(text, Math.max(0, ranges[0].start - SNIPPET_LEAD))
		windowEnd = alignToCodePointStart(text, Math.min(text.length, windowStart + SNIPPET_MAX_LENGTH))
	}

	const segments: TLUiFindOnCanvasSnippetSegment[] = []
	const push = (value: string, isMatch: boolean) => {
		if (value) segments.push({ text: value, isMatch })
	}

	if (windowStart > 0) push('…', false)

	let index = windowStart
	for (const range of ranges) {
		if (range.end <= windowStart) continue
		if (range.start >= windowEnd) break
		const start = Math.max(range.start, windowStart)
		const end = Math.min(range.end, windowEnd)
		push(text.slice(index, start), false)
		push(text.slice(start, end), true)
		index = end
	}
	push(text.slice(index, windowEnd), false)

	if (windowEnd < text.length) push('…', false)

	return segments.length ? segments : [{ text: text.slice(windowStart, windowEnd), isMatch: false }]
}
