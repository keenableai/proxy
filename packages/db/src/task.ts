import type {AuditVia, Prisma} from '@prisma/client';
import type {Result} from 'ts-results-es';

import {type ApiError, wrapDb} from '@proxy/utils';
import {TASK_ABANDONED_AFTER_MS} from '@proxy/utils/tasks';

import {db} from '.';
import {type Viewer, visibleTo} from './viewer';

/** What an agent set out to do, as it named it when it started. */
export type AgentTaskRow = {
	id: string;
	agentId: string;
	// The task this one is a sub-task of; null for one started on its own.
	parentId: string | null;
	title: string;
	goal: string;
	via: AuditVia;
	createdAt: Date;
	// Null while the task is under way.
	finishedAt: Date | null;
	// What was done or found, as the agent said when it finished; null where it said nothing.
	outcome: string | null;
};

const taskSelect = {
	id: true,
	agentId: true,
	parentId: true,
	title: true,
	goal: true,
	via: true,
	createdAt: true,
	finishedAt: true,
	outcome: true,
} as const;

/**
 * Starts a task for the agent: what it is called and what the person asked for, and the agent's
 * task it is a sub-task of, where it is one. The parent is locked while the sub-task is made, so it
 * can't be finished in between and leave the sub-task open; `Ok(null)` means it is no longer under
 * way, finished or abandoned (@proxy/utils/tasks). `ownerUserId` is the member whose own the agent
 * is, who alone sees the task; null for a shared agent's.
 */
export async function createAgentTask(data: {
	orgId: string;
	agentId: string;
	ownerUserId: string | null;
	parentId: string | null;
	title: string;
	goal: string;
	via: AuditVia;
}): Promise<Result<AgentTaskRow | null, ApiError>> {
	const {orgId, agentId, parentId} = data;
	if (parentId === null) {
		return wrapDb(() => db.agentTask.create({data, select: taskSelect}));
	}
	return wrapDb(() =>
		db.$transaction(async (tx) => {
			const abandonedBefore = new Date(Date.now() - TASK_ABANDONED_AFTER_MS);
			const parent = await tx.$queryRaw<Array<{id: string}>>`
				SELECT "id" FROM "AgentTask"
				WHERE "id" = ${parentId} AND "orgId" = ${orgId} AND "agentId" = ${agentId}
					AND "finishedAt" IS NULL AND "createdAt" > ${abandonedBefore}
				FOR UPDATE`;
			if (parent.length === 0) {
				return null;
			}
			return tx.agentTask.create({data, select: taskSelect});
		}),
	);
}

/** `Ok(null)` means the agent has no such task: unknown, or another agent's. */
export async function getAgentTask(
	orgId: string,
	agentId: string,
	taskId: string,
): Promise<Result<AgentTaskRow | null, ApiError>> {
	return wrapDb(() =>
		db.agentTask.findFirst({where: {id: taskId, orgId, agentId}, select: taskSelect}),
	);
}

/**
 * Marks the agent's task finished now, with what was done where the agent said, and its sub-tasks
 * still under way finished with it, in one transaction. One already finished keeps the time it was,
 * and takes the outcome only where it has none, as a sub-task finished with its parent does; one
 * abandoned (@proxy/utils/tasks) stays as it is, ended when it was abandoned. `Ok(null)` means the
 * agent has no such task.
 */
export async function finishAgentTask(
	orgId: string,
	agentId: string,
	taskId: string,
	outcome: string | null,
): Promise<Result<AgentTaskRow | null, ApiError>> {
	return wrapDb(() =>
		db.$transaction(async (tx) => {
			const finishedAt = new Date();
			const abandonedBefore = new Date(finishedAt.getTime() - TASK_ABANDONED_AFTER_MS);
			const {count} = await tx.agentTask.updateMany({
				where: {id: taskId, orgId, agentId, finishedAt: null, createdAt: {gt: abandonedBefore}},
				data: {finishedAt, outcome},
			});
			if (count > 0) {
				await finishSubTasks(tx, {orgId, agentId, finishedAt, abandonedBefore}, [taskId]);
			}
			if (count === 0 && outcome !== null) {
				await tx.agentTask.updateMany({
					where: {id: taskId, orgId, agentId, finishedAt: {not: null}, outcome: null},
					data: {outcome},
				});
			}
			return tx.agentTask.findFirst({where: {id: taskId, orgId, agentId}, select: taskSelect});
		}),
	);
}

