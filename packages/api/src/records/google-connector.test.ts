import {beforeEach, describe, expect, mock, spyOn, test} from 'bun:test';
import {Ok, type Result} from 'ts-results-es';

import type {ApiError} from '@proxy/utils';
import {findCollection, findIntegration, type Collection} from '@proxy/integrations';

mock.module('@proxy/db/connection', () => ({updateConnectionCredential: mock()}));

mock.module('../observability/log', () => ({
	log: {debug: mock(), info: mock(), warn: mock(), error: mock()},
	serializeError: mock(() => ({})),
}));

mock.module('../utils/env', () => ({env: {NODE_ENV: 'production', APP_URL: 'https://app.example.com', GOOGLE_CLIENT_ID: 'client-1', GOOGLE_CLIENT_SECRET: 'secret-1'}}));

mock.module('../utils/secret-crypto', () => ({
	encryptSecret: (plaintext: string): Result<string, ApiError> => Ok(`enc:${plaintext}`),
	decryptSecret: (stored: string): Result<string, ApiError> => Ok(stored.replace(/^enc:/, '')),
}));

function files(): Collection {
	const integration = findIntegration('google');
	const found = integration && findCollection(integration, 'files');
	if (!found) {
		throw new Error('No files collection');
	}
	return found;
}

const CREDENTIAL = {accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: new Date(Date.now() + 3_600_000).toISOString(), scopes: [], email: 'alex@example.com'};

const target = {
	connection: {id: 'google-1', integrationId: 'google', account: 'alex@example.com', createdAt: new Date(), tools: null, name: null, defaults: [], credential: `enc:${JSON.stringify(CREDENTIAL)}`},
	collection: files(),
};

const query = (changes: object = {}) => ({search: null, page: null, filter: null, parent: null, ...changes});

// A Drive as Google answers it: My Drive holding Projects, which holds a plan, a budget and a deck.
const MY_DRIVE_ID = '0AFmyDriveRootUk9PVA';
const OWNER = [{displayName: 'Alex Kim', emailAddress: 'alex@example.com'}];

const DRIVE_FILES: Record<string, object> = {
	'1Projects': {
		id: '1Projects',
		name: 'Projects',
		mimeType: 'application/vnd.google-apps.folder',
		modifiedTime: '2026-10-01T09:00:00.000Z',
		owners: OWNER,
		webViewLink: 'https://drive.google.com/drive/folders/1Projects',
		parents: [MY_DRIVE_ID],
	},
	'1Plan': {
		id: '1Plan',
		name: 'Launch plan',
		mimeType: 'application/vnd.google-apps.document',
		modifiedTime: '2026-10-08T08:16:23.137Z',
		owners: OWNER,
		webViewLink: 'https://docs.google.com/document/d/1Plan/edit?usp=drivesdk',
		parents: ['1Projects'],
	},
	'1Budget': {
		id: '1Budget',
		name: 'Budget 2026',
		mimeType: 'application/vnd.google-apps.spreadsheet',
		modifiedTime: '2026-10-07T12:00:00.000Z',
		owners: OWNER,
		webViewLink: 'https://docs.google.com/spreadsheets/d/1Budget/edit?usp=drivesdk',
		parents: ['1Projects'],
	},
	'1Huge': {
		id: '1Huge',
		name: 'Everything ever written',
		mimeType: 'application/vnd.google-apps.document',
		modifiedTime: '2026-09-01T12:00:00.000Z',
		owners: OWNER,
		webViewLink: 'https://docs.google.com/document/d/1Huge/edit?usp=drivesdk',
		parents: [MY_DRIVE_ID],
	},
};

const SHEETS = {
	sheets: [
		{properties: {sheetId: 0, title: 'Q1', gridProperties: {rowCount: 120, columnCount: 8}}},
		{properties: {sheetId: 1834, title: "Alex's notes", gridProperties: {rowCount: 1000, columnCount: 26}}},
	],
};

function rows(from: number, count: number): string[][] {
	return Array.from({length: count}, (_, index) => [`Item ${from + index}`, String((from + index) * 10), index === 0 ? 'Paid' : '']);
}

function googleError(status: number, message: string, reason: string): Response {
	return Response.json({error: {code: status, message, errors: [{message, domain: 'global', reason}]}}, {status});
}

const drive = {requests: [] as URL[], answer: (_url: URL): Response | null => null};

