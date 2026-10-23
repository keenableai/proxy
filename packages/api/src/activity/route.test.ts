import {afterEach, beforeEach, describe, expect, mock, setSystemTime, test} from 'bun:test';
import {Ok} from 'ts-results-es';

const listAuditEntries = mock();
const listTaskEntries = mock();
const listLastTaskRequests = mock();

const listMemberNames = mock(async (): Promise<unknown> => Ok([]));

mock.module('@proxy/db/organization', () => ({getMembership: mock(async () => Ok({role: 'owner'})), listMemberNames}));

const requireViewer = mock(async () => Ok({orgId: 'org-1', userId: 'user-1', slug: 'org-1', name: 'Workspace', role: 'owner', onboarded: true, experiments: []}));

mock.module('../utils/user-org', () => ({requireViewer, requireOwner: requireViewer}));
mock.module('@proxy/db/audit', () => ({listAuditEntries, listLastTaskRequests, listTaskEntries}));

const listAgentTasks = mock();
const listAgentTasksSince = mock();
const listAgentTasksBetween = mock();

mock.module('@proxy/db/task', () => ({listAgentTasks, listAgentTasksBetween, listAgentTasksSince}));

function makeRequest(query: Record<string, string>) {
	return {user: {userId: 'user-1', email: 'test@example.com', name: 'Test User'}, query};
}

beforeEach(() => {
	mock.clearAllMocks();
	listAuditEntries.mockResolvedValue(Ok([]));
	listAgentTasks.mockResolvedValue(Ok([]));
	listAgentTasksSince.mockResolvedValue(Ok([]));
	setSystemTime(new Date('2026-10-15T23:30:00Z'));
});

afterEach(() => {
	setSystemTime();
});

describe('handleActivityTimelineRoute', () => {
	test('answers the tasks under way since the time asked for, with every request made for them', async () => {
		const task = {
			id: 'task-1',
			agentId: 'agent-1',
			parentId: null,
			title: 'Triage inbox',
			goal: 'Archive the newsletters',
			via: 'mcp',
			createdAt: new Date('2026-10-15T20:00:00Z'),
			finishedAt: null,
			outcome: null,
		};
		const entry = {
			id: 'entry-1',
			agentId: 'agent-1',
			connectionId: 'mail-1',
			collectionId: 'emails',
			action: 'archive',
			recordTitle: 'Weekly digest',
			query: null,
			outcome: 'allowed' as const,
			via: 'mcp' as const,
			taskId: 'task-1',
			durationMs: 640,
			userId: null,
			error: null,
			createdAt: new Date('2026-10-15T20:05:00Z'),
		};
		listAgentTasksSince.mockResolvedValue(Ok([task]));
		listTaskEntries.mockResolvedValue(Ok([entry]));
		const {handleActivityTimelineRoute} = await import('./route');
		const result = await handleActivityTimelineRoute(makeRequest({from: '2026-10-14T23:30:00Z'}) as never);

		const viewer = expect.objectContaining({orgId: 'org-1', userId: 'user-1'});
		expect(listAgentTasksSince).toHaveBeenCalledWith(viewer, new Date('2026-10-14T23:30:00Z'), 200);
		expect(listTaskEntries).toHaveBeenCalledWith(viewer, ['task-1'], 2000);
		const {createdAt, ...fields} = entry;
		expect(result.unwrap()).toEqual({
			now: '2026-10-15T23:30:00.000Z',
			from: '2026-10-14T23:30:00.000Z',
			tasks: [
				{
					id: 'task-1',
					agentId: 'agent-1',
					parentId: null,
					title: 'Triage inbox',
					goal: 'Archive the newsletters',
					via: 'mcp',
					startedAt: '2026-10-15T20:00:00.000Z',
					finishedAt: null,
					outcome: null,
				},
			],
			entries: [{...fields, at: createdAt.toISOString(), userName: null}],
		});
	});

	test('a window further back than a month is cut to one, and a time that is not one is refused', async () => {
		listTaskEntries.mockResolvedValue(Ok([]));
		const {handleActivityTimelineRoute} = await import('./route');
		await handleActivityTimelineRoute(makeRequest({from: '2020-01-01T00:00:00Z'}) as never);
		const bad = await handleActivityTimelineRoute(makeRequest({from: 'yesterday'}) as never);

		expect(listAgentTasksSince).toHaveBeenCalledWith(expect.objectContaining({orgId: 'org-1', userId: 'user-1'}), new Date('2026-09-14T23:30:00Z'), 200);
		expect(bad.unwrapErr().kind).toBe('parse_error');
	});
});

