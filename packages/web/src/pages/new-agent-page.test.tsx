/// <reference types="bun" />

import {afterEach, describe, expect, test} from 'bun:test';
import {cleanup, render, screen} from '@testing-library/react';
import {TooltipProvider} from '@proxy/ui/components/tooltip';
import {ThemeProvider} from '@proxy/ui/components/theme-provider';
import {createMemoryRouter, RouterProvider} from 'react-router';
import {HumanSide} from '@/components/human-side';
import type {AgentLogin} from '@/lib/types';
import {NewAgentPage} from '@/pages/new-agent-page';

afterEach(() => {
	cleanup();
});

function claudeLogin(revokedAt: string | null): AgentLogin {
	return {
		id: 'agent-1',
		providerId: 'claude',
		name: 'Claude',
		username: 'claude-k7q2',
		createdAt: '2026-10-01T00:00:00Z',
		lastActiveAt: null,
		revokedAt,
		grants: [],
	};
}

function renderNewAgentPage(agents: AgentLogin[]) {
	const router = createMemoryRouter(
		[
			{
				id: 'human',
				loader: () => ({
					user: {id: 'user-1', email: 'person@example.com', name: null, image: null},
					onboarded: true,
				}),
				element: <HumanSide />,
				children: [
					{
						path: '/agents/new',
						loader: () => ({agents}),
						element: <NewAgentPage />,
					},
				],
			},
		],
		{initialEntries: ['/agents/new']},
	);

	return render(
		<ThemeProvider>
			<TooltipProvider>
				<RouterProvider router={router} />
			</TooltipProvider>
		</ThemeProvider>,
	);
}

describe('NewAgentPage', () => {
	test('offers Claude Duet separately when its shared Claude login is connected', async () => {
		renderNewAgentPage([claudeLogin(null)]);

		expect(screen.queryByRole('button', {name: /^Claude Connected$/})).toBeNull();
		const duet = await screen.findByRole('button', {name: 'Claude Duet Connected'});
		expect(duet.querySelector('img')?.getAttribute('src')).toBe('/agent-providers/claude-duet.png');
	});

	test('does not offer Claude Duet until its revoked shared login is restored', async () => {
		renderNewAgentPage([claudeLogin('2026-10-21T00:00:00Z')]);

		expect(await screen.findByText('Which agent do you use?')).toBeDefined();
		expect(screen.queryByRole('button', {name: /Claude Duet/})).toBeNull();
	});
});
