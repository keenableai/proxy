import {useCallback, useEffect, useRef, useState} from 'react';
import {getActivityTimeline} from '@/client/agents-client';
import type {ActivityTimeline} from '@/client/schemas';
import {AuditEntryDialog} from '@/components/audit-entry-dialog';
import {TaskTimeline} from '@/components/task-timeline';
import {useOrgSlug} from '@/hooks/use-org';
import {
	DEFAULT_MINUTES,
	endedAt,
	LOADED_MINUTES,
	MAX_MINUTES,
	presetOf,
	windowLabel,
	WINDOWS,
	windowStart,
	zoomed,
} from '@/lib/timeline-window';
import type {AgentLogin, AuditEntry, Connection} from '@/lib/types';
import {Button} from '@proxy/ui/components/button';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@proxy/ui/components/select';

// How often the timeline is read again while the page is open, so a task under way moves along.
const REFRESH_MS = 60 * 1000;

// Zooming or scrolling with the wheel is told to the api this long after the last turn.
const ZOOM_SETTLE_MS = 300;

const MINUTE_MS = 60 * 1000;

// About how wide the labels beside the timeline are, so scrolling moves it as far as the pointer.
const LABELS_PX = 240;

const CUSTOM = 'custom';

// Under the home page's input: who is doing what for the person. Every agent's row over the tasks
// it handed to its sub-agents in a window of time, up to now at the right edge, each with the
// requests made for it; a task's name opens its page, and a request opens in full. The window's
// length is chosen above the timeline, or zoomed with Ctrl or Cmd and the wheel, or a pinch, as a
// video editor's timeline is, its end staying where it is; zoomed to a length not on offer, the
// choice reads Custom. Scrolling sideways, or with Shift, moves it back in time and forward again
// up to now, where it follows now once more; Now brings it straight back. The timeline is read
// again every minute, always at least a day back. With no task in that much, there is nothing to
// show, and it stays off the page.
export function AgentTimeline({
	initial,
	agents,
	connections,
}: {
	initial: ActivityTimeline;
	agents: AgentLogin[];
	connections: Connection[];
}) {
	const org = useOrgSlug();
	const [minutes, setMinutes] = useState(DEFAULT_MINUTES);
	// The answer shown: the first came with the page. Zoomed out past what it covers, the older
	// part arrives with the next reading; zoomed in, it has everything already.
	const [answer, setAnswer] = useState(initial);
	const [opened, setOpened] = useState<AuditEntry | null>(null);
	// Where the window ends, scrolled back in time; null while it ends at now.
	const [end, setEnd] = useState<number | null>(null);
	const mounted = useRef(false);
	// The window's length, for the wheel's listener, which is added once.
	const length = useRef(minutes);
	useEffect(() => {
		length.current = minutes;
	}, [minutes]);

	useEffect(() => {
		let gone = false;
		const read = async () => {
			const from = Math.min(
				(end ?? Date.now()) - minutes * MINUTE_MS,
				Date.now() - LOADED_MINUTES * MINUTE_MS,
			);
			const result = await getActivityTimeline(org, new Date(from).toISOString());
			if (gone || result.isErr()) {
				return;
			}
			setAnswer(result.value);
		};
		// The page's own answer is fresh; a window chosen after it is read once it settles.
		const settle = mounted.current ? setTimeout(() => void read(), ZOOM_SETTLE_MS) : null;
		mounted.current = true;
		const timer = setInterval(() => {
			if (document.visibilityState === 'visible') {
				void read();
			}
		}, REFRESH_MS);
		return () => {
			gone = true;
			if (settle !== null) {
				clearTimeout(settle);
			}
			clearInterval(timer);
		};
	}, [org, minutes, end]);

	// The wheel with Ctrl or Cmd held, which a pinch on a trackpad also sends, zooms rather than
	// scrolls the page, and sideways, or with Shift, scrolls the timeline through time, as far as the
	// pointer moved; listened to by hand, since React's wheel listener can't stop the scroll. Up and
	// down, the page scrolls as ever. On the timeline whenever it is there, which it isn't while
	// there is nothing to show.
	const listenForZoom = useCallback((element: HTMLDivElement) => {
		const onWheel = (event: WheelEvent) => {
			if (event.ctrlKey || event.metaKey) {
				event.preventDefault();
				setMinutes((current) => zoomed(current, event.deltaY));
				return;
			}
			const sideways = event.shiftKey ? event.deltaY : event.deltaX;
			if (!event.shiftKey && Math.abs(event.deltaX) <= Math.abs(event.deltaY)) {
				return;
			}
			event.preventDefault();
			const msPerPx = (length.current * MINUTE_MS) / Math.max(element.clientWidth - LABELS_PX, 100);
			setEnd((current) => {
				const now = Date.now();
				const next = (current ?? now) + sideways * msPerPx;
				if (next >= now) {
					return null;
				}
				return Math.max(next, now - (MAX_MINUTES - length.current) * MINUTE_MS);
			});
		};
		element.addEventListener('wheel', onWheel, {passive: false});
		return () => element.removeEventListener('wheel', onWheel);
	}, []);

	// Nothing in the past day, or further back where the window reaches: nothing to show at all.
	if (answer.tasks.length === 0) {
		return null;
	}

	const now = new Date(answer.now);
	const to = end === null ? now : new Date(Math.min(end, now.getTime()));
	const window = {from: windowStart(minutes, to), to};
	const inWindow = answer.tasks.some(
		(task) => (endedAt(task, now) ?? now).getTime() >= window.from.getTime(),
	);
	const preset = presetOf(minutes);

	return (
		<section aria-label="Agents" className="flex w-full max-w-3xl flex-col items-end gap-2 text-sm">
			<div className="flex items-center gap-2">
				{end !== null && (
					<Button variant="outline" size="sm" onClick={() => setEnd(null)}>
						Now
					</Button>
				)}
				<Select
					value={preset ?? CUSTOM}
					items={[
						...WINDOWS.map((choice) => ({value: choice.id, label: choice.label})),
						{value: CUSTOM, label: windowLabel(minutes)},
					]}
					onValueChange={(next) => {
						const chosen = WINDOWS.find((choice) => choice.id === next);
						if (chosen) {
							setMinutes(chosen.minutes);
						}
					}}
				>
					<SelectTrigger size="sm" aria-label="Window" className="w-36">
						<SelectValue />
					</SelectTrigger>
					<SelectContent alignItemWithTrigger={false}>
						{WINDOWS.map((choice) => (
							<SelectItem key={choice.id} value={choice.id}>
								{choice.label}
							</SelectItem>
						))}
						{preset === null && <SelectItem value={CUSTOM}>Custom</SelectItem>}
					</SelectContent>
				</Select>
			</div>
			<div ref={listenForZoom} className="w-full">
				{inWindow && (
					<TaskTimeline
						tasks={answer.tasks}
						entries={answer.entries}
						now={answer.now}
						window={window}
						agents={agents}
						connections={connections}
						onOpenEntry={setOpened}
					/>
				)}
				{!inWindow && (
					<p className="rounded-lg border px-4 py-3 text-center text-muted-foreground">
						{end === null
							? `No tasks in the ${windowLabel(minutes).toLowerCase()}.`
							: 'No tasks in this stretch of time.'}
					</p>
				)}
			</div>
			<AuditEntryDialog
				entry={opened}
				agents={agents}
				connections={connections}
				tasks={answer.tasks}
				onClose={() => setOpened(null)}
			/>
		</section>
	);
}
