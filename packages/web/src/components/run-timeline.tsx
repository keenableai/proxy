import {ChevronDownIcon, ChevronRightIcon, CornerDownRightIcon} from 'lucide-react';
import {Fragment, useId, useState} from 'react';
import {Link, useLocation} from 'react-router';
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
import {formatTime} from '@/lib/format';
import {
	BREAK_PX,
	buildRunTimeline,
	defaultExpanded,
	type RunBreak,
	type RunRow,
	type RunTimeline as RunLayout,
} from '@/lib/run-timeline';
import {
	AGENT_COLOR_CLASSES,
	ABANDONED_OPACITY,
	colorOf,
	formatDuration,
	MIN_TRACK_PX,
	requestSummary,
	roughDuration,
} from '@/lib/timeline';
import {STATUS_LABEL} from '@/lib/timeline-window';
import type {ActivityTask, AuditEntry, Connection} from '@/lib/types';
import {Tooltip, TooltipContent, TooltipTrigger} from '@proxy/ui/components/tooltip';
import {cn} from '@proxy/ui/lib/utils';

// A row's height and its track's, in pixels; the lines between rows are placed by them.
const ROW_H = 30;
const TRACK_H = 14;
const TRACK_TOP = (ROW_H - TRACK_H) / 2;

// How far a line between rows runs beside a track before it turns into it: its corner's radius.
const ELBOW = 8;

const LABEL = 'w-44 shrink-0 md:w-64';

type Props = {
	tasks: ActivityTask[];
	entries: AuditEntry[];
	// When the answer was read: where a task under way has got to.
	now: string;
	agentId: string;
	// The task the page is about, which stands out.
	focus: string;
	connections: Connection[];
	onOpenEntry: (entry: AuditEntry) => void;
};

