import {
	AssetRecordType,
	createShapeId,
	PageRecordType,
	TLBookmarkAsset,
	toRichText,
} from '@tldraw/editor'
import { beforeEach, describe, expect, it } from 'vitest'
import { TestEditor } from '../../../../test/TestEditor'
import { getFindMatchRanges, getFindOnCanvasResults, getFindOnCanvasSnippet } from './findOnCanvas'

let editor: TestEditor

const pageA = PageRecordType.createId('a')
const pageB = PageRecordType.createId('b')

const textId = createShapeId('text')
const noteId = createShapeId('note')
const geoId = createShapeId('geo')
const bookmarkId = createShapeId('bookmark')
const arrowId = createShapeId('arrow')
const frameId = createShapeId('frame')
const childId = createShapeId('child')

const bookmarkAssetId = AssetRecordType.createId('bookmark')

beforeEach(() => {
	editor = new TestEditor()
	editor.renamePage(editor.getCurrentPageId(), 'Onboarding flow')
	editor.createPage({ id: pageA, name: 'Auth service architecture' })
	editor.createPage({ id: pageB, name: 'Authoring guidelines' })
})

function ids(query: string) {
	return getFindOnCanvasResults(editor, query).map((result) => result.id)
}

describe('getFindOnCanvasResults', () => {
	it('returns no results for a blank query', () => {
		editor.createShape({ id: textId, type: 'text', props: { richText: toRichText('Auth') } })
		expect(getFindOnCanvasResults(editor, '')).toEqual([])
	})

	it('matches exact case-insensitive substrings, including mid-word', () => {
		editor.createShape({
			id: textId,
			type: 'text',
			x: 0,
			y: 0,
			props: { richText: toRichText('OAuth callback') },
		})

		expect(ids('auth')).toContain(`shape:${textId}`)
		expect(ids('AUTH')).toContain(`shape:${textId}`)
		expect(ids('oauth callback')).toContain(`shape:${textId}`)
		// no fuzzy or token matching: only exact substrings match
		expect(ids('atuh')).not.toContain(`shape:${textId}`)
		expect(ids('oauth back')).not.toContain(`shape:${textId}`)
	})

	it('returns whole results for text, note, geo, and bookmark shapes', () => {
		editor.createShape({
			id: textId,
			type: 'text',
			props: { richText: toRichText('Authentication service') },
		})
		editor.createShape({
			id: noteId,
			type: 'note',
			props: { richText: toRichText('Auth token expires') },
		})
		editor.createShape({
			id: geoId,
			type: 'geo',
			props: { geo: 'ellipse', richText: toRichText('Author profile') },
		})
		editor.createAssets([
			AssetRecordType.create({
				id: bookmarkAssetId,
				type: 'bookmark',
				props: {
					src: 'https://example.com/authors',
					title: 'Authoring guide',
					description: '',
					image: '',
					favicon: '',
				},
			}),
		])
		editor.createShape({
			id: bookmarkId,
			type: 'bookmark',
			props: { url: 'https://example.com/authors', assetId: bookmarkAssetId },
		})

		const results = getFindOnCanvasResults(editor, 'auth')
		const pageName = editor.getPage(editor.getCurrentPageId())!.name

		expect(results.filter((result) => result.pageId === editor.getCurrentPageId())).toEqual([
			{
				id: `shape:${textId}`,
				kind: 'shape',
				pageId: editor.getCurrentPageId(),
				pageName,
				shapeId: textId,
				shapeType: 'text',
				kindKey: 'tool.text',
				icon: 'tool-text',
				text: 'Authentication service',
				matchStart: 0,
				matchEnd: 4,
			},
			{
				id: `shape:${noteId}`,
				kind: 'shape',
				pageId: editor.getCurrentPageId(),
				pageName,
				shapeId: noteId,
				shapeType: 'note',
				kindKey: 'tool.note',
				icon: 'tool-note',
				text: 'Auth token expires',
				matchStart: 0,
				matchEnd: 4,
			},
			{
				id: `shape:${geoId}`,
				kind: 'shape',
				pageId: editor.getCurrentPageId(),
				pageName,
				shapeId: geoId,
				shapeType: 'geo',
				kindKey: 'geo-style.ellipse',
				icon: 'geo-ellipse',
				text: 'Author profile',
				matchStart: 0,
				matchEnd: 4,
			},
			{
				id: `shape:${bookmarkId}`,
				kind: 'shape',
				pageId: editor.getCurrentPageId(),
				pageName,
				shapeId: bookmarkId,
				shapeType: 'bookmark',
				kindKey: 'tool.bookmark',
				icon: 'bookmark',
				text: 'Authoring guide — https://example.com/authors',
				matchStart: 0,
				matchEnd: 4,
			},
		])
	})

	it('searches a bookmark url when it has no title', () => {
		editor.createShape({
			id: bookmarkId,
			type: 'bookmark',
			props: { url: 'https://example.com/authors' },
		})
		expect(ids('authors')).toEqual([`shape:${bookmarkId}`])
	})

	it('does not search unsupported shape types', () => {
		editor.createShape({
			id: arrowId,
			type: 'arrow',
			props: { richText: toRichText('Authenticate') },
		})
		editor.createShape({ id: frameId, type: 'frame', props: { name: 'Auth frame' } })
		// arrow labels and frame names are deliberately not searched
		expect(ids('authenticate')).toEqual([])
		expect(ids('auth frame')).toEqual([])
	})

	it('orders results by page index, page name first, then shapes in preorder', () => {
		editor.setCurrentPage(pageA)
		editor.createShape({ id: frameId, type: 'frame', x: 0, y: 0, props: { name: 'Frame' } })
		editor.createShape({
			id: childId,
			type: 'text',
			parentId: frameId,
			props: { richText: toRichText('Auth child') },
		})
		editor.createShape({
			id: textId,
			type: 'text',
			x: 400,
			y: 0,
			props: { richText: toRichText('Auth sibling') },
		})

		expect(ids('auth')).toEqual([
			`page:${pageA}`,
			`shape:${childId}`,
			`shape:${textId}`,
			`page:${pageB}`,
		])
	})

	it('updates when shapes are created, edited, and deleted', () => {
		editor.setCurrentPage(pageA)
		expect(ids('widget')).toEqual([])

		editor.createShape({ id: textId, type: 'text', props: { richText: toRichText('Widget') } })
		expect(ids('widget')).toEqual([`shape:${textId}`])

		editor.updateShape({
			id: textId,
			type: 'text',
			props: { richText: toRichText('Gadget') },
		})
		expect(ids('widget')).toEqual([])
		expect(ids('gadget')).toEqual([`shape:${textId}`])

		editor.deleteShape(textId)
		expect(ids('gadget')).toEqual([])
	})

	it('reports match offsets against the source text, not the folded text', () => {
		editor.createShape({
			id: textId,
			type: 'text',
			props: { richText: toRichText('\u0130Auth service') },
		})

		const result = getFindOnCanvasResults(editor, 'auth').find(
			(candidate) => candidate.id === `shape:${textId}`
		)!

		expect({ start: result.matchStart, end: result.matchEnd }).toEqual({ start: 1, end: 5 })
		expect(result.text.slice(result.matchStart, result.matchEnd)).toBe('Auth')
	})

	it('updates when a page is renamed', () => {
		expect(ids('renamed')).toEqual([])
		editor.renamePage(pageA, 'Renamed page')
		expect(ids('renamed')).toEqual([`page:${pageA}`])
	})

	it('updates when a bookmark asset title changes', () => {
		editor.createAssets([
			AssetRecordType.create({
				id: bookmarkAssetId,
				type: 'bookmark',
				props: {
					src: 'https://example.com/x',
					title: 'Before',
					description: '',
					image: '',
					favicon: '',
				},
			}),
		])
		editor.createShape({
			id: bookmarkId,
			type: 'bookmark',
			props: { url: 'https://example.com/x', assetId: bookmarkAssetId },
		})
		expect(ids('before')).toEqual([`shape:${bookmarkId}`])

		const asset = editor.getAsset(bookmarkAssetId) as TLBookmarkAsset
		editor.updateAssets([{ ...asset, props: { ...asset.props, title: 'After' } }])
		expect(ids('before')).toEqual([])
		expect(ids('after')).toEqual([`shape:${bookmarkId}`])
	})
})

