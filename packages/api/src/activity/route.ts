import {Err, type Result} from 'ts-results-es';
import {z} from 'zod';

import {ApiErr, type ApiError, Do, parseSchema} from '@proxy/utils';
import {type AuditEntryRow, listAuditEntries, listLastTaskRequests, listTaskEntries} from '@proxy/db/audit';
import {listMemberNames} from '@proxy/db/organization';
import {type AgentTaskRow, listAgentTasks, listAgentTasksBetween, listAgentTasksSince} from '@proxy/db/task';
import type {Viewer} from '@proxy/db/viewer';

import type {AuthenticatedRequest} from '../server/middleware/require-auth';
import {requireViewer} from '../utils/user-org';
import {runAround} from './runs';

const MAX_ENTRIES = 500;

export type AuditEntryResponse = {
	id: string;
	at: string;
	// None for what Personal Agent Proxy did itself, as the home page's widgets write.
	agentId: string | null;
	connectionId: string;
	collectionId: string;
	// list, view, create, update or delete, or a command of the collection, such as `send`.
	action: string;
	recordTitle: string | null;
	query: string | null;
	outcome: 'allowed' | 'denied' | 'failed';
	// What went wrong, for a failed request: the api's kind of error, with the provider's HTTP status
	// where it answered with one, such as `provider_unreachable 429`; none for every other outcome.
	error: string | null;
	// The web app's agent pages, or the MCP server.
	via: 'web' | 'mcp';
	// The agent's task the request was made for, among the answer's `tasks`; none for entries from
	// before tasks, and for what Personal Agent Proxy did itself.
	taskId: string | null;
	// How long the request took; none for entries from before it was kept, and for what Personal
	// Agent Proxy did itself.
	durationMs: number | null;
	// The member who asked for what Personal Agent Proxy did itself, and their name or address while
	// they are in the organization; null for an agent's request, and for entries from before it was
	// kept.
	userId: string | null;
	userName: string | null;
};

/** What an agent set out to do, as it said when it started: what the entries made for it were for. */
export type ActivityTaskResponse = {
	id: string;
	agentId: string;
	// The agent's task it is a sub-task of, where the agent handed part of that task to a sub-agent;
	// null for a task started on its own. The parent may be missing from the answer.
	parentId: string | null;
	title: string;
	goal: string;
	via: 'web' | 'mcp';
	startedAt: string;
	// Null while the agent hasn't called it finished, abandoned (@proxy/utils/tasks) or not.
	finishedAt: string | null;
	// What was done or found, as the agent said when it finished; null where it said nothing.
	outcome: string | null;
};

function toActivityTask({createdAt, finishedAt, ...task}: AgentTaskRow): ActivityTaskResponse {
	return {...task, startedAt: createdAt.toISOString(), finishedAt: finishedAt?.toISOString() ?? null};
}

// `?agentId=proxy` is what Personal Agent Proxy did itself.
const PROXY = 'proxy';

const querySchema = z.object({
	agentId: z.string().min(1).optional(),
	connectionId: z.string().min(1).optional(),
	taskId: z.string().min(1).optional(),
	outcome: z.enum(['allowed', 'denied', 'failed']).optional(),
});

/**
 * The requests the person sees in the organization, newest first, the latest 500: shared agents'
 * and their own agents', on shared connections and their own; and the tasks they were made for;
 * with `?taskId=`, that task too, even before any request was made for it.
 */
export function handleListActivityRoute(request: AuthenticatedRequest): Promise<Result<{entries: AuditEntryResponse[]; tasks: ActivityTaskResponse[]}, ApiError>> {
	return Do(async ($) => {
		const {agentId, connectionId, taskId, outcome} = $(parseSchema(querySchema, request.query));
		const viewer = $(await requireViewer(request));
		const filter = {
			...(agentId === undefined ? {} : {agentId: agentId === PROXY ? null : agentId}),
			...(connectionId === undefined ? {} : {connectionId}),
			...(taskId === undefined ? {} : {taskId}),
			...(outcome === undefined ? {} : {outcome}),
		};
		const rows = $(await listAuditEntries(viewer, filter, MAX_ENTRIES));
		const taskIds = new Set([...rows.flatMap((row) => (row.taskId === null ? [] : [row.taskId])), ...(taskId === undefined ? [] : [taskId])]);
		const tasks = $(await listAgentTasks(viewer, [...taskIds]));
		return {entries: $(await toEntries(viewer, rows)), tasks: tasks.map(toActivityTask)};
	});
}