// A run, what an agent did in one go (the layout in lib/run-timeline.ts): every task in a row
// under the task it was handed from, along one axis from when the first started to the last thing
// done, its idle stretches folded away. A track runs as long as its task did, the requests made
// for it solid on it, hatched where it waited on what it handed on; a line goes down from a task
// where it handed one on and back up where that one was finished, standing out for the row under
// the pointer. A task's sub-tasks are laid out under it or rolled into it by its chevron, and
// short tasks one after another sit in one row until theirs is opened. Every mark says more on
// hover; a request opens in full, a task's name opens its page.
export function RunTimeline({
	tasks,
	entries,
	now,
	agentId,
	focus,
	connections,
	onOpenEntry,
}: Props) {
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(() =>
		defaultExpanded(tasks, focus),
	);
	const [active, setActive] = useState<string | null>(null);
	const [measure, width] = useChartWidth();
	const hatch = useId();
	const timeline = buildRunTimeline(tasks, entries, new Date(now), width, {expanded, focus});
	const titleOf = (taskId: string | null) =>
		tasks.find((candidate) => candidate.id === taskId)?.title ?? null;
	const toggle = (row: RunRow) =>
		setExpanded((current) => {
			const next = new Set(current);
			if (next.has(row.id)) {
				next.delete(row.id);
				// Folding a task folds the groups under it back together too.
				for (const id of current) {
					if (
						id.startsWith('group:') &&
						rowsUnder(timeline, row).some((under) => under.id === id)
					) {
						next.delete(id);
					}
				}
				return next;
			}
			next.add(row.id);
			return next;
		});
	const isOpen = (row: RunRow, index: number) =>
		row.kind === 'task' && timeline.rows.some((candidate) => candidate.parentRow === index);
	const isActive = (row: RunRow) =>
		row.id === active ||
		row.id === focus ||
		(row.parentRow !== null && timeline.rows[row.parentRow]?.id === active);
	const height = Math.max(timeline.rows.length, 1) * ROW_H;

	return (
		<div className="flex flex-col gap-3 text-sm">
			<div className="flex overflow-hidden rounded-lg border">
				<div className={cn(LABEL, 'min-w-0 border-r bg-muted/40')}>
					{timeline.rows.map((row, index) => (
						<RowLabel
							key={row.id}
							row={row}
							open={isOpen(row, index)}
							focused={row.id === focus}
							active={isActive(row)}
							onToggle={() => toggle(row)}
							onHover={(over) => setActive(over ? row.id : null)}
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
									className="stroke-border/70"
								/>
							))}
							{timeline.breaks.map((gap) => (
								<Fragment key={gap.start}>
									<rect
										x={gap.start}
										y={0}
										width={gap.end - gap.start}
										height={height}
										className="fill-muted-foreground/8"
									/>
									<rect
										x={gap.start}
										y={0}
										width={gap.end - gap.start}
										height={height}
										fill={`url(#${hatch})`}
										opacity={0.4}
									/>
								</Fragment>
							))}
							{timeline.rows.map((row, index) => (
								<g
									key={row.id}
									className={AGENT_COLOR_CLASSES[colorOf(agentId)]}
									transform={`translate(0 ${index * ROW_H})`}
								>
									{isActive(row) && (
										<rect x={0} y={0} width={width} height={ROW_H} className="fill-foreground/4" />
									)}
									{row.kind === 'group' && (
										<Track
											span={row}
											y={TRACK_TOP}
											height={TRACK_H}
											opacity={row.status === 'abandoned' ? ABANDONED_OPACITY / 2 : 0.08}
										/>
									)}
									{row.members.map((member) => (
										<Track
											key={member.start}
											span={member}
											y={TRACK_TOP}
											height={TRACK_H}
											clippedEnd={row.status === 'running' && member.end >= width - 1}
											opacity={row.status === 'abandoned' ? ABANDONED_OPACITY : undefined}
											dashed={row.status === 'abandoned'}
										/>
									))}
									<RequestMarks requests={row.requests} y={TRACK_TOP} height={TRACK_H} />
									{row.waiting.map((stretch) => (
										<rect
											key={stretch.start}
											x={stretch.start}
											y={TRACK_TOP}
											width={stretch.end - stretch.start}
											height={TRACK_H}
											rx={2}
											fill={`url(#${hatch})`}
										/>
									))}
									{row.status === 'running' && (
										<Pulse x={Math.min(row.end, width - 4)} y={ROW_H / 2} />
									)}
								</g>
							))}
							<Handoffs timeline={timeline} isActive={isActive} />
						</svg>
						<div className="absolute inset-0">
							{timeline.breaks.map((gap) => (
								<BreakTarget key={gap.start} gap={gap} height={height} />
							))}
							{timeline.rows.map((row, index) => (
								<Fragment key={row.id}>
									<RowTarget
										row={row}
										top={index * ROW_H + TRACK_TOP}
										onToggle={() => toggle(row)}
										onHover={(over) => setActive(over ? row.id : null)}
									/>
									<RequestTargets
										requests={row.requests}
										top={index * ROW_H + TRACK_TOP}
										height={TRACK_H}
										connections={connections}
										forTask={(entry) =>
											row.kind === 'task' && entry.taskId === row.id ? null : titleOf(entry.taskId)
										}
										onOpen={onOpenEntry}
									/>
								</Fragment>
							))}
							<HandoffTargets timeline={timeline} onHover={setActive} />
						</div>
					</div>
					<AxisLabels ticks={timeline.ticks} width={width}>
						{timeline.breaks.map((gap) => (
							<span
								key={gap.start}
								className={cn(
									'absolute top-1.5 whitespace-nowrap italic',
									(gap.start + gap.end) / 2 < width - 32 ? '-translate-x-1/2' : '-translate-x-full',
								)}
								style={{
									left: (gap.start + gap.end) / 2 < width - 32 ? (gap.start + gap.end) / 2 : width,
								}}
							>
								{roughDuration(gap.idleMs)} idle
							</span>
						))}
					</AxisLabels>
				</div>
			</div>
			<Legend>
				<Key swatch={<TrackSwatch />}>Task</Key>
				<Key swatch={<TrackSwatch requests />}>Requests</Key>
				<Key swatch={<TrackSwatch hatched />}>Waiting on sub-tasks</Key>
				<Key swatch={<TrackSwatch running />}>Under way</Key>
				<Key swatch={<TrackSwatch abandoned />}>Given up</Key>
				<Key swatch={<span className="size-2 rounded-full bg-foreground/60" />}>Handed on</Key>
				<Key swatch={<span className="size-2 rounded-full border-[1.5px] border-foreground/60" />}>
					Handed back
				</Key>
				{timeline.breaks.length > 0 && (
					<Key
						swatch={
							<span
								className="h-2.5 rounded-sm bg-muted-foreground/15"
								style={{width: BREAK_PX / 2}}
							/>
						}
					>
						Idle
					</Key>
				)}
				<Key swatch={<Marker blocked className="relative" />}>Blocked</Key>
				<Key swatch={<Marker blocked={false} className="relative" />}>Failed</Key>
			</Legend>
		</div>
	);
}