describe('getFindOnCanvasSnippet', () => {
	it('marks every occurrence of the query while preserving the original text', () => {
		expect(getFindOnCanvasSnippet('Auth and OAuth', 'auth')).toEqual([
			{ text: 'Auth', isMatch: true },
			{ text: ' and O', isMatch: false },
			{ text: 'Auth', isMatch: true },
		])
	})

	it('trims long text down to the first match', () => {
		const text = `${'x'.repeat(200)} needle ${'y'.repeat(200)}`
		const segments = getFindOnCanvasSnippet(text, 'needle')
		const snippet = segments.map((segment) => segment.text).join('')

		expect(snippet.startsWith('…')).toBe(true)
		expect(snippet.endsWith('…')).toBe(true)
		expect(snippet).toContain('needle')
		expect(segments.filter((segment) => segment.isMatch)).toEqual([
			{ text: 'needle', isMatch: true },
		])
	})

	it('returns the text unchanged for a blank query', () => {
		expect(getFindOnCanvasSnippet('Auth', '')).toEqual([{ text: 'Auth', isMatch: false }])
	})

	it('keeps the source text when folding changes its length', () => {
		// 'İ'.toLowerCase() is two code units, so folded offsets are not source offsets.
		expect(getFindOnCanvasSnippet('İAuth service', 'auth')).toEqual([
			{ text: 'İ', isMatch: false },
			{ text: 'Auth', isMatch: true },
			{ text: ' service', isMatch: false },
		])
	})

	it('keeps astral characters before a match intact', () => {
		expect(getFindOnCanvasSnippet('🙂 Auth', 'auth')).toEqual([
			{ text: '🙂 ', isMatch: false },
			{ text: 'Auth', isMatch: true },
		])
	})

	it('marks every occurrence when folding expands more than once', () => {
		expect(getFindOnCanvasSnippet('İiİi', 'i')).toEqual([
			{ text: 'İ', isMatch: true },
			{ text: 'i', isMatch: true },
			{ text: 'İ', isMatch: true },
			{ text: 'i', isMatch: true },
		])
	})

	it('never splits a surrogate pair when it trims', () => {
		const text = `${'🙂'.repeat(40)} needle ${'y'.repeat(100)}`
		const snippet = getFindOnCanvasSnippet(text, 'needle')
			.map((segment) => segment.text)
			.join('')
		const visible = snippet.replace(/…/g, '')

		// A split pair would leave a lone surrogate, which renders as U+FFFD.
		expect(visible).not.toContain('\ufffd')
		expect(JSON.stringify(visible)).not.toContain('\\ud')
		expect(text).toContain(visible)
		expect(visible).toContain('needle')
	})
})