function answer(url: URL): Response {
	const custom = drive.answer(url);
	if (custom) {
		return custom;
	}
	const path = url.pathname;
	if (path === '/drive/v3/files/root') {
		return Response.json({id: MY_DRIVE_ID});
	}
	if (path === '/drive/v3/files') {
		return Response.json({nextPageToken: 'page-2', files: [DRIVE_FILES['1Projects'], DRIVE_FILES['1Plan']]});
	}
	if (path === '/drive/v3/files/1Plan/export') {
		return new Response('# Launch plan\n\n- Ship it', {headers: {'content-type': 'text/markdown'}});
	}
	if (path === '/drive/v3/files/1Huge/export') {
		return googleError(403, 'This file is too large to be exported.', 'exportSizeLimitExceeded');
	}
	const file = /^\/drive\/v3\/files\/([^/]+)$/.exec(path)?.[1];
	if (file) {
		return DRIVE_FILES[file] ? Response.json(DRIVE_FILES[file]) : googleError(404, `File not found: ${file}.`, 'notFound');
	}
	if (path === '/v4/spreadsheets/1Budget') {
		return Response.json(SHEETS);
	}
	if (path === '/v4/spreadsheets/1Budget/values:batchGet') {
		const [header, range] = url.searchParams.getAll('ranges');
		const [, from = '2', to = '2'] = /!A(\d+):ZZ(\d+)$/.exec(range ?? '') ?? [];
		const count = Number(from) === 52 ? 3 : Number(to) - Number(from) + 1;
		return Response.json({
			spreadsheetId: '1Budget',
			valueRanges: [
				{range: header, majorDimension: 'ROWS', values: [['Item', 'Amount', '']]},
				{range, majorDimension: 'ROWS', values: rows(Number(from), count)},
			],
		});
	}
	return googleError(404, 'Not found', 'notFound');
}

spyOn(globalThis, 'fetch').mockImplementation((async (input: string | URL | Request) => {
	const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
	drive.requests.push(url);
	return answer(url);
}) as typeof fetch);

function requested(path: string): URL[] {
	return drive.requests.filter((url) => url.pathname === path);
}

beforeEach(() => {
	drive.requests = [];
	drive.answer = () => null;
});

