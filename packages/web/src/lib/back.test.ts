import {describe, expect, test} from 'bun:test';
import {backFrom, backOf} from './back';

describe('backOf', () => {
	test('reads the way back from a page’s state, as far as it goes', () => {
		expect(backOf(null)).toBeNull();
		expect(backOf({back: 3})).toBeNull();
		expect(backOf({back: '/w/activity?window=60'})).toEqual({
			back: '/w/activity?window=60',
			then: null,
		});
		expect(backOf({back: '/w/activity/tasks/t1', then: {back: '/w?end=5', then: null}})).toEqual({
			back: '/w/activity/tasks/t1',
			then: {back: '/w?end=5', then: null},
		});
	});
});

describe('backFrom', () => {
	test('is the page a link is followed from, with the page’s own way back', () => {
		expect(
			backFrom({pathname: '/w/activity/tasks/t1', search: '', state: {back: '/w?end=5'}}),
		).toEqual({
			back: '/w/activity/tasks/t1',
			then: {back: '/w?end=5', then: null},
		});
	});
});