describe('Greek sigma', () => {
	it('treats capital, normal, and final sigma as the same letter', () => {
		expect(getFindMatchRanges('ΟΣ', 'ος')).toEqual([{ start: 0, end: 2 }])
		expect(getFindMatchRanges('ος', 'ΟΣ')).toEqual([{ start: 0, end: 2 }])
		expect(getFindMatchRanges('ΟΣ', 'οσ')).toEqual([{ start: 0, end: 2 }])
		expect(getFindMatchRanges('οσ', 'ος')).toEqual([{ start: 0, end: 2 }])
	})

	it('matches both occurrences regardless of position in the word', () => {
		// `'ΟΣΟΣ'.toLowerCase()` is `'οσος'`, so a whole-string lowercase would miss one of these.
		expect(getFindMatchRanges('ΟΣΟΣ', 'ΟΣ')).toEqual([
			{ start: 0, end: 2 },
			{ start: 2, end: 4 },
		])
		expect(getFindMatchRanges('ΟΣΟΣ', 'ος')).toEqual([
			{ start: 0, end: 2 },
			{ start: 2, end: 4 },
		])
	})

	it('marks both occurrences without rewriting the source spelling', () => {
		expect(getFindOnCanvasSnippet('ΟΣΟΣ', 'ος')).toEqual([
			{ text: 'ΟΣ', isMatch: true },
			{ text: 'ΟΣ', isMatch: true },
		])
		expect(getFindOnCanvasSnippet('τέλος και τέλος', 'τέλοσ')).toEqual([
			{ text: 'τέλος', isMatch: true },
			{ text: ' και ', isMatch: false },
			{ text: 'τέλος', isMatch: true },
		])
	})

	it('finds a shape whose label ends in a final sigma', () => {
		editor.createShape({
			id: textId,
			type: 'text',
			props: { richText: toRichText('Κάτοψη τέλος') },
		})

		for (const query of ['τέλος', 'τέλοσ', 'ΤΈΛΟΣ']) {
			const result = getFindOnCanvasResults(editor, query).find(
				(candidate) => candidate.id === `shape:${textId}`
			)
			expect(result?.text.slice(result.matchStart, result.matchEnd)).toBe('τέλος')
		}
	})
})

describe('getFindMatchRanges', () => {
	it('maps folded matches back onto source indices', () => {
		expect(getFindMatchRanges('İAuth', 'auth')).toEqual([{ start: 1, end: 5 }])
		expect('İAuth'.slice(1, 5)).toBe('Auth')
	})

	it('returns every occurrence in source order', () => {
		expect(getFindMatchRanges('Auth and OAuth', 'auth')).toEqual([
			{ start: 0, end: 4 },
			{ start: 10, end: 14 },
		])
	})

	it('returns nothing for a blank query', () => {
		expect(getFindMatchRanges('Auth', '')).toEqual([])
	})
})
