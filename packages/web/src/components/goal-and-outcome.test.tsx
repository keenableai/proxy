/// <reference types="bun" />

import {afterEach, describe, expect, test} from 'bun:test';
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {useState} from 'react';
import {type ShownText, TextPanel, TextSwitch} from '@/components/goal-and-outcome';

afterEach(cleanup);

// The two as a page holds them: the switch choosing what the panel shows.
function Both({outcome}: {outcome: string | null}) {
	const [shown, setShown] = useState<ShownText>('goal');
	return (
		<>
			<TextSwitch shown={shown} hasOutcome={outcome !== null} onChange={setShown} />
			<TextPanel shown={shown} goal="Plan the week" outcome={outcome} />
		</>
	);
}

describe('TextSwitch and TextPanel', () => {
	test('show the description, and the outcome once switched to', () => {
		render(<Both outcome="Tuesday is the day to start" />);

		expect(screen.getByRole('tabpanel').textContent).toBe('Plan the week');
		expect(screen.getByRole('tab', {name: 'Description'}).getAttribute('aria-selected')).toBe(
			'true',
		);

		fireEvent.click(screen.getByRole('tab', {name: 'Outcome'}));

		expect(screen.getByRole('tabpanel').textContent).toBe('Tuesday is the day to start');
		expect(screen.getByRole('tab', {name: 'Outcome'}).getAttribute('aria-selected')).toBe('true');
	});

	test('a task without an outcome has only its description, and the switch can’t be moved', () => {
		render(<Both outcome={null} />);

		expect(screen.getByText('Plan the week')).toBeTruthy();
		const outcome = screen.getByRole('tab', {name: 'Outcome'});
		expect(outcome.getAttribute('aria-disabled')).toBe('true');

		fireEvent.click(outcome);

		expect(screen.getByText('Plan the week')).toBeTruthy();
		expect(screen.getByRole('tab', {name: 'Description'}).getAttribute('aria-selected')).toBe(
			'true',
		);
	});
});
