import {BanIcon, XIcon} from 'lucide-react';
import type {ReactNode} from 'react';
import {connectionLabel, describeEntry, locateEntry} from '@/lib/access';
import {formatTime} from '@/lib/format';
import {
	ABANDONED_OPACITY,
	AGENT_COLOR_CLASSES,
	formatDuration,
	merged,
	MIN_TRACK_PX,
	requestSummary,
	type Span,
	TRACK_OPACITY,
	type TimelineRequest,
} from '@/lib/timeline';
import {STATUS_LABEL, type TaskStatus} from '@/lib/timeline-window';
import type {ActivityTask, AuditEntry, Connection} from '@/lib/types';
import {Tooltip, TooltipContent, TooltipTrigger} from '@proxy/ui/components/tooltip';
import {cn} from '@proxy/ui/lib/utils';

// What the two timelines draw with. A chart is an SVG the width of its box, measured as it
// resizes, with a layer of hit targets over it: the drawing is plain shapes, and everything that
// says more on hover or opens on click is an element with a name. An agent's color (the layout's
// colorOf) is set as the text color, which the shapes take as currentColor: a task is a faint
// track of it, with the requests made for the task solid on it; the hatching, the lines between
// rows and the axis are in the foreground's grays; amber and red are kept for a request blocked
// or failed, what may need the person.

// A request blocked, amber, or failed, red: what may need the person.
const BLOCKED = 'bg-amber-500 dark:bg-amber-600';
const FAILED = 'bg-red-500 dark:bg-red-700';

/** The hatching a task wears while it waits on what it handed on: thin lines at 45°. */
export function HatchDefs({id}: {id: string}) {
	return (
		<defs>
			<pattern
				id={id}
				patternUnits="userSpaceOnUse"
				width="6"
				height="6"
				patternTransform="rotate(45)"
				className="text-foreground/35"
			>
				<line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="1.2" />
			</pattern>
		</defs>
	);
}

/** A task's track: a rounded bar, square where it runs past the chart's edge. */
export function Track({
	span,
	y,
	height,
	clippedStart = false,
	clippedEnd = false,
	opacity = TRACK_OPACITY,
	dashed = false,
}: {
	span: Span;
	y: number;
	height: number;
	clippedStart?: boolean;
	clippedEnd?: boolean;
	opacity?: number;
	dashed?: boolean;
}) {
	// Run on past the edge, where the chart cuts it off, so that side stays square.
	const start = clippedStart ? span.start - 8 : span.start;
	const end = clippedEnd ? span.end + 8 : span.end;
	return (
		<rect
			x={start}
			y={y}
			width={Math.max(end - start, MIN_TRACK_PX)}
			height={height}
			rx={4}
			fill="currentColor"
			fillOpacity={opacity}
			stroke={dashed ? 'currentColor' : 'none'}
			strokeOpacity={0.5}
			strokeDasharray={dashed ? '3 3' : undefined}
		/>
	);
}

/** The requests made for a task, solid on its track, those that touch drawn as one. */
export function RequestMarks({
	requests,
	y,
	height,
}: {
	requests: TimelineRequest[];
	y: number;
	height: number;
}) {
	return (
		<>
			{merged(requests, 1).map((span) => (
				<rect
					key={span.start}
					x={span.start}
					y={y}
					width={span.end - span.start}
					height={height}
					rx={Math.min(2, height / 2)}
					fill="currentColor"
				/>
			))}
		</>
	);
}

/** A dot at the end of a task's track while it is under way. */
export function Pulse({x, y}: {x: number; y: number}) {
	return (
		<circle
			cx={x}
			cy={y}
			r={3.5}
			fill="currentColor"
			className="animate-pulse motion-reduce:animate-none"
		/>
	);
}

// How many of a group's tasks are named on hover before the rest are counted.
const MAX_NAMED = 8;

/** The tasks of a group, named one under another, the rest counted. */
export function TaskNames({tasks}: {tasks: ActivityTask[]}) {
	return (
		<span className="flex flex-col opacity-80">
			<ul className="list-disc pl-4">
				{tasks.slice(0, MAX_NAMED).map((task) => (
					<li key={task.id}>{task.title}</li>
				))}
			</ul>
			{tasks.length > MAX_NAMED && <span>{tasks.length - MAX_NAMED} more</span>}
		</span>
	);
}

/** What a task's tooltip says: its name and how it went. */
export function TaskTooltip({
	task,
	status,
	durationMs,
	requests,
	subTasks,
}: {
	task: ActivityTask;
	status: TaskStatus;
	durationMs: number;
	requests: TimelineRequest[];
	subTasks: number;
}) {
	const parts = [
		`${STATUS_LABEL[status]} · ${formatDuration(durationMs)}`,
		...requestSummary(requests),
		...(subTasks > 0 ? [`${subTasks} ${subTasks === 1 ? 'sub-task' : 'sub-tasks'}`] : []),
	];
	return (
		<span className="flex flex-col gap-1">
			<span className="font-medium">{task.title}</span>
			<span className="opacity-80">{parts.join(' · ')}</span>
		</span>
	);
}