describe('googleConnector.list', () => {
	test('the top is the four places, each holding files', async () => {
		const {googleConnector} = await import('./google-connector');
		const page = (await googleConnector.list(target, query())).unwrap();

		expect(page).toEqual({
			records: [
				{id: 'root', values: {name: 'My Drive', kind: 'Place'}, updatedAt: '', hasChildren: true},
				{id: 'shared-with-me', values: {name: 'Shared with me', kind: 'Place'}, updatedAt: '', hasChildren: true},
				{id: 'shared-drives', values: {name: 'Shared drives', kind: 'Place'}, updatedAt: '', hasChildren: true},
				{id: 'recent', values: {name: 'Recent', kind: 'Place'}, updatedAt: '', hasChildren: true},
			],
			nextPage: null,
		});
		expect(drive.requests).toEqual([]);
	});

	test('inside a folder, its files, folders first, from the page token given, with the next one and the trail', async () => {
		const {googleConnector} = await import('./google-connector');
		const page = (await googleConnector.list(target, query({parent: '1Projects', page: 'page-1'}))).unwrap();

		const [list] = requested('/drive/v3/files');
		expect(Object.fromEntries(list?.searchParams ?? [])).toEqual({
			q: "'1Projects' in parents and trashed=false",
			orderBy: 'folder,modifiedTime desc',
			pageSize: '50',
			pageToken: 'page-1',
			fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,owners(displayName,emailAddress),webViewLink,parents,driveId)',
			supportsAllDrives: 'true',
			includeItemsFromAllDrives: 'true',
		});
		expect(requested('/drive/v3/files/1Projects')[0]?.searchParams.get('supportsAllDrives')).toBe('true');
		expect(page.nextPage).toBe('page-2');
		expect(page.records).toEqual([
			{
				id: '1Projects',
				values: {name: 'Projects', kind: 'Folder', modified: '2026-10-01T09:00:00.000Z', owner: 'Alex Kim', link: 'https://drive.google.com/drive/folders/1Projects'},
				updatedAt: '2026-10-01T09:00:00.000Z',
				hasChildren: true,
			},
			{
				id: '1Plan',
				values: {name: 'Launch plan', kind: 'Document', modified: '2026-10-08T08:16:23.137Z', owner: 'Alex Kim', link: 'https://docs.google.com/document/d/1Plan/edit?usp=drivesdk'},
				updatedAt: '2026-10-08T08:16:23.137Z',
			},
		]);
		expect(page.trail).toEqual([
			{id: 'root', title: 'My Drive'},
			{id: '1Projects', title: 'Projects'},
		]);
	});

	test('My Drive lists what is at its top, Shared with me and Recent in their own order', async () => {
		const {googleConnector} = await import('./google-connector');
		await googleConnector.list(target, query({parent: 'root'}));
		await googleConnector.list(target, query({parent: 'shared-with-me'}));
		const recent = (await googleConnector.list(target, query({parent: 'recent'}))).unwrap();

		expect(requested('/drive/v3/files').map((url) => [url.searchParams.get('q'), url.searchParams.get('orderBy')])).toEqual([
			["'root' in parents and trashed=false", 'folder,modifiedTime desc'],
			['sharedWithMe=true and trashed=false', 'sharedWithMeTime desc'],
			['trashed=false', 'viewedByMeTime desc'],
		]);
		expect(recent.trail).toEqual([{id: 'recent', title: 'Recent'}]);
	});

	test('shared drives are listed as folders, and inside one its own files', async () => {
		const {googleConnector} = await import('./google-connector');
		drive.answer = (url) => {
			if (url.pathname === '/drive/v3/drives') {
				return Response.json({drives: [{id: '0ATeamDrive', name: 'Team', kind: 'drive#drive'}]});
			}
			if (url.pathname === '/drive/v3/drives/0ATeamDrive') {
				return Response.json({id: '0ATeamDrive', name: 'Team'});
			}
			return null;
		};

		const drives = (await googleConnector.list(target, query({parent: 'shared-drives'}))).unwrap();
		const inside = (await googleConnector.list(target, query({parent: 'drive-0ATeamDrive'}))).unwrap();

		expect(drives.records).toEqual([{id: 'drive-0ATeamDrive', values: {name: 'Team', kind: 'Folder'}, updatedAt: '', hasChildren: true}]);
		const [list] = requested('/drive/v3/files');
		expect(list?.searchParams.get('q')).toBe("'0ATeamDrive' in parents and trashed=false");
		expect(list?.searchParams.get('corpora')).toBe('drive');
		expect(list?.searchParams.get('driveId')).toBe('0ATeamDrive');
		expect(inside.trail).toEqual([
			{id: 'shared-drives', title: 'Shared drives'},
			{id: 'drive-0ATeamDrive', title: 'Team'},
		]);
	});

	test('a search goes through all of Drive, its words quoted as Drive needs, in the order Drive finds best', async () => {
		const {googleConnector} = await import('./google-connector');
		await googleConnector.list(target, query({search: "Alex's \\ plan"}));
		await googleConnector.list(target, query({search: 'plan', parent: '1Projects'}));

		const [everywhere, inFolder] = requested('/drive/v3/files');
		expect(everywhere?.searchParams.get('q')).toBe("fullText contains 'Alex\\'s \\\\ plan' and trashed=false");
		expect(everywhere?.searchParams.get('corpora')).toBe('allDrives');
		expect(everywhere?.searchParams.get('orderBy')).toBeNull();
		expect(inFolder?.searchParams.get('q')).toBe("fullText contains 'plan' and '1Projects' in parents and trashed=false");
	});

	test("an id that isn't one of Drive's never reaches Google", async () => {
		const {googleConnector} = await import('./google-connector');
		const result = await googleConnector.list(target, query({parent: "x' or name contains '"}));

		expect(result.isErr() && result.error.kind).toBe('not_found');
		expect(drive.requests).toEqual([]);
	});

	test("a spreadsheet holds its tabs, and a tab its rows, 50 to a page under the first row's headers", async () => {
		const {googleConnector} = await import('./google-connector');
		const tabs = (await googleConnector.list(target, query({parent: '1Budget'}))).unwrap();

		expect(tabs.records.map((record) => [record.id, record.values.name, record.values.content, record.hasChildren])).toEqual([
			['sheet-1Budget-0', 'Q1', '120 rows, 8 columns', true],
			['sheet-1Budget-1834', "Alex's notes", '1000 rows, 26 columns', true],
		]);
		expect(tabs.trail).toEqual([
			{id: 'root', title: 'My Drive'},
			{id: '1Projects', title: 'Projects'},
			{id: '1Budget', title: 'Budget 2026'},
		]);

		const first = (await googleConnector.list(target, query({parent: 'sheet-1Budget-1834'}))).unwrap();
		expect(requested('/v4/spreadsheets/1Budget/values:batchGet')[0]?.searchParams.getAll('ranges')).toEqual(["'Alex''s notes'!A1:ZZ1", "'Alex''s notes'!A2:ZZ51"]);
		expect(first.records).toHaveLength(50);
		expect(first.records[0]).toEqual({
			id: 'row-1Budget-1834-2',
			values: {
				name: 'Item 2',
				kind: 'Row',
				modified: '2026-10-07T12:00:00.000Z',
				owner: 'Alex Kim',
				link: 'https://docs.google.com/spreadsheets/d/1Budget/edit?usp=drivesdk#gid=1834',
				content: 'Item: Item 2\nAmount: 20\nColumn C: Paid',
			},
			updatedAt: '2026-10-07T12:00:00.000Z',
		});
		expect(first.nextPage).toBe('52');
		expect(first.trail?.at(-1)).toEqual({id: 'sheet-1Budget-1834', title: "Alex's notes"});

		const last = (await googleConnector.list(target, query({parent: 'sheet-1Budget-1834', page: '52'}))).unwrap();
		expect(last.records.map((record) => record.id)).toEqual(['row-1Budget-1834-52', 'row-1Budget-1834-53', 'row-1Budget-1834-54']);
		expect(last.nextPage).toBeNull();
	});

	test('a page of rows that is not a row number is refused', async () => {
		const {googleConnector} = await import('./google-connector');
		const result = await googleConnector.list(target, query({parent: 'sheet-1Budget-0', page: 'A1'}));

		expect(result.isErr() && result.error.kind).toBe('validation_error');
	});

	test('a folder whose folder the account cannot see is under Shared with me', async () => {
		const {googleConnector} = await import('./google-connector');
		drive.answer = (url) => {
			if (url.pathname === '/drive/v3/files/1Shared') {
				return Response.json({id: '1Shared', name: 'Shared plans', mimeType: 'application/vnd.google-apps.folder', parents: ['1Hidden']});
			}
			return null;
		};
		const page = (await googleConnector.list(target, query({parent: '1Shared'}))).unwrap();

		expect(page.trail).toEqual([
			{id: 'shared-with-me', title: 'Shared with me'},
			{id: '1Shared', title: 'Shared plans'},
		]);
	});
});

