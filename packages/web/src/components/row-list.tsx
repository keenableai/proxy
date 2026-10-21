import {useEffect, useId, useState, type ReactNode} from 'react';
import {Link} from 'react-router';
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuTrigger,
} from '@proxy/ui/components/context-menu';
import {cn} from '@proxy/ui/lib/utils';

// The compact list every page shares: one line per row, the whole row a link or a button.
// Callers pass their own trailing cells, with widths and phone/desktop visibility set by class,
// and the header above the rows carries the same classes, which keeps the columns lined up.
export function RowList({header, children}: {header?: ReactNode; children: ReactNode}) {
	return (
		<div>
			{header}
			<ul>{children}</ul>
		</div>
	);
}

type RowProps = {
	icon?: ReactNode;
	title: ReactNode;
	tooltip?: ReactNode;
	// A line under the title, wrapping as long as it needs, the row growing with it.
	subtitle?: ReactNode;
	// Cells after the title, right-aligned in the order given.
	cells?: ReactNode;
	// The row's context menu, opened with a right click or a long press: its items.
	menu?: ReactNode;
	// Beside the row rather than in it, as a link elsewhere is: a link can't hold another.
	after?: ReactNode;
} & ({to: string; onClick?: never} | {onClick: () => void; to?: never});

// Its item out into the gutter of what holds the list (`--bleed`), and the row filling it, so its
// hover reaches the gutter while its text stays on the line; beside something else (`after`), the
// two share the item, the row's hover on its side only.
const ITEM = 'relative -mx-(--bleed)';
const ROW =
	'flex w-full min-w-0 items-center gap-3 px-(--bleed) text-left text-sm hover:bg-muted/50 active:bg-muted/50';
const TOOLTIP_CLEARANCE_PX = 112;

export function Row({to, onClick, icon, title, tooltip, subtitle, cells, menu, after}: RowProps) {
	const [tooltipHovered, setTooltipHovered] = useState(false);
	const [tooltipFocused, setTooltipFocused] = useState(false);
	const [tooltipDismissed, setTooltipDismissed] = useState(false);
	const [tooltipSide, setTooltipSide] = useState<'top' | 'bottom'>('top');
	const tooltipId = useId();
	const tooltipOpen = (tooltipHovered || tooltipFocused) && !tooltipDismissed;
	useEffect(() => {
		if (!tooltipOpen) {
			return;
		}

		const dismiss = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				setTooltipDismissed(true);
			}
		};
		document.addEventListener('keydown', dismiss);
		return () => document.removeEventListener('keydown', dismiss);
	}, [tooltipOpen]);
	const className = cn(ROW, subtitle ? 'min-h-10 py-2' : 'h-10');
	const content = (
		<>
			{icon}
			{subtitle ? (
				<span className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="truncate">{title}</span>
					<span className="text-muted-foreground">{subtitle}</span>
				</span>
			) : (
				<span className="min-w-0 flex-1 truncate">{title}</span>
			)}
			{cells}
		</>
	);
	const tooltipElement = tooltip && (
		<span
			id={tooltipId}
			role="tooltip"
			hidden={!tooltipOpen}
			className={cn(
				'absolute right-0 z-50 flex max-h-24 w-max max-w-[calc(100vw-2rem)] flex-col items-start gap-0.5 overflow-y-auto rounded-md bg-foreground px-3 py-1.5 text-left text-xs break-all whitespace-normal text-background shadow-sm',
				tooltipSide === 'top' ? 'bottom-full' : 'top-full',
			)}
		>
			{tooltip}
			<span
				aria-hidden
				className={cn(
					'absolute right-4 size-2 rotate-45 bg-foreground',
					tooltipSide === 'top' ? '-bottom-1' : '-top-1',
				)}
			/>
		</span>
	);
	const placeTooltip = (element: HTMLElement) => {
		setTooltipSide(element.getBoundingClientRect().top < TOOLTIP_CLEARANCE_PX ? 'bottom' : 'top');
		setTooltipDismissed(false);
	};
	const showHoveredTooltip = tooltip
		? (event: {currentTarget: HTMLElement}) => {
				placeTooltip(event.currentTarget);
				setTooltipHovered(true);
			}
		: undefined;
	const hideHoveredTooltip = tooltip ? () => setTooltipHovered(false) : undefined;
	const showFocusedTooltip = tooltip
		? (event: {currentTarget: HTMLElement}) => {
				placeTooltip(event.currentTarget);
				setTooltipFocused(true);
			}
		: undefined;
	const hideFocusedTooltip = tooltip ? () => setTooltipFocused(false) : undefined;
	const control =
		to !== undefined ? (
			<Link
				to={to}
				className={className}
				aria-describedby={tooltip ? tooltipId : undefined}
				onFocus={showFocusedTooltip}
				onBlur={hideFocusedTooltip}
			>
				{content}
			</Link>
		) : (
			<button
				type="button"
				onClick={onClick}
				className={className}
				aria-describedby={tooltip ? tooltipId : undefined}
				onFocus={showFocusedTooltip}
				onBlur={hideFocusedTooltip}
			>
				{content}
			</button>
		);
	const row = after ? (
		<div className="flex items-center">
			{control}
			<div className="flex shrink-0 items-center pr-(--bleed)">{after}</div>
		</div>
	) : (
		control
	);
	const item = (
		<>
			{row}
			{tooltipElement}
		</>
	);

	if (!menu) {
		return (
			<li className={ITEM} onMouseEnter={showHoveredTooltip} onMouseLeave={hideHoveredTooltip}>
				{item}
			</li>
		);
	}

	return (
		<ContextMenu>
			<ContextMenuTrigger
				render={
					<li
						className={ITEM}
						onMouseEnter={showHoveredTooltip}
						onMouseLeave={hideHoveredTooltip}
					/>
				}
			>
				{item}
			</ContextMenuTrigger>
			<ContextMenuContent>{menu}</ContextMenuContent>
		</ContextMenu>
	);
}

// The column labels above the rows, laid out by the caller with the rows' own cell classes.
export function RowHeader({children}: {children: ReactNode}) {
	return (
		<div className="bleed flex h-8 items-center gap-3 text-xs text-muted-foreground">
			{children}
		</div>
	);
}

// What a list says in place of its rows when it has none, on the rows' text line.
export function EmptyRows({children}: {children: ReactNode}) {
	return <li className="py-3 text-sm text-muted-foreground">{children}</li>;
}
