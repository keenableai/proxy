// A run: what an agent did in one go, as the person sees it. Agents work through sub-agents, and
// each task is one of them at work, so the tasks of one go are those that overlap or follow one
// another closely; a run is such a stretch of an agent's tasks, and a task's page shows the run it
// is in. A task's sub-tasks are under way while it is, so a run keeps every tree whole.

// Tasks this close after the last one ended are still the same run.
export const RUN_GAP_MS = 5 * 60 * 1000;

// When a task was last at work: when it was finished, or, while it isn't, its last request, or
// when it started. One left open isn't at work just for being open.
export type RunTask = {id: string; startedAt: Date; activeUntil: Date};

/** The ids of the tasks in the run `taskId` is in, in the order started; none where it isn't among `tasks`. */
export function runAround(tasks: RunTask[], taskId: string, gapMs = RUN_GAP_MS): string[] {
	const runs: Array<{ids: string[]; until: number}> = [];
	for (const task of [...tasks].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())) {
		const last = runs.at(-1);
		const until = Math.max(task.activeUntil.getTime(), task.startedAt.getTime());
		if (last && task.startedAt.getTime() <= last.until + gapMs) {
			last.ids.push(task.id);
			last.until = Math.max(last.until, until);
			continue;
		}
		runs.push({ids: [task.id], until});
	}
	return runs.find((run) => run.ids.includes(taskId))?.ids ?? [];
}
