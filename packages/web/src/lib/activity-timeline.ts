import {formatDuration, layRequests, MINUTE, type Span, type TimelineRequest} from '@/lib/timeline';
import {endedAt, gridlines, type TaskStatus, taskStatus} from '@/lib/timeline-window';
import type {ActivityTask, AuditEntry} from '@/lib/types';

// The home page's timeline: who is doing what. Every agent has a row over a window of time
// ending now, or scrolled back from it, and in it a bar for every task it was given, with the
// requests made for the task along the bottom of the bar as long as each took. A task's sub-tasks
// are rolled into it here, their requests on its bar; the task's page lays them out. Tasks under
// way at once each take a lane of the agent's row; one after another, they share one. Over a long
// window, short tasks close together are one bar, which zooms the window in on them.

export type ActivityBar = Span & {
	// The task, or, for short ones close together, the tasks, in the order started.
	tasks: ActivityTask[];
	// Where each task runs.
	members: Span[];
	// The task's, or, for several, under way if any is, else abandoned if every one was.
	status: TaskStatus;
	// From when the first started to when the last ended, or to now, in milliseconds since the epoch.
	fromMs: number;
	toMs: number;
	durationMs: number;
	// It started before the window, or runs on past its end.
	clippedStart: boolean;
	clippedEnd: boolean;
	// Made for its tasks, or for a task rolled into one of them.
	requests: TimelineRequest[];
	// How many tasks were handed on from its tasks, at any depth.
	subTasks: number;
};

export type ActivityRow = {
	agentId: string;
	// Bars in lanes: those in one lane don't overlap.
	lanes: ActivityBar[][];
	working: number;
};

type ActivityTick = {px: number; label: string};

export type ActivityTimeline = {rows: ActivityRow[]; width: number; ticks: ActivityTick[]};

export type Window = {from: Date; to: Date};

// The least room between two tasks in one lane, in pixels, so their bars don't touch.
const LANE_GAP_PX = 6;

// A task drawn narrower than this is short; short tasks of one agent less than the gap apart
// are one bar, since a bar each would hold nothing readable. That bar is at least wide enough
// to say how many it holds.
const SHORT_PX = 28;
const CLUSTER_GAP_PX = 16;
export const CLUSTER_MIN_PX = 52;

// The room a gridline's label takes, "23h 30m" with space around it.
const LABEL_PX = 72;

/**
 * The timeline of `tasks` over `window`, `width` pixels wide, as it stood at `now`: every agent's
 * row, the busiest first, over the tasks it was given that were under way in the window.
 */
export function buildActivityTimeline(
	allTasks: ActivityTask[],
	entries: AuditEntry[],
	now: Date,
	window: Window,
	width: number,
): ActivityTimeline {
	const time = (iso: string) => new Date(iso).getTime();
	const endOf = (task: ActivityTask) => (endedAt(task, now) ?? now).getTime();
	const from = window.from.getTime();
	const to = window.to.getTime();
	const spanMs = Math.max(to - from, 1);
	const px = (ms: number) => ((Math.min(Math.max(ms, from), to) - from) / spanMs) * width;
	const ids = new Set(allTasks.map((task) => task.id));
	// The tasks agents were given themselves, each with what it handed on rolled in.
	const tops = allTasks.filter((task) => task.parentId === null || !ids.has(task.parentId));
	const below = (parentId: string) => allTasks.filter((task) => task.parentId === parentId);
	const descendants = (task: ActivityTask): ActivityTask[] =>
		below(task.id).flatMap((child) => [child, ...descendants(child)]);
	const bars = tops
		.map((task): ActivityBar => {
			const tree = [task, ...descendants(task)];
			const start = time(task.startedAt);
			const end = Math.max(...tree.map(endOf));
			const span = {start: px(start), end: px(end)};
			return {
				tasks: [task],
				members: [span],
				status: tree.some((one) => taskStatus(one, now) === 'running')
					? 'running'
					: taskStatus(task, now),
				...span,
				fromMs: start,
				toMs: end,
				durationMs: end - start,
				clippedStart: start < from,
				clippedEnd: end > to,
				requests: layRequests(
					entries.filter(
						(entry) => entry.taskId !== null && tree.some((one) => one.id === entry.taskId),
					),
					px,
					from,
					to,
				),
				subTasks: tree.length - 1,
			};
		})
		.filter((bar) => bar.fromMs <= to && bar.toMs >= from)
		.sort((a, b) => a.fromMs - b.fromMs);
	const agentIds = [...new Set(bars.map((bar) => bar.tasks[0]?.agentId ?? ''))];
	const rows = agentIds.map((agentId): ActivityRow => {
		const own = clustered(
			bars.filter((bar) => bar.tasks[0]?.agentId === agentId),
			width,
		);
		const lanes: ActivityBar[][] = [];
		for (const bar of own) {
			const lane = lanes.find((candidate) => {
				const last = candidate[candidate.length - 1];
				return last === undefined || last.end + LANE_GAP_PX <= bar.start;
			});
			if (lane) {
				lane.push(bar);
				continue;
			}
			lanes.push([bar]);
		}
		return {agentId, lanes, working: own.filter((bar) => bar.status === 'running').length};
	});
	const lastEnd = (row: ActivityRow) => Math.max(...row.lanes.flat().map((bar) => bar.end));
	rows.sort(
		(a, b) =>
			Number(b.working > 0) - Number(a.working > 0) ||
			lastEnd(b) - lastEnd(a) ||
			a.agentId.localeCompare(b.agentId),
	);
	const ticks = gridlines(
		spanMs / MINUTE,
		(now.getTime() - to) / MINUTE,
		Math.max(Math.floor(width / LABEL_PX), 2),
	).map(({at, ago}) => ({px: at * width, label: ago === 0 ? 'Now' : formatDuration(ago * MINUTE)}));
	return {rows, width, ticks};
}

// One agent's bars, in the order started, with runs of short ones less than the gap apart made
// one bar each, wide enough to be named and kept inside the chart.
function clustered(bars: ActivityBar[], width: number): ActivityBar[] {
	const short = (bar: ActivityBar) => bar.end - bar.start < SHORT_PX;
	const out: ActivityBar[] = [];
	for (const bar of bars) {
		const last = out[out.length - 1];
		if (
			!last ||
			!short(bar) ||
			!last.members.every((member) => member.end - member.start < SHORT_PX) ||
			bar.start - last.end >= CLUSTER_GAP_PX
		) {
			out.push(bar);
			continue;
		}
		const tasks = [...last.tasks, ...bar.tasks];
		const members = [...last.members, ...bar.members];
		const statuses = [last.status, bar.status];
		const start = Math.min(...members.map((member) => member.start), width - CLUSTER_MIN_PX);
		out[out.length - 1] = {
			tasks,
			members,
			status: statuses.includes('running')
				? 'running'
				: statuses.every((status) => status === 'abandoned')
					? 'abandoned'
					: 'finished',
			start,
			end: Math.max(...members.map((member) => member.end), start + CLUSTER_MIN_PX),
			fromMs: Math.min(last.fromMs, bar.fromMs),
			toMs: Math.max(last.toMs, bar.toMs),
			durationMs: Math.max(last.toMs, bar.toMs) - Math.min(last.fromMs, bar.fromMs),
			clippedStart: last.clippedStart || bar.clippedStart,
			clippedEnd: last.clippedEnd || bar.clippedEnd,
			requests: [...last.requests, ...bar.requests].sort((a, b) => a.start - b.start),
			subTasks: last.subTasks + bar.subTasks,
		};
	}
	return out;
}
