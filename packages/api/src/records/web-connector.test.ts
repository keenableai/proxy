import {beforeEach, describe, expect, mock, test} from 'bun:test';
import {Ok} from 'ts-results-es';

import {findCollection, findIntegration, type Collection} from '@proxy/integrations';

// The servers' tools by name, answering as Exa's, Parallel's and Keenable's do.
type Call = {server: string; name: string; args: Record<string, unknown>};
const tools = {calls: [] as Call[], answer: (_call: Call): string => ''};

mock.module('../connections/mcp/mcp-session', () => ({
	callMcpToolFor: async (server: {name: string}, _connection: unknown, name: string, args: Record<string, unknown>) => {
		tools.calls.push({server: server.name, name, args});
		return Ok(tools.answer({server: server.name, name, args}));
	},
}));

const {exaConnector, keenableConnector, parallelConnector} = await import('./web-connector');

const CONNECTORS = {exa: exaConnector, parallel: parallelConnector, keenable: keenableConnector};

function collection(integrationId: string, id: string): Collection {
	const integration = findIntegration(integrationId);
	const found = integration && findCollection(integration, id);
	if (!found) {
		throw new Error(`No ${id} collection`);
	}
	return found;
}

function run(integrationId: keyof typeof CONNECTORS, command: 'run' | 'read', values: Record<string, string>) {
	const target = {
		connection: {
			id: `${integrationId}-1`,
			integrationId,
			orgId: 'org-1',
			ownerUserId: 'user-1',
			connectedById: 'user-1',
			account: 'alex@example.com',
			createdAt: new Date(),
			tools: null,
			name: null,
			defaults: [],
			credential: 'v1.encrypted',
		},
		collection: collection(integrationId, command === 'run' ? 'searches' : 'pages'),
	};
	const runner = CONNECTORS[integrationId].newCommands?.[command];
	if (!runner) {
		throw new Error(`No ${command} for ${integrationId}`);
	}
	return runner(target, values);
}

const EXA_RESULTS = 'Title: Mocks | Bun Docs\nURL: https://bun.sh/docs/test/mocks\nPublished: N/A\nHighlights:\nMocking replaces a dependency.';

beforeEach(() => {
	tools.calls = [];
	tools.answer = ({name}) => {
		if (name === 'web_search_exa') {
			return EXA_RESULTS;
		}
		if (name === 'web_fetch_exa') {
			return '# Mocks | Bun Docs\nURL: https://bun.sh/docs/test/mocks\n\nMocking replaces a dependency.';
		}
		if (name === 'web_search') {
			return JSON.stringify({results: [{url: 'https://bun.sh/docs/test/mocks', title: 'Mocks | Bun Docs', publish_date: null, excerpts: ['Mocking replaces a dependency.']}]});
		}
		if (name === 'search_web_pages') {
			return JSON.stringify({
				query: 'bun module mocks',
				results: [{url: 'https://bun.sh/docs/test/mocks', title: 'Mocks | Bun Docs', description: '', snippet: 'Mocking replaces a dependency.\n', acquired_at: '2026-10-13T09:00:00Z'}],
			});
		}
		if (name === 'fetch_page_content') {
			return JSON.stringify({url: 'https://bun.sh/docs/test/mocks', title: 'Mocks | Bun Docs', content: 'Mocking replaces a dependency.', description: ''});
		}
		return JSON.stringify({results: [{url: 'https://bun.sh/docs/test/mocks', title: 'Mocks | Bun Docs', excerpts: [], full_content: 'x'.repeat(150_000)}], errors: []});
	};
});

describe('webConnector', () => {
	test('searches Exa with the query as what to find and why, its results as Exa writes them', async () => {
		const record = (await run('exa', 'run', {query: ' bun module mocks '})).unwrap();

		expect(tools.calls).toEqual([{server: 'Exa', name: 'web_search_exa', args: {query: 'bun module mocks', objective: 'bun module mocks'}}]);
		expect(record?.values).toEqual({query: 'bun module mocks', results: EXA_RESULTS});
	});

	test('searches Parallel with the query as its objective and its one search, the results written as Exa writes them', async () => {
		const record = (await run('parallel', 'run', {query: 'bun module mocks'})).unwrap();

		expect(tools.calls).toEqual([{server: 'Parallel', name: 'web_search', args: {objective: 'bun module mocks', search_queries: ['bun module mocks']}}]);
		expect(record?.values.results).toBe(EXA_RESULTS);
	});

	test('searches Keenable with the query, asking for JSON, its results written as Exa writes them', async () => {
		const record = (await run('keenable', 'run', {query: 'bun module mocks'})).unwrap();

		expect(tools.calls).toEqual([{server: 'Keenable', name: 'search_web_pages', args: {query: 'bun module mocks', output_format: 'json'}}]);
		expect(record?.values.results).toBe(EXA_RESULTS);
	});

	test('reads a page with Keenable, as much of it as is kept', async () => {
		const record = (await run('keenable', 'read', {url: 'https://bun.sh/docs/test/mocks'})).unwrap();

		expect(tools.calls).toEqual([{server: 'Keenable', name: 'fetch_page_content', args: {url: 'https://bun.sh/docs/test/mocks', max_chars: 100_000, output_format: 'json'}}]);
		expect(record?.values).toEqual({url: 'https://bun.sh/docs/test/mocks', title: 'Mocks | Bun Docs', content: 'Mocking replaces a dependency.'});
	});

	test('reads a page with Exa, as much of it as is kept', async () => {
		const record = (await run('exa', 'read', {url: 'https://bun.sh/docs/test/mocks'})).unwrap();

		expect(tools.calls).toEqual([{server: 'Exa', name: 'web_fetch_exa', args: {urls: ['https://bun.sh/docs/test/mocks'], maxCharacters: 100_000}}]);
		expect(record?.values).toEqual({url: 'https://bun.sh/docs/test/mocks', title: 'Mocks | Bun Docs', content: 'Mocking replaces a dependency.'});
	});

	test('reads a page with Parallel in full, keeping the first 100,000 characters', async () => {
		const record = (await run('parallel', 'read', {url: 'https://bun.sh/docs/test/mocks'})).unwrap();

		expect(tools.calls).toEqual([{server: 'Parallel', name: 'web_fetch', args: {urls: ['https://bun.sh/docs/test/mocks'], full_content: true}}]);
		expect(record?.values.title).toBe('Mocks | Bun Docs');
		expect(record?.values.content).toHaveLength(100_000);
	});

	test('refuses an empty query and an address that is no web page, before asking the provider', async () => {
		expect((await run('exa', 'run', {query: '  '})).unwrapErr()).toMatchObject({kind: 'validation_error'});
		expect((await run('parallel', 'read', {url: 'file:///etc/passwd'})).unwrapErr()).toMatchObject({kind: 'validation_error'});
		expect((await run('parallel', 'read', {url: 'not a url'})).unwrapErr()).toMatchObject({kind: 'validation_error'});
		expect(tools.calls).toEqual([]);
	});
});