// A hit target over a request, in the layer over the chart: on hover, what it was, where and how
// long it took; a click opens it in full. One blocked or failed wears a marker; every other is
// only its stretch of the track.
function RequestTarget({
	request,
	top,
	height,
	connections,
	forTask,
	onOpen,
}: {
	request: TimelineRequest;
	top: number;
	height: number;
	connections: Connection[];
	// The task it was made for, where that is one rolled into the row's.
	forTask: string | null;
	onOpen: () => void;
}) {
	const {entry} = request;
	const located = locateEntry(connections, entry);
	const where = located ? connectionLabel(connections, located.connection) : 'Deleted connection';
	const duration = entry.durationMs === null ? null : formatDuration(entry.durationMs);
	const marked = entry.outcome !== 'allowed';
	return (
		<Tooltip disableHoverablePopup>
			<TooltipTrigger
				render={
					<button
						type="button"
						onClick={onOpen}
						aria-label={describeEntry(entry, located)}
						className={cn(
							'absolute cursor-pointer rounded-sm transition-[top] duration-300 ease-in-out focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none',
							!marked && 'hover:bg-foreground/10',
						)}
						style={
							marked
								? {left: request.end, top: top + height / 2, width: 0, height: 0}
								: {left: request.start, top, width: request.end - request.start, height}
						}
					/>
				}
			>
				{marked && <Marker blocked={entry.outcome === 'denied'} className="-translate-1/2" />}
			</TooltipTrigger>
			<TooltipContent className="pointer-events-none max-w-xs">
				<span className="flex flex-col gap-1">
					<span className="font-medium">{describeEntry(entry, located)}</span>
					<span className="opacity-80">
						{where} · {formatTime(entry.at)}
						{duration && ` · ${duration}`}
					</span>
					{forTask && <span className="opacity-80">For “{forTask}”</span>}
					{entry.outcome === 'denied' && <span>Blocked: the agent may not do this</span>}
					{entry.outcome === 'failed' && <span>Failed{entry.error ? `: ${entry.error}` : ''}</span>}
				</span>
			</TooltipContent>
		</Tooltip>
	);
}

// The least a request is wide to get a target of its own, where it isn't marked.
export const MIN_TARGET_PX = 8;

// Markers closer than this would overlap, so their requests share one, with their count on it.
const CLUSTER_PX = 14;

/**
 * The targets for a row's requests: those blocked or failed as markers, any that would overlap as
 * one marker with their count; every other as its stretch of the track, where it is wide enough
 * to point at.
 */
export function RequestTargets({
	requests,
	top,
	height,
	connections,
	forTask,
	onOpen,
}: {
	requests: TimelineRequest[];
	top: number;
	height: number;
	connections: Connection[];
	// The task a request was made for, where that is one rolled into the row's.
	forTask: (entry: AuditEntry) => string | null;
	onOpen: (entry: AuditEntry) => void;
}) {
	const clusters: TimelineRequest[][] = [];
	for (const request of requests.filter((candidate) => candidate.entry.outcome !== 'allowed')) {
		const last = clusters[clusters.length - 1];
		const anchor = last?.[0]?.end;
		if (last && anchor !== undefined && request.end - anchor < CLUSTER_PX) {
			last.push(request);
			continue;
		}
		clusters.push([request]);
	}
	return (
		<>
			{requests
				.filter(
					(request) =>
						request.entry.outcome === 'allowed' && request.end - request.start >= MIN_TARGET_PX,
				)
				.map((request) => (
					<RequestTarget
						key={request.entry.id}
						request={request}
						top={top}
						height={height}
						connections={connections}
						forTask={forTask(request.entry)}
						onOpen={() => onOpen(request.entry)}
					/>
				))}
			{clusters.map((cluster) => {
				const [first] = cluster;
				if (!first) {
					return null;
				}
				if (cluster.length === 1) {
					return (
						<RequestTarget
							key={first.entry.id}
							request={first}
							top={top}
							height={height}
							connections={connections}
							forTask={forTask(first.entry)}
							onOpen={() => onOpen(first.entry)}
						/>
					);
				}
				return (
					<RequestCluster
						key={first.entry.id}
						requests={cluster}
						top={top + height / 2}
						connections={connections}
						onOpen={onOpen}
					/>
				);
			})}
		</>
	);
}

