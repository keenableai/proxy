import {endedAt, gridlines, type TaskStatus, taskStatus} from '@/lib/timeline-window';
import type {ActivityTask, AuditEntry} from '@/lib/types';

// What the agents did, as one timeline: agents work through sub-agents, and each task is one of
// them at work, so every agent has a row of its own, standing for the conversation its tasks were
// handed from, and every task is a row under it, or under the task it was handed from where the
// agent said so. A task's page lays out the run it is in (the api's activity/runs.ts): the axis
// starts when the first task did and ends at the last thing done, and a task left open runs on
// past it, fading, rather than stretching the axis over the hours nothing happened. The home page
// lays out every agent's tasks over a window of time ending now. A row's bar runs as long as its
// task did; on it, every request made for the task, from when it came in to when it was done.
// Where a row's tasks were under way, it was waiting on them. Nothing here is what the agent
// thought or said, only what Personal Agent Proxy saw: the tasks, and the requests.

// A stretch of the axis, as fractions of it from its start.
export type Stretch = {start: number; end: number};

export type TimelineCall = Stretch & {entry: AuditEntry};

// A task's bar, or, with no task, the agent's own.
export type TimelineBar = Stretch & {
	task: ActivityTask | null;
	status: TaskStatus;
	// From when it started to when it ended, or to now.
	durationMs: number;
	// It runs on past the end of the axis: still open, or left open until it was abandoned.
	open: boolean;
	// From when it started to when it was last at work: its last request, or when it was finished.
	activeMs: number;
	// Finished because the task it was handed from was, without saying anything itself.
	finishedWithParent: boolean;
	calls: TimelineCall[];
	// While what was handed from it was under way, merged where they overlap.
	waiting: Stretch[];
	// It started before the window, so its bar starts at the edge.
	clipped: boolean;
	// How many tasks were handed on from it, at any depth below.
	subTasks: number;
	// Its sub-tasks are folded into it: not laid out under it, their requests on its bar.
	folded: boolean;
	// Its color, one of TASK_COLORS, the same for every task of one tree: from the id of the task its
	// agent handed on at the top of it, so it stays as the timeline is read again or moved. Null for
	// the agent's own.
	color: number | null;
	// The bar it was handed from, the task's or the agent's, which its lines join; null for the
	// agent's own.
	handedFrom: TimelineBar | null;
};

// A lane: the agent's own, or tasks handed from the row above it one after another, none
// overlapping, so an agent doing many small tasks doesn't take a row for each.
export type TimelineRow = {
	agentId: string;
	// How far down it is: 0 for the agent's row, 1 for tasks handed from it, and so on.
	depth: number;
	// The row of what its tasks were handed from; null for the agent's row.
	parentRow: number | null;
	// In the order they started.
	bars: TimelineBar[];
};

export type Tick = {at: number; label: string};

export type Timeline = {
	rows: TimelineRow[];
	// How long the axis is, from its start.
	spanMs: number;
	ticks: Tick[];
};

// The home page's: a stretch of time ending now, rather than a run's own.
export type TimelineWindow = {from: Date; to: Date};

// The least the axis is, so a task done in a moment still has room to show its requests.
const MIN_SPAN_MS = 10 * 1000;

const SECOND = 1000;
const MINUTE = 60 * SECOND;

// The least room between two tasks in one lane, as a fraction of the axis, so their bars don't touch.
const LANE_GAP = 0.01;
const HOUR = 60 * MINUTE;

// The steps the axis is marked off in, the least that gives it no more than a few marks.
const STEPS = [1, 2, 5, 10, 15, 30]
	.map((s) => s * SECOND)
	.concat(
		[1, 2, 5, 10, 15, 30].map((m) => m * MINUTE),
		[1, 2, 3, 6, 12, 24].map((h) => h * HOUR),
	);
// How many colors tasks are drawn in (the component's TASK_COLORS).
export const TASK_COLORS = 5;

/** One of the task colors for a task's id: the same every time, spread evenly over the ids. */
export function colorOf(id: string): number {
	let hash = 0;
	for (const char of id) {
		hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
	}
	return hash % TASK_COLORS;
}

// No more marks than this on the axis, where the timeline doesn't say how many fit.
const MAX_TICKS = 8;

