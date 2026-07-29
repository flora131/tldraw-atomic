import { Box, clamp, TLShapeId, useEditor, useValue, Vec } from '@tldraw/editor'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePrefersReducedMotion } from '../../../shapes/shared/usePrefersReducedMotion'
import { useA11y } from '../../context/a11y'
import { useFindOnCanvas } from '../../context/find-on-canvas'
import { useTranslation } from '../../hooks/useTranslation/useTranslation'
import { TldrawUiButton } from '../primitives/Button/TldrawUiButton'
import { TldrawUiButtonIcon } from '../primitives/Button/TldrawUiButtonIcon'
import { TldrawUiIcon } from '../primitives/TldrawUiIcon'
import { TldrawUiKbd } from '../primitives/TldrawUiKbd'
import {
	getFindOnCanvasResults,
	getFindOnCanvasSnippet,
	groupFindOnCanvasResults,
	TLUiFindOnCanvasResult,
} from './findOnCanvas'

/** How long the jump highlight stays on the canvas. */
const HIGHLIGHT_DURATION_MS = 1200
/** How much room to leave around a shape we have jumped to. */
const JUMP_INSET_PX = 220
/** How much room to leave under the palette before the framed area starts. */
const JUMP_PANEL_GAP_PX = 16

/**
 * The find on canvas palette. Opens with the `find-on-canvas` action (cmd/ctrl+F), searches page
 * names and shape text across every page, and jumps to a result's canvas location.
 *
 * @internal @react
 */
export const DefaultFindOnCanvas = memo(function DefaultFindOnCanvas() {
	const { isOpen } = useFindOnCanvas()
	if (!isOpen) return null
	return <FindOnCanvasPanel />
})

