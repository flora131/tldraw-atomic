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
	const needle = query.toLowerCase()
	if (!needle) return results

	const matchIn = (text: string) => {
		const start = text.toLowerCase().indexOf(needle)
		if (start === -1) return null
		return { matchStart: start, matchEnd: Math.min(start + needle.length, text.length) }
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

/**
 * Trim a long result down to the text around its first match, browser-find style, and split it into
 * matched and unmatched segments so the UI can emphasise the matches without injecting HTML.
 *
 * @internal
 */
export function getFindOnCanvasSnippet(
	text: string,
	query: string
): TLUiFindOnCanvasSnippetSegment[] {
	const needle = query.toLowerCase()
	if (!needle) return text ? [{ text, isMatch: false }] : []

	let snippet = text
	if (text.length > SNIPPET_MAX_LENGTH) {
		const at = text.toLowerCase().indexOf(needle)
		const start = Math.max(0, (at === -1 ? 0 : at) - SNIPPET_LEAD)
		const end = start + SNIPPET_MAX_LENGTH
		snippet = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
	}

	const segments: TLUiFindOnCanvasSnippetSegment[] = []
	const lower = snippet.toLowerCase()
	let index = 0
	while (index <= snippet.length) {
		const at = lower.indexOf(needle, index)
		if (at === -1) break
		if (at > index) segments.push({ text: snippet.slice(index, at), isMatch: false })
		segments.push({ text: snippet.slice(at, at + needle.length), isMatch: true })
		index = at + needle.length
	}
	if (index < snippet.length) segments.push({ text: snippet.slice(index), isMatch: false })

	return segments.length ? segments : [{ text: snippet, isMatch: false }]
}
