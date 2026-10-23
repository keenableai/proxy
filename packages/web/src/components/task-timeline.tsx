import {BanIcon, ChevronDownIcon, ChevronRightIcon, CornerDownRightIcon, XIcon} from 'lucide-react';
import {Fragment, type CSSProperties, type ReactNode, useCallback, useState} from 'react';
import {Link} from 'react-router';
import {AgentLogo} from '@/components/brand-logo';
import {useOrgSlug} from '@/hooks/use-org';
import {connectionLabel, describeEntry, locateEntry} from '@/lib/access';
import {formatTime} from '@/lib/format';
import {
	buildTimeline,
	colorOf,
	formatDuration,
	TASK_COLORS,
	type TimelineCall,
	type TimelineBar,
	type TimelineRow,
	type TimelineWindow,
} from '@/lib/task-timeline';
import type {ActivityTask, AgentLogin, AuditEntry, Connection} from '@/lib/types';
import {Tooltip, TooltipContent, TooltipTrigger} from '@proxy/ui/components/tooltip';
import {cn} from '@proxy/ui/lib/utils';

// A row's height, and how far its bar sits in from its top and bottom, in pixels: the connectors
// between rows are placed by them.
const ROW_H = 36;
const BAR_INSET = 10;

const LABEL = 'w-36 shrink-0 md:w-56';

// The room an axis label takes, "23h 30m" with space around it, in pixels; and how wide the axis
// is taken to be until it is measured.
const LABEL_PX = 72;
const DEFAULT_AXIS_PX = 600;

// A task is one solid bar in the color of its tree (the layout's colorOf), a light sweeping along
// it while it is under way and faded once given up, as its tooltip says in words too. The colors
// are the reference palette's blue, magenta, green, violet and aqua, in an order whose neighbors
// stay apart for color-blind eyes, each stepped for the dark theme; its orange, yellow and red are
// left out, as amber and red mean a request was blocked or failed. The agent's own row, which
// stands for the conversation rather than a task, is a wash. A request shows only where it was
// blocked or failed, each as a marker with an icon: what may need the person.
const TASK_COLOR_CLASSES = [
	'bg-[#2a78d6] dark:bg-[#3987e5]',
	'bg-[#e87ba4] dark:bg-[#d55181]',
	'bg-[#008300] dark:bg-[#008300]',
	'bg-[#6250d6] dark:bg-[#9085e9]',
	'bg-[#1baf7a] dark:bg-[#199e70]',
] as const;
const AGENT_SPAN: Record<TimelineBar['status'], string> = {
	running: 'bg-sky-500/15',
	finished: 'bg-muted',
	abandoned: 'bg-muted',
};
// How long one sweep of the shimmer along a task under way takes, as index.css has it.
const SHIMMER_S = 2.4;

const BLOCKED = 'bg-amber-500 dark:bg-amber-600';
const FAILED = 'bg-red-500 dark:bg-red-700';

// A stretch the task waited on its sub-tasks, hatched.
const WAITING_STYLE: CSSProperties = {
	backgroundImage: 'repeating-linear-gradient(135deg, currentColor 0 1px, transparent 1px 6px)',
};

// How far inside the bar it was handed from a task's bar keeps, in pixels, so the lines between
// them always meet both: a task started a moment after what handed it on is drawn starting a
// little later, and one finished just before it, a little earlier; at most a quarter of that bar,
// where it is narrow, so what was handed from it still fits. Only where it is drawn moves; its
// times stay as they were.
const NUDGE = 16;

// Where a bar is drawn, as CSS offsets from the row's left and right: where its task ran, kept
// inside the bar it was handed from as that is drawn, unless it runs on past the window there.
function barLeft(bar: TimelineBar): string {
	const at = `${bar.start * 100}%`;
	if (bar.handedFrom === null || bar.clipped) {
		return at;
	}
	return `max(${at}, calc(${barLeft(bar.handedFrom)} + ${nudge(bar.handedFrom)}))`;
}

