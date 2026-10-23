import {Fragment, useId} from 'react';
import {Link} from 'react-router';
import {AgentLogo} from '@/components/brand-logo';
import {
	AxisLabels,
	HatchDefs,
	Key,
	Legend,
	Marker,
	Pulse,
	RequestMarks,
	RequestTargets,
	TaskNames,
	TaskTooltip,
	Track,
	TrackSwatch,
} from '@/components/timeline-chart';
import {useChartWidth} from '@/hooks/use-chart-width';
import {useOrgSlug} from '@/hooks/use-org';
import {
	type ActivityBar,
	type ActivityRow,
	buildActivityTimeline,
	type Window,
} from '@/lib/activity-timeline';
import {
	AGENT_COLOR_CLASSES,
	ABANDONED_OPACITY,
	colorOf,
	formatDuration,
	MIN_TRACK_PX,
	requestSummary,
} from '@/lib/timeline';
import {STATUS_LABEL} from '@/lib/timeline-window';
import type {ActivityTask, AgentLogin, AuditEntry, Connection} from '@/lib/types';
import {Tooltip, TooltipContent, TooltipTrigger} from '@proxy/ui/components/tooltip';
import {cn} from '@proxy/ui/lib/utils';

// A lane's height and its bar's, and the room above and below an agent's lanes, in pixels. The
// requests run along the bottom of a bar, under its name.
const LANE_H = 26;
const BAR_H = 20;
const ROW_PAD = 6;
const REQUEST_H = 4;
const REQUEST_INSET = 2;

// A bar at least this wide carries its task's name.
const MIN_NAMED_PX = 56;

const LABEL = 'w-44 shrink-0 md:w-56';

type Props = {
	tasks: ActivityTask[];
	entries: AuditEntry[];
	// When the answer was read: where a task under way has got to.
	now: string;
	window: Window;
	agents: AgentLogin[];
	connections: Connection[];
	onOpenEntry: (entry: AuditEntry) => void;
	// Zoom the window in on a stretch of time, in milliseconds since the epoch.
	onZoom: (from: number, to: number) => void;
};

