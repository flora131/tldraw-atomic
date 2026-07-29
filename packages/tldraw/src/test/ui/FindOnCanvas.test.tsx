import { act, fireEvent, screen } from '@testing-library/react'
import { createShapeId, Editor, PageRecordType, toRichText } from '@tldraw/editor'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Tldraw } from '../../lib/Tldraw'
import { TLUiOverrides } from '../../lib/ui/overrides'
import {
	renderTldrawComponent,
	renderTldrawComponentWithEditor,
} from '../testutils/renderTldrawComponent'

// The package test setup replaces `useTranslation` with a stub that returns the key. These tests
// check the copy users actually see, so they use the real translations.
vi.mock('../../lib/ui/hooks/useTranslation/useTranslation', async () =>
	vi.importActual('../../lib/ui/hooks/useTranslation/useTranslation')
)

const pageB = PageRecordType.createId('b')

const textId = createShapeId('text')
const noteId = createShapeId('note')
const otherPageTextId = createShapeId('other')

async function setup(overrides?: TLUiOverrides) {
	const { editor } = await renderTldrawComponentWithEditor(
		(onMount) => <Tldraw onMount={onMount} overrides={overrides} />,
		{ waitForPatterns: false }
	)

	act(() => {
		// User preferences and open menus are global, so start every test from a known state.
		editor.user.updateUserPreferences({ areKeyboardShortcutsEnabled: true })
		editor.menus.clearOpenMenus()
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

/** Dispatch a keydown the way a real keypress arrives: from inside the editor container. */
function pressShortcut(editor: Editor, init: KeyboardEventInit, target?: Element) {
	const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
	act(() => {
		;(target ?? editor.getContainer()).dispatchEvent(event)
	})
	return event
}

function openFind(editor: Editor, target?: Element) {
	return pressShortcut(editor, { key: 'f', code: 'KeyF', metaKey: true }, target)
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

function getCount() {
	return screen.getByTestId('find-on-canvas.count').textContent
}

function getActiveRow() {
	const id = getInput().getAttribute('aria-activedescendant')
	return id ? document.getElementById(id) : null
}

function getActiveRowLabel() {
	return getActiveRow()?.getAttribute('aria-label')
}

/** The single row flagged as selected, so a stale `aria-selected` can't hide behind the count. */
function getSelectedRowLabels() {
	return getRows()
		.filter((row) => row.getAttribute('aria-selected') === 'true')
		.map((row) => row.getAttribute('aria-label'))
}

function getLiveRegionText() {
	return document.querySelector('[role="status"]')?.textContent ?? null
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

	it('opens from a non-Latin keyboard layout', async () => {
		const { editor } = await setup()

		// Cyrillic: the physical F key reports 'а'.
		const cyrillic = pressShortcut(editor, { key: 'а', code: 'KeyF', metaKey: true })
		expect(cyrillic.defaultPrevented).toBe(true)
		expect(getInput()).toBeTruthy()

		fireEvent.keyDown(getInput(), { key: 'Escape' })

		// Greek: the same physical key reports 'φ'.
		const greek = pressShortcut(editor, { key: 'φ', code: 'KeyF', ctrlKey: true })
		expect(greek.defaultPrevented).toBe(true)
		expect(getInput()).toBeTruthy()
	})

	it('does not fall back to the physical key for other Latin layouts', async () => {
		const { editor } = await setup()

		// Dvorak: the physical F key types 'j', and cmd+J is not find.
		const event = pressShortcut(editor, { key: 'j', code: 'KeyF', metaKey: true })

		expect(event.defaultPrevented).toBe(false)
		expect(screen.queryByTestId('find-on-canvas.input')).toBeNull()
	})

	it('ignores a non-Latin shortcut when shortcuts are off or an IME is composing', async () => {
		const { editor } = await setup()
		act(() => {
			editor.user.updateUserPreferences({ areKeyboardShortcutsEnabled: false })
		})
		const disabled = pressShortcut(editor, { key: 'а', code: 'KeyF', metaKey: true })
		expect(disabled.defaultPrevented).toBe(false)
		expect(screen.queryByTestId('find-on-canvas.input')).toBeNull()

		act(() => {
			editor.user.updateUserPreferences({ areKeyboardShortcutsEnabled: true })
		})
		const composing = pressShortcut(editor, {
			key: 'а',
			code: 'KeyF',
			metaKey: true,
			isComposing: true,
		})
		expect(composing.defaultPrevented).toBe(false)
		expect(screen.queryByTestId('find-on-canvas.input')).toBeNull()
	})

	it('opens when the editor holds focus but nothing is focused in the DOM', async () => {
		const { editor } = await setup()

		// The state right after mount: the editor is logically focused, the body is the active element.
		const event = pressShortcut(
			editor,
			{ key: 'f', code: 'KeyF', metaKey: true },
			editor.getContainerDocument().body
		)

		expect(event.defaultPrevented).toBe(true)
		expect(getInput()).toBeTruthy()
	})

	it('ignores the shortcut when focus is outside the editor', async () => {
		const { editor } = await setup()
		const outside = editor.getContainerDocument().createElement('input')
		editor.getContainerDocument().body.appendChild(outside)

		const event = pressShortcut(editor, { key: 'f', code: 'KeyF', metaKey: true }, outside)

		expect(event.defaultPrevented).toBe(false)
		expect(screen.queryByTestId('find-on-canvas.input')).toBeNull()
		outside.remove()
	})

	it('opens while a shape label is being edited', async () => {
		const { editor } = await setup()

		// Stand in for the ProseMirror surface: a contenteditable inside the editor container while
		// the editor is in text-editing mode. The generic shortcut hook skips both of these.
		const editable = editor.getContainerDocument().createElement('div')
		editable.setAttribute('contenteditable', 'true')
		editor.getContainer().appendChild(editable)
		act(() => {
			editor.setEditingShape(textId)
		})
		editable.focus()
		expect(editor.getEditingShapeId()).toBe(textId)

		const event = openFind(editor, editable)

		expect(event.defaultPrevented).toBe(true)
		expect(getInput()).toBeTruthy()
		expect(document.activeElement).toBe(getInput())
		// Opening committed the text edit.
		expect(editor.getEditingShapeId()).toBe(null)
	})

	it('leaves the browser find bar alone when keyboard shortcuts are turned off', async () => {
		const { editor } = await setup()
		act(() => {
			editor.user.updateUserPreferences({ areKeyboardShortcutsEnabled: false })
		})

		const event = openFind(editor)

		expect(screen.queryByTestId('find-on-canvas.input')).toBeNull()
		// Not preventing it is the point: the browser's own find bar has to stay available.
		expect(event.defaultPrevented).toBe(false)
	})

	it('leaves the browser find bar alone while editing text with shortcuts turned off', async () => {
		const { editor } = await setup()
		const editable = editor.getContainerDocument().createElement('div')
		editable.setAttribute('contenteditable', 'true')
		editor.getContainer().appendChild(editable)
		act(() => {
			editor.user.updateUserPreferences({ areKeyboardShortcutsEnabled: false })
			editor.setEditingShape(textId)
		})
		editable.focus()

		const event = openFind(editor, editable)

		expect(screen.queryByTestId('find-on-canvas.input')).toBeNull()
		expect(event.defaultPrevented).toBe(false)
		// The text edit is untouched.
		expect(editor.getEditingShapeId()).toBe(textId)
	})

	it('does not open while another menu is open', async () => {
		const { editor } = await setup()
		act(() => {
			editor.menus.addOpenMenu('some-other-menu')
		})

		const event = openFind(editor)

		expect(screen.queryByTestId('find-on-canvas.input')).toBeNull()
		expect(event.defaultPrevented).toBe(false)

		act(() => {
			editor.menus.deleteOpenMenu('some-other-menu')
		})
		expect(openFind(editor).defaultPrevented).toBe(true)
		expect(getInput()).toBeTruthy()
	})

	it('does not open while the editor is crashing', async () => {
		const { editor } = await setup()
		act(() => {
			editor.crash(new Error('test crash'))
		})

		const event = openFind(editor)

		expect(screen.queryByTestId('find-on-canvas.input')).toBeNull()
		expect(event.defaultPrevented).toBe(false)
	})

	it('lets an action override under the same id replace the palette', async () => {
		const calls: string[] = []
		const { editor } = await setup({
			actions(_editor, actions) {
				return {
					...actions,
					'find-on-canvas': {
						...actions['find-on-canvas'],
						onSelect(source) {
							calls.push(source)
						},
					},
				}
			},
		})

		openFind(editor)

		expect(calls).toEqual(['kbd'])
		expect(screen.queryByTestId('find-on-canvas.input')).toBeNull()
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

	it('keeps result rows out of the tab order', async () => {
		const { editor } = await setup()
		openFind(editor)
		type('auth')

		expect(getRows().map((row) => row.getAttribute('tabindex'))).toEqual(['-1', '-1', '-1', '-1'])
		expect(screen.getByTestId('find-on-canvas.next').getAttribute('tabindex')).toBe(null)
	})

	it('shows the active position and moves with the arrow keys without jumping', async () => {
		const { editor } = await setup()
		openFind(editor)
		type('auth')

		expect(getCount()).toBe('1 of 4')
		expect(getActiveRowLabel()).toBe('Authentication service, text, on page Onboarding flow.')

		fireEvent.keyDown(getInput(), { key: 'ArrowDown' })
		expect(getCount()).toBe('2 of 4')
		expect(getActiveRowLabel()).toBe('Auth token expires, note, on page Onboarding flow.')
		// Moving is not committing: no page switch and no selection.
		expect(editor.getCurrentPageId()).toBe(editor.getPages()[0].id)
		expect(editor.getSelectedShapeIds()).toEqual([])

		fireEvent.keyDown(getInput(), { key: 'ArrowUp' })
		expect(getCount()).toBe('1 of 4')

		// wraps around backwards
		fireEvent.keyDown(getInput(), { key: 'ArrowUp' })
		expect(getCount()).toBe('4 of 4')
	})

	it('moves and jumps with the previous and next controls', async () => {
		const { editor } = await setup()
		openFind(editor)
		type('auth')

		fireEvent.click(screen.getByTestId('find-on-canvas.next'))
		expect(getCount()).toBe('2 of 4')
		expect(getSelectedRowLabels()).toEqual(['Auth token expires, note, on page Onboarding flow.'])
		// A pointer user gets no Enter step: next also commits.
		expect(editor.getSelectedShapeIds()).toEqual([noteId])
		// Focus goes back to the query, which owns aria-activedescendant.
		expect(document.activeElement).toBe(getInput())

		fireEvent.click(screen.getByTestId('find-on-canvas.next'))
		expect(getCount()).toBe('3 of 4')
		// The third result is the page name for page B.
		expect(editor.getCurrentPageId()).toBe(pageB)
		expect(editor.getSelectedShapeIds()).toEqual([])

		fireEvent.click(screen.getByTestId('find-on-canvas.previous'))
		expect(getCount()).toBe('2 of 4')
		expect(editor.getSelectedShapeIds()).toEqual([noteId])
	})

	it('makes a clicked row the active result and jumps to it', async () => {
		const { editor } = await setup()
		openFind(editor)
		type('auth')

		fireEvent.click(getRows()[3])

		expect(getCount()).toBe('4 of 4')
		expect(getActiveRowLabel()).toBe('Author profile, text, on page Authoring guidelines.')
		expect(getSelectedRowLabels()).toEqual(['Author profile, text, on page Authoring guidelines.'])
		expect(editor.getCurrentPageId()).toBe(pageB)
		expect(editor.getSelectedShapeIds()).toEqual([otherPageTextId])
		expect(document.activeElement).toBe(getInput())

		// The next arrow press continues from the clicked row, not from where it used to be.
		fireEvent.keyDown(getInput(), { key: 'ArrowDown' })
		expect(getCount()).toBe('1 of 4')
	})

	it('lets the focused header button keep Enter for itself', async () => {
		const { editor } = await setup()
		openFind(editor)
		type('auth')

		const close = screen.getByTestId('find-on-canvas.close') as HTMLButtonElement
		close.focus()
		fireEvent.keyDown(close, { key: 'Enter' })
		// The palette's handler must not swallow it into a jump.
		expect(editor.getSelectedShapeIds()).toEqual([])
		expect(screen.queryByTestId('find-on-canvas.input')).toBeTruthy()

		fireEvent.click(close)
		expect(screen.queryByTestId('find-on-canvas.input')).toBeNull()
	})

	it('lets FocusManager restore the focus ring', async () => {
		const { editor } = await setup()
		openFind(editor)
		type('auth')

		const container = editor.getContainer()
		container.classList.add('tl-container__no-focus-ring')
		fireEvent.keyDown(getInput(), { key: 'ArrowDown' })
		expect(container.classList.contains('tl-container__no-focus-ring')).toBe(false)

		container.classList.add('tl-container__no-focus-ring')
		fireEvent.keyDown(screen.getByTestId('find-on-canvas.next'), { key: 'Tab' })
		expect(container.classList.contains('tl-container__no-focus-ring')).toBe(false)
	})

	it('does not let palette keys trigger canvas shortcuts', async () => {
		const { editor } = await setup()
		openFind(editor)
		expect(editor.getCurrentToolId()).toBe('select')

		// `d` selects the draw tool on the canvas.
		fireEvent.keyDown(getInput(), { key: 'd', code: 'KeyD' })
		type('d')
		expect(editor.getCurrentToolId()).toBe('select')
		expect(getInput().value).toBe('d')

		// ...including while a palette button owns focus, where the shortcut hook's own input filter
		// would not help.
		const next = screen.getByTestId('find-on-canvas.next') as HTMLButtonElement
		next.focus()
		fireEvent.keyDown(next, { key: 'd', code: 'KeyD' })
		expect(editor.getCurrentToolId()).toBe('select')
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

		expect(getCount()).toBe('2 of 3')
		expect(getActiveRowLabel()).toBe('Go to page Authoring guidelines.')
		expect(getLiveRegionText()).toBe('Go to page Authoring guidelines. 2 of 3')
	})

	it('updates results when searchable text changes', async () => {
		const { editor } = await setup()
		openFind(editor)
		type('gadget')

		expect(screen.getByTestId('find-on-canvas.message').textContent).toBe(
			'No shapes contain ‘gadget’.'
		)
		expect(getLiveRegionText()).toBe('No shapes contain ‘gadget’.')

		act(() => {
			editor.updateShape({
				id: textId,
				type: 'text',
				props: { richText: toRichText('Gadget service') },
			})
		})

		expect(getRows().map((row) => row.textContent)).toEqual(['Gadget serviceText'])
		expect(getLiveRegionText()).toBe('Gadget service, text, on page Onboarding flow. 1 of 1')
	})

	it('announces results created, renamed, and removed while it is open', async () => {
		const { editor } = await setup()
		openFind(editor)
		type('widget')
		expect(getLiveRegionText()).toBe('No shapes contain ‘widget’.')

		const created = createShapeId('created')
		act(() => {
			editor.createShape({
				id: created,
				type: 'note',
				x: 600,
				y: 0,
				props: { richText: toRichText('Widget backlog') },
			})
		})
		expect(getLiveRegionText()).toBe('Widget backlog, note, on page Onboarding flow. 1 of 1')

		act(() => {
			editor.renamePage(pageB, 'Widget guidelines')
		})
		expect(getLiveRegionText()).toBe('Widget backlog, note, on page Onboarding flow. 1 of 2')

		// A change that does not touch the results stays quiet.
		const before = getLiveRegionText()
		act(() => {
			editor.setCamera({ x: 123, y: 456, z: 1 })
		})
		expect(getLiveRegionText()).toBe(before)

		act(() => {
			editor.deleteShape(created)
			editor.renamePage(pageB, 'Authoring guidelines')
		})
		expect(getLiveRegionText()).toBe('No shapes contain ‘widget’.')
	})

	it('shows an instructional state before anything is typed', async () => {
		const { editor } = await setup()
		openFind(editor)

		expect(screen.getByTestId('find-on-canvas.message').textContent).toBe(
			'Search shape text, notes, bookmarks, and page names.'
		)
	})

	it('leaves the keyboard to the IME while it is composing', async () => {
		const { editor } = await setup()
		openFind(editor)
		type('auth')

		const input = getInput()
		const startingPage = editor.getCurrentPageId()
		fireEvent.compositionStart(input)

		// Enter commits the IME candidate; it must not jump.
		const enter = fireEvent.keyDown(input, { key: 'Enter' })
		expect(enter).toBe(true) // not default-prevented
		expect(editor.getCurrentPageId()).toBe(startingPage)
		expect(editor.getSelectedShapeIds()).toEqual([])
		expect(getCount()).toBe('1 of 4')

		// The arrows walk the candidate list, so they must not move the active result.
		fireEvent.keyDown(input, { key: 'ArrowDown' })
		fireEvent.keyDown(input, { key: 'ArrowUp' })
		expect(getCount()).toBe('1 of 4')

		// Escape cancels the candidate, so it must not close the palette.
		fireEvent.keyDown(input, { key: 'Escape' })
		expect(screen.queryByTestId('find-on-canvas.input')).toBeTruthy()

		// Once composition ends, everything works again.
		fireEvent.compositionEnd(input)
		fireEvent.keyDown(input, { key: 'ArrowDown' })
		expect(getCount()).toBe('2 of 4')
		fireEvent.keyDown(input, { key: 'Enter' })
		expect(editor.getSelectedShapeIds()).toEqual([noteId])
	})

	it('leaves the keyboard to the IME when only the event says it is composing', async () => {
		const { editor } = await setup()
		openFind(editor)
		type('auth')

		// jsdom's fireEvent does carry `isComposing` through to the native event; some browser and
		// IME combinations only report composition through the legacy keyCode, so both are covered.
		fireEvent.keyDown(getInput(), { key: 'ArrowDown', isComposing: true })
		expect(getCount()).toBe('1 of 4')

		fireEvent.keyDown(getInput(), { key: 'ArrowDown', keyCode: 229 })
		expect(getCount()).toBe('1 of 4')

		fireEvent.keyDown(getInput(), { key: 'ArrowDown' })
		expect(getCount()).toBe('2 of 4')
	})

	it('closes on escape after focus has moved to the canvas', async () => {
		const { editor } = await setup()
		openFind(editor)
		type('auth')

		// Model clicking the canvas: focus leaves the palette, so its own handler never sees the key.
		const container = editor.getContainer()
		container.focus()
		expect(document.activeElement).toBe(container)

		fireEvent.keyDown(container, { key: 'Escape' })

		expect(screen.queryByTestId('find-on-canvas.input')).toBeNull()
		expect(document.activeElement).toBe(container)
	})

	it('leaves canvas escape alone for editors, menus, and composition', async () => {
		const { editor } = await setup()
		const container = editor.getContainer()

		// A shape's text editor keeps escape for itself.
		openFind(editor)
		const editable = editor.getContainerDocument().createElement('div')
		editable.setAttribute('contenteditable', 'true')
		container.appendChild(editable)
		fireEvent.keyDown(editable, { key: 'Escape' })
		expect(screen.queryByTestId('find-on-canvas.input')).toBeTruthy()
		editable.remove()

		// So does an open menu.
		act(() => {
			editor.menus.addOpenMenu('some-other-menu')
		})
		fireEvent.keyDown(container, { key: 'Escape' })
		expect(screen.queryByTestId('find-on-canvas.input')).toBeTruthy()
		act(() => {
			editor.menus.deleteOpenMenu('some-other-menu')
		})

		// So does an IME candidate window.
		fireEvent.keyDown(container, { key: 'Escape', isComposing: true })
		expect(screen.queryByTestId('find-on-canvas.input')).toBeTruthy()

		// A plain canvas escape closes it, and the listener goes with it.
		fireEvent.keyDown(container, { key: 'Escape' })
		expect(screen.queryByTestId('find-on-canvas.input')).toBeNull()
		// A second escape has nothing left to close, and must not throw.
		fireEvent.keyDown(container, { key: 'Escape' })
		expect(screen.queryByTestId('find-on-canvas.input')).toBeNull()
	})

	it('keeps its ARIA ids to itself when two editors are on the page', async () => {
		const editors: Editor[] = []
		const rendered = await renderTldrawComponent(
			<>
				<Tldraw onMount={(editor) => void editors.push(editor)} />
				<Tldraw onMount={(editor) => void editors.push(editor)} />
			</>,
			{ waitForPatterns: false }
		)
		expect(editors).toHaveLength(2)

		for (const editor of editors) {
			act(() => {
				editor.user.updateUserPreferences({ areKeyboardShortcutsEnabled: true })
				editor.menus.clearOpenMenus()
				editor.updateInstanceState({ isFocused: true })
				editor.createShape({
					id: createShapeId(`text-${editors.indexOf(editor)}`),
					type: 'text',
					x: 0,
					y: 0,
					props: { richText: toRichText('Authentication service') },
				})
			})
			openFind(editor)
			const input = editor
				.getContainer()
				.querySelector('[data-testid="find-on-canvas.input"]') as HTMLInputElement
			fireEvent.change(input, { target: { value: 'auth' } })
		}

		const inputs = rendered.container.querySelectorAll('[data-testid="find-on-canvas.input"]')
		expect(inputs).toHaveLength(2)

		const listIds = [...rendered.container.querySelectorAll('[role="listbox"]')].map((el) => el.id)
		expect(listIds).toHaveLength(2)
		expect(new Set(listIds).size).toBe(2)

		const optionIds = [...rendered.container.querySelectorAll('[role="option"]')].map((el) => el.id)
		expect(optionIds.length).toBeGreaterThan(1)
		expect(new Set(optionIds).size).toBe(optionIds.length)

		// Each combobox points at the listbox and the option inside its own editor.
		for (const editor of editors) {
			const container = editor.getContainer()
			const input = container.querySelector(
				'[data-testid="find-on-canvas.input"]'
			) as HTMLInputElement
			const listbox = document.getElementById(input.getAttribute('aria-controls')!)
			const active = document.getElementById(input.getAttribute('aria-activedescendant')!)
			expect(listbox).toBeTruthy()
			expect(container.contains(listbox)).toBe(true)
			expect(active).toBeTruthy()
			expect(container.contains(active)).toBe(true)
		}

		// Moving the active result in one editor leaves the other alone.
		const [first, second] = editors
		const secondActiveBefore = (
			second
				.getContainer()
				.querySelector('[data-testid="find-on-canvas.input"]') as HTMLInputElement
		).getAttribute('aria-activedescendant')
		fireEvent.keyDown(first.getContainer().querySelector('[data-testid="find-on-canvas.input"]')!, {
			key: 'ArrowDown',
		})
		const secondActiveAfter = (
			second
				.getContainer()
				.querySelector('[data-testid="find-on-canvas.input"]') as HTMLInputElement
		).getAttribute('aria-activedescendant')
		expect(secondActiveAfter).toBe(secondActiveBefore)
	})

	it('closes on escape and returns focus to the editor', async () => {
		const { editor } = await setup()
		openFind(editor)

		fireEvent.keyDown(getInput(), { key: 'Escape' })

		expect(screen.queryByTestId('find-on-canvas.input')).toBeNull()
		expect(document.activeElement).toBe(editor.getContainer())
	})
})
