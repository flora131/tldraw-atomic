import { act, fireEvent, screen } from '@testing-library/react'
import { createShapeId, Editor, PageRecordType, toRichText } from '@tldraw/editor'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Tldraw } from '../../lib/Tldraw'
import { renderTldrawComponentWithEditor } from '../testutils/renderTldrawComponent'

// The package test setup replaces `useTranslation` with a stub that returns the key. These tests
// check the copy users actually see, so they use the real translations.
vi.mock('../../lib/ui/hooks/useTranslation/useTranslation', async () =>
	vi.importActual('../../lib/ui/hooks/useTranslation/useTranslation')
)

const pageB = PageRecordType.createId('b')

const textId = createShapeId('text')
const noteId = createShapeId('note')
const otherPageTextId = createShapeId('other')

async function setup() {
	const { editor } = await renderTldrawComponentWithEditor(
		(onMount) => <Tldraw onMount={onMount} />,
		{ waitForPatterns: false }
	)

	act(() => {
		// Shortcuts only register while the editor is focused.
		editor.updateInstanceState({ isFocused: true })
		editor.renamePage(editor.getCurrentPageId(), 'Onboarding flow')
		editor.createShape({
			id: textId,
			type: 'text',
			x: 0,
			y: 0,
			props: { richText: toRichText('Authentication service') },
		})
		editor.createShape({
			id: noteId,
			type: 'note',
			x: 300,
			y: 0,
			props: { richText: toRichText('Auth token expires') },
		})
		editor.createPage({ id: pageB, name: 'Authoring guidelines' })
		editor.setCurrentPage(pageB)
		editor.createShape({
			id: otherPageTextId,
			type: 'text',
			x: 0,
			y: 0,
			props: { richText: toRichText('Author profile') },
		})
		editor.setCurrentPage(editor.getPages()[0].id)
		editor.setSelectedShapes([])
	})

	return { editor }
}

function pressShortcut(editor: Editor, init: KeyboardEventInit) {
	const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
	act(() => {
		editor.getContainerDocument().body.dispatchEvent(event)
	})
	return event
}

function openFind(editor: Editor) {
	return pressShortcut(editor, { key: 'f', code: 'KeyF', metaKey: true })
}

function getInput() {
	return screen.getByTestId('find-on-canvas.input') as HTMLInputElement
}

function type(value: string) {
	fireEvent.change(getInput(), { target: { value } })
}

function getRows() {
	return screen.getAllByRole('option')
}

function getActiveRowLabel() {
	const input = getInput()
	const id = input.getAttribute('aria-activedescendant')
	return id ? document.getElementById(id)?.getAttribute('aria-label') : undefined
}

beforeEach(() => {
	vi.useRealTimers()
})