// Every row laid out under a row, at any depth.
function rowsUnder(timeline: RunLayout, row: RunRow): RunRow[] {
	const index = timeline.rows.indexOf(row);
	const direct = timeline.rows.filter((candidate) => candidate.parentRow === index);
	return direct.flatMap((child) => [child, ...rowsUnder(timeline, child)]);
}

// A row's name: its task's, opening the task's page, indented under what it was handed from, with
// how long it took; a group's, how many tasks it holds. Where a task handed any on, a chevron lays
// them out under it or rolls them back in; a group's lays its tasks out.
function RowLabel({
	row,
	open,
	focused,
	active,
	onToggle,
	onHover,
}: {
	row: RunRow;
	open: boolean;
	focused: boolean;
	active: boolean;
	onToggle: () => void;
	onHover: (over: boolean) => void;
}) {
	const org = useOrgSlug();
	const {state} = useLocation();
	const [task] = row.tasks;
	const foldable = row.kind === 'group' || row.rolledIn > 0 || open;
	const chevronLabel =
		row.kind === 'group'
			? `Show the ${row.tasks.length} tasks`
			: `${open ? 'Hide' : 'Show'} the ${row.rolledIn === 1 ? 'sub-task' : `${row.rolledIn} sub-tasks`}`;
	const aside = (
		<span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground tabular-nums">
			{formatDuration(row.durationMs)}
		</span>
	);
	return (
		<div
			className={cn(
				'flex items-center',
				focused && 'bg-muted font-medium',
				!focused && active && 'bg-muted/70',
			)}
			style={{height: ROW_H, paddingLeft: 8 + row.depth * 14}}
			onMouseEnter={() => onHover(true)}
			onMouseLeave={() => onHover(false)}
		>
			{foldable && (
				<button
					type="button"
					onClick={onToggle}
					aria-expanded={open}
					aria-label={chevronLabel}
					className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
				>
					{open ? (
						<ChevronDownIcon className="size-3.5" />
					) : (
						<ChevronRightIcon className="size-3.5" />
					)}
				</button>
			)}
			{!foldable && (
				<span className="flex size-5 shrink-0 items-center justify-center">
					{row.depth > 0 && <CornerDownRightIcon className="size-3.5 text-muted-foreground" />}
				</span>
			)}
			{row.kind === 'group' && (
				<button
					type="button"
					onClick={onToggle}
					className="flex h-full min-w-0 flex-1 cursor-pointer items-center pr-3 pl-1 text-left text-muted-foreground hover:text-foreground"
				>
					<span className="truncate">{row.tasks.length} tasks</span>
					{aside}
				</button>
			)}
			{row.kind === 'task' && task && (
				<Link
					to={`/${org}/activity/tasks/${encodeURIComponent(task.id)}`}
					state={state}
					preventScrollReset
					aria-current={focused ? 'page' : undefined}
					className="flex h-full min-w-0 flex-1 items-center pr-3 pl-1 hover:text-foreground"
				>
					<span className="truncate">{task.title}</span>
					{aside}
				</Link>
			)}
		</div>
	);
}

