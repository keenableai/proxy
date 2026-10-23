import {useEffect, useState} from 'react';
import {useLoaderData, useRevalidator} from 'react-router';
import {AppShell, PageTitle} from '@/components/app-shell';
import {AuditEntryDialog} from '@/components/audit-entry-dialog';
import {AuditList} from '@/components/audit-list';
import {BackButton} from '@/components/back-button';
import {AgentLogo} from '@/components/brand-logo';
import {NotFound} from '@/components/not-found';
import {RunTimeline} from '@/components/run-timeline';
import {useOrgSlug} from '@/hooks/use-org';
import {endedAt, STATUS_LABEL, taskStatus} from '@/lib/timeline-window';
import {counted, formatDateTime} from '@/lib/format';
import {formatDuration} from '@/lib/timeline';
import type {AuditEntry} from '@/lib/types';
import type {taskLoader} from '@/loaders';
import {Badge} from '@proxy/ui/components/badge';

// How often a run with a task under way is read again, so its timeline moves along as the agent
// works.
const REFRESH_MS = 5 * 1000;

// One task of an agent's, in the run of its tasks it is in: what the task set out to do and how it
// went, then the run's timeline, every task of the run under the one it was handed from, and
// every request made for any of them, as the activity log lists them. Agents work through
// sub-agents, so a task is one of them at work, and the run is what the agent did in one go. Read
// again every few seconds while a task of the run is under way.
export function TaskPage() {
	const org = useOrgSlug();
	const {run, agents, connections} = useLoaderData<typeof taskLoader>();
	const revalidator = useRevalidator();
	const [opened, setOpened] = useState<AuditEntry | null>(null);
	const task = run?.tasks.find((candidate) => candidate.id === run.task);
	const running =
		run?.tasks.some((candidate) => taskStatus(candidate, new Date(run.now)) === 'running') ?? false;

	useEffect(() => {
		if (!running) {
			return;
		}
		const timer = setInterval(() => {
			if (document.visibilityState === 'visible') {
				void revalidator.revalidate();
			}
		}, REFRESH_MS);
		return () => clearInterval(timer);
	}, [running, revalidator]);

	if (!run || !task) {
		return <NotFound what="task" back={`/${org}/activity`} backLabel="Back to activity" />;
	}

	const now = new Date(run.now);
	const status = taskStatus(task, now);
	const agent = agents.find((candidate) => candidate.id === run.agentId);
	const own = run.entries.filter((entry) => entry.taskId === task.id);
	const ended = endedAt(task, now) ?? now;
	const summary = [
		formatDuration(ended.getTime() - new Date(task.startedAt).getTime()),
		counted(own.length, 'request'),
		...countOutcomes(own),
	];
	const runSummary = [
		counted(run.tasks.length, 'task'),
		counted(run.entries.length, 'request'),
		...countOutcomes(run.entries),
	];

	return (
		<AppShell
			title={
				<>
					<BackButton
						to={`/${org}/activity?task=${encodeURIComponent(task.id)}`}
						label="Back to activity"
					/>
					<PageTitle>{task.title}</PageTitle>
				</>
			}
		>
			<div className="flex flex-col gap-1.5 text-sm">
				<div className="flex flex-wrap items-center gap-2">
					<h1 className="text-base font-medium">{task.title}</h1>
					<Badge variant={status === 'running' ? 'outline' : 'secondary'}>
						{STATUS_LABEL[status]}
					</Badge>
				</div>
				<p className="text-muted-foreground">{task.goal}</p>
				<p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
					<span>Started {formatDateTime(task.startedAt)}</span>
					{summary.map((part) => (
						<span key={part} className="contents">
							<span aria-hidden>·</span>
							<span>{part}</span>
						</span>
					))}
				</p>
				{task.outcome && (
					<p>
						<span className="text-muted-foreground">Handed back: </span>
						{task.outcome}
					</p>
				)}
			</div>
			<div className="flex flex-col gap-2">
				<p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
					{agent && (
						<span className="inline-flex items-center gap-1.5 text-foreground">
							<AgentLogo providerId={agent.providerId} />
							{agent.name}
						</span>
					)}
					{!agent && <span className="text-foreground">Deleted agent</span>}
					<span>in one go, from {formatDateTime(run.tasks[0]?.startedAt ?? task.startedAt)}</span>
					{runSummary.map((part) => (
						<span key={part} className="contents">
							<span aria-hidden>·</span>
							<span>{part}</span>
						</span>
					))}
				</p>
				<RunTimeline
					tasks={run.tasks}
					entries={run.entries}
					now={run.now}
					agentId={run.agentId}
					focus={task.id}
					connections={connections}
					onOpenEntry={setOpened}
				/>
			</div>
			<AuditList
				entries={[...run.entries].reverse()}
				agents={agents}
				connections={connections}
				tasks={run.tasks}
				showAgent={false}
			/>
			<AuditEntryDialog
				entry={opened}
				agents={agents}
				connections={connections}
				tasks={run.tasks}
				onClose={() => setOpened(null)}
			/>
		</AppShell>
	);
}

// "2 blocked", "1 failed": what didn't go through, where anything didn't.
function countOutcomes(entries: AuditEntry[]): string[] {
	const blocked = entries.filter((entry) => entry.outcome === 'denied').length;
	const failed = entries.filter((entry) => entry.outcome === 'failed').length;
	return [
		...(blocked > 0 ? [`${blocked} blocked`] : []),
		...(failed > 0 ? [`${failed} failed`] : []),
	];
}