// Who is doing what (the layout in lib/activity-timeline.ts): every agent's row over a window of
// time, a bar for every task it was given, named where there is room, the requests made for it
// along the bar's bottom as long as each took, blocked or failed ones marked. Tasks under way at
// once each take a lane of the row; short ones close together are one bar, which zooms in on them.
// A bar says more on hover and opens the task's page; a request opens in full; an agent's name
// opens the agent's page.
export function ActivityTimeline({
	tasks,
	entries,
	now,
	window,
	agents,
	connections,
	onOpenEntry,
	onZoom,
}: Props) {
	const [measure, width] = useChartWidth();
	const hatch = useId();
	const timeline = buildActivityTimeline(tasks, entries, new Date(now), window, width);
	const titleOf = (taskId: string | null) =>
		tasks.find((candidate) => candidate.id === taskId)?.title ?? null;
	const heightOf = (row: ActivityRow) => row.lanes.length * LANE_H + 2 * ROW_PAD;
	const tops = timeline.rows.reduce<number[]>(
		(acc, row) => [...acc, (acc[acc.length - 1] ?? 0) + heightOf(row)],
		[0],
	);
	const height = tops[tops.length - 1] ?? 0;
	const barTop = (rowIndex: number, lane: number) =>
		(tops[rowIndex] ?? 0) + ROW_PAD + lane * LANE_H + (LANE_H - BAR_H) / 2;
	const nowAt = timeline.ticks.find((tick) => tick.label === 'Now');

	return (
		<div className="flex flex-col gap-3 text-sm">
			<div className="flex overflow-hidden rounded-lg border">
				<div className={cn(LABEL, 'min-w-0 border-r bg-muted/40')}>
					{timeline.rows.map((row, index) => (
						<AgentLabel
							key={row.agentId}
							row={row}
							agent={agents.find((candidate) => candidate.id === row.agentId)}
							height={heightOf(row)}
							last={index === timeline.rows.length - 1}
						/>
					))}
					<div className="h-7" />
				</div>
				<div className="min-w-0 flex-1 px-4">
					<div ref={measure} className="relative" style={{height}}>
						<svg width={width} height={height} className="absolute inset-0 block overflow-hidden">
							<HatchDefs id={hatch} />
							{timeline.ticks.map((tick) => (
								<line
									key={tick.px}
									x1={tick.px}
									x2={tick.px}
									y1={0}
									y2={height}
									className={tick === nowAt ? 'stroke-foreground/40' : 'stroke-border/70'}
								/>
							))}
							{timeline.rows.slice(0, -1).map((row, index) => (
								<line
									key={row.agentId}
									x1={0}
									x2={width}
									y1={tops[index + 1]}
									y2={tops[index + 1]}
									className="stroke-border/70"
								/>
							))}
							{timeline.rows.map((row, rowIndex) => (
								<g key={row.agentId} className={AGENT_COLOR_CLASSES[colorOf(row.agentId)]}>
									{row.lanes.map((lane, laneIndex) =>
										lane.map((bar) => (
											<Fragment key={keyOf(bar)}>
												<Track
													span={bar}
													y={barTop(rowIndex, laneIndex)}
													height={BAR_H}
													clippedStart={bar.clippedStart}
													clippedEnd={bar.clippedEnd}
													opacity={bar.status === 'abandoned' ? ABANDONED_OPACITY : undefined}
													dashed={bar.status === 'abandoned'}
												/>
												<RequestMarks
													requests={bar.requests}
													y={barTop(rowIndex, laneIndex) + BAR_H - REQUEST_INSET - REQUEST_H}
													height={REQUEST_H}
												/>
												{bar.status === 'running' && !bar.clippedEnd && (
													<Pulse x={bar.end} y={barTop(rowIndex, laneIndex) + BAR_H / 2} />
												)}
											</Fragment>
										)),
									)}
								</g>
							))}
						</svg>
						<div className="absolute inset-0">
							{timeline.rows.map((row, rowIndex) =>
								row.lanes.map((lane, laneIndex) =>
									lane.map((bar) => (
										<Fragment key={keyOf(bar)}>
											{(bar.tasks.length > 1 || bar.end - bar.start >= MIN_NAMED_PX) && (
												<span
													aria-hidden
													className="pointer-events-none absolute truncate text-[11px] leading-3 text-foreground/90"
													style={{
														left: bar.start + 6,
														top: barTop(rowIndex, laneIndex) + 2,
														width: bar.end - bar.start - 12,
													}}
												>
													{bar.tasks.length > 1 ? `${bar.tasks.length} tasks` : bar.tasks[0]?.title}
												</span>
											)}
											<BarTarget bar={bar} top={barTop(rowIndex, laneIndex)} onZoom={onZoom} />
											<RequestTargets
												requests={bar.requests}
												top={barTop(rowIndex, laneIndex)}
												height={BAR_H}
												connections={connections}
												forTask={(entry) =>
													bar.tasks.length === 1 && entry.taskId === bar.tasks[0]?.id
														? null
														: titleOf(entry.taskId)
												}
												onOpen={onOpenEntry}
											/>
										</Fragment>
									)),
								),
							)}
						</div>
					</div>
					<AxisLabels ticks={timeline.ticks} width={width} />
				</div>
			</div>
			<Legend>
				<Key swatch={<TrackSwatch />}>Task</Key>
				<Key swatch={<TrackSwatch requests />}>Requests</Key>
				<Key swatch={<TrackSwatch running />}>Under way</Key>
				<Key swatch={<TrackSwatch abandoned />}>Given up</Key>
				<Key swatch={<Marker blocked className="relative" />}>Blocked</Key>
				<Key swatch={<Marker blocked={false} className="relative" />}>Failed</Key>
			</Legend>
		</div>
	);
}

