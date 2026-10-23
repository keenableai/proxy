// Where a page was come to from, kept in the router's location state as a link is followed, so
// the page's back arrow returns there rather than to a list it may not have come from: the address
// of the page before, with its own back in turn, so going back twice retraces the way, as from a
// sub-task's page to its task's and from there to the home page as it was.
export type Back = {back: string; then: Back | null};

/** The way back a page's location state says, where it says one. */
export function backOf(state: unknown): Back | null {
	if (typeof state !== 'object' || state === null || !('back' in state)) {
		return null;
	}
	if (typeof state.back !== 'string') {
		return null;
	}
	return {back: state.back, then: 'then' in state ? backOf(state.then) : null};
}

/** The way back for a link followed from the page at `location`: that page, and its own way back. */
export function backFrom(location: {pathname: string; search: string; state: unknown}): Back {
	return {back: `${location.pathname}${location.search}`, then: backOf(location.state)};
}
