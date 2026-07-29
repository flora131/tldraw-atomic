import { createContext, ReactNode, useContext, useMemo, useState } from 'react'

/** @internal */
export interface TLUiFindOnCanvasContextType {
	/** Whether the find on canvas palette is open. */
	isOpen: boolean
	/**
	 * Increments every time the palette is asked to open, including while it is already open, so
	 * that the palette can re-focus and select its query.
	 */
	openCount: number
	open(): void
	close(): void
}

/** @internal */
export const FindOnCanvasContext = createContext<TLUiFindOnCanvasContextType | null>(null)

/** @internal */
export interface TLUiFindOnCanvasProviderProps {
	children: ReactNode
}

/**
 * Holds the open state of the find on canvas palette. It sits above the actions provider so that
 * both the `find-on-canvas` action and the palette itself share one piece of state.
 *
 * @internal @react
 */
export function TldrawUiFindOnCanvasProvider({ children }: TLUiFindOnCanvasProviderProps) {
	const [state, setState] = useState({ isOpen: false, openCount: 0 })

	const context = useMemo(
		(): TLUiFindOnCanvasContextType => ({
			isOpen: state.isOpen,
			openCount: state.openCount,
			open() {
				setState((prev) => ({ isOpen: true, openCount: prev.openCount + 1 }))
			},
			close() {
				setState((prev) => ({ ...prev, isOpen: false }))
			},
		}),
		[state]
	)

	return <FindOnCanvasContext.Provider value={context}>{children}</FindOnCanvasContext.Provider>
}

/** @internal */
export function useFindOnCanvas() {
	const context = useContext(FindOnCanvasContext)
	if (!context) {
		throw new Error('useFindOnCanvas must be used within a TldrawUiFindOnCanvasProvider')
	}
	return context
}