// Finishes the sub-tasks of `parentIds` still under way, level by level down the tree. Each level
// is read after the one above is updated, which waits for a sub-task being made under it
// (createAgentTask), so none is left open. An abandoned sub-task keeps when it ended, but its own
// sub-tasks, started before it was abandoned, may still be under way.
async function finishSubTasks(
	tx: Prisma.TransactionClient,
	at: {orgId: string; agentId: string; finishedAt: Date; abandonedBefore: Date},
	parentIds: string[],
): Promise<void> {
	const open = await tx.agentTask.findMany({
		where: {orgId: at.orgId, agentId: at.agentId, parentId: {in: parentIds}, finishedAt: null},
		select: {id: true},
	});
	if (open.length === 0) {
		return;
	}
	const ids = open.map((task) => task.id);
	// Not one finished since it was read, which keeps its own time and outcome.
	await tx.agentTask.updateMany({
		where: {id: {in: ids}, finishedAt: null, createdAt: {gt: at.abandonedBefore}},
		data: {finishedAt: at.finishedAt},
	});
	await finishSubTasks(tx, at, ids);
}

/** The agent's tasks still under way, newest first: none finished, and none abandoned (@proxy/utils/tasks). */
export async function listOpenAgentTasks(
	orgId: string,
	agentId: string,
): Promise<Result<AgentTaskRow[], ApiError>> {
	return wrapDb(() =>
		db.agentTask.findMany({
			where: {
				orgId,
				agentId,
				finishedAt: null,
				createdAt: {gt: new Date(Date.now() - TASK_ABANDONED_AFTER_MS)},
			},
			select: taskSelect,
			orderBy: {createdAt: 'desc'},
		}),
	);
}

/**
 * The tasks the viewer sees, shared agents' and their own agents', under way at some point between
 * `from` and `to`: started by `to` and not finished before `from`, nor abandoned before it, a day
 * after it started. Of those, the newest `take` that are tasks of their own: started on their own,
 * or handed on from a task not under way then, as one abandoned may have left a sub-task going;
 * newest first. The rest are sub-tasks of these (listSubTasks).
 */
export async function listAgentTasksBetween(
	viewer: Viewer,
	from: Date,
	to: Date,
	take: number,
): Promise<Result<AgentTaskRow[], ApiError>> {
	const startedSince = new Date(from.getTime() - TASK_ABANDONED_AFTER_MS);
	return wrapDb(async () => {
		const tops = await db.$queryRaw<Array<{id: string}>>`
			SELECT "task"."id" FROM "AgentTask" AS "task"
			WHERE "task"."orgId" = ${viewer.orgId}
				AND ("task"."ownerUserId" IS NULL OR "task"."ownerUserId" = ${viewer.userId})
				AND "task"."createdAt" <= ${to}
				AND ("task"."finishedAt" >= ${from} OR ("task"."finishedAt" IS NULL AND "task"."createdAt" >= ${startedSince}))
				AND NOT EXISTS (
					SELECT 1 FROM "AgentTask" AS "parent"
					WHERE "parent"."id" = "task"."parentId"
						AND "parent"."createdAt" <= ${to}
						AND ("parent"."finishedAt" >= ${from} OR ("parent"."finishedAt" IS NULL AND "parent"."createdAt" >= ${startedSince}))
				)
			ORDER BY "task"."createdAt" DESC
			LIMIT ${take}`;
		return db.agentTask.findMany({
			where: {id: {in: tops.map((task) => task.id)}},
			select: taskSelect,
			orderBy: {createdAt: 'desc'},
		});
	});
}

/** The tasks the viewer sees among `ids`, for naming what the activity log's entries were for. */
export async function listAgentTasks(
	viewer: Viewer,
	ids: string[],
): Promise<Result<AgentTaskRow[], ApiError>> {
	if (ids.length === 0) {
		return wrapDb(async () => []);
	}
	return wrapDb(() =>
		db.agentTask.findMany({
			where: {...visibleTo(viewer), id: {in: ids}},
			select: taskSelect,
		}),
	);
}

/**
 * The sub-tasks of the tasks `taskIds`, at every depth, that the viewer sees, in the order started:
 * the first `take` of them, level by level, so a task with more under it than that shows what it
 * handed on itself before what those handed on in turn.
 */
export async function listSubTasks(
	viewer: Viewer,
	taskIds: string[],
	take: number,
): Promise<Result<AgentTaskRow[], ApiError>> {
	return wrapDb(async () => {
		const found: AgentTaskRow[] = [];
		let parentIds = taskIds;
		while (parentIds.length > 0 && found.length < take) {
			const level: AgentTaskRow[] = await db.agentTask.findMany({
				where: {...visibleTo(viewer), parentId: {in: parentIds}},
				select: taskSelect,
				orderBy: {createdAt: 'asc'},
				take: take - found.length,
			});
			found.push(...level);
			parentIds = level.map((task) => task.id);
		}
		return found.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
	});
}