/** "850ms", "1.2s", "5s", "12s", "2m 5s", "1h 4m": how long something took, as short as it reads. */
export function formatDuration(ms: number): string {
	if (ms < SECOND) {
		return `${Math.round(ms)}ms`;
	}
	if (ms < 10 * SECOND) {
		const seconds = ms / SECOND;
		return Number.isInteger(seconds) ? `${seconds}s` : `${seconds.toFixed(1)}s`;
	}
	if (ms < MINUTE) {
		return `${Math.round(ms / SECOND)}s`;
	}
	if (ms < HOUR) {
		const seconds = Math.round((ms % MINUTE) / SECOND);
		const minutes = Math.floor(ms / MINUTE);
		return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
	}
	const minutes = Math.round((ms % HOUR) / MINUTE);
	const hours = Math.floor(ms / HOUR);
	return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/** Where the axis is marked, from its start, a step apart: "0s", "30s", "1m", and so on. */
export function ticks(spanMs: number, maxTicks = MAX_TICKS): Tick[] {
	const step = STEPS.find((candidate) => spanMs / candidate <= maxTicks) ?? spanMs;
	const marks: Tick[] = [];
	for (let at = 0; at <= spanMs; at += step) {
		marks.push({at: at / spanMs, label: at === 0 ? '0s' : formatDuration(at)});
	}
	return marks;
}

/** The stretches, sorted, with those that overlap or touch made one. */
export function merged(stretches: Stretch[]): Stretch[] {
	const sorted = [...stretches].sort((a, b) => a.start - b.start);
	const out: Stretch[] = [];
	for (const stretch of sorted) {
		const last = out.at(-1);
		if (last && stretch.start <= last.end) {
			last.end = Math.max(last.end, stretch.end);
			continue;
		}
		out.push({...stretch});
	}
	return out;
}

/**
 * The timeline of `tasks`, with the requests made for them, as it stood at `now`: a run's, along
 * its own axis, or, over `window`, every task under way in it, each agent's row over its tasks, the
 * busiest agents first, then those at work most recently.
 */
export function buildTimeline(
	allTasks: ActivityTask[],
	entries: AuditEntry[],
	now: Date,
	{
		window,
		maxTicks = MAX_TICKS,
		expanded = new Set(),
	}: {
		window?: TimelineWindow;
		// As many marks as there is room to label along the axis.
		maxTicks?: number;
		// The tasks whose sub-tasks are laid out under them; every other task's are folded into it.
		expanded?: ReadonlySet<string>;
	} = {},
): Timeline {
	const time = (iso: string) => new Date(iso).getTime();
	const endOf = (task: ActivityTask) => (endedAt(task, now) ?? now).getTime();
	const tasks = window
		? allTasks.filter(
				(task) =>
					endOf(task) >= window.from.getTime() && time(task.startedAt) <= window.to.getTime(),
			)
		: allTasks;
	if (tasks.length === 0) {
		return {rows: [], spanMs: MIN_SPAN_MS, ticks: ticks(MIN_SPAN_MS, maxTicks)};
	}
	const byId = new Map(tasks.map((task) => [task.id, task]));
	const callsOf = (task: ActivityTask) => entries.filter((entry) => entry.taskId === task.id);
	// When a task was last at work: when it was finished, or its last request, or when it started.
	const activeUntil = (task: ActivityTask) =>
		Math.max(
			time(task.finishedAt ?? task.startedAt),
			...callsOf(task).map((entry) => time(entry.at)),
		);
	const origin = window
		? window.from.getTime()
		: Math.min(...tasks.map((task) => time(task.startedAt)));
	const spanMs = window
		? Math.max(window.to.getTime() - origin, 1)
		: Math.max(Math.max(...tasks.map(activeUntil)) - origin, MIN_SPAN_MS);
	const axisEnd = origin + spanMs;
	const at = (ms: number) => (Math.min(Math.max(ms, origin), axisEnd) - origin) / spanMs;

	// What was handed from a task, or from its agent for null, in the order started.
	const parentOf = (task: ActivityTask) =>
		task.parentId !== null && byId.has(task.parentId) ? task.parentId : null;
	const below = (agentId: string, parentId: string | null) =>
		tasks
			.filter((task) => task.agentId === agentId && parentOf(task) === parentId)
			.sort((a, b) => time(a.startedAt) - time(b.startedAt));
	const waitingOn = (children: ActivityTask[]) =>
		merged(
			children.map((child) => ({start: at(time(child.startedAt)), end: at(endOf(child))})),
		).filter((stretch) => stretch.end > stretch.start);

	// The task at the top of a task's tree, which its agent handed on.
	const topOf = (task: ActivityTask): ActivityTask => {
		const parentId = parentOf(task);
		const parent = parentId === null ? undefined : byId.get(parentId);
		if (!parent) {
			return task;
		}
		return topOf(parent);
	};

	// Every task handed on from a task, at any depth below it.
	const descendants = (task: ActivityTask): ActivityTask[] =>
		below(task.agentId, task.id).flatMap((child) => [child, ...descendants(child)]);

	const taskBar = (task: ActivityTask): TimelineBar => {
		const start = time(task.startedAt);
		const end = endOf(task);
		const handedOn = descendants(task);
		const folded = handedOn.length > 0 && !expanded.has(task.id);
		const requestsOf = folded ? [task, ...handedOn].flatMap(callsOf) : callsOf(task);
		const top = topOf(task);
		const parentId = parentOf(task);
		const parentFinishedAt = parentId === null ? null : (byId.get(parentId)?.finishedAt ?? null);
		return {
			task,
			status: taskStatus(task, now),
			start: at(start),
			end: at(end),
			durationMs: end - start,
			open: end > axisEnd,
			activeMs: activeUntil(task) - start,
			finishedWithParent:
				task.finishedAt !== null && task.outcome === null && task.finishedAt === parentFinishedAt,
			calls: requestsOf
				.flatMap((entry) => {
					const done = time(entry.at);
					if (done < origin || done - (entry.durationMs ?? 0) > axisEnd) {
						return [];
					}
					return [{entry, start: at(done - (entry.durationMs ?? 0)), end: at(done)}];
				})
				.sort((a, b) => a.start - b.start),
			waiting: waitingOn(below(task.agentId, task.id)),
			clipped: start < origin,
			subTasks: handedOn.length,
			folded,
			color: colorOf(top.id),
			handedFrom: null,
		};
	};

	const rows: TimelineRow[] = [];
	// The tasks handed from one row, in lanes: each in the first that is free by the time it starts,
	// a lane each where they overlap; under each lane, what its tasks handed on, in lanes of their
	// own. The lanes under one row are then ordered so the fewest lines run through bars they don't
	// join (leastCrossing).
	const blocks = (agentId: string, handed: ActivityTask[], depth: number): LaneBlock[] => {
		const lanes: TimelineBar[][] = [];
		for (const bar of handed.map(taskBar)) {
			const lane = lanes.find((candidate) => {
				const last = candidate.at(-1);
				return last === undefined || last.end + LANE_GAP <= bar.start;
			});
			if (lane) {
				lane.push(bar);
				continue;
			}
			lanes.push([bar]);
		}
		return leastCrossing(
			lanes.map((bars) => {
				const next = bars
					.flatMap((bar) => (bar.task === null || bar.folded ? [] : below(agentId, bar.task.id)))
					.sort((a, b) => time(a.startedAt) - time(b.startedAt));
				return {bars, depth, below: blocks(agentId, next, depth + 1)};
			}),
		);
	};
	const lay = (agentId: string, lanes: LaneBlock[], parentRow: number) => {
		for (const lane of lanes) {
			const row = rows.length;
			rows.push({agentId, depth: lane.depth, parentRow, bars: lane.bars});
			lay(agentId, lane.below, row);
		}
	};
	for (const agentId of agentsInOrder(tasks, now, endOf)) {
		const own = tasks.filter((task) => task.agentId === agentId);
		const first = Math.min(...own.map((task) => time(task.startedAt)));
		const last = Math.max(...own.map(endOf));
		const agentRow = rows.length;
		rows.push({
			agentId,
			depth: 0,
			parentRow: null,
			bars: [
				{
					task: null,
					status: own.some((task) => taskStatus(task, now) === 'running') ? 'running' : 'finished',
					start: at(first),
					end: window ? at(last) : 1,
					durationMs: Math.min(last, axisEnd) - first,
					open: false,
					activeMs: Math.min(last, axisEnd) - first,
					finishedWithParent: false,
					calls: [],
					waiting: waitingOn(below(agentId, null)),
					clipped: first < origin,
					subTasks: own.length,
					folded: false,
					color: null,
					handedFrom: null,
				},
			],
		});
		lay(agentId, blocks(agentId, below(agentId, null), 1), agentRow);
	}
	// Each task's lines join the bar it was handed from, its parent's or else its agent's.
	const barOfTask = new Map(
		rows.flatMap((row) =>
			row.bars.flatMap((bar) => (bar.task === null ? [] : [[bar.task.id, bar] as const])),
		),
	);
	for (const row of rows) {
		const agentBar = rows.find(
			(candidate) => candidate.agentId === row.agentId && candidate.depth === 0,
		)?.bars[0];
		for (const bar of row.bars) {
			if (bar.task === null) {
				continue;
			}
			const parentId = parentOf(bar.task);
			bar.handedFrom = (parentId === null ? agentBar : barOfTask.get(parentId)) ?? null;
		}
	}
	const marks = window
		? gridlines(spanMs / MINUTE, (now.getTime() - axisEnd) / MINUTE, maxTicks).map(({at, ago}) => ({
				at,
				label: ago === 0 ? 'Now' : formatDuration(ago * MINUTE),
			}))
		: ticks(spanMs, maxTicks);
	return {rows, spanMs, ticks: marks};
}

// The agents of `tasks`: those with a task under way first, then those at work most recently.
function agentsInOrder(
	tasks: ActivityTask[],
	now: Date,
	endOf: (task: ActivityTask) => number,
): string[] {
	const ids = [...new Set(tasks.map((task) => task.agentId))];
	const of = (agentId: string) => tasks.filter((task) => task.agentId === agentId);
	const working = (agentId: string) =>
		of(agentId).some((task) => taskStatus(task, now) === 'running') ? 0 : 1;
	const lastEnd = (agentId: string) => Math.max(...of(agentId).map(endOf));
	return ids.sort(
		(a, b) => working(a) - working(b) || lastEnd(b) - lastEnd(a) || a.localeCompare(b),
	);
}

// A lane and the lanes laid out under it, which move together when lanes are reordered.
type LaneBlock = {bars: TimelineBar[]; depth: number; below: LaneBlock[]};

// Up to this many lanes under one row, every order is tried; past it, each lane is put in turn
// where it crosses least.
const MAX_EXHAUSTIVE = 6;

// Every bar of a lane and of the lanes under it.
function barsIn(block: LaneBlock): TimelineBar[] {
	return [...block.bars, ...block.below.flatMap(barsIn)];
}

// Where a lane's lines run up to the row its tasks were handed from: down at each start, up at
// each end where the task was handed back.
function linesOf(block: LaneBlock): number[] {
	return block.bars.flatMap((bar) => [
		...(bar.clipped ? [] : [bar.start]),
		...(bar.status === 'finished' && !bar.finishedWithParent && !bar.open ? [bar.end] : []),
	]);
}

// How many times the lines of lane `below` run through a bar of lane `above`, set over it.
function crossings(above: LaneBlock, below: LaneBlock): number {
	const bars = barsIn(above);
	return linesOf(below).reduce(
		(total, at) => total + bars.filter((bar) => bar.start <= at && at <= bar.end).length,
		0,
	);
}

/**
 * The lanes under one row in the order whose lines run through the fewest bars they don't join:
 * a line from the row to a lane runs through every lane set above it. Among orders that cross as
 * little, the one closest to the lanes' own, the earliest first.
 */
function leastCrossing(lanes: LaneBlock[]): LaneBlock[] {
	if (lanes.length < 2) {
		return lanes;
	}
	const cost = lanes.map((above) =>
		lanes.map((below) => (above === below ? 0 : crossings(above, below))),
	);
	const total = (order: number[]) =>
		order.reduce(
			(sum, lane, index) =>
				sum + order.slice(index + 1).reduce((more, after) => more + (cost[lane]?.[after] ?? 0), 0),
			0,
		);
	const indices = lanes.map((_, index) => index);
	const best =
		lanes.length <= MAX_EXHAUSTIVE
			? permutations(indices).reduce((kept, order) => (total(order) < total(kept) ? order : kept))
			: indices.reduce<number[]>((order, lane) => {
					const options = order.map((_, at) => [...order.slice(0, at), lane, ...order.slice(at)]);
					return [...options, [...order, lane]].reduce((kept, option) =>
						total(option) < total(kept) ? option : kept,
					);
				}, []);
	return best.flatMap((index) => lanes[index] ?? []);
}

// Every order of `items`, the given one first.
function permutations(items: number[]): number[][] {
	if (items.length <= 1) {
		return [items];
	}
	return items.flatMap((item, index) =>
		permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
			item,
			...rest,
		]),
	);
}
