/// <reference types="bun" />

import {afterEach, describe, expect, test} from 'bun:test';
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {ConnectionAccess} from '@/components/connection-access';
import type {Action} from '@proxy/integrations';

afterEach(() => {
	cleanup();
});

const action: Action = {
	id: 'read',
	label: 'Read',
	description: 'Read records',
	risk: 'low',
};

const actions: Action[] = [
	action,
	{id: 'create', label: 'Create', description: 'Create records', risk: 'medium'},
	{id: 'edit', label: 'Edit', description: 'Edit records', risk: 'high'},
];

function deferred() {
	let resolve = () => {};
	let reject = () => {};
	const promise = new Promise<void>((done, fail) => {
		resolve = () => done();
		reject = () => fail(new Error('Save failed'));
	});
	return {promise, reject, resolve};
}

describe('ConnectionAccess', () => {
	test('checks a range with shift-click and saves its changes together', async () => {
		const changes: Array<Record<string, boolean | null>> = [];
		render(
			<ConnectionAccess
				actions={actions}
				defaults={[]}
				onChange={(next) => {
					changes.push(next);
					return changes.length === 1 ? Promise.resolve() : new Promise(() => undefined);
				}}
			/>,
		);
		const checkboxes = screen.getAllByRole('checkbox');

		fireEvent.click(checkboxes[0]!);
		await act(async () => Promise.resolve());
		fireEvent.click(checkboxes[2]!, {shiftKey: true});
		await waitFor(() => expect(changes).toHaveLength(2));

		expect(checkboxes.map((checkbox) => checkbox.getAttribute('aria-checked'))).toEqual([
			'true',
			'true',
			'true',
		]);
		expect(changes).toEqual([{read: true}, {read: true, create: true, edit: true}]);
	});

	test('unchecks a range with shift-click', async () => {
		const changes: Array<Record<string, boolean | null>> = [];
		render(
			<ConnectionAccess
				actions={actions}
				defaults={actions.map((action) => action.id)}
				onChange={(next) => {
					changes.push(next);
					return changes.length === 1 ? Promise.resolve() : new Promise(() => undefined);
				}}
			/>,
		);
		const checkboxes = screen.getAllByRole('checkbox');

		fireEvent.click(checkboxes[0]!);
		await act(async () => Promise.resolve());
		fireEvent.click(checkboxes[2]!, {shiftKey: true});
		await waitFor(() => expect(changes).toHaveLength(2));

		expect(checkboxes.map((checkbox) => checkbox.getAttribute('aria-checked'))).toEqual([
			'false',
			'false',
			'false',
		]);
		expect(changes).toEqual([{read: false}, {read: false, create: false, edit: false}]);
	});

	test('keeps range changes that match an agent default inherited', async () => {
		const changes: Array<Record<string, boolean | null>> = [];
		render(
			<ConnectionAccess
				actions={actions}
				defaults={['read', 'create']}
				own={{read: false}}
				onChange={(next) => {
					changes.push(next);
					return changes.length === 1 ? Promise.resolve() : new Promise(() => undefined);
				}}
			/>,
		);
		const checkboxes = screen.getAllByRole('checkbox');

		fireEvent.click(checkboxes[0]!);
		await act(async () => Promise.resolve());
		fireEvent.click(checkboxes[2]!, {shiftKey: true});
		await waitFor(() => expect(changes).toHaveLength(2));

		expect(checkboxes.map((checkbox) => checkbox.getAttribute('aria-checked'))).toEqual([
			'true',
			'true',
			'true',
		]);
		expect(changes).toEqual([{read: null}, {read: null, edit: true}]);
	});

	test('re-saves an optimistic range value after its earlier save fails', async () => {
		const firstSave = deferred();
		const changes: Array<Record<string, boolean | null>> = [];
		render(
			<ConnectionAccess
				actions={actions}
				defaults={[]}
				onChange={(next) => {
					changes.push(next);
					return changes.length === 1 ? firstSave.promise : new Promise(() => undefined);
				}}
			/>,
		);
		const checkboxes = screen.getAllByRole('checkbox');

		fireEvent.click(checkboxes[0]!);
		await act(async () => Promise.resolve());
		fireEvent.click(checkboxes[2]!, {shiftKey: true});
		await act(async () => Promise.resolve());

		expect(changes).toEqual([{read: true}]);

		await act(async () => firstSave.reject());

		expect(changes).toEqual([{read: true}, {read: true, create: true, edit: true}]);
		expect(checkboxes.map((checkbox) => checkbox.getAttribute('aria-checked'))).toEqual([
			'true',
			'true',
			'true',
		]);
	});

	test('waits for every overlapping save before saving a range', async () => {
		const readSave = deferred();
		const createSave = deferred();
		const editSave = deferred();
		const rangeSave = deferred();
		const changes: Array<Record<string, boolean | null>> = [];
		render(
			<ConnectionAccess
				actions={actions}
				defaults={[]}
				onChange={(next) => {
					changes.push(next);
					if ('read' in next && 'create' in next) {
						return rangeSave.promise;
					}

					if ('read' in next) {
						return readSave.promise;
					}

					if ('create' in next) {
						return createSave.promise;
					}

					return editSave.promise;
				}}
			/>,
		);
		const checkboxes = screen.getAllByRole('checkbox');

		fireEvent.click(checkboxes[0]!);
		await act(async () => Promise.resolve());
		fireEvent.click(checkboxes[1]!);
		await act(async () => Promise.resolve());
		fireEvent.click(checkboxes[2]!);
		await act(async () => Promise.resolve());
		fireEvent.click(checkboxes[0]!, {shiftKey: true});
		await act(async () => Promise.resolve());

		expect(checkboxes.map((checkbox) => checkbox.getAttribute('aria-checked'))).toEqual([
			'false',
			'false',
			'false',
		]);
		expect(changes).toEqual([{read: true}, {create: true}, {edit: true}]);

		await act(async () => createSave.resolve());
		await act(async () => editSave.reject());
		expect(changes).toHaveLength(3);

		await act(async () => readSave.resolve());
		expect(changes).toEqual([
			{read: true},
			{create: true},
			{edit: true},
			{read: false, create: false, edit: false},
		]);
	});

	test('treats shift-click as one change when its previous anchor is no longer listed', async () => {
		const changes: Array<Record<string, boolean | null>> = [];
		const onChange = (next: Record<string, boolean | null>) => {
			changes.push(next);
			return new Promise<void>(() => undefined);
		};
		const view = render(
			<ConnectionAccess actions={actions.slice(0, 2)} defaults={[]} onChange={onChange} />,
		);

		fireEvent.click(screen.getByRole('checkbox', {name: /^Read/}));
		await act(async () => Promise.resolve());
		view.rerender(
			<ConnectionAccess actions={actions.slice(1)} defaults={[]} onChange={onChange} />,
		);
		fireEvent.click(screen.getByRole('checkbox', {name: /^Edit/}), {shiftKey: true});
		await act(async () => Promise.resolve());

		expect(changes).toEqual([{read: true}, {edit: true}]);
	});

	test('keeps focus on the range endpoint and supports shift-clicking its text', async () => {
		const changes: Array<Record<string, boolean | null>> = [];
		render(
			<ConnectionAccess
				actions={actions}
				defaults={[]}
				onChange={(next) => {
					changes.push(next);
					return changes.length === 1 ? Promise.resolve() : new Promise(() => undefined);
				}}
			/>,
		);
		const checkboxes = screen.getAllByRole('checkbox');
		const firstCheckbox = checkboxes[0]!;
		const lastCheckbox = checkboxes[2]!;
		const editText = screen.getByText('Edit').parentElement!;

		fireEvent.click(firstCheckbox);
		await act(async () => Promise.resolve());
		fireEvent.mouseDown(editText, {shiftKey: true});
		expect(document.activeElement).toBe(lastCheckbox);
		expect(checkboxes.map((checkbox) => checkbox.getAttribute('aria-checked'))).toEqual([
			'false',
			'false',
			'false',
		]);
		expect(changes).toEqual([{read: true}]);
		fireEvent.click(editText, {shiftKey: true});
		await waitFor(() => expect(changes).toHaveLength(2));

		expect(checkboxes.map((checkbox) => checkbox.getAttribute('aria-checked'))).toEqual([
			'true',
			'true',
			'true',
		]);
		expect(changes).toEqual([{read: true}, {read: true, create: true, edit: true}]);
	});

	test('reads refreshed defaults after a pending make-default before saving a range', async () => {
		const makeDefault = deferred();
		const changes: Array<Record<string, boolean | null>> = [];
		const view = render(
			<ConnectionAccess
				actions={actions}
				defaults={[]}
				own={{read: true, create: true, edit: false}}
				onChange={(next) => {
					changes.push(next);
					return Promise.resolve();
				}}
				onMakeDefault={() => makeDefault.promise}
			/>,
		);

		fireEvent.click(screen.getByRole('checkbox', {name: /^Edit/}));
		await act(async () => Promise.resolve());
		fireEvent.click(
			screen.getAllByRole('button', {name: 'Make this the default for every agent'})[0]!,
		);
		await act(async () => Promise.resolve());
		fireEvent.click(screen.getByRole('checkbox', {name: /^Read/}), {shiftKey: true});
		await act(async () => Promise.resolve());

		expect(changes).toEqual([{edit: true}]);

		view.rerender(
			<ConnectionAccess
				actions={actions}
				defaults={['read']}
				own={{create: true, edit: false}}
				onChange={(next) => {
					changes.push(next);
					return Promise.resolve();
				}}
				onMakeDefault={() => Promise.resolve()}
			/>,
		);
		await act(async () => makeDefault.resolve());

		expect(changes).toEqual([{edit: true}, {read: false, create: null}]);
	});

	test('shows a change immediately while it is saved and keeps the refreshed value', async () => {
		const save = deferred();
		const changes: Array<Record<string, boolean | null>> = [];
		const view = render(
			<ConnectionAccess
				actions={[action]}
				defaults={['read']}
				onChange={(next) => {
					changes.push(next);
					return save.promise;
				}}
			/>,
		);
		const checkbox = screen.getByRole('checkbox', {name: /^Read/});

		fireEvent.click(checkbox);

		expect(checkbox.getAttribute('aria-checked')).toBe('false');
		await act(async () => Promise.resolve());
		expect(changes).toEqual([{read: false}]);

		view.rerender(
			<ConnectionAccess actions={[action]} defaults={[]} onChange={() => Promise.resolve()} />,
		);
		await act(async () => save.resolve());

		expect(checkbox.getAttribute('aria-checked')).toBe('false');
	});

	test('returns to the stored value when a save does not change it', async () => {
		const save = deferred();
		render(
			<ConnectionAccess actions={[action]} defaults={['read']} onChange={() => save.promise} />,
		);
		const checkbox = screen.getByRole('checkbox', {name: /^Read/});

		fireEvent.click(checkbox);
		expect(checkbox.getAttribute('aria-checked')).toBe('false');

		await act(async () => save.resolve());

		expect(checkbox.getAttribute('aria-checked')).toBe('true');
	});

	test('saves repeated changes to one action in click order', async () => {
		const firstSave = deferred();
		const secondSave = deferred();
		const changes: Array<Record<string, boolean | null>> = [];
		const view = render(
			<ConnectionAccess
				actions={[action]}
				defaults={['read']}
				onChange={(next) => {
					changes.push(next);
					return changes.length === 1 ? firstSave.promise : secondSave.promise;
				}}
			/>,
		);
		const checkbox = screen.getByRole('checkbox', {name: /^Read/});

		fireEvent.click(checkbox);
		await act(async () => Promise.resolve());
		fireEvent.click(checkbox);
		await act(async () => Promise.resolve());

		expect(checkbox.getAttribute('aria-checked')).toBe('true');
		expect(changes).toEqual([{read: false}]);

		await act(async () => firstSave.resolve());
		expect(changes).toEqual([{read: false}, {read: true}]);

		view.rerender(
			<ConnectionAccess
				actions={[action]}
				defaults={['read']}
				onChange={() => Promise.resolve()}
			/>,
		);
		await act(async () => secondSave.resolve());

		expect(checkbox.getAttribute('aria-checked')).toBe('true');
	});

	test('saves the latest repeated change after an earlier save fails', async () => {
		const firstSave = deferred();
		const changes: Array<Record<string, boolean | null>> = [];
		render(
			<ConnectionAccess
				actions={[action]}
				defaults={['read']}
				onChange={(next) => {
					changes.push(next);
					return changes.length === 1 ? firstSave.promise : Promise.resolve();
				}}
			/>,
		);
		const checkbox = screen.getByRole('checkbox', {name: /^Read/});

		fireEvent.click(checkbox);
		await act(async () => Promise.resolve());
		fireEvent.click(checkbox);
		await act(async () => Promise.resolve());

		await act(async () => firstSave.reject());

		expect(changes).toEqual([{read: false}, {read: true}]);
		expect(checkbox.getAttribute('aria-checked')).toBe('true');
	});

	test('preserves order between making a value the default and changing its checkbox', async () => {
		const makeDefault = deferred();
		const checkboxSave = deferred();
		const changes: Array<Record<string, boolean | null>> = [];
		const view = render(
			<ConnectionAccess
				actions={[action]}
				defaults={[]}
				own={{read: true}}
				onChange={(next) => {
					changes.push(next);
					return checkboxSave.promise;
				}}
				onMakeDefault={() => makeDefault.promise}
			/>,
		);
		const checkbox = screen.getByRole('checkbox', {name: /^Read/});

		fireEvent.click(screen.getByRole('button', {name: 'Make this the default for every agent'}));
		await act(async () => Promise.resolve());
		fireEvent.click(checkbox);
		await act(async () => Promise.resolve());

		expect(checkbox.getAttribute('aria-checked')).toBe('false');
		expect(changes).toEqual([]);

		view.rerender(
			<ConnectionAccess
				actions={[action]}
				defaults={['read']}
				own={{}}
				onChange={(next) => {
					changes.push(next);
					return Promise.resolve();
				}}
				onMakeDefault={() => Promise.resolve()}
			/>,
		);
		await act(async () => makeDefault.resolve());

		expect(changes).toEqual([{read: false}]);
		expect(checkbox.getAttribute('aria-checked')).toBe('false');

		view.rerender(
			<ConnectionAccess
				actions={[action]}
				defaults={['read']}
				own={{read: false}}
				onChange={() => Promise.resolve()}
				onMakeDefault={() => Promise.resolve()}
			/>,
		);
		await act(async () => checkboxSave.resolve());

		expect(checkbox.getAttribute('aria-checked')).toBe('false');
	});

	test('queues a reset behind an unfinished checkbox save', async () => {
		const checkboxSave = deferred();
		const changes: Array<Record<string, boolean | null>> = [];
		render(
			<ConnectionAccess
				actions={[action]}
				defaults={[]}
				own={{read: true}}
				onChange={(next) => {
					changes.push(next);
					return changes.length === 1 ? checkboxSave.promise : Promise.resolve();
				}}
			/>,
		);

		fireEvent.click(screen.getByRole('checkbox', {name: /^Read/}));
		await act(async () => Promise.resolve());
		fireEvent.click(screen.getByRole('button', {name: 'Reset to default'}));
		await act(async () => Promise.resolve());

		expect(changes).toEqual([{read: null}]);

		await act(async () => checkboxSave.resolve());

		expect(changes).toEqual([{read: null}, {read: null}]);
	});
});
