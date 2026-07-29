import { Editor, useEditor, useValue } from '@tldraw/editor'
import { useEffect } from 'react'
import { useActions } from '../context/actions'
import { matchesKeyboardShortcutKey } from './useKeyboardShortcuts'

/**
 * The generic shortcut registry also refuses to run while a shape's text is being edited. Find has
 * to work there — that is where the browser's own find bar would otherwise win — so this listener
 * keeps every other guard and drops only that one.
 */
function isFindOnCanvasShortcutDisabled(editor: Editor) {
	return (
		editor.menus.hasAnyOpenMenus() ||
		!!editor.getCrashingError() ||
		!editor.user.getAreKeyboardShortcutsEnabled()
	)
}

/**
 * Cmd/Ctrl+F cannot go through the generic shortcut registry: that handler bails out for
 * content-editable targets and while a shape's text is being edited, which is exactly where the
 * browser's own find bar would otherwise open. So the shortcut lives here, on a capture listener
 * that runs before ProseMirror, and calls whichever action is registered under `find-on-canvas` —
 * so an override still wins.
 *
 * @internal
 */
export function useFindOnCanvasKeyboardShortcut() {
	const editor = useEditor()
	const actions = useActions()
	const isFocused = useValue('is focused', () => editor.getInstanceState().isFocused, [editor])

	useEffect(() => {
		if (!isFocused) return

		const action = actions['find-on-canvas']
		if (!action) return

		const container = editor.getContainer()
		const doc = editor.getContainerDocument()

		const handleKeyDown = (event: KeyboardEvent) => {
			// An IME candidate window owns the keyboard while it is composing. Some browser and IME
			// combinations only report that through the legacy keyCode.
			// eslint-disable-next-line @typescript-eslint/no-deprecated
			if (event.isComposing || event.keyCode === 229) return
			// `event.key` on a Cyrillic or Greek layout is not `f`, so fall back to the physical key
			// the same way the generic shortcut registry does.
			if (!matchesKeyboardShortcutKey(event, 'f')) return
			if (event.shiftKey || event.altKey) return
			// The action's kbd is `cmd+f,ctrl+f`: exactly one accelerator, never both.
			if (event.metaKey === event.ctrlKey) return

			// The user can turn keyboard shortcuts off, and then the browser's find bar is theirs
			// again. A host override may still opt into required behaviour.
			if (isFindOnCanvasShortcutDisabled(editor) && !action.isRequiredA11yAction) return

			// Only when the keystroke belongs to this editor. Nothing focused counts too: the editor
			// can hold logical focus while the document body is still the active element.
			const target = event.target as Node | null
			const isInsideEditor = !!target && container.contains(target)
			const isUnfocusedDocument =
				!target || target === doc || target === doc.body || target === doc.documentElement
			if (!isInsideEditor && !isUnfocusedDocument) return

			event.preventDefault()
			event.stopPropagation()
			action.onSelect('kbd')
		}

		doc.addEventListener('keydown', handleKeyDown, { capture: true })
		return () => doc.removeEventListener('keydown', handleKeyDown, { capture: true })
	}, [actions, editor, isFocused])
}