// Requests blocked or failed so close together their markers would overlap: one marker with
// their count, amber where every one was blocked and red where any failed; on hover, what each
// was; a click opens the latest.
function RequestCluster({
	requests,
	top,
	connections,
	onOpen,
}: {
	requests: TimelineRequest[];
	top: number;
	connections: Connection[];
	onOpen: (entry: AuditEntry) => void;
}) {
	const blocked = requests.filter((request) => request.entry.outcome === 'denied').length;
	const failed = requests.length - blocked;
	const latest = requests[requests.length - 1];
	const summary = [
		...(blocked > 0 ? [`${blocked} blocked`] : []),
		...(failed > 0 ? [`${failed} failed`] : []),
	].join(', ');
	return (
		<Tooltip disableHoverablePopup>
			<TooltipTrigger
				render={
					<button
						type="button"
						onClick={() => latest && onOpen(latest.entry)}
						aria-label={`${requests.length} requests: ${summary}`}
						className="absolute cursor-pointer transition-[top] duration-300 ease-in-out focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none"
						style={{left: requests[0]?.end ?? 0, top, width: 0, height: 0}}
					/>
				}
			>
				<Marker blocked={failed === 0} count={requests.length} className="-translate-1/2" />
			</TooltipTrigger>
			<TooltipContent className="pointer-events-none max-w-xs">
				<span className="flex flex-col gap-1">
					<span className="font-medium">
						{requests.length} requests {summary}
					</span>
					{requests.slice(0, 5).map((request) => (
						<span key={request.entry.id} className="opacity-80">
							{describeEntry(request.entry, locateEntry(connections, request.entry))} ·{' '}
							{formatTime(request.entry.at)}
						</span>
					))}
					{requests.length > 5 && <span className="opacity-80">{requests.length - 5} more</span>}
				</span>
			</TooltipContent>
		</Tooltip>
	);
}

export function Marker({
	blocked,
	count,
	className,
}: {
	blocked: boolean;
	count?: number;
	className?: string;
}) {
	const Icon = blocked ? BanIcon : XIcon;
	return (
		<span
			aria-hidden
			className={cn(
				'absolute flex size-4 items-center justify-center rounded-full text-white ring-2 ring-background',
				blocked ? BLOCKED : FAILED,
				className,
			)}
		>
			{count === undefined && <Icon className="size-2.5" strokeWidth={3} />}
			{count !== undefined && (
				<span className="text-[10px] leading-none font-semibold tabular-nums">{count}</span>
			)}
		</span>
	);
}

/** The labels under the axis, each centred on its mark but kept inside the chart at either end. */
export function AxisLabels({
	ticks,
	width,
	children,
}: {
	ticks: Array<{px: number; label: string}>;
	width: number;
	children?: ReactNode;
}) {
	return (
		<div className="relative h-7 text-xs text-muted-foreground tabular-nums">
			{ticks.map((tick) => (
				<span
					key={tick.px}
					className={cn(
						'absolute top-1.5 whitespace-nowrap',
						tick.px > 24 && tick.px < width - 24 && '-translate-x-1/2',
						tick.px >= width - 24 && '-translate-x-full',
					)}
					style={{left: tick.px}}
				>
					{tick.label}
				</span>
			))}
			{children}
		</div>
	);
}

export function Legend({children}: {children: ReactNode}) {
	return (
		<div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-xs text-muted-foreground">
			{children}
		</div>
	);
}

export function Key({swatch, children}: {swatch: ReactNode; children: ReactNode}) {
	return (
		<span className="inline-flex items-center gap-1.5">
			<span className="flex items-center">{swatch}</span>
			{children}
		</span>
	);
}

/** A swatch of a task's track, for the legend: with requests on it, hatched, under way or given up. */
export function TrackSwatch({
	requests = false,
	hatched = false,
	running = false,
	abandoned = false,
}: {
	requests?: boolean;
	hatched?: boolean;
	running?: boolean;
	abandoned?: boolean;
}) {
	return (
		<svg width="24" height="12" className={cn('block', AGENT_COLOR_CLASSES[0])} aria-hidden>
			{hatched && <HatchDefs id="legend-hatch" />}
			<Track
				span={{start: 0, end: running ? 20 : 24}}
				y={1}
				height={10}
				opacity={abandoned ? ABANDONED_OPACITY : undefined}
				dashed={abandoned}
			/>
			{requests && <rect x="3" y="1" width="7" height="10" rx="2" fill="currentColor" />}
			{requests && <rect x="14" y="1" width="4" height="10" rx="2" fill="currentColor" />}
			{hatched && <rect y="1" width="24" height="10" rx="3" fill="url(#legend-hatch)" />}
			{running && <Pulse x={20} y={6} />}
		</svg>
	);
}
