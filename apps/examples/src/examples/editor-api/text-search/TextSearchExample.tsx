import { TLComponents, TLUiOverrides, Tldraw, atom, track } from 'tldraw'
import 'tldraw/tldraw.css'
import { TextSearchPanel } from './TextSearchPanel'
import './text-search.css'

export const showSearch = atom('showSearch', false)

const components: TLComponents = {
	HelperButtons: TextSearchPanel,
}

const overrides: TLUiOverrides = {
	actions(_editor, actions) {
		return {
			...actions,
			// Replace the built-in find on canvas action rather than adding a second cmd+f action,
			// so this example's panel is the only thing the shortcut opens.
			'find-on-canvas': {
				...actions['find-on-canvas'],
				label: 'Search',
				onSelect() {
					if (!showSearch.get()) {
						showSearch.set(true)
					}
				},
			},
		}
	},
}

const TextSearchExample = track(() => {
	return (
		<div className="tldraw__editor">
			<Tldraw persistenceKey="text-search-example" overrides={overrides} components={components} />
		</div>
	)
})

export default TextSearchExample
