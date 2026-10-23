import {useCallback, useEffect, useRef, useState} from 'react';
import {useLocation, useSearchParams} from 'react-router';
import {getActivityTimeline} from '@/client/agents-client';
import type {ActivityTimeline as ActivityAnswer} from '@/client/schemas';
import {AuditEntryDialog} from '@/components/audit-entry-dialog';
import {ActivityTimeline} from '@/components/activity-timeline';
import {useOrgSlug} from '@/hooks/use-org';
import {
	DEFAULT_MINUTES,
	endedAt,
	LOADED_MINUTES,
	MAX_MINUTES,
	MIN_MINUTES,
	presetOf,
	windowLabel,
	WINDOWS,
	windowStart,
	zoomed,
} from '@/lib/timeline-window';
import type {AgentLogin, AuditEntry, Connection} from '@/lib/types';
import {Button} from '@proxy/ui/components/button';
import {cn} from '@proxy/ui/lib/utils';
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

// How long zooming in on a bar of several tasks takes.
const ZOOM_MS = 450;

function easeInOut(progress: number): number {
	return progress < 0.5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2;
}

function cancelZoom(zooming: {current: number | null}) {
	if (zooming.current !== null) {
		cancelAnimationFrame(zooming.current);
		zooming.current = null;
	}
}

