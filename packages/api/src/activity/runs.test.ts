import {describe, expect, test} from 'bun:test';

import {runAround} from './runs';

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 16, 9, minutes));

function task(id: string, from: number, until: number) {
	return {id, startedAt: at(from), activeUntil: at(until)};
}

describe('runAround', () => {
	test('tasks that overlap, or follow within five minutes, are one run, in the order started', () => {
		const tasks = [task('c', 12, 20), task('a', 0, 10), task('b', 5, 8), task('d', 26, 30)];

		expect(runAround(tasks, 'a')).toEqual(['a', 'b', 'c']);
		expect(runAround(tasks, 'c')).toEqual(['a', 'b', 'c']);
		expect(runAround(tasks, 'd')).toEqual(['d']);
	});

	test('a long task keeps the run going past the ones that end before it', () => {
		const tasks = [task('long', 0, 40), task('short', 1, 2), task('late', 30, 31)];

		expect(runAround(tasks, 'late')).toEqual(['long', 'short', 'late']);
	});

	test('a task the agent has none of is in no run', () => {
		expect(runAround([task('a', 0, 1)], 'z')).toEqual([]);
	});
});
