/// <reference types="bun" />

import {afterEach, describe, expect, test} from 'bun:test';
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {TooltipProvider} from '@proxy/ui/components/tooltip';
import {createMemoryRouter, RouterProvider} from 'react-router';
import {AgentSetup} from '@/components/agent-setup';
import {AGENT_PROVIDERS, findAgentProvider, type AgentProviderId} from '@proxy/integrations';
import type {AgentLogin} from '@/lib/types';

afterEach(() => {
	cleanup();
});

function customAgent(id: string, name: string): AgentLogin {
	return {
		id,
		providerId: 'custom',
		name,
		username: `${name.toLowerCase()}-k7q2`,
		createdAt: '2026-10-01T00:00:00Z',
		lastActiveAt: null,
		revokedAt: null,
		grants: [],
	};
}

function renderAgentSetup(
	providerId: AgentProviderId,
	agents: AgentLogin[] = [],
	onContinue: (agent: AgentLogin | null) => void = () => undefined,
) {
	const provider = findAgentProvider(providerId);
	if (!provider) {
		throw new Error(`${providerId} provider is missing`);
	}

	const router = createMemoryRouter(
		[
			{
				path: '/',
				element: (
					<AgentSetup
						agents={agents}
						providers={[provider]}
						fixed={providerId}
						continueLabel="Continue"
						onContinue={onContinue}
					/>
				),
			},
		],
		{initialEntries: ['/']},
	);

	return render(
		<TooltipProvider>
			<RouterProvider router={router} />
		</TooltipProvider>,
	);
}

function renderAgentChoice(agents: AgentLogin[] = []) {
	const router = createMemoryRouter(
		[
			{
				path: '/welcome',
				element: (
					<AgentSetup
						agents={agents}
						providers={AGENT_PROVIDERS}
						continueLabel="Continue"
						onContinue={() => undefined}
					/>
				),
			},
		],
		{initialEntries: ['/welcome']},
	);

	render(
		<TooltipProvider>
			<RouterProvider router={router} />
		</TooltipProvider>,
	);
	return router;
}

describe('AgentSetup', () => {
	test('goes back to the choice of agent with the browser', async () => {
		const router = renderAgentChoice();

		fireEvent.click(screen.getByRole('button', {name: /Claude Code/}));
		expect(screen.getByText('Add Personal Agent Proxy to Claude Code')).toBeDefined();
		expect(router.state.location.search).toBe('?agent=claude-code');

		await act(() => router.navigate(-1));
		expect(screen.getByText('Which agent do you use?')).toBeDefined();
	});

	test('shows the complete Hermes Agent command and remote OAuth handoff', () => {
		renderAgentSetup('hermes');

		expect(
			screen.getByText(
				"hermes mcp add personal-agent-proxy --url 'http://localhost/mcp' --auth oauth --connect-timeout 300",
			),
		).toBeDefined();
		expect(
			screen.getByText(/copy the full redirect URL from the browser back into its prompt/),
		).toBeDefined();
	});

	test('keeps the generic command-based setup steps for Claude Code', () => {
		renderAgentSetup('claude-code');

		expect(
			screen.getByText('claude mcp add --transport http personal-agent-proxy http://localhost/mcp'),
		).toBeDefined();
		expect(
			screen.getByText('In Claude Code, run /mcp and choose personal-agent-proxy to sign in.'),
		).toBeDefined();
		expect(screen.getByText(/Claude Code opens Personal Agent Proxy to sign in/)).toBeDefined();
	});

	test('offers Claude and Claude Duet as separate products', () => {
		renderAgentChoice();

		expect(screen.getByRole('button', {name: 'Claude Needs a public https address'})).toBeDefined();
		expect(
			screen.getByRole('button', {name: 'Claude Duet Needs a public https address'}),
		).toBeDefined();
	});

	test('adds Claude through its Claude account connector', () => {
		renderAgentSetup('claude');

		expect(screen.getByRole('link', {name: 'Open Claude'}).getAttribute('href')).toBe(
			'https://claude.ai/customize/connectors',
		);
		expect(screen.getByText(/choose Register automatically under OAuth client/)).toBeDefined();
		expect(screen.getByText(/Choose Claude when asked which agent it works as/)).toBeDefined();
	});

	test('adds Claude Duet as its own product through the shared Claude login', () => {
		const claude: AgentLogin = {
			id: 'agent-1',
			providerId: 'claude',
			name: 'Claude',
			username: 'claude-k7q2',
			createdAt: '2026-10-01T00:00:00Z',
			lastActiveAt: null,
			revokedAt: null,
			grants: [],
		};
		const continued: Array<AgentLogin | null> = [];
		renderAgentSetup('claude-duet', [claude], (agent) => continued.push(agent));

		expect(screen.getByText('Add Personal Agent Proxy to Claude Duet')).toBeDefined();
		expect(
			screen.getByText(/Claude Duet uses the connectors in your Claude account/),
		).toBeDefined();
		expect(screen.getByText(/Claude Duet shares that login/)).toBeDefined();

		fireEvent.keyDown(window, {key: 'Enter', metaKey: true});
		expect(continued).toEqual([claude]);
	});

	test('adds a custom MCP agent, however many there are already', () => {
		const router = renderAgentChoice([customAgent('agent-1', 'Cursor')]);

		fireEvent.click(screen.getByRole('button', {name: /Custom MCP agent/}));
		expect(router.state.location.search).toBe('?agent=custom');
		expect(screen.getByText('Add Personal Agent Proxy to your agent')).toBeDefined();
		expect(screen.getByText('http://localhost/mcp')).toBeDefined();
		expect(screen.getByText(/Choose Custom MCP agent and give it a name/)).toBeDefined();
		expect(screen.getByText('Waiting for your agent to sign in…')).toBeDefined();
		expect(
			screen.getByText(/This server address only works for an agent on this computer/),
		).toBeDefined();
	});

	test('sets a custom MCP agent up again by its own name', () => {
		renderAgentSetup('custom', [customAgent('agent-1', 'Cursor')]);

		expect(screen.getByText('Add Personal Agent Proxy to Cursor')).toBeDefined();
		expect(screen.getByText('Cursor is signed in as Cursor.')).toBeDefined();
	});

	test('continues with Command+Enter once an agent is ready', () => {
		const agent = customAgent('agent-1', 'Cursor');
		const continued: Array<AgentLogin | null> = [];
		renderAgentSetup('custom', [agent], (next) => continued.push(next));

		fireEvent.keyDown(window, {key: 'Enter', metaKey: true});

		expect(continued).toEqual([agent]);
	});
});