// The target over a row's track: a task's opens its page and says on hover what it was for and
// how it went; a group's lays its tasks out, and says on hover which they are.
function RowTarget({
	row,
	top,
	onToggle,
	onHover,
}: {
	row: RunRow;
	top: number;
	onToggle: () => void;
	onHover: (over: boolean) => void;
}) {
	const org = useOrgSlug();
	const {state} = useLocation();
	const [task] = row.tasks;
	const style = {
		left: row.start,
		width: Math.max(row.end - row.start, MIN_TRACK_PX),
		top,
		height: TRACK_H,
	};
	const className = 'absolute rounded-md focus-visible:outline-2 focus-visible:outline-ring';
	if (row.kind === 'group' || !task) {
		return (
			<Tooltip disableHoverablePopup>
				<TooltipTrigger
					render={
						<button
							type="button"
							onClick={onToggle}
							aria-label={`Show the ${row.tasks.length} tasks`}
							className={cn(className, 'cursor-pointer')}
							style={style}
							onMouseEnter={() => onHover(true)}
							onMouseLeave={() => onHover(false)}
						/>
					}
				/>
				<TooltipContent className="pointer-events-none max-w-xs">
					<span className="flex flex-col gap-1">
						<span className="font-medium">
							{row.tasks.length} tasks handed on one after another
						</span>
						<span className="opacity-80">
							{[
								`${STATUS_LABEL[row.status]} · ${formatDuration(row.durationMs)}`,
								...requestSummary(row.requests),
							].join(' · ')}
						</span>
						<TaskNames tasks={row.tasks} />
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
						state={state}
						preventScrollReset
						aria-label={task.title}
						className={className}
						style={style}
						onMouseEnter={() => onHover(true)}
						onMouseLeave={() => onHover(false)}
					/>
				}
			/>
			<TooltipContent className="pointer-events-none max-w-xs">
				<TaskTooltip
					task={task}
					status={row.status}
					durationMs={row.durationMs}
					requests={row.requests}
					subTasks={row.rolledIn}
				/>
			</TooltipContent>
		</Tooltip>
	);
}

// Where a row's lines meet the track it was handed from: the dot where it was handed on, at the
// bottom edge of that track, a little before the row's start, and the ring where it was handed
// back, a little after its end, each kept on the parent's track; the lines turn into the row's
// track with corners of the radius each has room for.
function handoffOf(timeline: RunLayout, index: number) {
	const row = timeline.rows[index];
	const parent = row?.parentRow === null ? undefined : timeline.rows[row?.parentRow ?? -1];
	if (!row || !parent || row.parentRow === null) {
		return null;
	}
	const clamp = (x: number) =>
		Math.min(Math.max(x, parent.start), Math.max(parent.end, parent.start));
	const from = row.parentRow * ROW_H + ROW_H / 2 + TRACK_H / 2;
	const mid = index * ROW_H + ROW_H / 2;
	const xDown = clamp(row.start - ELBOW);
	const xUp = clamp(row.end + ELBOW);
	return {
		row,
		from,
		mid,
		xDown,
		rDown: Math.min(ELBOW, Math.max(row.start - xDown, 0), mid - from),
		xUp,
		rUp: Math.min(ELBOW, Math.max(xUp - row.end, 0), mid - from),
	};
}