describe('googleConnector.get', () => {
	test('a document opens as Markdown', async () => {
		const {googleConnector} = await import('./google-connector');
		const record = (await googleConnector.get(target, '1Plan')).unwrap();

		expect(requested('/drive/v3/files/1Plan/export')[0]?.searchParams.get('mimeType')).toBe('text/markdown');
		expect(record).toEqual({
			id: '1Plan',
			values: {
				name: 'Launch plan',
				kind: 'Document',
				modified: '2026-10-08T08:16:23.137Z',
				owner: 'Alex Kim',
				link: 'https://docs.google.com/document/d/1Plan/edit?usp=drivesdk',
				content: '# Launch plan\n\n- Ship it',
			},
			updatedAt: '2026-10-08T08:16:23.137Z',
		});
	});

	test('a spreadsheet opens with its tabs one a line', async () => {
		const {googleConnector} = await import('./google-connector');
		const record = (await googleConnector.get(target, '1Budget')).unwrap();

		expect(record.values.content).toBe("Q1: 120 rows, 8 columns\nAlex's notes: 1000 rows, 26 columns");
		expect(record.hasChildren).toBe(true);
	});

	test('a row opens with its values under the headers', async () => {
		const {googleConnector} = await import('./google-connector');
		const record = (await googleConnector.get(target, 'row-1Budget-0-7')).unwrap();

		expect(requested('/v4/spreadsheets/1Budget/values:batchGet')[0]?.searchParams.getAll('ranges')).toEqual(["'Q1'!A1:ZZ1", "'Q1'!A7:ZZ7"]);
		expect(record.values).toMatchObject({name: 'Item 7', kind: 'Row', content: 'Item: Item 7\nAmount: 70\nColumn C: Paid'});
	});

	test('a file too large to export says so', async () => {
		const {googleConnector} = await import('./google-connector');
		const result = await googleConnector.get(target, '1Huge');

		expect(result.isErr() && result.error).toEqual({kind: 'validation_error', statusCode: 400, message: 'This file is too large to read; Google exports at most 10 MB'});
	});

	test("a disabled API is Google's own message, saying where to enable it", async () => {
		const {googleConnector} = await import('./google-connector');
		const message =
			'Google Sheets API has not been used in project 1234 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/sheets.googleapis.com/overview?project=1234 then retry.';
		drive.answer = (url) => (url.hostname === 'sheets.googleapis.com' ? googleError(403, message, 'accessNotConfigured') : null);

		const result = await googleConnector.get(target, '1Budget');

		expect(result.isErr() && result.error).toEqual({kind: 'validation_error', statusCode: 400, message});
	});

	test('a file Drive does not have is not found by its id', async () => {
		const {googleConnector} = await import('./google-connector');
		const result = await googleConnector.get(target, '1Gone');

		expect(result.isErr() && result.error).toMatchObject({kind: 'not_found', resource: 'record', id: '1Gone'});
	});
});

test('files are not written to yet', async () => {
	const {googleConnector} = await import('./google-connector');
	const result = await googleConnector.update(target, '1Plan', {name: 'New name'});

	expect(result.isErr() && result.error.kind).toBe('validation_error');
});