describe('find on canvas', () => {
	it('opens with cmd+f and prevents the browser find dialog', async () => {
		const { editor } = await setup()
		expect(screen.queryByTestId('find-on-canvas.input')).toBeNull()

		const event = openFind(editor)

		expect(event.defaultPrevented).toBe(true)
		expect(getInput()).toBeTruthy()
	})

	it('opens with ctrl+f and focuses the query', async () => {
		const { editor } = await setup()
		pressShortcut(editor, { key: 'f', code: 'KeyF', ctrlKey: true })

		expect(document.activeElement).toBe(getInput())
	})

	it('groups matches by page in a deterministic order', async () => {
		const { editor } = await setup()
		openFind(editor)
		type('auth')

		expect(screen.getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual([
			'Onboarding flow',
			'Authoring guidelines',
		])
		expect(getRows().map((row) => row.textContent)).toEqual([
			'Authentication serviceText',
			'Auth token expiresNote',
			'Authoring guidelinesPage',
			'Author profileText',
		])
	})

	it('shows the active position and moves with the arrow keys', async () => {
		const { editor } = await setup()
		openFind(editor)
		type('auth')

		expect(screen.getByTestId('find-on-canvas.count').textContent).toBe('1 of 4')
		expect(getActiveRowLabel()).toBe('Authentication service, text, on page Onboarding flow.')

		fireEvent.keyDown(getInput(), { key: 'ArrowDown' })
		expect(screen.getByTestId('find-on-canvas.count').textContent).toBe('2 of 4')
		expect(getActiveRowLabel()).toBe('Auth token expires, note, on page Onboarding flow.')

		fireEvent.keyDown(getInput(), { key: 'ArrowUp' })
		expect(screen.getByTestId('find-on-canvas.count').textContent).toBe('1 of 4')

		// wraps around backwards
		fireEvent.keyDown(getInput(), { key: 'ArrowUp' })
		expect(screen.getByTestId('find-on-canvas.count').textContent).toBe('4 of 4')
	})

	it('moves with the previous and next controls', async () => {
		const { editor } = await setup()
		openFind(editor)
		type('auth')

		fireEvent.click(screen.getByTestId('find-on-canvas.next'))
		expect(screen.getByTestId('find-on-canvas.count').textContent).toBe('2 of 4')

		fireEvent.click(screen.getByTestId('find-on-canvas.previous'))
		expect(screen.getByTestId('find-on-canvas.count').textContent).toBe('1 of 4')
	})

	it('does not let palette keys trigger canvas shortcuts', async () => {
		const { editor } = await setup()
		openFind(editor)
		expect(editor.getCurrentToolId()).toBe('select')

		// `d` selects the draw tool on the canvas.
		fireEvent.keyDown(getInput(), { key: 'd', code: 'KeyD', bubbles: true })
		type('d')

		expect(editor.getCurrentToolId()).toBe('select')
		expect(getInput().value).toBe('d')
	})

	it('jumps to a shape result: switches page, selects it, and frames it', async () => {
		const { editor } = await setup()
		const setCamera = vi.spyOn(editor, 'setCamera')
		openFind(editor)
		type('author profile')

		expect(getRows()).toHaveLength(1)
		fireEvent.keyDown(getInput(), { key: 'Enter' })

		expect(editor.getCurrentPageId()).toBe(pageB)
		expect(editor.getSelectedShapeIds()).toEqual([otherPageTextId])
		expect(setCamera).toHaveBeenCalled()
	})

	it('jumps to a page result without selecting an unrelated shape', async () => {
		const { editor } = await setup()
		act(() => {
			editor.setCurrentPage(pageB)
			editor.setSelectedShapes([otherPageTextId])
			editor.setCurrentPage(editor.getPages()[0].id)
		})

		openFind(editor)
		type('authoring guidelines')

		expect(getRows()).toHaveLength(1)
		fireEvent.keyDown(getInput(), { key: 'Enter' })

		expect(editor.getCurrentPageId()).toBe(pageB)
		expect(editor.getSelectedShapeIds()).toEqual([])
	})

	it('keeps the slot when the active result is deleted', async () => {
		const { editor } = await setup()
		openFind(editor)
		type('auth')

		fireEvent.keyDown(getInput(), { key: 'ArrowDown' })
		expect(getActiveRowLabel()).toBe('Auth token expires, note, on page Onboarding flow.')

		act(() => {
			editor.deleteShape(noteId)
		})

		expect(screen.getByTestId('find-on-canvas.count').textContent).toBe('2 of 3')
		expect(getActiveRowLabel()).toBe('Go to page Authoring guidelines.')
	})

	it('updates results when searchable text changes', async () => {
		const { editor } = await setup()
		openFind(editor)
		type('gadget')

		expect(screen.getByTestId('find-on-canvas.message').textContent).toBe(
			'No shapes contain ‘gadget’.'
		)

		act(() => {
			editor.updateShape({
				id: textId,
				type: 'text',
				props: { richText: toRichText('Gadget service') },
			})
		})

		expect(getRows().map((row) => row.textContent)).toEqual(['Gadget serviceText'])
	})

	it('shows an instructional state before anything is typed', async () => {
		const { editor } = await setup()
		openFind(editor)

		expect(screen.getByTestId('find-on-canvas.message').textContent).toBe(
			'Search shape text, notes, bookmarks, and page names.'
		)
	})

	it('closes on escape and returns focus to the editor', async () => {
		const { editor } = await setup()
		openFind(editor)

		fireEvent.keyDown(getInput(), { key: 'Escape' })

		expect(screen.queryByTestId('find-on-canvas.input')).toBeNull()
		expect(document.activeElement).toBe(editor.getContainer())
	})
})