// Where a task handed one on: a dot on the bottom edge of its track, and a line down that turns
// into the start of the task's; where that task was finished by its agent, a line out of its end
// that turns back up to a ring on the track it was handed from. Each line is faint until its row,
// or the row it hangs from, is under the pointer.
function Handoffs({timeline, isActive}: {timeline: RunLayout; isActive: (row: RunRow) => boolean}) {
	return (
		<g className="pointer-events-none">
			{timeline.rows.map((_, index) => {
				const handoff = handoffOf(timeline, index);
				if (!handoff) {
					return null;
				}
				const {row, from, mid, xDown, rDown, xUp, rUp} = handoff;
				const active = isActive(row);
				const line = cn(
					'fill-none transition-colors',
					active ? 'stroke-foreground/70' : 'stroke-foreground/25',
				);
				return (
					<Fragment key={row.id}>
						<path
							d={`M ${xDown} ${from} V ${mid - rDown} ${rDown > 0 ? `A ${rDown} ${rDown} 0 0 0 ${xDown + rDown} ${mid}` : ''}`}
							strokeWidth={1.5}
							className={line}
						/>
						<circle
							cx={xDown}
							cy={from}
							r={3.5}
							strokeWidth={2}
							className={cn(
								'stroke-background',
								active ? 'fill-foreground/80' : 'fill-foreground/60',
							)}
						/>
						{row.handedBack && (
							<>
								<path
									d={`M ${row.end} ${mid} H ${xUp - rUp} ${rUp > 0 ? `A ${rUp} ${rUp} 0 0 0 ${xUp} ${mid - rUp}` : ''} V ${from}`}
									strokeWidth={1.5}
									className={line}
								/>
								<circle
									cx={xUp}
									cy={from}
									r={3}
									strokeWidth={1.5}
									className={cn(
										'fill-background',
										active ? 'stroke-foreground/80' : 'stroke-foreground/60',
									)}
								/>
							</>
						)}
					</Fragment>
				);
			})}
		</g>
	);
}

// How wide the target over a dot or ring is, so it is easy to point at.
const DOT_TARGET = 14;

// The targets over the dots and rings: on hover, what was handed on or back there, and when.
function HandoffTargets({
	timeline,
	onHover,
}: {
	timeline: RunLayout;
	onHover: (id: string | null) => void;
}) {
	return (
		<>
			{timeline.rows.map((_, index) => {
				const handoff = handoffOf(timeline, index);
				if (!handoff) {
					return null;
				}
				const {row, from, xDown, xUp} = handoff;
				const [first] = row.tasks;
				const last = row.tasks[row.tasks.length - 1];
				const name = row.kind === 'group' ? `${row.tasks.length} tasks` : `“${first?.title ?? ''}”`;
				const marks = [
					{at: xDown, text: `Handed on ${name}`, when: first?.startedAt ?? null},
					...(row.handedBack
						? [{at: xUp, text: `${name} handed back`, when: last?.finishedAt ?? null}]
						: []),
				];
				return marks.map((mark) => (
					<Tooltip key={`${row.id}:${mark.at}`} disableHoverablePopup>
						<TooltipTrigger
							render={
								<span
									aria-hidden
									className="absolute -translate-1/2 rounded-full"
									style={{left: mark.at, top: from, width: DOT_TARGET, height: DOT_TARGET}}
									onMouseEnter={() => onHover(row.id)}
									onMouseLeave={() => onHover(null)}
								/>
							}
						/>
						<TooltipContent className="pointer-events-none max-w-xs">
							<span className="flex flex-col gap-1">
								<span className="font-medium">{mark.text}</span>
								{mark.when && <span className="opacity-80">{formatTime(mark.when)}</span>}
							</span>
						</TooltipContent>
					</Tooltip>
				));
			})}
		</>
	);
}

// The target over a break: on hover, how long nothing happened.
function BreakTarget({gap, height}: {gap: RunBreak; height: number}) {
	return (
		<Tooltip disableHoverablePopup>
			<TooltipTrigger
				render={
					<span
						aria-hidden
						className="absolute"
						style={{left: gap.start, width: gap.end - gap.start, top: 0, height}}
					/>
				}
			/>
			<TooltipContent className="pointer-events-none max-w-xs">
				<span className="flex flex-col gap-1">
					<span className="font-medium">Nothing happened for {formatDuration(gap.idleMs)}</span>
					<span className="opacity-80">Folded away, so the busy stretches have the room</span>
				</span>
			</TooltipContent>
		</Tooltip>
	);
}