// The entries as the web app reads them, each with the name of the member who asked, where one did.
function toEntries(viewer: Viewer, rows: AuditEntryRow[]): Promise<Result<AuditEntryResponse[], ApiError>> {
	return Do(async ($) => {
		const userIds = new Set(rows.flatMap((row) => (row.userId === null ? [] : [row.userId])));
		const names = $(await listMemberNames([...userIds].map((userId) => ({orgId: viewer.orgId, userId}))));
		const nameOf = (userId: string | null) => names.find((member) => member.userId === userId)?.name ?? null;
		return rows.map(({createdAt, ...entry}) => ({...entry, at: createdAt.toISOString(), userName: nameOf(entry.userId)}));
	});
}

// A task's page: the agent's tasks started this far either side of the task, to find its run
// among, at most this many of them, and at most this many requests made for the run's tasks.
const RUN_REACH_MS = 24 * 60 * 60 * 1000;
const MAX_RUN_TASKS = 500;
const MAX_RUN_ENTRIES = 2000;

export type TaskRunResponse = {
	// When the answer was made: where a task still under way has got to.
	now: string;
	// The task the page is about, among `tasks`.
	task: string;
	// The agent whose run it is.
	agentId: string;
	// Every task of the run the task is in (runs.ts), in the order started: what the agent did in one go.
	tasks: ActivityTaskResponse[];
	// Every request made for them, in the order they were made.
	entries: AuditEntryResponse[];
};

/** `GET /activity/tasks/:taskId`: a task the person sees, the run of its agent's tasks it is in, and every request made for them. */
export function handleTaskRunRoute(request: AuthenticatedRequest): Promise<Result<TaskRunResponse, ApiError>> {
	return Do(async ($) => {
		const taskId = request.params.taskId ?? '';
		const viewer = $(await requireViewer(request));
		const now = new Date();
		const [task] = $(await listAgentTasks(viewer, [taskId]));
		if (task === undefined) {
			return $(Err(ApiErr.notFound('task', taskId)));
		}
		const started = task.createdAt.getTime();
		const around = $(await listAgentTasksBetween(viewer, task.agentId, new Date(started - RUN_REACH_MS), new Date(started + RUN_REACH_MS), MAX_RUN_TASKS));
		const lastRequests = $(
			await listLastTaskRequests(
				viewer,
				around.map((row) => row.id),
			),
		);
		const lastOf = new Map(lastRequests.map((row) => [row.taskId, row.at]));
		const ids = runAround(
			around.map((row) => ({id: row.id, startedAt: row.createdAt, activeUntil: row.finishedAt ?? lastOf.get(row.id) ?? row.createdAt})),
			task.id,
		);
		// Where more tasks started before it than were read, the task is its own run.
		const tasks = ids.length === 0 ? [task] : around.filter((row) => ids.includes(row.id));
		const rows = $(
			await listTaskEntries(
				viewer,
				tasks.map((row) => row.id),
				MAX_RUN_ENTRIES,
			),
		);
		return {
			now: now.toISOString(),
			task: task.id,
			agentId: task.agentId,
			tasks: tasks.map(toActivityTask),
			entries: $(await toEntries(viewer, rows)),
		};
	});
}

// The home page's timeline: at most this many tasks, a window at most this far back, and at most
// this many requests made for the tasks.
const MAX_TASKS = 200;
const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_TIMELINE_ENTRIES = 2000;

const timelineQuerySchema = z.object({from: z.iso.datetime({offset: true})});

export type ActivityTimelineResponse = {
	// When the answer was made: the right edge of the timeline.
	now: string;
	from: string;
	// Every task under way at some point since `from`, newest first.
	tasks: ActivityTaskResponse[];
	// Every request made for them, in the order they were made.
	entries: AuditEntryResponse[];
};

/** The tasks the person sees under way at some point since `?from=`, shared agents' and their own agents', with every request made for them. */
export function handleActivityTimelineRoute(request: AuthenticatedRequest): Promise<Result<ActivityTimelineResponse, ApiError>> {
	return Do(async ($) => {
		const query = $(parseSchema(timelineQuerySchema, request.query));
		const viewer = $(await requireViewer(request));
		const now = new Date();
		const from = new Date(Math.max(new Date(query.from).getTime(), now.getTime() - MAX_WINDOW_MS));
		const tasks = $(await listAgentTasksSince(viewer, from, MAX_TASKS));
		const rows = $(
			await listTaskEntries(
				viewer,
				tasks.map((task) => task.id),
				MAX_TIMELINE_ENTRIES,
			),
		);
		return {now: now.toISOString(), from: from.toISOString(), tasks: tasks.map(toActivityTask), entries: $(await toEntries(viewer, rows))};
	});
}