// Under the home page's input: who is doing what for the person. Every agent's row over the tasks
// it was given in a window of time, up to now at the right edge, each with the requests made for
// it; a task's bar opens its page, and a request opens in full. The window's
// length is chosen above the timeline, or zoomed with Ctrl or Cmd and the wheel, or a pinch, as a
// video editor's timeline is, around the moment under the pointer; zoomed to a length not on offer,
// the choice reads Custom. Scrolling sideways, or with Shift, moves it back in time and forward again
// up to now, where it follows now once more; Now brings it straight back. A bar of several short
// tasks zooms the window in on them. The timeline is read
// again every minute, always at least a day back. With no task in that much, there is nothing to
// show, and it stays off the page.
export function AgentTimeline({
	initial,
	agents,
	connections,
}: {
	initial: ActivityAnswer;
	agents: AgentLogin[];
	connections: Connection[];
}) {
	const org = useOrgSlug();
	// The window is kept in the address, so coming back to the page, by the browser's back button
	// or a task page's, finds it as it was.
	const [params, setParams] = useSearchParams();
	const location = useLocation();
	const [minutes, setMinutes] = useState(() => windowFromParams(params).minutes);
	// The answer shown: the first came with the page. Zoomed out past what it covers, the older
	// part arrives with the next reading; zoomed in, it has everything already.
	const [answer, setAnswer] = useState(initial);
	const [opened, setOpened] = useState<AuditEntry | null>(null);
	// Where the window ends, scrolled back in time; null while it ends at now.
	const [end, setEnd] = useState<number | null>(() => windowFromParams(params).end);
	const mounted = useRef(false);
	// The window's length and end, for the wheel's listener, which is added once.
	const length = useRef(minutes);
	const ending = useRef(end);
	useEffect(() => {
		length.current = minutes;
		ending.current = end;
	}, [minutes, end]);

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
		// Opened on a window that reaches further back than the page's own answer, it is read at once.
		const beyond =
			(end ?? Date.now()) - minutes * MINUTE_MS < Date.now() - LOADED_MINUTES * MINUTE_MS;
		const settle = mounted.current || beyond ? setTimeout(() => void read(), ZOOM_SETTLE_MS) : null;
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
				// The moment under the pointer stays where it is, the window growing or shrinking
				// around it; up to now, past which the window can't reach.
				const current = length.current;
				const next = zoomed(current, event.deltaY);
				const chartWidth = Math.max(element.clientWidth - LABELS_PX, 100);
				const fraction = Math.min(
					Math.max(
						(event.clientX - element.getBoundingClientRect().left - LABELS_PX) / chartWidth,
						0,
					),
					1,
				);
				const now = Date.now();
				const endAt = ending.current ?? now;
				const under = endAt - (1 - fraction) * current * MINUTE_MS;
				const nextEnd = under + (1 - fraction) * next * MINUTE_MS;
				setMinutes(next);
				setEnd(nextEnd >= now ? null : Math.max(nextEnd, now - (MAX_MINUTES - next) * MINUTE_MS));
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

	// The window zoomed in on a stretch of time: a little longer than it, centred on it, ending at
	// now where the stretch runs up to it. It gets there over a moment rather than at once: the
	// stretch's middle glides from where it is on the chart to the chart's middle while the
	// window's length changes by even factors, one motion, rather than the view sliding off and
	// back as it would were the window's own middle moved; at once for those who would rather
	// not see motion.
	const zooming = useRef<number | null>(null);
	useEffect(() => () => cancelZoom(zooming), []);
	const zoomTo = (from: number, to: number) => {
		const now = Date.now();
		const length = Math.max(to - from, MIN_MINUTES * MINUTE_MS);
		const padded = Math.min(
			Math.max(length * 1.25, MIN_MINUTES * MINUTE_MS),
			MAX_MINUTES * MINUTE_MS,
		);
		const targetMinutes = Math.round(padded / MINUTE_MS);
		const middle = (from + to) / 2;
		// Where the stretch's middle sits on the chart, as a fraction of the window: now, and at
		// the end, the middle but for a window kept from reaching past now.
		const startMinutes = minutes;
		const startEnd = end ?? now;
		const startAt = (middle - (startEnd - startMinutes * MINUTE_MS)) / (startMinutes * MINUTE_MS);
		const targetEnd = Math.min(middle + padded / 2, now);
		const targetAt = (middle - (targetEnd - padded)) / padded;
		const place = (lengthMs: number, at: number) => {
			const endAt = middle + (1 - at) * lengthMs;
			setEnd(endAt >= now - MINUTE_MS ? null : endAt);
		};
		cancelZoom(zooming);
		if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
			setMinutes(targetMinutes);
			place(padded, targetAt);
			return;
		}
		const began = performance.now();
		const step = (time: number) => {
			const progress = Math.min((time - began) / ZOOM_MS, 1);
			if (progress >= 1) {
				zooming.current = null;
				setMinutes(targetMinutes);
				place(padded, targetAt);
				return;
			}
			const eased = easeInOut(progress);
			const stepMinutes = Math.round(
				Math.exp(
					Math.log(startMinutes) + (Math.log(targetMinutes) - Math.log(startMinutes)) * eased,
				),
			);
			setMinutes(stepMinutes);
			place(stepMinutes * MINUTE_MS, startAt + (targetAt - startAt) * eased);
			zooming.current = requestAnimationFrame(step);
		};
		zooming.current = requestAnimationFrame(step);
	};

	// Once the window settles, it is written to the address, in place of the entry there, so the
	// page is found as it was on coming back; the default window leaves the address clean.
	useEffect(() => {
		const timer = setTimeout(() => {
			setParams(
				(current) => {
					const next = new URLSearchParams(current);
					next.delete('window');
					next.delete('end');
					if (minutes !== DEFAULT_MINUTES) {
						next.set('window', String(minutes));
					}
					if (end !== null) {
						next.set('end', String(Math.round(end)));
					}
					return next;
				},
				{replace: true},
			);
		}, ZOOM_SETTLE_MS);
		return () => clearTimeout(timer);
	}, [minutes, end, setParams]);
	// Where a task's page comes back to: this page, with the window as it is now.
	const backTo = `${location.pathname}${windowSearch(minutes, end)}`;

	// Scrolled or zoomed to where there is nothing, the timeline stays up, its rows going the way
	// they do, and only says so once the window has rested a second.
	const resting = useRested(`${minutes}:${end ?? ''}`);

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
				{/* Always there, fading in and out, so nothing else moves when it comes and goes. */}
				<Button
					variant="outline"
					size="sm"
					onClick={() => setEnd(null)}
					aria-hidden={end === null}
					tabIndex={end === null ? -1 : undefined}
					className={cn(
						'transition-opacity duration-300 motion-reduce:transition-none',
						end === null && 'pointer-events-none opacity-0',
					)}
				>
					Now
				</Button>
				<Select
					value={preset ?? CUSTOM}
					// What the closed select reads: "Last 6 hours" while the window ends at now, "6 hours"
					// scrolled back from it. The choices themselves always read "Last".
					items={[
						...WINDOWS.map((choice) => ({
							value: choice.id,
							label: windowLabel(choice.minutes, end === null),
						})),
						{value: CUSTOM, label: windowLabel(minutes, end === null)},
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
				{(inWindow || !resting) && (
					<ActivityTimeline
						tasks={answer.tasks}
						entries={answer.entries}
						now={answer.now}
						window={window}
						agents={agents}
						connections={connections}
						onOpenEntry={setOpened}
						onZoom={zoomTo}
						backTo={backTo}
					/>
				)}
				{!inWindow && resting && (
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

// How long the window has to stay put before it has come to rest.
const REST_MS = 1000;

/** Whether the window, told apart by `key`, has stayed the same for a second. */
function useRested(key: string): boolean {
	const [seen, setSeen] = useState(key);
	const [rested, setRested] = useState(true);
	if (key !== seen) {
		setSeen(key);
		setRested(false);
	}
	useEffect(() => {
		const timer = setTimeout(() => setRested(true), REST_MS);
		return () => clearTimeout(timer);
	}, [key]);
	return rested;
}

// The window as the address has it: its length in minutes and where it ends, where either is
// there and makes sense; else the default, ending at now.
function windowFromParams(params: URLSearchParams): {minutes: number; end: number | null} {
	const minutes = Number(params.get('window'));
	const end = Number(params.get('end'));
	return {
		minutes:
			Number.isInteger(minutes) && minutes >= MIN_MINUTES && minutes <= MAX_MINUTES
				? minutes
				: DEFAULT_MINUTES,
		end: Number.isFinite(end) && end > 0 && end < Date.now() ? end : null,
	};
}

// The search part of the address for a window: empty for the default, ending at now.
function windowSearch(minutes: number, end: number | null): string {
	const params = new URLSearchParams();
	if (minutes !== DEFAULT_MINUTES) {
		params.set('window', String(minutes));
	}
	if (end !== null) {
		params.set('end', String(Math.round(end)));
	}
	const search = params.toString();
	return search ? `?${search}` : '';
}
