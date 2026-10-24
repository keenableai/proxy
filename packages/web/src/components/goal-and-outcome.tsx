import {AnimatedHeight} from '@/components/animated-height';
import {Tooltip, TooltipContent, TooltipTrigger} from '@proxy/ui/components/tooltip';
import {cn} from '@proxy/ui/lib/utils';

// What a task set out to do and what came of it, one at a time: a switch between the two, and the
// text itself, the one shown fading in and the room it takes growing or shrinking to fit, so
// nothing below jumps. The two are separate so the page can place them apart; the page holds
// which is shown. A task without an outcome yet, under way or given up on, has only its
// description: the switch is there, but can't be moved, and says so on hover.

export type ShownText = 'goal' | 'outcome';

const OPTIONS: Array<{id: ShownText; label: string}> = [
	{id: 'goal', label: 'Description'},
	{id: 'outcome', label: 'Outcome'},
];

/**
 * The switch between the description and the outcome, its highlight sliding to the one chosen;
 * without an outcome to show, the outcome can't be chosen, and hovering it says so.
 */
export function TextSwitch({
	shown,
	hasOutcome,
	onChange,
}: {
	shown: ShownText;
	hasOutcome: boolean;
	onChange: (shown: ShownText) => void;
}) {
	return (
		<div
			role="tablist"
			aria-label="Description or outcome"
			className="relative grid w-fit grid-cols-2 rounded-md bg-muted p-0.5 text-xs"
		>
			<span
				aria-hidden
				className={cn(
					'absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-sm bg-background shadow-xs transition-transform duration-200 ease-out motion-reduce:transition-none',
					shown === 'outcome' && 'translate-x-full',
				)}
			/>
			{OPTIONS.map((option) => {
				const blocked = option.id === 'outcome' && !hasOutcome;
				const tab = (
					<button
						key={option.id}
						type="button"
						role="tab"
						aria-selected={shown === option.id}
						aria-disabled={blocked || undefined}
						onClick={() => {
							if (!blocked) {
								onChange(option.id);
							}
						}}
						className={cn(
							'relative rounded-sm px-2.5 py-0.5 transition-colors duration-200',
							shown === option.id && 'text-foreground',
							shown !== option.id &&
								!blocked &&
								'cursor-pointer text-muted-foreground hover:text-foreground',
							blocked && 'cursor-not-allowed text-muted-foreground/50',
						)}
					>
						{option.label}
					</button>
				);
				if (!blocked) {
					return tab;
				}
				return (
					<Tooltip key={option.id}>
						<TooltipTrigger render={tab} />
						<TooltipContent>Not available</TooltipContent>
					</Tooltip>
				);
			})}
		</div>
	);
}

/** The text chosen, or the description alone where there is no outcome: fading in, in a box that animates to its height. */
export function TextPanel({
	shown,
	goal,
	outcome,
	className,
}: {
	shown: ShownText;
	goal: string;
	outcome: string | null;
	className?: string;
}) {
	if (outcome === null) {
		return <p className={className}>{goal}</p>;
	}
	return (
		<div role="tabpanel" className={className}>
			<AnimatedHeight open>
				<p key={shown} className="animate-in fade-in-0 duration-200 motion-reduce:animate-none">
					{shown === 'goal' ? goal : outcome}
				</p>
			</AnimatedHeight>
		</div>
	);
}