describe('handleListActivityRoute', () => {
	test('narrows to one outcome', async () => {
		const {handleListActivityRoute} = await import('./route');
		await handleListActivityRoute(makeRequest({outcome: 'denied'}) as never);

		expect(listAuditEntries).toHaveBeenCalledWith(expect.objectContaining({orgId: 'org-1', userId: 'user-1'}), {outcome: 'denied'}, 500);
	});

	test('what Personal Agent Proxy did itself is the entries without an agent', async () => {
		const {handleListActivityRoute} = await import('./route');
		await handleListActivityRoute(makeRequest({agentId: 'proxy'}) as never);

		expect(listAuditEntries).toHaveBeenCalledWith(expect.objectContaining({orgId: 'org-1', userId: 'user-1'}), {agentId: null}, 500);
	});

	test('names the tasks the entries were made for, and the one asked for even without entries, and who asked for what Personal Agent Proxy did', async () => {
		const entry = {
			id: 'e1',
			agentId: 'agent-1',
			connectionId: 'c1',
			collectionId: 'emails',
			action: 'list',
			recordTitle: null,
			query: null,
			outcome: 'allowed',
			via: 'mcp',
			taskId: 'task-1',
			durationMs: 340,
			userId: null,
			error: null,
			createdAt: new Date('2026-10-15T10:00:00Z'),
		};
		listMemberNames.mockResolvedValue(Ok([{orgId: 'org-1', userId: 'user-2', name: 'Dana'}]));
		listAuditEntries.mockResolvedValue(Ok([entry, {...entry, id: 'e2', taskId: null, agentId: null, durationMs: null, userId: 'user-2'}]));
		listAgentTasks.mockResolvedValue(
			Ok([
				{
					id: 'task-1',
					agentId: 'agent-1',
					parentId: 'task-0',
					title: 'Triage inbox',
					goal: 'Archive the newsletters',
					via: 'mcp',
					createdAt: new Date('2026-10-15T09:00:00Z'),
					finishedAt: new Date('2026-10-15T09:30:00Z'),
					outcome: 'Archived 12 newsletters',
				},
			]),
		);
		const {handleListActivityRoute} = await import('./route');
		const result = await handleListActivityRoute(makeRequest({taskId: 'task-2'}) as never);

		expect(listAuditEntries).toHaveBeenCalledWith(expect.objectContaining({orgId: 'org-1', userId: 'user-1'}), {taskId: 'task-2'}, 500);
		expect(listAgentTasks).toHaveBeenCalledWith(expect.objectContaining({orgId: 'org-1', userId: 'user-1'}), ['task-1', 'task-2']);
		expect(result.unwrap()).toEqual({
			entries: [
				{
					id: 'e1',
					agentId: 'agent-1',
					connectionId: 'c1',
					collectionId: 'emails',
					action: 'list',
					recordTitle: null,
					query: null,
					outcome: 'allowed',
					via: 'mcp',
					taskId: 'task-1',
					durationMs: 340,
					userId: null,
					userName: null,
					error: null,
					at: '2026-10-15T10:00:00.000Z',
				},
				{
					id: 'e2',
					agentId: null,
					connectionId: 'c1',
					collectionId: 'emails',
					action: 'list',
					recordTitle: null,
					query: null,
					outcome: 'allowed',
					via: 'mcp',
					taskId: null,
					durationMs: null,
					userId: 'user-2',
					userName: 'Dana',
					error: null,
					at: '2026-10-15T10:00:00.000Z',
				},
			],
			tasks: [
				{
					id: 'task-1',
					agentId: 'agent-1',
					parentId: 'task-0',
					title: 'Triage inbox',
					goal: 'Archive the newsletters',
					via: 'mcp',
					startedAt: '2026-10-15T09:00:00.000Z',
					finishedAt: '2026-10-15T09:30:00.000Z',
					outcome: 'Archived 12 newsletters',
				},
			],
		});
	});
});

