import type {Action, OwnSettings} from '@proxy/integrations';
import {CheckCheckIcon, Undo2Icon} from 'lucide-react';
import {useId, useRef, useState} from 'react';
import {RowList} from '@/components/row-list';
import {IconButton} from '@/components/icon-button';
import {Badge} from '@proxy/ui/components/badge';
import {Checkbox} from '@proxy/ui/components/checkbox';
import {cn} from '@proxy/ui/lib/utils';

type Props = {
	actions: Action[];
	// The actions agents get by default.
	defaults: string[];
	// An agent's own settings. Left out on a connection's page, where the defaults themselves are set.
	own?: OwnSettings;
	// On a connection's page: how many agents have a setting of their own, by action.
	differing?: Partial<Record<string, number>>;
	// Actions turned on or off; null returns an agent's action to the default.
	onChange: (actions: Record<string, boolean | null>) => Promise<void>;
	// On an agent's page: makes the agent's own setting for an action the connection's default.
	onMakeDefault?: (actionId: string, allowed: boolean) => Promise<void>;
};

// A connection's access, the way an editor shows its settings: one checkbox per action, the only
// control for it. On an agent's page every action starts on the connection's default; one the
// agent has its own setting for is marked with a bar, a button that makes it the default for
// every agent, and one that resets it to the default.
export function ConnectionAccess({
	actions,
	defaults,
	own,
	differing,
	onChange,
	onMakeDefault,
}: Props) {
	// A connection's actions show on more than one page section, so the ids need their own prefix.
	const idPrefix = useId();
	// Keep the control responsive while its change is saved and the route's data is reloaded.
	const [pending, setPending] = useState<Partial<Record<string, boolean>>>({});
	const queues = useRef<Partial<Record<string, Promise<void>>>>({});
	const rangeAnchor = useRef<string | null>(null);
	const defaultsRef = useRef(defaults);
	const ownRef = useRef(own);
	defaultsRef.current = defaults;
	ownRef.current = own;
	const isDefault = (id: string) => defaults.includes(id);
	const storedIsOn = (id: string) => (own ? (own[id] ?? isDefault(id)) : isDefault(id));
	const isOn = (id: string) => pending[id] ?? storedIsOn(id);
	const isOwn = (id: string) => own?.[id] !== undefined;
	// On an agent's page, an action that matches the default follows it rather than being stored.
	const setting = (id: string, next: boolean): boolean | null => {
		if (ownRef.current && next === defaultsRef.current.includes(id)) {
			return null;
		}
		return next;
	};
	const queueChanges = (checked: Record<string, boolean>, save: () => Promise<void>) => {
		const actionIds = Object.keys(checked);
		if (actionIds.length === 0) {
			return;
		}

		setPending((current) => ({...current, ...checked}));

		// Preserve click order across every control that can change the same action.
		const previous = actionIds.map((actionId) => queues.current[actionId] ?? Promise.resolve());
		const request = Promise.all(
			previous.map((pendingSave) => pendingSave.catch(() => undefined)),
		).then(save);
		for (const actionId of actionIds) {
			queues.current[actionId] = request;
		}
		const settle = () => {
			setPending((current) => {
				const next = {...current};
				for (const actionId of actionIds) {
					if (queues.current[actionId] !== request) {
						continue;
					}

					delete queues.current[actionId];
					delete next[actionId];
				}
				return next;
			});
		};
		void request.then(settle, settle);
	};
	const queueChange = (actionId: string, checked: boolean, save: () => Promise<void>) => {
		queueChanges({[actionId]: checked}, save);
	};
	const change = (actionId: string, checked: boolean) => {
		queueChange(actionId, checked, () => onChange({[actionId]: setting(actionId, checked)}));
	};
	const changeRange = (actionId: string, checked: boolean, shiftKey: boolean) => {
		const anchorIndex = actions.findIndex((action) => action.id === rangeAnchor.current);
		const actionIndex = actions.findIndex((action) => action.id === actionId);
		if (!shiftKey || anchorIndex === -1 || actionIndex === -1) {
			rangeAnchor.current = actionId;
			change(actionId, checked);
			return;
		}

		const first = Math.min(anchorIndex, actionIndex);
		const last = Math.max(anchorIndex, actionIndex);
		const changedActions = actions
			.slice(first, last + 1)
			.filter((action) => isOn(action.id) !== checked || pending[action.id] !== undefined);
		queueChanges(Object.fromEntries(changedActions.map((action) => [action.id, checked])), () =>
			onChange(
				Object.fromEntries(
					changedActions.map((action) => [action.id, setting(action.id, checked)]),
				),
			),
		);
	};

	return (
		<RowList>
			{actions.map((action) => {
				const checked = isOn(action.id);
				const blocked = checked && action.requires !== undefined && !isOn(action.requires);
				const required = actions.find((candidate) => candidate.id === action.requires);
				const others = differing?.[action.id] ?? 0;
				const inputId = `${idPrefix}-${action.id}`;
				const labelId = `${inputId}-label`;
				const descriptionId = `${inputId}-description`;
				return (
					<li
						key={action.id}
						className={cn(
							'flex items-start gap-3 border-l-2 py-2 pr-4 pl-3.5 text-sm md:pr-3 md:pl-2.5',
							isOwn(action.id) ? 'border-primary' : 'border-transparent',
						)}
					>
						<Checkbox
							id={inputId}
							aria-labelledby={labelId}
							aria-describedby={descriptionId}
							className="mt-0.5"
							checked={checked}
							onMouseDown={(event) => {
								if (!event.shiftKey || event.button !== 0) {
									return;
								}

								event.preventDefault();
								event.currentTarget.focus();
							}}
							onCheckedChange={(next, details) =>
								changeRange(
									action.id,
									next,
									details.event instanceof MouseEvent && details.event.shiftKey,
								)
							}
						/>
						<div
							className="flex min-w-0 flex-1 flex-col gap-0.5"
							onMouseDown={(event) => {
								if (!event.shiftKey) {
									return;
								}

								event.preventDefault();
								document.getElementById(inputId)?.focus();
							}}
							onClick={(event) => {
								if (event.shiftKey) {
									event.preventDefault();
									changeRange(action.id, !checked, true);
									return;
								}

								document.getElementById(inputId)?.focus();
								changeRange(action.id, !checked, false);
							}}
						>
							<span id={labelId} className="flex items-center gap-2">
								{action.label}
								{action.risk === 'high' && (
									<Badge variant="destructive" className="font-normal">
										High risk
									</Badge>
								)}
							</span>
							<span id={descriptionId} className="text-muted-foreground">
								{action.description}
								{blocked && required && ` · Off while ${required.label} is off`}
							</span>
						</div>
						<span className="flex shrink-0 items-center gap-2 text-muted-foreground">
							{others > 0 && `Changed for ${others} ${others === 1 ? 'agent' : 'agents'}`}
							{isOwn(action.id) && onMakeDefault && (
								<IconButton
									label="Make this the default for every agent"
									onClick={() =>
										queueChange(action.id, checked, () => onMakeDefault(action.id, checked))
									}
								>
									<CheckCheckIcon />
								</IconButton>
							)}
							{isOwn(action.id) && (
								<IconButton
									label="Reset to default"
									onClick={() =>
										queueChange(action.id, isDefault(action.id), () =>
											onChange({[action.id]: null}),
										)
									}
								>
									<Undo2Icon />
								</IconButton>
							)}
						</span>
					</li>
				);
			})}
		</RowList>
	);
}
