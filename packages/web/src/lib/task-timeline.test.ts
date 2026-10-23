import {describe, expect, test} from 'bun:test';
import type {ActivityTask, AuditEntry} from '@/lib/types';
import {
	buildTimeline,
	colorOf,
	formatDuration,
	merged,
	TASK_COLORS,
	type Timeline,
	type TimelineBar,
	ticks,
} from './task-timeline';

const now = new Date('2026-10-16T09:10:00Z');

function task(overrides: Partial<ActivityTask>): ActivityTask {
	return {
		id: 'plan',
		agentId: 'a1',
		parentId: null,
		title: 'Plan the week',
		goal: 'List the week’s events and what to do first',
		via: 'mcp',
		startedAt: '2026-10-16T09:00:00Z',
		finishedAt: null,
		outcome: null,
		...overrides,
	};
}

function entry(overrides: Partial<AuditEntry>): AuditEntry {
	return {
		id: 'e1',
		at: '2026-10-16T09:01:00Z',
		agentId: 'a1',
		connectionId: 'mail-1',
		collectionId: 'emails',
		action: 'list',
		recordTitle: null,
		query: null,
		outcome: 'allowed',
		error: null,
		via: 'mcp',
		taskId: 'plan',
		durationMs: 1200,
		userId: null,
		userName: null,
		...overrides,
	};
}

describe('formatDuration', () => {
	test('reads as short as it can at every length', () => {
		expect([850, 1200, 12_400, 125_000, 120_000, 3_840_000, 7_200_000].map(formatDuration)).toEqual(
			['850ms', '1.2s', '12s', '2m 5s', '2m', '1h 4m', '2h'],
		);
	});
});

describe('ticks', () => {
	test('marks the axis from its start, a round step apart, no more than eight times', () => {
		expect(ticks(30_000).map((tick) => tick.label)).toEqual([
			'0s',
			'5s',
			'10s',
			'15s',
			'20s',
			'25s',
			'30s',
		]);
		expect(ticks(10 * 60_000).map((tick) => tick.label)).toEqual([
			'0s',
			'2m',
			'4m',
			'6m',
			'8m',
			'10m',
		]);
		expect(ticks(10 * 60_000).at(-1)?.at).toBe(1);
		// With room for three: a longer step.
		expect(ticks(10 * 60_000, 3).map((tick) => tick.label)).toEqual(['0s', '5m', '10m']);
	});
});

describe('merged', () => {
	test('makes stretches that overlap or touch one, in order', () => {
		expect(
			merged([
				{start: 0.5, end: 0.6},
				{start: 0.1, end: 0.3},
				{start: 0.2, end: 0.4},
				{start: 0.4, end: 0.45},
			]),
		).toEqual([
			{start: 0.1, end: 0.45},
			{start: 0.5, end: 0.6},
		]);
	});
});

// Each row as its tasks' ids, joined where they share the lane, with its depth and parent row.
function lanesOf(timeline: Timeline) {
	return timeline.rows.map((row) => [
		row.bars.map((bar) => bar.task?.id ?? 'agent').join('+'),
		row.depth,
		row.parentRow,
	]);
}

// Every one of `tasks` with its sub-tasks laid out under it rather than folded in.
function unfolded(...tasks: ActivityTask[]) {
	return {expanded: new Set(tasks.map((one) => one.id))};
}

function barOf(timeline: Timeline, id: string): TimelineBar | undefined {
	return timeline.rows.flatMap((row) => row.bars).find((bar) => (bar.task?.id ?? 'agent') === id);
}