// A bar is drawn at least this wide, in pixels, so a short task nudged later at its start still
// ends after it starts, its lines in order.
const MIN_BAR = 4;

function barRight(bar: TimelineBar): string {
	const at = `${(1 - bar.end) * 100}%`;
	if (bar.handedFrom === null || bar.open) {
		return at;
	}
	return `min(max(${at}, calc(${barRight(bar.handedFrom)} + ${nudge(bar.handedFrom)})), calc(100% - ${barLeft(bar)} - ${MIN_BAR}px))`;
}

function nudge(from: TimelineBar): string {
	return `min(${NUDGE}px, calc((100% - ${barLeft(from)} - ${barRight(from)}) / 4))`;
}

// How far a line runs beside a bar before it turns into it: half the nudge, so the line meets the
// bar it was handed from inside it.
function elbow(bar: TimelineBar): string {
	if (bar.handedFrom === null) {
		return `${ELBOW}px`;
	}
	return `min(${ELBOW}px, calc(${nudge(bar.handedFrom)} / 2))`;
}

const STATUS_LABEL: Record<TimelineBar['status'], string> = {
	running: 'Under way',
	finished: 'Finished',
	abandoned: 'Abandoned',
};

// How long a bar's task took; for one left open, how long it was at work, or that it is open
// where it never did anything.
function barDuration(bar: TimelineBar): string {
	if (!bar.open) {
		return formatDuration(bar.durationMs);
	}
	return bar.activeMs < 1000 ? 'open' : formatDuration(bar.activeMs);
}

// A bar left open fades out past the end of the axis.
const OPEN_STYLE: CSSProperties = {
	maskImage: 'linear-gradient(to right, black max(50%, calc(100% - 32px)), transparent)',
};

type Props = {
	tasks: ActivityTask[];
	entries: AuditEntry[];
	// When the answer was read: where a task under way has got to.
	now: string;
	// The home page's stretch of time ending now; a run's own axis without one.
	window?: TimelineWindow;
	// The task a task's page is about, which stands out.
	focus?: string;
	// The tasks whose sub-tasks are laid out under them at first; every other task's are folded in.
	unfolded?: string[];
	agents: AgentLogin[];
	connections: Connection[];
	onOpenEntry: (entry: AuditEntry) => void;
};

