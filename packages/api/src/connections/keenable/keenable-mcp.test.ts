import {describe, expect, test} from 'bun:test';

import {formatKeenableResults, parseKeenablePage} from './keenable-mcp';

describe('formatKeenableResults', () => {
	test('writes the results out as Exa writes its own, a block a page, its snippet as the highlights', () => {
		const text = JSON.stringify({
			query: 'bun module mocks',
			results: [
				{
					url: 'https://bun.sh/docs/test/mocks',
					title: 'Mocks | Bun Docs',
					description: '',
					snippet: 'Mocking replaces a dependency.\nUse mock.module.\n',
					published_at: '2026-10-12T08:00:00Z',
					acquired_at: '2026-10-13T09:00:00Z',
				},
				{url: 'https://example.com', title: '', description: '', snippet: 'Example Domain', acquired_at: '2026-10-13T09:00:00Z'},
			],
		});
		expect(formatKeenableResults(text).unwrap()).toBe(
			[
				'Title: Mocks | Bun Docs\nURL: https://bun.sh/docs/test/mocks\nPublished: 2026-10-12\nHighlights:\nMocking replaces a dependency.\nUse mock.module.',
				'Title: https://example.com\nURL: https://example.com\nPublished: N/A\nHighlights:\nExample Domain',
			].join('\n\n---\n\n'),
		);
	});

	test('is Keenable out of reach when it answers with something else', () => {
		expect(formatKeenableResults('Rate limit exceeded').unwrapErr().kind).toBe('provider_unreachable');
	});
});

describe('parseKeenablePage', () => {
	test('reads the title and the text', () => {
		const text = JSON.stringify({url: 'https://example.com/', title: 'Example Domain', content: '# Example Domain\n\nThis domain is for examples.\n', description: ''});
		expect(parseKeenablePage(text).unwrap()).toEqual({title: 'Example Domain', content: '# Example Domain\n\nThis domain is for examples.'});
	});

	test('a page without a title keeps all of it as the text', () => {
		expect(parseKeenablePage(JSON.stringify({url: 'https://example.com/', content: 'Just text\n'})).unwrap()).toEqual({title: '', content: 'Just text'});
	});
});