function FindOnCanvasPanel() {
	const editor = useEditor()
	const msg = useTranslation()
	const a11y = useA11y()
	const { openCount, close } = useFindOnCanvas()
	const prefersReducedMotion = usePrefersReducedMotion()

	const [query, setQuery] = useState('')
	const [activeResultId, setActiveResultId] = useState<string | null>(null)
	const [highlight, setHighlight] = useState<{ shapeId: TLShapeId; key: number } | null>(null)

	const rPanel = useRef<HTMLDivElement>(null)
	const rInput = useRef<HTMLInputElement>(null)
	const rList = useRef<HTMLDivElement>(null)
	// The slot the active result sat in, so that deleting it selects its successor.
	const rActiveIndex = useRef(-1)

	const results = useValue('find on canvas results', () => getFindOnCanvasResults(editor, query), [
		editor,
		query,
	])
	const groups = useMemo(() => groupFindOnCanvasResults(results), [results])

	const activeIndex = results.findIndex((result) => result.id === activeResultId)
	const activeResult = activeIndex === -1 ? null : results[activeIndex]

	// Focus and select the query whenever the palette is opened, including while already open.
	useEffect(() => {
		const input = rInput.current
		if (!input) return
		input.focus()
		input.select()
	}, [openCount])

	// Announce the palette when it opens.
	useEffect(() => {
		a11y.announce({ msg: msg('find-on-canvas.opened'), priority: 'polite' })
	}, [a11y, msg, openCount])

	// Keep an active result while there is one to have. If the active result disappears (it was
	// deleted, or the query changed) we keep its slot, which selects the next result along.
	useEffect(() => {
		const index = results.findIndex((result) => result.id === activeResultId)
		if (index !== -1) {
			rActiveIndex.current = index
			return
		}
		if (results.length === 0) {
			rActiveIndex.current = -1
			if (activeResultId !== null) setActiveResultId(null)
			return
		}
		const next = clamp(rActiveIndex.current, 0, results.length - 1)
		rActiveIndex.current = next
		setActiveResultId(results[next].id)
	}, [results, activeResultId])

	// Keep the active row in view without moving DOM focus out of the query input.
	useEffect(() => {
		if (!activeResultId) return
		const row = rList.current?.querySelector('[data-isactive="true"]')
		// jsdom and older browsers don't implement scrollIntoView
		if (typeof row?.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' })
	}, [activeResultId])

	// Take the highlight off the canvas after a moment.
	useEffect(() => {
		if (!highlight) return
		const timeout = editor.timers.setTimeout(() => setHighlight(null), HIGHLIGHT_DURATION_MS)
		return () => clearTimeout(timeout)
	}, [editor, highlight])

	const describeResult = useCallback(
		(result: TLUiFindOnCanvasResult) => {
			if (result.kind === 'page') {
				return msg('find-on-canvas.page-result').replace('{page}', result.pageName)
			}
			return msg('find-on-canvas.result')
				.replace('{text}', result.text)
				.replace('{kind}', msg(result.kindKey).toLowerCase())
				.replace('{page}', result.pageName)
		},
		[msg]
	)

	const getPositionMessage = useCallback(
		(index: number) =>
			msg('find-on-canvas.position')
				.replace('{index}', String(index + 1))
				.replace('{total}', String(results.length)),
		[msg, results.length]
	)

	const announceResult = useCallback(
		(result: TLUiFindOnCanvasResult, index: number, prefix?: string) => {
			const description = prefix ?? describeResult(result)
			a11y.announce({ msg: `${description} ${getPositionMessage(index)}`, priority: 'polite' })
		},
		[a11y, describeResult, getPositionMessage]
	)

	/** The one place active state changes, so navigation and jumping can never disagree. */
	const setActiveResult = useCallback(
		(result: TLUiFindOnCanvasResult, index: number, announce = true) => {
			rActiveIndex.current = index
			setActiveResultId(result.id)
			if (announce) announceResult(result, index)
		},
		[announceResult]
	)

	const handleClose = useCallback(() => {
		close()
		editor.getContainer().focus()
	}, [close, editor])

	/** Arrow keys move the active result without committing to it. */
	const moveActive = useCallback(
		(delta: number) => {
			if (results.length === 0) return
			const from = activeIndex === -1 ? -1 : activeIndex
			const next = (from + delta + results.length) % results.length
			setActiveResult(results[next], next)
		},
		[activeIndex, results, setActiveResult]
	)

	/**
	 * Frame `bounds` in the part of the canvas the palette does not cover: the point of a jump is
	 * seeing what you landed on.
	 */
	const frameBounds = useCallback(
		(bounds: Box) => {
			const container = editor.getContainer().getBoundingClientRect()
			const panel = rPanel.current?.getBoundingClientRect()
			const viewport = editor.getViewportScreenBounds()
			const occludedTop = panel ? Math.max(0, panel.bottom - container.top + JUMP_PANEL_GAP_PX) : 0
			const freeHeight = Math.max(viewport.height - occludedTop, 1)

			const { zoomSteps } = editor.getCameraOptions()
			const baseZoom = editor.getBaseZoom()
			const zoom = clamp(
				Math.min(
					(viewport.width - JUMP_INSET_PX) / Math.max(bounds.width, 1),
					(freeHeight - JUMP_INSET_PX / 2) / Math.max(bounds.height, 1)
				),
				zoomSteps[0] * baseZoom,
				Math.min(1, zoomSteps[zoomSteps.length - 1] * baseZoom)
			)

			const focusY = occludedTop + freeHeight / 2
			editor.setCamera(
				new Vec(viewport.width / 2 / zoom - bounds.center.x, focusY / zoom - bounds.center.y, zoom),
				{
					animation: prefersReducedMotion
						? undefined
						: { duration: editor.options.animationMediumMs },
				}
			)
		},
		[editor, prefersReducedMotion]
	)

	const jumpTo = useCallback(
		(result: TLUiFindOnCanvasResult, index: number) => {
			// Take the active slot first: a jump is also a commit, so the count, the active row and
			// the next arrow press all have to follow the result we landed on.
			setActiveResult(result, index, false)

			editor.setCurrentPage(result.pageId)

			if (result.kind === 'page') {
				// A page result switches page without selecting anything on it.
				editor.setSelectedShapes([])
				setHighlight(null)
				const pageBounds = editor.getCurrentPageBounds()
				if (pageBounds) frameBounds(pageBounds)
				announceResult(
					result,
					index,
					msg('find-on-canvas.switched-page').replace('{page}', result.pageName)
				)
				return
			}

			editor.select(result.shapeId)
			const bounds = editor.getShapePageBounds(result.shapeId)
			if (bounds) frameBounds(bounds)
			setHighlight({ shapeId: result.shapeId, key: Date.now() })

			// Selecting a shape queues its own announcement, so let that land first.
			editor.timers.setTimeout(() => announceResult(result, index), 0)
		},
		[announceResult, editor, frameBounds, msg, setActiveResult]
	)

	/**
	 * The previous and next controls move and jump in one go: a pointer user has no Enter step.
	 * Focus goes back to the query, which owns `aria-activedescendant`.
	 */
	const jumpBy = useCallback(
		(delta: number) => {
			if (results.length === 0) return
			const from = activeIndex === -1 ? 0 : activeIndex
			const next = (from + delta + results.length) % results.length
			jumpTo(results[next], next)
			rInput.current?.focus()
		},
		[activeIndex, jumpTo, results]
	)

	const handleInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
		// A new query always starts from the first result.
		rActiveIndex.current = -1
		setActiveResultId(null)
		setQuery(event.target.value)
	}, [])

	// What the user can actually see about the results. Announcing on this rather than on the array
	// identity means a store tick or a camera move stays quiet, while a shape created, edited,
	// deleted or renamed elsewhere still reaches the live region.
	const resultsSignature = useMemo(
		() =>
			JSON.stringify(
				results.map((result) => [
					result.id,
					result.kind,
					result.pageName,
					result.text,
					result.matchStart,
					result.matchEnd,
				])
			),
		[results]
	)

	const rAnnouncedSignature = useRef<string | null>(null)
	useEffect(() => {
		const signature = `${query}\u0000${resultsSignature}`
		if (rAnnouncedSignature.current === signature) return
		const isFirstRun = rAnnouncedSignature.current === null
		rAnnouncedSignature.current = signature
		// Opening with an empty query is announced by the open message instead.
		if (isFirstRun && !query) return

		if (!query) {
			a11y.announce({ msg: msg('find-on-canvas.idle'), priority: 'polite' })
			return
		}
		if (results.length === 0) {
			a11y.announce({
				msg: msg('find-on-canvas.no-results').replace('{query}', query),
				priority: 'polite',
			})
			return
		}
		// The active result may have just disappeared; announce the slot that replaces it, using the
		// same clamp the reconciliation effect applies.
		const current = results.findIndex((result) => result.id === activeResultId)
		const index = current === -1 ? clamp(rActiveIndex.current, 0, results.length - 1) : current
		a11y.announce({
			msg: `${describeResult(results[index])} ${msg('find-on-canvas.position')
				.replace('{index}', String(index + 1))
				.replace('{total}', String(results.length))}`,
			priority: 'polite',
		})
		// `activeResultId` is deliberately not a dependency: arrow and pointer navigation announce
		// themselves, and re-running here would say everything twice.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [a11y, describeResult, msg, query, resultsSignature])

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent) => {
			const isQuery = event.target === rInput.current

			// Escape closes from anywhere in the palette.
			if (event.key === 'Escape') {
				event.preventDefault()
				event.stopPropagation()
				handleClose()
				return
			}

			// Tab and the arrows have to reach the body so FocusManager can bring the focus ring
			// back, and nothing on the canvas binds them while a palette control owns focus.
			const isFocusManagerKey =
				event.key === 'Tab' || event.key === 'ArrowUp' || event.key === 'ArrowDown'

			// While a palette button owns focus the generic shortcut handler would still see plain
			// keys, so keep those inside the palette. The query input is already filtered out by
			// `shouldSkipEvent`, and stopping there would cost us the focus ring.
			if (!isQuery && !isFocusManagerKey) event.stopPropagation()

			// Enter belongs to the focused button when a button owns focus.
			if (!isQuery) return

			switch (event.key) {
				case 'ArrowDown':
					event.preventDefault()
					moveActive(1)
					break
				case 'ArrowUp':
					event.preventDefault()
					moveActive(-1)
					break
				case 'Enter':
					event.preventDefault()
					if (activeResult) jumpTo(activeResult, activeIndex)
					break
			}
		},
		[activeIndex, activeResult, handleClose, jumpTo, moveActive]
	)

	const hasResults = results.length > 0

	return (
		<>
			{highlight && <FindOnCanvasHighlight key={highlight.key} shapeId={highlight.shapeId} />}
			<div
				ref={rPanel}
				className="tlui-find-on-canvas"
				role="search"
				aria-label={msg('find-on-canvas.title')}
				onKeyDown={handleKeyDown}
			>
				<div className="tlui-find-on-canvas__header">
					<svg
						className="tlui-find-on-canvas__header__icon"
						viewBox="0 0 18 18"
						fill="none"
						aria-hidden="true"
					>
						<circle cx="8" cy="8" r="4.75" stroke="currentColor" strokeWidth="1.5" />
						<path
							d="m11.5 11.5 3 3"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
						/>
					</svg>
					<input
						ref={rInput}
						className="tlui-input tlui-find-on-canvas__input"
						type="text"
						role="combobox"
						value={query}
						onChange={handleInputChange}
						placeholder={msg('find-on-canvas.placeholder')}
						aria-label={msg('find-on-canvas.title')}
						aria-expanded={hasResults}
						aria-controls="tlui-find-on-canvas__list"
						aria-autocomplete="list"
						aria-activedescendant={
							activeResult ? `tlui-find-on-canvas__result-${activeIndex}` : undefined
						}
						autoComplete="off"
						spellCheck={false}
						data-testid="find-on-canvas.input"
					/>
					{hasResults && (
						<span className="tlui-find-on-canvas__count" data-testid="find-on-canvas.count">
							{getPositionMessage(activeIndex === -1 ? 0 : activeIndex)}
						</span>
					)}
					<div className="tlui-find-on-canvas__nav">
						<TldrawUiButton
							type="icon"
							title={msg('find-on-canvas.previous')}
							disabled={!hasResults}
							onClick={() => jumpBy(-1)}
							data-testid="find-on-canvas.previous"
						>
							<TldrawUiButtonIcon icon="chevron-up" small />
						</TldrawUiButton>
						<TldrawUiButton
							type="icon"
							title={msg('find-on-canvas.next')}
							disabled={!hasResults}
							onClick={() => jumpBy(1)}
							data-testid="find-on-canvas.next"
						>
							<TldrawUiButtonIcon icon="chevron-down" small />
						</TldrawUiButton>
						<TldrawUiButton
							type="icon"
							title={msg('find-on-canvas.close')}
							onClick={handleClose}
							data-testid="find-on-canvas.close"
						>
							<TldrawUiButtonIcon icon="cross-2" small />
						</TldrawUiButton>
					</div>
				</div>

				<div className="tlui-find-on-canvas__divider" />

				{hasResults ? (
					<div
						ref={rList}
						id="tlui-find-on-canvas__list"
						className="tlui-find-on-canvas__list"
						role="listbox"
						aria-label={msg('find-on-canvas.matches')}
					>
						{groups.map((group) => (
							<div
								key={group.pageId}
								className="tlui-find-on-canvas__group"
								role="group"
								aria-label={group.pageName}
							>
								<div className="tlui-find-on-canvas__group-label">
									<span className="tlui-find-on-canvas__group-label__name">{group.pageName}</span>
									<span className="tlui-find-on-canvas__group-label__count">
										{group.results.length}
									</span>
								</div>
								{group.results.map((result) => {
									const index = results.indexOf(result)
									const isActive = index === activeIndex
									return (
										<button
											key={result.id}
											type="button"
											id={`tlui-find-on-canvas__result-${index}`}
											className="tlui-find-on-canvas__row"
											role="option"
											// The query owns focus and points at the active row through
											// `aria-activedescendant`, so rows stay out of the tab order.
											tabIndex={-1}
											data-resultid={result.id}
											data-isactive={isActive}
											aria-selected={isActive}
											aria-label={describeResult(result)}
											onClick={() => {
												jumpTo(result, index)
												rInput.current?.focus()
											}}
										>
											<TldrawUiIcon
												icon={result.kind === 'page' ? 'list' : result.icon}
												label=""
												small
												aria-hidden="true"
											/>
											<span className="tlui-find-on-canvas__row__text">
												{getFindOnCanvasSnippet(result.text, query).map((segment, i) =>
													segment.isMatch ? (
														<mark key={i}>{segment.text}</mark>
													) : (
														<span key={i}>{segment.text}</span>
													)
												)}
											</span>
											<span className="tlui-find-on-canvas__row__kind">
												{result.kind === 'page'
													? msg('find-on-canvas.kind.page')
													: msg(result.kindKey)}
											</span>
										</button>
									)
								})}
							</div>
						))}
					</div>
				) : (
					<div
						className="tlui-find-on-canvas__message"
						data-tone={query ? undefined : 'muted'}
						data-testid="find-on-canvas.message"
					>
						{query
							? msg('find-on-canvas.no-results').replace('{query}', query)
							: msg('find-on-canvas.idle')}
					</div>
				)}

				<div className="tlui-find-on-canvas__divider" />

				<div className="tlui-find-on-canvas__footer">
					<span className="tlui-find-on-canvas__hint">
						<TldrawUiKbd visibleOnMobileLayout>[[↑↓]]</TldrawUiKbd>
						{msg('find-on-canvas.hint.move')}
					</span>
					<span className="tlui-find-on-canvas__hint">
						<TldrawUiKbd visibleOnMobileLayout>[[↵]]</TldrawUiKbd>
						{msg('find-on-canvas.hint.jump')}
					</span>
					<span className="tlui-find-on-canvas__hint">
						<TldrawUiKbd visibleOnMobileLayout>[[Esc]]</TldrawUiKbd>
						{msg('find-on-canvas.hint.close')}
					</span>
				</div>
			</div>
		</>
	)
}

/**
 * A brief ring around the shape a jump landed on. It follows the camera, and only animates when
 * the user has not asked for reduced motion.
 */
function FindOnCanvasHighlight({ shapeId }: { shapeId: TLShapeId }) {
	const editor = useEditor()
	const prefersReducedMotion = usePrefersReducedMotion()

	const rect = useValue(
		'find on canvas highlight',
		() => {
			if (!editor.getCurrentPageShapeIds().has(shapeId)) return null
			const bounds = editor.getShapePageBounds(shapeId)
			if (!bounds) return null
			const zoom = editor.getZoomLevel()
			const topLeft = editor.pageToViewport({ x: bounds.minX, y: bounds.minY })
			return { x: topLeft.x, y: topLeft.y, w: bounds.width * zoom, h: bounds.height * zoom }
		},
		[editor, shapeId]
	)

	if (!rect) return null

	return (
		<div
			className="tlui-find-on-canvas__highlight"
			data-animate={!prefersReducedMotion}
			style={{
				transform: `translate(${rect.x - 6}px, ${rect.y - 6}px)`,
				width: rect.w + 12,
				height: rect.h + 12,
			}}
		/>
	)
}