// What agents did, each agent's row over its tasks, each task under what it was handed from: a
// run's, along one axis from when its first task started to the last thing done, or the home
// page's, over a window ending now. A bar runs as long as its task did, fading on where it was left
// open; the requests made for it sit on it, as long as each took; a row hatches where it waited on
// what it handed on, a line goes down where it handed a task on and back up where that task was
// finished. Every mark says more on hover; a request opens in full, a task's name opens its page,
// and an agent's name the agent's.
export function TaskTimeline({
	tasks,
	entries,
	now,
	window,
	focus,
	unfolded = [],
	agents,
	connections,
	onOpenEntry,
}: Props) {
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(unfolded));
	// A lane's chevron unfolds the sub-tasks of every task in it, or, none folded, folds them all.
	const toggle = (row: TimelineRow) => {
		const ids = row.bars.flatMap((bar) =>
			bar.task !== null && bar.subTasks > 0 ? [bar.task.id] : [],
		);
		const unfold = row.bars.some((bar) => bar.folded);
		setExpanded((current) => {
			const next = new Set(current);
			for (const id of ids) {
				if (unfold) {
					next.add(id);
					continue;
				}
				next.delete(id);
			}
			return next;
		});
	};
	// As many marks on the axis as can be labelled side by side at its width.
	const [axisWidth, setAxisWidth] = useState(DEFAULT_AXIS_PX);
	const measureAxis = useCallback((element: HTMLDivElement) => {
		setAxisWidth(element.clientWidth);
		if (typeof ResizeObserver === 'undefined') {
			return;
		}
		const observer = new ResizeObserver(() => setAxisWidth(element.clientWidth));
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	const maxTicks = Math.max(Math.floor(axisWidth / LABEL_PX), 2);
	const timeline = buildTimeline(tasks, entries, new Date(now), {window, maxTicks, expanded});
	const titleOf = (taskId: string | null) =>
		tasks.find((candidate) => candidate.id === taskId)?.title ?? null;
	const agentOf = (agentId: string) => agents.find((candidate) => candidate.id === agentId);
	const handedOn = (agentId: string) =>
		timeline.rows
			.filter((row) => row.agentId === agentId)
			.flatMap((row) => row.bars)
			.filter((bar) => bar.task !== null).length;
	const holdsFocus = (row: TimelineRow) =>
		focus !== undefined && row.bars.some((bar) => bar.task?.id === focus);

	return (
		<div className="flex flex-col gap-3 text-sm">
			<div className="flex overflow-hidden rounded-lg border">
				<div className={cn(LABEL, 'min-w-0 border-r bg-muted/40')}>
					{timeline.rows.map((row, index) => (
						<RowLabel
							key={index}
							row={row}
							agent={agentOf(row.agentId)}
							focused={holdsFocus(row)}
							onToggle={() => toggle(row)}
						/>
					))}
					<div className="h-7" />
				</div>
				<div className="min-w-0 flex-1 px-4">
					<div ref={measureAxis} className="relative">
						{timeline.ticks.map((tick) => (
							<span
								key={tick.at}
								aria-hidden
								className="absolute inset-y-0 border-l border-border/60"
								style={{left: `${tick.at * 100}%`}}
							/>
						))}
						{timeline.rows.map((row, index) => (
							<div key={index} className="relative" style={{height: ROW_H}}>
								{row.bars.map((bar) => (
									<Fragment key={bar.task?.id ?? 'agent'}>
										<TaskSpan
											bar={bar}
											agentName={agentOf(row.agentId)?.name ?? 'Deleted agent'}
											parentTitle={titleOf(bar.task?.parentId ?? null)}
											taskCount={handedOn(row.agentId)}
											focused={focus !== undefined && bar.task?.id === focus}
										/>
										{bar.calls
											.filter((call) => call.entry.outcome !== 'allowed')
											.map((call) => (
												<Request
													key={call.entry.id}
													call={call}
													bar={bar}
													// Made for a sub-task folded into this one.
													forTask={
														call.entry.taskId === bar.task?.id ? null : titleOf(call.entry.taskId)
													}
													connections={connections}
													onOpen={() => onOpenEntry(call.entry)}
												/>
											))}
									</Fragment>
								))}
							</div>
						))}
						<Handoffs rows={timeline.rows} />
					</div>
					<div className="relative h-7 text-xs text-muted-foreground tabular-nums">
						{timeline.ticks.map((tick) => (
							<span
								key={tick.at}
								// Centred on its line, but kept inside the axis at either end.
								className={cn(
									'absolute top-1.5 whitespace-nowrap',
									tick.at > 0 && tick.at < 1 && '-translate-x-1/2',
									tick.at === 1 && '-translate-x-full',
								)}
								style={{left: `${tick.at * 100}%`}}
							>
								{tick.label}
							</span>
						))}
					</div>
				</div>
			</div>
			<Legend />
		</div>
	);
}

// The agent's row is named by the agent; a lane by its left-most task in view, indented under what
// it was handed from, opening the task's page, with how many more tasks the lane holds there, else
// how long the task took; the lane of the task the page is about stands out. Where its tasks handed
// any on, a chevron unfolds them under it, or folds them back in.
function RowLabel({
	row,
	agent,
	focused,
	onToggle,
}: {
	row: TimelineRow;
	agent: AgentLogin | undefined;
	focused: boolean;
	onToggle: () => void;
}) {
	const org = useOrgSlug();
	const [lead] = row.bars;
	const more = row.bars.length - 1;
	const aside = (
		<span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
			{lead && more === 0 ? barDuration(lead) : `+${more}`}
		</span>
	);
	const task = lead?.task ?? null;
	if (task === null) {
		return <AgentLabel agent={agent} duration={aside} />;
	}
	const handedOn = row.bars.reduce((total, bar) => total + bar.subTasks, 0);
	const folded = row.bars.some((bar) => bar.folded);
	return (
		<div
			className={cn(
				'flex items-center hover:bg-muted',
				focused ? 'bg-muted font-medium' : 'text-foreground/90',
			)}
			style={{height: ROW_H, paddingLeft: 8 + (row.depth - 1) * 14}}
		>
			{handedOn > 0 && (
				<button
					type="button"
					onClick={onToggle}
					aria-expanded={!folded}
					aria-label={`${folded ? 'Show' : 'Hide'} the ${handedOn === 1 ? 'sub-task' : `${handedOn} sub-tasks`}`}
					className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
				>
					{folded ? (
						<ChevronRightIcon className="size-3.5" />
					) : (
						<ChevronDownIcon className="size-3.5" />
					)}
				</button>
			)}
			{handedOn === 0 && (
				<span className="flex size-5 shrink-0 items-center justify-center">
					<CornerDownRightIcon className="size-3.5 text-muted-foreground" />
				</span>
			)}
			<Link
				to={`/${org}/activity/tasks/${encodeURIComponent(task.id)}`}
				preventScrollReset
				aria-current={focused ? 'page' : undefined}
				className="flex h-full min-w-0 flex-1 items-center gap-2 pr-3 pl-1"
			>
				<span className="truncate">{task.title}</span>
				{aside}
			</Link>
		</div>
	);
}

// The agent's row is named by the agent, opening its page; one deleted since has an empty tile.
function AgentLabel({agent, duration}: {agent: AgentLogin | undefined; duration: ReactNode}) {
	const org = useOrgSlug();
	if (!agent) {
		return (
			<div className="flex items-center gap-2 pr-3 pl-3" style={{height: ROW_H}}>
				<span className="size-5 shrink-0 rounded-md border border-dashed" />
				<span className="truncate font-medium">Deleted agent</span>
				{duration}
			</div>
		);
	}
	return (
		<Link
			to={`/${org}/agents/${encodeURIComponent(agent.id)}`}
			className="flex items-center gap-2 pr-3 pl-3 hover:bg-muted"
			style={{height: ROW_H}}
		>
			<AgentLogo providerId={agent.providerId} />
			<span className="truncate font-medium">{agent.name}</span>
			{duration}
		</Link>
	);
}

// A bar, hatched where it waited on what it handed on, fading on where it was left open; on
// hover, what it was for, how it went and what it handed back.
function TaskSpan({
	bar,
	agentName,
	parentTitle,
	taskCount,
	focused,
}: {
	bar: TimelineBar;
	agentName: string;
	parentTitle: string | null;
	taskCount: number;
	focused: boolean;
}) {
	const org = useOrgSlug();
	const {task} = bar;
	const blocked = bar.calls.filter((call) => call.entry.outcome === 'denied').length;
	const failed = bar.calls.filter((call) => call.entry.outcome === 'failed').length;
	const requests = [
		...(bar.calls.length > 0 ? [`${bar.calls.length} requests`] : []),
		...(blocked > 0 ? [`${blocked} blocked`] : []),
		...(failed > 0 ? [`${failed} failed`] : []),
	];
	const className = cn(
		'absolute min-w-1 rounded-md',
		'overflow-hidden',
		task === null || bar.color === null ? AGENT_SPAN[bar.status] : TASK_COLOR_CLASSES[bar.color],
		task !== null && bar.status === 'abandoned' && 'opacity-50',
		bar.open && 'rounded-r-none',
		bar.clipped && 'rounded-l-none',
		focused && 'ring-2 ring-foreground/50 ring-offset-1 ring-offset-background',
	);
	const style: CSSProperties = {
		left: barLeft(bar),
		right: barRight(bar),
		...(bar.open ? OPEN_STYLE : {}),
		top: BAR_INSET,
		bottom: BAR_INSET,
	};
	return (
		<Tooltip disableHoverablePopup>
			<TooltipTrigger
				render={
					task === null ? (
						<div className={className} style={style} />
					) : (
						<Link
							to={`/${org}/activity/tasks/${encodeURIComponent(task.id)}`}
							preventScrollReset
							aria-label={task.title}
							className={className}
							style={style}
						/>
					)
				}
			>
				{task !== null && bar.status === 'running' && (
					<span
						aria-hidden
						// Each bar's sweep starts at a point of its own, so they don't all move in step.
						style={{
							animationDelay: `-${((colorOf(task.id + task.startedAt) / TASK_COLORS) * SHIMMER_S).toFixed(2)}s`,
						}}
						className="absolute inset-0 animate-lanes-shimmer bg-linear-100 from-transparent from-30% via-white/45 via-50% to-transparent to-70% motion-reduce:hidden"
					/>
				)}
				{bar.waiting.map((stretch) => (
					<span
						key={stretch.start}
						aria-hidden
						className={cn(
							'absolute inset-y-0',
							task === null ? 'text-foreground/25' : 'text-white/45',
						)}
						style={{
							...WAITING_STYLE,
							left: `${((stretch.start - bar.start) / (bar.end - bar.start)) * 100}%`,
							width: `${((stretch.end - stretch.start) / (bar.end - bar.start)) * 100}%`,
						}}
					/>
				))}
			</TooltipTrigger>
			<TooltipContent className="pointer-events-none max-w-xs">
				{task === null && (
					<span className="flex flex-col gap-1">
						<span className="font-medium">{agentName}</span>
						<span className="opacity-80">
							Handed on {taskCount === 1 ? 'one task' : `${taskCount} tasks`} over{' '}
							{formatDuration(bar.durationMs)}
						</span>
					</span>
				)}
				{task !== null && (
					<span className="flex flex-col gap-1">
						<span className="font-medium">{task.title}</span>
						<span className="opacity-80">{task.goal}</span>
						<span className="opacity-80">
							{bar.finishedWithParent
								? 'Finished with what it was handed from'
								: STATUS_LABEL[bar.status]}{' '}
							· {formatDuration(bar.open ? bar.activeMs : bar.durationMs)}
							{bar.open && ` at work, open ${formatDuration(bar.durationMs)}`}
							{requests.map((part) => ` · ${part}`).join('')}
						</span>
						{task.outcome && (
							<span>
								{parentTitle ? `Handed back to “${parentTitle}”: ` : 'Handed back: '}
								{task.outcome}
							</span>
						)}
					</span>
				)}
			</TooltipContent>
		</Tooltip>
	);
}

// A request blocked or failed on its task's bar, as a marker. Opens the request in full.
function Request({
	call,
	bar,
	forTask,
	connections,
	onOpen,
}: {
	call: TimelineCall;
	bar: TimelineBar;
	forTask: string | null;
	connections: Connection[];
	onOpen: () => void;
}) {
	const {entry} = call;
	const located = locateEntry(connections, entry);
	const where = located ? connectionLabel(connections, located.connection) : 'Deleted connection';
	const duration = entry.durationMs === null ? null : formatDuration(entry.durationMs);

	return (
		<Tooltip disableHoverablePopup>
			<TooltipTrigger
				render={
					<button
						type="button"
						onClick={onOpen}
						aria-label={describeEntry(entry, located)}
						className="absolute cursor-pointer focus-visible:outline-2 focus-visible:outline-ring"
						style={{
							left: `clamp(${barLeft(bar)}, ${((call.start + call.end) / 2) * 100}%, calc(100% - ${barRight(bar)}))`,
							top: ROW_H / 2,
						}}
					/>
				}
			>
				<Marker blocked={entry.outcome === 'denied'} className="-translate-1/2" />
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

function Marker({blocked, className}: {blocked: boolean; className?: string}) {
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
			<Icon className="size-2.5" strokeWidth={3} />
		</span>
	);
}

// How far a connector runs beside a sub-task's bar before it turns into it, in pixels: the radius
// of its corner.
const ELBOW = 8;

// Where a row handed a task on: a dot on the bottom edge of its bar, and a line down beside the
// task's bar that turns into its start; where the task was finished, rather than finished with
// what it was handed from, a line out of its end that turns back up to a ring on the row's bar.
function Handoffs({rows}: {rows: TimelineRow[]}) {
	return (
		<div aria-hidden className="pointer-events-none absolute inset-0">
			{rows.flatMap((row, index) => {
				const {parentRow} = row;
				if (parentRow === null) {
					return [];
				}
				// From the parent's bar's bottom edge to the middle of the task's bar.
				const top = parentRow * ROW_H + ROW_H - BAR_INSET;
				const height = index * ROW_H + ROW_H / 2 - top;
				return row.bars.map((bar) => {
					// The lines meet the bar where it is drawn, and so its parent's.
					const down = `calc(${barLeft(bar)} - ${elbow(bar)})`;
					const out = `calc(100% - ${barRight(bar)})`;
					const up = `calc(100% - ${barRight(bar)} + ${elbow(bar)})`;
					// Handed on before the window, or handed back after it: no line where it isn't.
					return (
						<Fragment key={bar.task?.id ?? 'agent'}>
							{!bar.clipped && (
								<>
									<span
										className="absolute rounded-bl-lg border-b-[1.5px] border-l-[1.5px] border-foreground/35"
										style={{left: down, top, height, width: elbow(bar)}}
									/>
									<span
										className="absolute size-2 -translate-1/2 rounded-full bg-foreground/60 ring-2 ring-background"
										style={{left: down, top}}
									/>
								</>
							)}
							{bar.status === 'finished' && !bar.finishedWithParent && !bar.open && (
								<>
									<span
										className="absolute rounded-br-lg border-r-[1.5px] border-b-[1.5px] border-foreground/35"
										style={{left: out, top, height, width: elbow(bar)}}
									/>
									<span
										className="absolute size-2 -translate-1/2 rounded-full border-[1.5px] border-foreground/60 bg-background"
										style={{left: up, top}}
									/>
								</>
							)}
						</Fragment>
					);
				});
			})}
		</div>
	);
}

function Legend() {
	return (
		<div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-xs text-muted-foreground">
			<Key
				swatch={
					<span className="flex h-2.5 w-6 overflow-hidden rounded-sm">
						{TASK_COLOR_CLASSES.map((color) => (
							<span key={color} className={cn('h-full flex-1', color)} />
						))}
					</span>
				}
			>
				Tasks
			</Key>
			<Key
				swatch={
					<span
						className={cn('relative h-2.5 w-4 overflow-hidden rounded-sm', TASK_COLOR_CLASSES[0])}
					>
						<span className="absolute inset-0 animate-lanes-shimmer bg-linear-100 from-transparent from-30% via-white/45 via-50% to-transparent to-70% motion-reduce:hidden" />
					</span>
				}
			>
				Under way
			</Key>
			<Key
				swatch={<span className={cn('h-2.5 w-4 rounded-sm opacity-50', TASK_COLOR_CLASSES[0])} />}
			>
				Given up
			</Key>
			<Key
				swatch={
					<span
						className={cn('h-2.5 w-4 rounded-sm text-white/45', TASK_COLOR_CLASSES[0])}
						style={WAITING_STYLE}
					/>
				}
			>
				Waiting on sub-tasks
			</Key>
			<Key swatch={<span className="size-2 rounded-full bg-foreground/60" />}>Handed on</Key>
			<Key swatch={<span className="size-2 rounded-full border-[1.5px] border-foreground/60" />}>
				Handed back
			</Key>
			<Key swatch={<Marker blocked className="relative" />}>Blocked</Key>
			<Key swatch={<Marker blocked={false} className="relative" />}>Failed</Key>
		</div>
	);
}

function Key({swatch, children}: {swatch: ReactNode; children: ReactNode}) {
	return (
		<span className="inline-flex items-center gap-1.5">
			<span className="flex items-center">{swatch}</span>
			{children}
		</span>
	);
}