describe('buildTimeline', () => {
	const plan = task({finishedAt: '2026-10-16T09:10:00Z', outcome: 'Tuesday is the day to start'});
	const calendar = task({
		id: 'calendar',
		parentId: 'plan',
		title: 'Check the calendar',
		startedAt: '2026-10-16T09:01:00Z',
		finishedAt: '2026-10-16T09:04:00Z',
		outcome: 'Tuesday afternoon is free',
	});
	const issues = task({
		id: 'issues',
		parentId: 'plan',
		title: 'Find the open issues',
		startedAt: '2026-10-16T09:03:00Z',
		finishedAt: '2026-10-16T09:06:00Z',
		outcome: 'Six issues open',
	});
	const notes = task({
		id: 'notes',
		parentId: 'calendar',
		title: 'Pull the meeting notes',
		startedAt: '2026-10-16T09:02:00Z',
		finishedAt: '2026-10-16T09:03:00Z',
		outcome: 'Three decisions',
	});

	test('the agent’s row is on top, and every task is handed from it, or from the task the agent said', () => {
		expect(
			lanesOf(buildTimeline([plan, issues, calendar, notes], [], now, unfolded(plan, calendar))),
		).toEqual([
			['agent', 0, null],
			['plan', 1, 0],
			// Above the calendar, whose lines then cross its bar once; below it, its own would cross the
			// calendar's and the notes'.
			['issues', 2, 1],
			['calendar', 2, 1],
			['notes', 3, 3],
		]);
	});

	test('lanes are ordered so the fewest lines run through bars they don’t join, the earliest first where it’s even', () => {
		// The long task runs while the short one starts and ends: set below it, the short one's lines
		// would cross it twice; above it, the long one's cross nothing.
		const long = task({
			id: 'long',
			startedAt: '2026-10-16T09:00:00Z',
			finishedAt: '2026-10-16T09:10:00Z',
		});
		const short = task({
			id: 'short',
			startedAt: '2026-10-16T09:02:00Z',
			finishedAt: '2026-10-16T09:03:00Z',
		});
		expect(lanesOf(buildTimeline([long, short], [], now)).map(([id]) => id)).toEqual([
			'agent',
			'short',
			'long',
		]);

		// Each crosses the other once, whichever is on top: the earliest first.
		const apart = task({
			id: 'apart',
			startedAt: '2026-10-16T09:00:00Z',
			finishedAt: '2026-10-16T09:04:00Z',
		});
		const overlapping = task({
			id: 'overlapping',
			startedAt: '2026-10-16T09:03:00Z',
			finishedAt: '2026-10-16T09:06:00Z',
		});
		expect(lanesOf(buildTimeline([apart, overlapping], [], now)).map(([id]) => id)).toEqual([
			'agent',
			'apart',
			'overlapping',
		]);
	});

	test('tasks one after another share a lane; those under way at once each take one', () => {
		const first = task({
			id: 'first',
			startedAt: '2026-10-16T09:00:00Z',
			finishedAt: '2026-10-16T09:01:00Z',
		});
		const second = task({
			id: 'second',
			startedAt: '2026-10-16T09:02:00Z',
			finishedAt: '2026-10-16T09:03:00Z',
		});
		const during = task({
			id: 'during',
			startedAt: '2026-10-16T09:02:30Z',
			finishedAt: '2026-10-16T09:04:00Z',
		});
		const third = task({
			id: 'third',
			startedAt: '2026-10-16T09:05:00Z',
			finishedAt: '2026-10-16T09:10:00Z',
		});

		expect(lanesOf(buildTimeline([third, during, second, first], [], now))).toEqual([
			['agent', 0, null],
			['first+second+third', 1, 0],
			['during', 1, 0],
		]);
	});

	test('what the tasks of one lane handed on shares the lanes under it', () => {
		const morning = task({
			id: 'morning',
			startedAt: '2026-10-16T09:00:00Z',
			finishedAt: '2026-10-16T09:04:00Z',
		});
		const noon = task({
			id: 'noon',
			startedAt: '2026-10-16T09:05:00Z',
			finishedAt: '2026-10-16T09:10:00Z',
		});
		const a = task({
			id: 'a',
			parentId: 'morning',
			startedAt: '2026-10-16T09:01:00Z',
			finishedAt: '2026-10-16T09:02:00Z',
		});
		const b = task({
			id: 'b',
			parentId: 'noon',
			startedAt: '2026-10-16T09:06:00Z',
			finishedAt: '2026-10-16T09:07:00Z',
		});

		expect(lanesOf(buildTimeline([morning, noon, a, b], [], now, unfolded(morning, noon)))).toEqual(
			[
				['agent', 0, null],
				['morning+noon', 1, 0],
				['a+b', 2, 1],
			],
		);
	});

	test('each task knows the bar it was handed from, its parent’s or its agent’s, for its lines to join', () => {
		const timeline = buildTimeline([plan, calendar], [], now, unfolded(plan));

		expect(barOf(timeline, 'plan')?.handedFrom).toBe(barOf(timeline, 'agent'));
		expect(barOf(timeline, 'calendar')?.handedFrom).toBe(barOf(timeline, 'plan'));
		const nested = buildTimeline([plan, notes, calendar], [], now, unfolded(plan, calendar));
		expect(barOf(nested, 'notes')?.handedFrom).toBe(barOf(nested, 'calendar'));
		expect(barOf(timeline, 'agent')?.handedFrom).toBeNull();
	});

	test('folded, a task’s sub-tasks take no lanes, and their requests sit on its bar', () => {
		const requests = [
			entry({id: 'own', at: '2026-10-16T09:00:30Z'}),
			entry({id: 'below', taskId: 'notes', at: '2026-10-16T09:02:30Z'}),
		];
		const folded = buildTimeline([plan, calendar, notes, issues], requests, now);

		expect(lanesOf(folded)).toEqual([
			['agent', 0, null],
			['plan', 1, 0],
		]);
		expect(barOf(folded, 'plan')).toMatchObject({folded: true, subTasks: 3});
		expect(barOf(folded, 'plan')?.calls.map((call) => call.entry.id)).toEqual(['own', 'below']);
		// Still waiting on them while they were under way.
		expect(barOf(folded, 'plan')?.waiting).toEqual([{start: 0.1, end: 0.6}]);
	});

	test('unfolded one level, its sub-tasks show, each with their own folded in', () => {
		const timeline = buildTimeline([plan, calendar, notes, issues], [], now, unfolded(plan));

		expect(lanesOf(timeline)).toEqual([
			['agent', 0, null],
			['plan', 1, 0],
			['calendar', 2, 1],
			['issues', 2, 1],
		]);
		expect(barOf(timeline, 'plan')).toMatchObject({folded: false, subTasks: 3});
		expect(barOf(timeline, 'calendar')).toMatchObject({folded: true, subTasks: 1});
		expect(barOf(timeline, 'issues')).toMatchObject({folded: false, subTasks: 0});
	});

	test('every task of one tree is drawn in its top task’s color, the same every time', () => {
		const timeline = buildTimeline(
			[plan, calendar, notes, issues],
			[],
			now,
			unfolded(plan, calendar),
		);

		expect(['calendar', 'notes', 'issues'].map((id) => barOf(timeline, id)?.color)).toEqual([
			colorOf('plan'),
			colorOf('plan'),
			colorOf('plan'),
		]);
		expect(barOf(timeline, 'agent')?.color).toBeNull();
		expect(colorOf('plan')).toBe(colorOf('plan'));
		expect(
			['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
				.map(colorOf)
				.every((color) => color >= 0 && color < TASK_COLORS),
		).toBe(true);
	});

	test('a task whose parent is not in the run is handed from the agent', () => {
		expect(lanesOf(buildTimeline([calendar], [], now))).toEqual([
			['agent', 0, null],
			['calendar', 1, 0],
		]);
	});

	test('places every bar along one axis from when the first task started; the agent waits while tasks are under way', () => {
		const second = task({
			id: 'second',
			startedAt: '2026-10-16T09:07:00Z',
			finishedAt: '2026-10-16T09:10:00Z',
		});
		const timeline = buildTimeline([calendar, second], [], now);

		expect(timeline.spanMs).toBe(9 * 60_000);
		expect(
			[barOf(timeline, 'agent'), barOf(timeline, 'calendar'), barOf(timeline, 'second')].map(
				(bar) => [bar?.start, bar?.end],
			),
		).toEqual([
			[0, 1],
			[0, 1 / 3],
			[2 / 3, 1],
		]);
		expect(barOf(timeline, 'agent')?.waiting).toEqual([
			{start: 0, end: 1 / 3},
			{start: 2 / 3, end: 1},
		]);
	});

	test('a task waits while its sub-tasks are under way, overlapping ones as one stretch', () => {
		const timeline = buildTimeline([plan, calendar, issues], [], now, unfolded(plan));

		expect(barOf(timeline, 'plan')?.waiting).toEqual([{start: 0.1, end: 0.6}]);
		expect(barOf(timeline, 'calendar')?.waiting).toEqual([]);
	});

	test('a request runs from when it came in to when it was logged; one from before durations, a moment', () => {
		const timeline = buildTimeline(
			[plan, calendar],
			[
				entry({at: '2026-10-16T09:01:00Z', durationMs: 6000}),
				entry({id: 'e2', taskId: 'calendar', at: '2026-10-16T09:02:00Z', durationMs: null}),
			],
			now,
			unfolded(plan),
		);

		expect(
			barOf(timeline, 'plan')?.calls.map((call) => [call.entry.id, call.start, call.end]),
		).toEqual([['e1', 0.09, 0.1]]);
		expect(
			barOf(timeline, 'calendar')?.calls.map((call) => [call.entry.id, call.start, call.end]),
		).toEqual([['e2', 0.2, 0.2]]);
	});

	test('the axis ends at the last thing done: a task left open runs on past it, open', () => {
		const open = task({});
		const later = new Date('2026-10-16T15:00:00Z');
		const timeline = buildTimeline([open], [entry({at: '2026-10-16T09:04:00Z'})], later);

		expect(timeline.spanMs).toBe(4 * 60_000);
		expect(barOf(timeline, 'plan')).toMatchObject({
			status: 'running',
			end: 1,
			open: true,
			durationMs: 6 * 60 * 60_000,
			activeMs: 4 * 60_000,
		});

		const abandoned = barOf(buildTimeline([open], [], new Date('2026-10-18T09:00:00Z')), 'plan');
		expect(abandoned).toMatchObject({
			status: 'abandoned',
			open: true,
			durationMs: 24 * 60 * 60_000,
		});
	});

	test('a sub-task finished with its parent, saying nothing, is told apart from one that handed something back', () => {
		const leftOpen = task({
			id: 'left',
			parentId: 'plan',
			startedAt: '2026-10-16T09:02:00Z',
			finishedAt: '2026-10-16T09:10:00Z',
		});
		const timeline = buildTimeline([plan, calendar, leftOpen], [], now, unfolded(plan));

		expect(
			['plan', 'calendar', 'left'].map((id) => barOf(timeline, id)?.finishedWithParent),
		).toEqual([false, false, true]);
	});

	test('a run done in a moment still gets ten seconds of axis', () => {
		const quick = task({finishedAt: '2026-10-16T09:00:02Z'});
		const timeline = buildTimeline([quick], [], now);

		expect(timeline.spanMs).toBe(10_000);
		expect(barOf(timeline, 'plan')?.end).toBe(0.2);
	});
});

describe('buildTimeline over a window', () => {
	// The hour up to ten past ten.
	const window = {from: new Date('2026-10-16T09:10:00Z'), to: new Date('2026-10-16T10:10:00Z')};
	const at = new Date('2026-10-16T10:10:00Z');

	test('every agent’s row over its tasks, those with one under way first, then the latest at work', () => {
		const done = task({
			id: 'done',
			agentId: 'a1',
			startedAt: '2026-10-16T09:20:00Z',
			finishedAt: '2026-10-16T09:40:00Z',
		});
		const recent = task({
			id: 'recent',
			agentId: 'a2',
			startedAt: '2026-10-16T09:50:00Z',
			finishedAt: '2026-10-16T10:00:00Z',
		});
		const working = task({id: 'working', agentId: 'a3', startedAt: '2026-10-16T09:30:00Z'});
		const timeline = buildTimeline([done, recent, working], [], at, {window});

		expect(
			timeline.rows.map((row) => [row.agentId, row.bars[0]?.task?.id ?? 'agent', row.parentRow]),
		).toEqual([
			['a3', 'agent', null],
			['a3', 'working', 0],
			['a2', 'agent', null],
			['a2', 'recent', 2],
			['a1', 'agent', null],
			['a1', 'done', 4],
		]);
		// One under way runs to now, at the right edge.
		expect(barOf(timeline, 'working')).toMatchObject({start: 1 / 3, end: 1, open: false});
	});

	test('a task that ended before the window is left out; one that started before it starts at its edge', () => {
		const before = task({
			id: 'before',
			startedAt: '2026-10-16T08:00:00Z',
			finishedAt: '2026-10-16T09:00:00Z',
		});
		const across = task({
			id: 'across',
			startedAt: '2026-10-16T08:40:00Z',
			finishedAt: '2026-10-16T09:40:00Z',
		});
		const timeline = buildTimeline(
			[before, across],
			[
				entry({id: 'early', taskId: 'across', at: '2026-10-16T09:00:00Z'}),
				entry({id: 'late', taskId: 'across', at: '2026-10-16T09:25:00Z', durationMs: 0}),
			],
			at,
			{window},
		);

		expect(lanesOf(timeline)).toEqual([
			['agent', 0, null],
			['across', 1, 0],
		]);
		expect(barOf(timeline, 'across')).toMatchObject({start: 0, end: 0.5, clipped: true});
		expect(barOf(timeline, 'across')?.calls.map((call) => [call.entry.id, call.start])).toEqual([
			['late', 0.25],
		]);
	});

	test('the axis is marked in time before now, ending at it', () => {
		const timeline = buildTimeline([task({startedAt: '2026-10-16T09:30:00Z'})], [], at, {window});

		expect(timeline.spanMs).toBe(60 * 60_000);
		expect(timeline.ticks.map((tick) => tick.at)).toEqual([0.25, 0.5, 0.75, 1]);
		expect(timeline.ticks.map((tick) => tick.label)).toEqual(['45m', '30m', '15m', 'Now']);
	});
});

describe('buildTimeline over a window scrolled back', () => {
	// The hour up to twenty minutes before ten past ten.
	const window = {from: new Date('2026-10-16T08:50:00Z'), to: new Date('2026-10-16T09:50:00Z')};
	const at = new Date('2026-10-16T10:10:00Z');

	test('leaves out what started after it, runs on past its end what was still going, and marks it before now', () => {
		const later = task({id: 'later', startedAt: '2026-10-16T10:00:00Z'});
		const going = task({
			id: 'going',
			startedAt: '2026-10-16T09:20:00Z',
			finishedAt: '2026-10-16T10:05:00Z',
		});
		const timeline = buildTimeline(
			[later, going],
			[
				entry({id: 'in', taskId: 'going', at: '2026-10-16T09:30:00Z', durationMs: 0}),
				entry({id: 'after', taskId: 'going', at: '2026-10-16T10:00:00Z', durationMs: 0}),
			],
			at,
			{window},
		);

		expect(lanesOf(timeline)).toEqual([
			['agent', 0, null],
			['going', 1, 0],
		]);
		expect(barOf(timeline, 'going')).toMatchObject({start: 0.5, end: 1, open: true});
		expect(barOf(timeline, 'going')?.calls.map((call) => call.entry.id)).toEqual(['in']);
		expect(timeline.ticks.map((tick) => tick.label)).toEqual(['1h 15m', '1h', '45m', '30m']);
	});
});