describe('handleTaskRunRoute', () => {
	const task = (id: string, start: string, finish: string | null, parentId: string | null = null) => ({
		id,
		agentId: 'agent-1',
		parentId,
		title: `Task ${id}`,
		goal: 'List the week’s events and what to do first',
		via: 'mcp',
		createdAt: new Date(start),
		finishedAt: finish === null ? null : new Date(finish),
		outcome: null,
	});
	// Calendar, then notes a minute after it ends and a sub-task of notes; then, an hour later, mail.
	const calendar = task('calendar', '2026-10-15T20:00:00Z', '2026-10-15T20:10:00Z');
	const notes = task('notes', '2026-10-15T20:11:00Z', null);
	const sub = task('sub', '2026-10-15T20:12:00Z', '2026-10-15T20:13:00Z', 'notes');
	const mail = task('mail', '2026-10-15T21:30:00Z', '2026-10-15T21:31:00Z');
	const entry = {
		id: 'entry-1',
		agentId: 'agent-1',
		connectionId: 'mail-1',
		collectionId: 'emails',
		action: 'list',
		recordTitle: null,
		query: null,
		outcome: 'allowed' as const,
		via: 'mcp' as const,
		taskId: 'sub',
		durationMs: 1200,
		userId: null,
		error: null,
		createdAt: new Date('2026-10-15T20:12:30Z'),
	};

	function makeRunRequest(taskId: string) {
		return {user: {userId: 'user-1', email: 'test@example.com', name: 'Test User'}, query: {}, params: {taskId}};
	}

	beforeEach(() => {
		listAgentTasksBetween.mockResolvedValue(Ok([calendar, notes, sub, mail]));
		// Notes is still open: its last request, not now, is when it was last at work.
		listLastTaskRequests.mockResolvedValue(Ok([{taskId: 'notes', at: new Date('2026-10-15T20:20:00Z')}]));
		listTaskEntries.mockResolvedValue(Ok([entry]));
	});

	test('answers the run the task is in, the agent’s tasks a day either side of it, with every request made for them', async () => {
		listAgentTasks.mockResolvedValue(Ok([sub]));
		const {handleTaskRunRoute} = await import('./route');
		const result = await handleTaskRunRoute(makeRunRequest('sub') as never);

		const viewer = expect.objectContaining({orgId: 'org-1', userId: 'user-1'});
		expect(listAgentTasks).toHaveBeenCalledWith(viewer, ['sub']);
		expect(listAgentTasksBetween).toHaveBeenCalledWith(viewer, 'agent-1', new Date('2026-10-14T20:12:00Z'), new Date('2026-10-16T20:12:00Z'), 500);
		expect(listTaskEntries).toHaveBeenCalledWith(viewer, ['calendar', 'notes', 'sub'], 2000);
		const run = result.unwrap();
		expect(run).toMatchObject({now: '2026-10-15T23:30:00.000Z', task: 'sub', agentId: 'agent-1'});
		expect(run.tasks.map((row) => [row.id, row.parentId])).toEqual([
			['calendar', null],
			['notes', null],
			['sub', 'notes'],
		]);
		const {createdAt, ...fields} = entry;
		expect(run.entries).toEqual([{...fields, at: createdAt.toISOString(), userName: null}]);
	});

	test('a task an hour after the others is a run of its own', async () => {
		listAgentTasks.mockResolvedValue(Ok([mail]));
		const {handleTaskRunRoute} = await import('./route');
		const result = await handleTaskRunRoute(makeRunRequest('mail') as never);

		expect(result.unwrap().tasks.map((row) => row.id)).toEqual(['mail']);
	});

	test('a task the person does not see is not found', async () => {
		listAgentTasks.mockResolvedValue(Ok([]));
		const {handleTaskRunRoute} = await import('./route');
		const result = await handleTaskRunRoute(makeRunRequest('task-9') as never);

		expect(result.unwrapErr()).toMatchObject({kind: 'not_found', resource: 'task', id: 'task-9'});
		expect(listTaskEntries).not.toHaveBeenCalled();
	});
});
