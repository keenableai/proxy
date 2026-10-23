import {describe, expect, test} from 'bun:test';
import type {ActivityTask} from '@/lib/types';
import {gridlines, presetOf, taskStatus, windowLabel, windowStart, zoomed} from './timeline-window';

const now = new Date('2026-10-16T12:00:00Z');
const from = new Date('2026-10-16T11:00:00Z');

function task(overrides: Partial<ActivityTask>): ActivityTask {
	return {
		id: 't1',
		agentId: 'a1',
		title: 'Triage inbox',
		goal: 'Archive the newsletters',
		via: 'mcp',
		startedAt: '2026-10-16T11:30:00Z',
		finishedAt: null,
		parentId: null,
		outcome: null,
		...overrides,
	};
}

describe('taskStatus', () => {
	test('a task is running until it is finished, or a day after it started, abandoned', () => {
		expect(taskStatus(task({}), now)).toBe('running');
		expect(taskStatus(task({finishedAt: '2026-10-16T11:58:00Z'}), now)).toBe('finished');
		expect(taskStatus(task({startedAt: '2026-10-15T12:00:01Z'}), now)).toBe('running');
		expect(taskStatus(task({startedAt: '2026-10-15T12:00:00Z'}), now)).toBe('abandoned');
	});
});

describe('the window', () => {
	test('starts its length before now', () => {
		expect(windowStart(60, now)).toEqual(from);
	});

	test('is marked off in its own step on offer, else the largest that leaves a few stretches', () => {
		expect(gridlines(60)).toEqual([
			{at: 0.25, ago: 45},
			{at: 0.5, ago: 30},
			{at: 0.75, ago: 15},
			{at: 1, ago: 0},
		]);
		expect(gridlines(6 * 60)).toHaveLength(6);
		expect(gridlines(24 * 60)).toHaveLength(8);
		expect(gridlines(135)).toHaveLength(9);
		expect(gridlines(25 * 60)).toHaveLength(9);
	});

	test('scrolled back, keeps its lines a whole number of steps before now', () => {
		expect(gridlines(60, 20)).toEqual([
			{at: 1 - 55 / 60, ago: 75},
			{at: 1 - 40 / 60, ago: 60},
			{at: 1 - 25 / 60, ago: 45},
			{at: 1 - 10 / 60, ago: 30},
		]);
	});

	test('never takes a step longer than half the window, however little room there is', () => {
		// Six days over room for six labels: a day apart would be one too many, a week too long.
		expect(gridlines(6 * 24 * 60 + 11, 0, 6).map((line) => line.ago)).toEqual([
			6 * 24 * 60,
			4 * 24 * 60,
			2 * 24 * 60,
			0,
		]);
		expect(gridlines(100, 0, 2).map((line) => line.ago)).toEqual([90, 60, 30, 0]);
	});

	test('takes a longer step where its own would give more lines than there is room to label', () => {
		expect(gridlines(60, 0, 2).map((line) => line.ago)).toEqual([30, 0]);
		expect(gridlines(24 * 60, 0, 4).map((line) => line.ago)).toEqual([18 * 60, 12 * 60, 6 * 60, 0]);
		// Room enough: its own step.
		expect(gridlines(60, 0, 10)).toHaveLength(4);
	});

	test('zooms by the wheel, out for down and in for up, within its bounds', () => {
		expect(zoomed(360, 200)).toBeGreaterThan(360);
		expect(zoomed(360, -200)).toBeLessThan(360);
		expect(zoomed(20, -5000)).toBe(15);
		expect(zoomed(20000, 5000)).toBe(31 * 24 * 60);
	});

	test('is one on offer at its lengths, and named by its length otherwise', () => {
		expect(presetOf(360)).toBe('6h');
		expect(presetOf(135)).toBeNull();
		expect(windowLabel(360)).toBe('Last 6 hours');
		expect(windowLabel(135)).toBe('Last 2h 15m');
		expect(windowLabel(45)).toBe('Last 45m');
		expect(windowLabel(3 * 24 * 60)).toBe('Last 3d');
		// Scrolled back from now, it isn't the last anything.
		expect(windowLabel(360, false)).toBe('6 hours');
		expect(windowLabel(135, false)).toBe('2h 15m');
	});
});