// A bar's key: a bar of several tasks is never the same element as the bar of its first task
// alone, which it turns into on zooming in, as the tooltip's listeners stay with the element.
function keyOf(bar: ActivityBar): string {
	const id = bar.tasks[0]?.id ?? '';
	return bar.tasks.length > 1 ? `cluster:${id}` : id;
}

// An agent's row is named by the agent, opening its page, with how many tasks it has under way,
// or had in the window; one deleted since has an empty tile.
function AgentLabel({
	row,
	agent,
	height,
	last,
}: {
	row: ActivityRow;
	agent: AgentLogin | undefined;
	height: number;
	last: boolean;
}) {
	const org = useOrgSlug();
	const count = row.lanes.flat().reduce((total, bar) => total + bar.tasks.length, 0);
	const aside = (
		<span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground tabular-nums">
			{row.working > 0 ? `${row.working} under way` : `${count} ${count === 1 ? 'task' : 'tasks'}`}
		</span>
	);
	const className = cn('flex items-center gap-2 pr-3 pl-3', !last && 'border-b');
	if (!agent) {
		return (
			<div className={className} style={{height}}>
				<span className="size-5 shrink-0 rounded-md border border-dashed" />
				<span className="truncate font-medium">Deleted agent</span>
				{aside}
			</div>
		);
	}
	return (
		<Link
			to={`/${org}/agents/${encodeURIComponent(agent.id)}`}
			className={cn(className, 'hover:bg-muted')}
			style={{height}}
		>
			<AgentLogo providerId={agent.providerId} />
			<span className="truncate font-medium">{agent.name}</span>
			{aside}
		</Link>
	);
}

// The target over a bar: a task's opens its page, and says on hover what it was for and how it
// went; one of several tasks zooms the window in on them, and says on hover which they are.
function BarTarget({
	bar,
	top,
	onZoom,
}: {
	bar: ActivityBar;
	top: number;
	onZoom: (from: number, to: number) => void;
}) {
	const org = useOrgSlug();
	const [task] = bar.tasks;
	const style = {
		left: bar.start,
		width: Math.max(bar.end - bar.start, MIN_TRACK_PX),
		top,
		height: BAR_H,
	};
	const className =
		'absolute rounded-md hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-ring';
	if (!task) {
		return null;
	}
	if (bar.tasks.length > 1) {
		return (
			<Tooltip disableHoverablePopup>
				<TooltipTrigger
					render={
						<button
							type="button"
							onClick={() => onZoom(bar.fromMs, bar.toMs)}
							aria-label={`Zoom in on ${bar.tasks.length} tasks`}
							className={cn(className, 'cursor-zoom-in')}
							style={style}
						/>
					}
				/>
				<TooltipContent className="pointer-events-none max-w-xs">
					<span className="flex flex-col gap-1">
						<span className="font-medium">{bar.tasks.length} tasks close together</span>
						<span className="opacity-80">
							{[
								`${STATUS_LABEL[bar.status]} · ${formatDuration(bar.durationMs)}`,
								...requestSummary(bar.requests),
							].join(' · ')}
						</span>
						<TaskNames tasks={bar.tasks} />
						<span>Click to zoom in on them</span>
					</span>
				</TooltipContent>
			</Tooltip>
		);
	}
	return (
		<Tooltip disableHoverablePopup>
			<TooltipTrigger
				render={
					<Link
						to={`/${org}/activity/tasks/${encodeURIComponent(task.id)}`}
						preventScrollReset
						aria-label={task.title}
						className={className}
						style={style}
					/>
				}
			/>
			<TooltipContent className="pointer-events-none max-w-xs">
				<TaskTooltip
					task={task}
					status={bar.status}
					durationMs={bar.durationMs}
					requests={bar.requests}
					subTasks={bar.subTasks}
				/>
			</TooltipContent>
		</Tooltip>
	);
}
