// `bun run demo`: fills the local database with a workspace for showing Personal Agent Proxy off,
// signed in as dana@acmecorp.com: a long list of connections, one agent, Instinct, and its
// tasks of the past days. The one to open is "Finding an office", three days of work handed out
// to sub-agents: requirements, leads, emails to brokers, a shortlist with the team, viewings in the
// calendar and a deposit the proxy kept it from paying. Beside it, in the home page's last 24
// hours, groceries being ordered right now, the month's expenses and a trip to Lisbon. All of it
// is made up. Run it while `bun run dev` is up, and again right before showing it: every time is
// relative to when it runs. Running it again deletes the workspace first.
import {type AgentProviderId, EMAIL_PROVIDERS, VAULT_INTEGRATION_ID} from '@proxy/integrations';

import {db} from '../src';
import {encrypt, signInLink, wipeUser} from './local-seed';

// Every one of Dana's addresses is this one, the sign-in's included.
const EMAIL = process.env.DEMO_EMAIL || 'dana@acmecorp.com';
const WORKSPACE_SLUG = `${EMAIL.split('@')[0]}-workspace`;
const ORG_NAME = 'Dana’s Workspace';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const now = Date.now();

// Deterministic, so the requests come out the same on every run.
let randomState = 7;
function random(): number {
	randomState = (randomState * 1664525 + 1013904223) % 2 ** 32;
	return randomState / 2 ** 32;
}

function daysAgo(days: number): Date {
	return new Date(now - days * DAY);
}

await wipeUser(EMAIL);

// ---- Person and organization ----------------------------------------------------------------

const user = await db.user.create({
	data: {
		email: EMAIL,
		name: 'Dana Whitfield',
		emailVerified: daysAgo(90),
		termsAcceptedAt: daysAgo(90),
		createdAt: daysAgo(90),
	},
});
const org = await db.organization.create({
	data: {
		name: ORG_NAME,
		slug: WORKSPACE_SLUG,
		ownerUserId: user.id,
		onboardedAt: daysAgo(90),
		createdAt: daysAgo(90),
	},
});
await db.orgMember.create({data: {orgId: org.id, userId: user.id}});

// ---- Connections ----------------------------------------------------------------------------

type Connection = {id: string; integrationId: string};

// Made-up tokens throughout: the pages listing connections and access work, opening a record fails.
const TOKENS = encrypt(
	JSON.stringify({
		clientId: 'demo-client',
		accessToken: 'demo-access-token',
		refreshToken: null,
		expiresAt: null,
	}),
);

function googleCredential(email: string): string {
	return encrypt(
		JSON.stringify({
			accessToken: 'demo-access-token',
			refreshToken: null,
			expiresAt: null,
			scopes: [
				'openid',
				'https://www.googleapis.com/auth/userinfo.email',
				'https://www.googleapis.com/auth/gmail.modify',
				'https://www.googleapis.com/auth/gmail.send',
				'https://www.googleapis.com/auth/calendar.events',
				'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
				'https://www.googleapis.com/auth/drive',
				'https://www.googleapis.com/auth/documents',
				'https://www.googleapis.com/auth/spreadsheets',
				'https://www.googleapis.com/auth/presentations',
				'https://www.googleapis.com/auth/contacts',
			],
			email,
		}),
	);
}

// Connected a day apart in this order, oldest first, as the home page stacks their logos.
let connectedDaysAgo = 80;

async function connect(data: {
	integrationId: string;
	account: string;
	credential: string | null;
	// The actions every agent gets.
	defaults: string[];
	// A custom MCP server's name, and its tools.
	name?: string;
	tools?: Tool[];
	shared?: boolean;
}): Promise<Connection> {
	connectedDaysAgo -= 1;
	const connection = await db.connection.create({
		data: {
			orgId: org.id,
			ownerUserId: data.shared ? null : user.id,
			connectedById: user.id,
			integrationId: data.integrationId,
			account: data.account,
			credential: data.credential,
			name: data.name ?? null,
			tools: data.tools ? JSON.stringify(data.tools) : null,
			createdAt: daysAgo(connectedDaysAgo),
		},
	});
	for (const actionId of data.defaults) {
		await db.connectionDefault.create({data: {connectionId: connection.id, actionId}});
	}
	return connection;
}

// A custom MCP server's tool, as the server lists it (`McpTool` in @proxy/integrations).
type Tool = {
	name: string;
	title: string;
	description: string;
	inputSchema: {type: 'object'; properties: Record<string, {type: string; description?: string}>};
	annotations: {readOnlyHint: boolean; destructiveHint?: boolean; openWorldHint?: boolean};
};

function tool(name: string, title: string, description: string, readsOnly: boolean): Tool {
	return {
		name,
		title,
		description,
		inputSchema: {type: 'object', properties: {query: {type: 'string'}}},
		annotations: readsOnly
			? {readOnlyHint: true}
			: {readOnlyHint: false, destructiveHint: false, openWorldHint: true},
	};
}

// A custom MCP server at `address`, its read-only tools on by default as the api sets them.
function server(name: string, address: string, tools: Tool[]): Promise<Connection> {
	return connect({
		integrationId: 'mcp',
		account: address,
		credential: encrypt(JSON.stringify({auth: 'none', url: `https://${address}`})),
		defaults: tools.filter((one) => one.annotations.readOnlyHint).map((one) => one.name),
		name,
		tools,
	});
}

const vault = await connect({
	integrationId: VAULT_INTEGRATION_ID,
	account: ORG_NAME,
	credential: null,
	defaults: ['readEntries', 'writeEntries'],
});
const sharedVault = await connect({
	integrationId: VAULT_INTEGRATION_ID,
	account: ORG_NAME,
	credential: null,
	defaults: ['readEntries'],
	shared: true,
});
const google = await connect({
	integrationId: 'google',
	account: EMAIL,
	credential: googleCredential(EMAIL),
	defaults: [
		'readEmails',
		'markEmails',
		'archiveEmails',
		'flagEmails',
		'writeEmails',
		'sendEmails',
		'readEvents',
		'writeEvents',
		'inviteGuests',
		'readFiles',
		'createFiles',
		'editFiles',
		'readContacts',
		'writeContacts',
	],
});
const slack = await server('Slack', 'mcp.slack.com/mcp', [
	tool('slack_search_messages', 'Search messages', 'Searches messages across channels.', true),
	tool('slack_read_thread', 'Read thread', 'Reads a thread and its replies.', true),
	tool('slack_send_message', 'Send message', 'Posts a message to a channel or a thread.', false),
]);
const notion = await connect({
	integrationId: 'notion',
	account: `${EMAIL} · Acme Corp`,
	credential: TOKENS,
	defaults: ['read', 'create', 'edit'],
});
const linear = await connect({
	integrationId: 'linear',
	account: `${EMAIL} · Acme Corp`,
	credential: TOKENS,
	defaults: ['read', 'create'],
});
const granola = await connect({
	integrationId: 'granola',
	account: EMAIL,
	credential: TOKENS,
	defaults: ['readNotes', 'readTranscripts'],
});
await server('GitHub', 'api.githubcopilot.com/mcp', [
	tool('search_issues', 'Search issues', 'Searches issues and pull requests.', true),
	tool('create_issue', 'Create issue', 'Opens an issue in a repository.', false),
]);
await server('Stripe', 'mcp.stripe.com', [
	tool('list_payments', 'List payments', 'Lists recent payments.', true),
	tool('create_refund', 'Create refund', 'Refunds a payment.', false),
]);
await server('Figma', 'mcp.figma.com/mcp', [
	tool('get_file', 'Get file', 'Reads a Figma file and its frames.', true),
]);
const exa = await connect({
	integrationId: 'exa',
	account: 'Exa',
	credential: encrypt(JSON.stringify({apiKey: 'demo-exa-key'})),
	defaults: ['search', 'fetch'],
});
const parallel = await connect({
	integrationId: 'parallel',
	account: 'Parallel',
	credential: encrypt(JSON.stringify({apiKey: 'demo-parallel-key'})),
	defaults: ['search', 'fetch'],
});
const bank = await connect({
	integrationId: 'plaid',
	account: 'Mercury',
	credential: encrypt(JSON.stringify({itemId: 'demo-item', accessToken: 'demo-access-token'})),
	defaults: ['readBalances', 'readTransactions'],
});
await connect({
	integrationId: 'email',
	account: EMAIL,
	// Fastmail's real servers with a made-up app password, as `bun run seed`'s mailboxes have.
	credential: encrypt(
		JSON.stringify({
			...EMAIL_PROVIDERS.find((provider) => provider.id === 'fastmail')?.servers,
			username: EMAIL,
			password: 'abcd-efgh-ijkl-mnop',
		}),
	),
	defaults: ['read'],
});
await connect({
	integrationId: 'cloudflare',
	account: EMAIL,
	credential: encrypt(JSON.stringify({apiKey: 'demo-cloudflare-key'})),
	defaults: ['read'],
});
await connect({
	integrationId: 'postgres',
	account: 'db.acmecorp.com/production',
	credential: encrypt(JSON.stringify({url: 'postgres://readonly@db.acmecorp.com/production'})),
	defaults: ['read', 'query'],
});
await server('Sentry', 'mcp.sentry.dev/mcp', [
	tool('search_issues', 'Search issues', 'Searches errors and their events.', true),
]);
await server('Vercel', 'mcp.vercel.com', [
	tool('list_deployments', 'List deployments', 'Lists a project’s deployments.', true),
]);
await server('HubSpot', 'mcp.hubspot.com', [
	tool('search_contacts', 'Search contacts', 'Searches CRM contacts.', true),
	tool('create_note', 'Create note', 'Adds a note to a contact.', false),
]);
await server('Asana', 'mcp.asana.com/sse', [
	tool('search_tasks', 'Search tasks', 'Searches tasks in a workspace.', true),
]);
await server('Atlassian', 'mcp.atlassian.com/v1/sse', [
	tool('search_confluence', 'Search Confluence', 'Searches Confluence pages.', true),
]);
await server('Intercom', 'mcp.intercom.com/mcp', [
	tool('search_conversations', 'Search conversations', 'Searches support conversations.', true),
]);
await server('Zapier', 'mcp.zapier.com/api/mcp', [
	tool('run_zap', 'Run Zap', 'Runs one of your Zaps.', false),
]);
await server('Supabase', 'mcp.supabase.com/mcp', [
	tool('execute_sql', 'Run SQL', 'Runs a read-only SQL query.', true),
]);
await server('Webflow', 'mcp.webflow.com/sse', [
	tool('list_pages', 'List pages', 'Lists a site’s pages.', true),
]);
await server('PayPal', 'mcp.paypal.com/sse', [
	tool('list_transactions', 'List transactions', 'Lists recent transactions.', true),
]);
await server('Canva', 'mcp.canva.com/mcp', [
	tool('search_designs', 'Search designs', 'Searches your designs.', true),
]);

// ---- Vault entries --------------------------------------------------------------------------

const VAULT_ENTRIES: Array<{title: string; type: string; content: string}> = [
	{
		title: 'Home',
		type: 'Address',
		content: 'Dana Whitfield\n1450 Guerrero St, Apt 4\nSan Francisco, CA 94110\nUnited States',
	},
	{
		title: 'Office',
		type: 'Address',
		content: 'Acme Corp, c/o Harbor Coworking\n88 Spear St, Floor 3\nSan Francisco, CA 94105',
	},
	{title: 'Mobile', type: 'Phone number', content: '+1 415 555 0142'},
	{
		title: 'Dietary preferences',
		type: 'Text',
		content: 'Vegetarian on weekdays. Oat milk. No cilantro.',
	},
	{title: 'Flights', type: 'Text', content: 'Aisle seat, morning flights, carry-on only.'},
];

const SHARED_VAULT_ENTRIES: Array<{title: string; type: string; content: string}> = [
	{
		title: 'Company card',
		type: 'Text',
		content: 'Visa Business ending 4417, exp 08/29. Ask Dana before paying anything.',
	},
	{
		title: 'Billing address',
		type: 'Address',
		content: 'Acme Corp\n88 Spear St, Floor 3\nSan Francisco, CA 94105',
	},
	{
		title: 'How we write',
		type: 'Text',
		content: 'Short sentences. Friendly, never pushy. Sign off as the team.',
	},
];

for (const [connectionId, entries] of [
	[vault.id, VAULT_ENTRIES],
	[sharedVault.id, SHARED_VAULT_ENTRIES],
] as const) {
	for (const values of entries) {
		await db.vaultEntry.create({
			data: {connectionId, collectionId: 'entries', values: encrypt(JSON.stringify(values))},
		});
	}
}

// ---- The agent ------------------------------------------------------------------------------

const AGENT_PASSWORD = 'demo-password';
const PROVIDER: AgentProviderId = 'instinct';
const agent = await db.agent.create({
	data: {
		orgId: org.id,
		ownerUserId: user.id,
		createdById: user.id,
		providerId: PROVIDER,
		name: 'Instinct',
		username: `instinct-${EMAIL.split('@')[0]}`,
		passwordHash: await Bun.password.hash(AGENT_PASSWORD),
		createdAt: daysAgo(60),
		lastActiveAt: new Date(now - 20 * SECOND),
	},
});
// Its settings of its own: it may post in Slack, and the company card in the shared vault is kept
// from it, so paying anything is left to Dana.
for (const grant of [
	{connectionId: slack.id, actionId: 'slack_send_message', allowed: true},
	{connectionId: sharedVault.id, actionId: 'readEntries', allowed: false},
	{connectionId: linear.id, actionId: 'create', allowed: true},
]) {
	await db.agentGrant.create({data: {agentId: agent.id, ...grant}});
}

// ---- Tasks and their requests ---------------------------------------------------------------

// A request, as the activity log keeps it: on a connection's collection, an action, the record's
// title or what was searched for, and how it went where it didn't go through.
type Call = {
	on: Connection;
	collection: string;
	action: string;
	title?: string;
	query?: string;
	outcome?: 'denied' | 'failed';
	error?: string;
	// How long it took; a usual request's time where left out.
	ms?: number;
};

// A run of requests one after another, from `at`, a few seconds apart.
type Burst = {at: number; calls: Call[]};

// A task: started at `from`, finished at `to` with its outcome, or still under way where `to` is
// null; its own requests in bursts, and the tasks it handed on to sub-agents. Times are in hours,
// from the start of the story it is in.
type Task = {
	title: string;
	goal: string;
	outcome: string | null;
	from: number;
	to: number | null;
	bursts: Burst[];
	parts?: Task[];
};

// How long a request took: most well under a second, a few a good deal longer.
function requestMs(call: Call): number {
	if (call.ms !== undefined) {
		return call.ms;
	}
	if (call.on === exa || call.on === parallel) {
		return Math.round(1800 + random() * 4500);
	}
	return Math.round(180 + random() ** 3 * 2600);
}

let taskCount = 0;
let entryCount = 0;

// When the task, or the last of the tasks it handed on at any depth, started, in hours.
function lastStart(task: Task): number {
	return Math.max(task.from, ...(task.parts ?? []).map(lastStart));
}

// Seeds the task and everything under it, `origin` being where its story's hour 0 is.
async function seedTask(task: Task, origin: number, parentId: string | null): Promise<void> {
	const at = (hours: number) => origin + hours * HOUR;
	const row = await db.agentTask.create({
		data: {
			orgId: org.id,
			ownerUserId: user.id,
			agentId: agent.id,
			parentId,
			title: task.title,
			goal: task.goal,
			via: 'mcp',
			createdAt: new Date(at(task.from)),
			lastStartedAt: new Date(at(lastStart(task))),
			finishedAt: task.to === null ? null : new Date(at(task.to)),
			outcome: task.to === null ? null : task.outcome,
		},
	});
	taskCount += 1;
	for (const burst of task.bursts) {
		let time = at(burst.at);
		for (const call of burst.calls) {
			time += (2 + random() * 9) * SECOND;
			const durationMs = requestMs(call);
			time += durationMs;
			await db.auditEntry.create({
				data: {
					orgId: org.id,
					ownerUserId: user.id,
					agentId: agent.id,
					connectionId: call.on.id,
					collectionId: call.collection,
					action: call.action,
					recordTitle: call.title ?? null,
					query: call.query ?? null,
					outcome: call.outcome ?? 'allowed',
					error: call.error ?? null,
					via: 'mcp',
					taskId: row.id,
					durationMs,
					createdAt: new Date(time),
				},
			});
			entryCount += 1;
		}
	}
	for (const part of task.parts ?? []) {
		await seedTask(part, origin, row.id);
	}
}

// The requests by kind, so the stories read as what was done.
const mail = {
	search: (query: string): Call => ({on: google, collection: 'emails', action: 'list', query}),
	read: (title: string): Call => ({on: google, collection: 'emails', action: 'view', title}),
	draft: (title: string): Call => ({on: google, collection: 'emails', action: 'create', title}),
	send: (title: string): Call => ({on: google, collection: 'emails', action: 'sendNew', title}),
	reply: (title: string): Call => ({on: google, collection: 'emails', action: 'send', title}),
	archive: (title: string): Call => ({on: google, collection: 'emails', action: 'archive', title}),
	flag: (title: string): Call => ({on: google, collection: 'emails', action: 'flag', title}),
	markRead: (title: string): Call => ({
		on: google,
		collection: 'emails',
		action: 'markRead',
		title,
	}),
};
const calendar = {
	list: (query?: string): Call => ({
		on: google,
		collection: 'events',
		action: 'list',
		...(query ? {query} : {}),
	}),
	read: (title: string): Call => ({on: google, collection: 'events', action: 'view', title}),
	create: (title: string): Call => ({on: google, collection: 'events', action: 'create', title}),
	update: (title: string): Call => ({on: google, collection: 'events', action: 'update', title}),
};
const drive = {
	search: (query: string): Call => ({on: google, collection: 'files', action: 'list', query}),
	read: (title: string): Call => ({on: google, collection: 'files', action: 'view', title}),
	create: (title: string): Call => ({on: google, collection: 'files', action: 'create', title}),
	readRange: (title: string): Call => ({on: google, collection: 'ranges', action: 'read', title}),
	writeRange: (title: string): Call => ({
		on: google,
		collection: 'ranges',
		action: 'write',
		title,
	}),
};
const contacts = {
	search: (query: string): Call => ({on: google, collection: 'contacts', action: 'list', query}),
	create: (title: string): Call => ({on: google, collection: 'contacts', action: 'create', title}),
};
const web = {
	search: (title: string): Call => ({on: exa, collection: 'searches', action: 'run', title}),
	deepSearch: (title: string): Call => ({
		on: parallel,
		collection: 'searches',
		action: 'run',
		title,
	}),
	read: (url: string): Call => ({on: exa, collection: 'pages', action: 'read', title: url}),
};
const pages = {
	search: (query: string): Call => ({on: notion, collection: 'pages', action: 'list', query}),
	read: (title: string): Call => ({on: notion, collection: 'pages', action: 'view', title}),
	create: (title: string): Call => ({on: notion, collection: 'pages', action: 'create', title}),
	update: (title: string): Call => ({on: notion, collection: 'pages', action: 'update', title}),
};
const meetings = {
	search: (query: string): Call => ({on: granola, collection: 'notes', action: 'list', query}),
	read: (title: string): Call => ({on: granola, collection: 'notes', action: 'view', title}),
	transcript: (title: string): Call => ({
		on: granola,
		collection: 'transcripts',
		action: 'view',
		title,
	}),
};
const chat = {
	search: (query: string): Call => ({
		on: slack,
		collection: 'tools',
		action: 'slack_search_messages',
		query: JSON.stringify({query}),
	}),
	thread: (channel: string): Call => ({
		on: slack,
		collection: 'tools',
		action: 'slack_read_thread',
		query: JSON.stringify({channel}),
	}),
	post: (channel: string, text: string): Call => ({
		on: slack,
		collection: 'tools',
		action: 'slack_send_message',
		query: JSON.stringify({channel, text}),
	}),
};
const entries = {
	read: (title: string): Call => ({on: vault, collection: 'entries', action: 'view', title}),
};
const money = {
	balances: (): Call => ({on: bank, collection: 'accounts', action: 'list'}),
	transactions: (query?: string): Call => ({
		on: bank,
		collection: 'transactions',
		action: 'list',
		...(query ? {query} : {}),
	}),
	transaction: (title: string): Call => ({
		on: bank,
		collection: 'transactions',
		action: 'view',
		title,
	}),
};
const issues = {
	create: (title: string): Call => ({on: linear, collection: 'issues', action: 'create', title}),
};

const LEADS_SHEET = 'Office leads';

// Three days of finding the team an office, handed out to sub-agents along the way, in hours from
// when it started: Tuesday the leads and the emails to brokers, Wednesday waiting for their
// replies, Thursday the replies and a shortlist the team votes on, Friday the viewings. The task's
// page folds a quiet stretch only where it would take more than a little of the chart, which is
// about 420 pixels wide: the first has to be well over a quarter of the run, as the wait on
// Wednesday is, and once it is folded the night to Friday folds too, leaving every step wide
// enough for a row of its own.
const OFFICE: Task = {
	title: 'Finding an office',
	goal: 'We are outgrowing the coworking space. Find an office for the team in San Francisco: 12 desks now, room for 20 next year, SoMa, the Mission or Jackson Square, under $18,000 a month, moving in by January 15. Shortlist the best ones with the team and set up viewings.',
	outcome:
		'Two viewings on Tuesday, both in the team’s calendars with the brokers invited: 135 Townsend St, 4th floor, at 10:00 ($16,400 a month, 4,100 sq ft) and 2 Henry Adams St, Suite 300, at 14:00 ($15,200 a month, 3,800 sq ft). 600 Battery St is the backup. The shortlist, the costs and a checklist for the viewings are in Notion. The broker for Townsend asks for a $2,000 holding deposit, which is left for Dana: a draft reply is waiting in Gmail.',
	from: 0,
	to: 77.3,
	bursts: [
		{at: 0, calls: [entries.read('Office'), pages.search('office')]},
		{at: 4.3, calls: [drive.readRange(`'${LEADS_SHEET}'!A1:J10`)]},
		{at: 47.9, calls: [mail.search('Inquiry')]},
		{at: 71.4, calls: [pages.read('Office shortlist')]},
		{
			at: 77.0,
			calls: [
				pages.update('Office shortlist'),
				chat.post(
					'#general',
					'Office viewings are booked for Tuesday: 135 Townsend at 10:00 and 2 Henry Adams at 14:00. Details in Notion.',
				),
			],
		},
	],
	parts: [
		{
			title: 'Gather the requirements',
			goal: 'Find out what the team needs from an office: how many desks, rooms, where and for how much.',
			outcome:
				'12 desks now and 20 by next autumn, two meeting rooms and a phone booth, a short walk from BART or Caltrain, up to $18,000 a month, moving in by January 15.',
			from: 0.03,
			to: 0.42,
			bursts: [
				{
					at: 0.04,
					calls: [
						pages.read('Office requirements'),
						meetings.search('office'),
						meetings.read('Team sync: where do we sit next year?'),
						meetings.transcript('Team sync: where do we sit next year?'),
						chat.search('office in:#general'),
						chat.thread('#general'),
					],
				},
				{
					at: 0.3,
					calls: [drive.search('Budget 2027'), drive.readRange("'Budget 2027'!B4:M9")],
				},
			],
		},
		{
			title: 'Generate leads',
			goal: 'Find every office for lease that fits the requirements, and put them in a sheet, best first.',
			outcome:
				'31 listings found; 9 fit the size, the budget and the move-in date. All in the sheet “Office leads”, best first.',
			from: 0.45,
			to: 4.1,
			bursts: [
				{at: 0.46, calls: [web.search('office space for lease San Francisco 3,500–4,500 sq ft')]},
				{
					at: 3.5,
					calls: [
						drive.create(LEADS_SHEET),
						drive.writeRange(`'${LEADS_SHEET}'!A1:J32`),
						drive.writeRange(`'${LEADS_SHEET}'!L1:L32`),
						drive.readRange(`'${LEADS_SHEET}'!A1:J10`),
					],
				},
			],
			parts: [
				{
					title: 'Search listings in SoMa',
					goal: 'Find offices for lease in SoMa with 12 to 20 desks, under $18,000 a month.',
					outcome:
						'14 listings, 5 that fit; the best is 135 Townsend St, 4th floor, at $16,400 a month.',
					from: 0.5,
					to: 2.2,
					bursts: [
						{
							at: 0.51,
							calls: [
								web.search('SoMa office lease 4,000 sq ft January'),
								web.read('https://www.loopnet.com/Listing/135-Townsend-St-San-Francisco-CA/'),
								web.read('https://www.loopnet.com/Listing/625-2nd-St-San-Francisco-CA/'),
								web.search('South Park San Francisco office sublease'),
								{
									...web.search('SoMa creative office for lease'),
									outcome: 'failed',
									error: 'provider_unreachable 429',
								},
							],
						},
						{
							at: 1.4,
							calls: [
								web.search('SoMa creative office for lease'),
								web.read('https://www.crexi.com/lease/properties/sf-soma-460-bryant'),
								web.read('https://www.officespace.com/ca/san-francisco/soma/townsend'),
								web.deepSearch('Reviews of 135 Townsend St building management'),
							],
						},
					],
				},
				{
					title: 'Search listings in the Mission',
					goal: 'Find offices for lease in the Mission and Design District with 12 to 20 desks.',
					outcome:
						'9 listings, 2 that fit: 2 Henry Adams St, Suite 300, and 2101 Mission St, 2nd floor.',
					from: 0.52,
					to: 1.6,
					bursts: [
						{
							at: 0.53,
							calls: [
								web.search('Mission District office space for lease 4,000 sq ft'),
								web.read('https://www.loopnet.com/Listing/2-Henry-Adams-St-San-Francisco-CA/'),
								web.read('https://www.loopnet.com/Listing/2101-Mission-St-San-Francisco-CA/'),
								web.deepSearch('Design District San Francisco office lease under $18k'),
							],
						},
					],
				},
				{
					title: 'Search listings in Jackson Square',
					goal: 'Find offices for lease in Jackson Square and the Financial District edge.',
					outcome: '8 listings, 2 that fit; 600 Battery St is the best of them.',
					from: 0.55,
					to: 2.6,
					bursts: [
						{
							at: 0.56,
							calls: [
								web.search('Jackson Square office for lease brick and timber'),
								web.read('https://www.loopnet.com/Listing/600-Battery-St-San-Francisco-CA/'),
							],
						},
						{
							at: 1.9,
							calls: [
								web.read('https://www.officespace.com/ca/san-francisco/jackson-square'),
								web.deepSearch('600 Battery St office availability 2027'),
							],
						},
					],
				},
				{
					title: 'Check the commutes',
					goal: 'For the best listings, how long the walk is from BART and Caltrain.',
					outcome: 'All five are within 10 minutes of BART or Caltrain; Townsend is 3 minutes.',
					from: 2.7,
					to: 3.3,
					bursts: [
						{
							at: 2.71,
							calls: [
								web.search('walking time 135 Townsend St to Caltrain 4th and King'),
								web.search('walking time 2 Henry Adams St to 16th St BART'),
								web.search('walking time 600 Battery St to Embarcadero BART'),
							],
						},
					],
				},
			],
		},
		{
			title: 'Email the brokers',
			goal: 'Write to the broker of each listing that fits: is it still available, what does it cost all in, and can we see it next week.',
			outcome:
				'Wrote to six brokers about nine spaces, asking about availability, the total monthly cost and a viewing next week.',
			from: 4.4,
			to: 6.1,
			bursts: [{at: 4.41, calls: [contacts.search('broker'), mail.search('from:broker')]}],
			parts: (
				[
					['Bayside Commercial', '135 Townsend St, 4th floor'],
					['Mission Realty Group', '2 Henry Adams St, Suite 300'],
					['Kearny Partners', '600 Battery St, 2nd floor'],
					['Bayside Commercial', '625 2nd St, Suite 210'],
					['Dogpatch Property Co', '2101 Mission St, 2nd floor'],
					['Northgate Leasing', '460 Bryant St, 3rd floor'],
				] as const
			).map(([broker, address], index) => ({
				title: `Write to ${broker}`,
				goal: `Ask ${broker} about ${address}: available from January, the total monthly cost, and a viewing next week.`,
				outcome: `Sent the inquiry about ${address}.`,
				from: 4.55 + index * 0.18,
				to: 4.55 + index * 0.18 + 0.09,
				bursts: [
					{
						at: 4.56 + index * 0.18,
						calls: [
							contacts.search(broker),
							mail.draft(`Inquiry: ${address}`),
							mail.send(`Inquiry: ${address}`),
						],
					},
				],
			})),
		},
		{
			title: 'Follow up on the replies',
			goal: 'Read what the brokers answered, update the sheet and ask for what is missing.',
			outcome:
				'Five brokers answered. Two spaces are gone; seven are left, three of them under budget with move-in in December. Asked for the floor plans of the three.',
			from: 48.0,
			to: 50.4,
			bursts: [
				{
					at: 48.02,
					calls: [
						mail.read('Re: Inquiry: 135 Townsend St, 4th floor'),
						mail.read('Re: Inquiry: 2 Henry Adams St, Suite 300'),
						mail.read('Re: Inquiry: 600 Battery St, 2nd floor'),
						mail.read('Re: Inquiry: 625 2nd St, Suite 210'),
						mail.read('Re: Inquiry: 460 Bryant St, 3rd floor'),
						drive.writeRange(`'${LEADS_SHEET}'!K1:N10`),
						mail.reply('Re: Inquiry: 135 Townsend St, 4th floor'),
						mail.reply('Re: Inquiry: 2 Henry Adams St, Suite 300'),
					],
				},
				{
					at: 50.0,
					calls: [mail.search('floor plan'), mail.read('Re: Inquiry: 600 Battery St, 2nd floor')],
				},
			],
			parts: [
				{
					title: 'Read the floor plans',
					goal: 'Check the floor plans: do 20 desks, two meeting rooms and a phone booth fit?',
					outcome:
						'Townsend and Henry Adams fit 20 desks and two rooms; Battery fits 18 with one room.',
					from: 48.9,
					to: 49.8,
					bursts: [
						{
							at: 48.91,
							calls: [
								drive.read('Floor plan, 135 Townsend 4F.pdf'),
								drive.read('Floor plan, 2 Henry Adams 300.pdf'),
								web.read('https://www.kearnypartners.com/listings/600-battery/floorplan'),
							],
						},
					],
				},
			],
		},
		{
			title: 'Shortlist with the team',
			goal: 'Put the best three side by side, with the costs, and let the team vote.',
			outcome:
				'Shortlist of three in Notion. The team voted for 135 Townsend St and 2 Henry Adams St, with 600 Battery St as the backup.',
			from: 50.9,
			to: 55.7,
			bursts: [
				{
					at: 52.0,
					calls: [
						pages.create('Office shortlist'),
						pages.update('Office shortlist'),
						chat.post(
							'#general',
							'Three offices made the shortlist, details in Notion. Vote in the thread by tomorrow.',
						),
					],
				},
				{at: 54.1, calls: [chat.thread('#general')]},
				{at: 55.5, calls: [chat.thread('#general'), pages.update('Office shortlist')]},
			],
			parts: [
				{
					title: 'Compare the costs',
					goal: 'The total monthly cost of each, with parking, utilities and fees, against the budget and what is in the bank.',
					outcome:
						'All three fit the budget; Henry Adams is the cheapest all in, at $15,200 a month.',
					from: 50.95,
					to: 51.8,
					bursts: [
						{
							at: 50.96,
							calls: [
								drive.readRange(`'${LEADS_SHEET}'!A1:N10`),
								drive.readRange("'Budget 2027'!B4:M9"),
								money.balances(),
								drive.writeRange(`'${LEADS_SHEET}'!O1:R4`),
							],
						},
					],
				},
			],
		},
		{
			title: 'Schedule the viewings',
			goal: 'Book a viewing of the two favorites when the team can come, and put them in everyone’s calendar.',
			outcome:
				'Viewings on Tuesday at 10:00 at 135 Townsend St and at 14:00 at 2 Henry Adams St, in everyone’s calendar with the brokers invited.',
			from: 71.5,
			to: 73.5,
			bursts: [
				{
					at: 72.3,
					calls: [
						mail.send('Viewing request: 135 Townsend St, 4th floor'),
						mail.send('Viewing request: 2 Henry Adams St, Suite 300'),
					],
				},
				{
					at: 73.2,
					calls: [
						mail.read('Re: Viewing request: 135 Townsend St, 4th floor'),
						mail.read('Re: Viewing request: 2 Henry Adams St, Suite 300'),
						calendar.create('Office viewing: 135 Townsend St'),
						calendar.create('Office viewing: 2 Henry Adams St'),
						calendar.update('Office viewing: 135 Townsend St'),
						calendar.update('Office viewing: 2 Henry Adams St'),
						contacts.create('Dana Whitfield, Bayside Commercial'),
						contacts.create('Marcus Lee, Mission Realty Group'),
					],
				},
			],
			parts: [
				{
					title: 'Find a time for everyone',
					goal: 'Find the times next week when the team is free for two hours.',
					outcome: 'Tuesday 10:00 to 12:00 and 14:00 to 16:00 are free for everyone.',
					from: 71.55,
					to: 72.2,
					bursts: [
						{
							at: 71.56,
							calls: [
								calendar.list(),
								calendar.list('Team offsite'),
								calendar.read('Weekly planning'),
								calendar.read('Investor call'),
								calendar.list(),
							],
						},
					],
				},
			],
		},
		{
			title: 'Hold the favorite space',
			goal: 'Ask Bayside Commercial to hold 135 Townsend St until the viewing.',
			outcome:
				'Bayside asks for a $2,000 holding deposit. The company card is not open to agents, so paying is left to Dana: a draft reply is waiting in Gmail.',
			from: 73.6,
			to: 74.2,
			bursts: [
				{
					at: 73.61,
					calls: [
						mail.reply('Re: Viewing request: 135 Townsend St, 4th floor'),
						mail.read('Re: Holding 135 Townsend St'),
						{
							on: sharedVault,
							collection: 'entries',
							action: 'view',
							title: 'Company card',
							outcome: 'denied',
						},
						mail.draft('Re: Holding 135 Townsend St'),
					],
				},
			],
		},
		{
			title: 'Prepare for the viewings',
			goal: 'What to look at and ask at each viewing, and what the move would take.',
			outcome:
				'A checklist for the viewings in Notion, the questions for each broker, and an issue in Linear for planning the move.',
			from: 74.3,
			to: 77.0,
			bursts: [
				{
					at: 75.4,
					calls: [
						pages.create('Viewing checklist'),
						pages.update('Office shortlist'),
						issues.create('Plan the office move'),
					],
				},
			],
			parts: [
				{
					title: 'Read the lease terms',
					goal: 'Read the lease summaries and note what to ask about: term, deposit, fees, build-out.',
					outcome:
						'Townsend wants a 3-year term and two months’ deposit; Henry Adams is flexible at 2 years. Questions noted for both.',
					from: 74.35,
					to: 75.2,
					bursts: [
						{
							at: 74.36,
							calls: [
								mail.search('lease summary'),
								drive.read('Lease summary, 135 Townsend St.pdf'),
								drive.read('Lease summary, 2 Henry Adams St.pdf'),
								web.search('San Francisco office lease typical CAM charges 2026'),
							],
						},
					],
				},
				{
					title: 'Plan the move',
					goal: 'What moving in January would take: movers, internet, furniture.',
					outcome: 'Three movers to ask for quotes, and internet takes four weeks to set up.',
					from: 75.7,
					to: 76.9,
					bursts: [
						{
							at: 75.72,
							calls: [
								web.search('office movers San Francisco quotes'),
								web.search('business fiber internet install time San Francisco'),
								pages.update('Viewing checklist'),
							],
						},
					],
				},
			],
		},
	],
};

// Started Tuesday morning if it is shown on Friday afternoon, and finished within the hour.
await seedTask(OFFICE, now - 78 * HOUR, null);

// The rest of the home page's last 24 hours, each a few hours long so its bar has room for its
// name, in the lane under the office's.

// Under way right now: hour 0 is five and a half hours ago.
const GROCERIES: Task = {
	title: 'Order groceries',
	goal: 'Order groceries for the week, delivered tomorrow when someone is home. Mostly what we always get, and brunch for six on Sunday.',
	outcome: null,
	from: 0,
	to: null,
	bursts: [
		{at: 0.005, calls: [entries.read('Dietary preferences'), entries.read('Home')]},
		{at: 1.6, calls: [pages.create('Shopping list')]},
		{at: 2.4, calls: [pages.update('Shopping list')]},
		{
			at: 4.4,
			calls: [
				mail.search('Greenleaf Market substitutions'),
				mail.read('Two items are out of stock'),
			],
		},
	],
	parts: [
		{
			title: 'Plan the week’s meals',
			goal: 'Five dinners for the week and brunch for six on Sunday, from what we like and the last order.',
			outcome: 'Five dinners and Sunday’s brunch planned; 34 items, most from the last order.',
			from: 0.02,
			to: 0.7,
			bursts: [
				{
					at: 0.021,
					calls: [
						mail.search('Greenleaf Market order'),
						mail.read('Your Greenleaf Market order #48213'),
						pages.read('Recipes we like'),
						calendar.read('Brunch at ours (6 people)'),
					],
				},
				{at: 0.5, calls: [pages.read('Recipes we like')]},
			],
		},
		{
			title: 'Compare the stores',
			goal: 'What the list costs at Greenleaf Market and at the two stores that deliver tomorrow.',
			outcome: 'Greenleaf is $14 cheaper for the whole list and has every item.',
			from: 0.75,
			to: 1.5,
			bursts: [
				{
					at: 0.76,
					calls: [
						web.search('Greenleaf Market delivery prices'),
						web.read('https://www.greenleafmarket.com/delivery'),
						web.deepSearch('grocery delivery San Francisco Mission tomorrow'),
					],
				},
			],
		},
		{
			title: 'Pick a delivery slot',
			goal: 'Find a two-hour slot tomorrow when someone is home.',
			outcome: null,
			from: 5.0,
			to: null,
			bursts: [{at: 5.02, calls: [calendar.list(), calendar.read('Climbing')]}],
		},
	],
};
await seedTask(GROCERIES, now - 5.5 * HOUR, null);

// Finished this morning: hour 0 is twelve hours ago.
const EXPENSES: Task = {
	title: 'October expenses',
	goal: 'Match every business transaction in October to a receipt, and list the ones without one.',
	outcome:
		'48 transactions, 45 matched to a receipt; the three without one are marked in the sheet.',
	from: 0,
	to: 4.9,
	bursts: [
		{
			at: 0.005,
			calls: [money.transactions('October')],
		},
		{
			at: 4.6,
			calls: [
				{
					...drive.writeRange("'October expenses'!A1:F49"),
					outcome: 'failed',
					error: 'provider_unreachable 503',
				},
				drive.writeRange("'October expenses'!A1:F49"),
			],
		},
	],
	parts: [
		{
			title: 'Match the receipts',
			goal: 'Find the receipt for each transaction in the inboxes and the receipts folder.',
			outcome: '45 of 48 matched.',
			from: 0.05,
			to: 2.4,
			bursts: [
				{
					at: 0.06,
					calls: [
						mail.search('receipt after:2026/09/30'),
						mail.read('Your receipt from Harbor Coworking'),
						mail.read('Your Figma invoice'),
						money.transaction('AWS'),
						drive.search('receipts October'),
						mail.read('Your Lyft receipt'),
						money.transaction('Blue Bottle Coffee'),
					],
				},
				{
					at: 2.1,
					calls: [
						money.transaction('Office Depot'),
						mail.search('invoice after:2026/09/30'),
						mail.read('Invoice INV-2291'),
					],
				},
			],
		},
		{
			title: 'Ask for the missing receipts',
			goal: 'Write to the vendors whose receipts are missing.',
			outcome: 'Asked three vendors for their receipts; two have answered.',
			from: 2.5,
			to: 4.0,
			bursts: [
				{
					at: 2.51,
					calls: [
						mail.send('Receipt for invoice 7731'),
						mail.send('Receipt for order 55-1902'),
						mail.send('Receipt for your October visit'),
					],
				},
				{at: 3.8, calls: [mail.read('Re: Receipt for invoice 7731')]},
			],
		},
	],
};
await seedTask(EXPENSES, now - 12 * HOUR, null);

// Last night: hour 0 is 21 hours ago.
const LISBON: Task = {
	title: 'Trip to Lisbon',
	goal: 'Flights to Lisbon for the conference, November 14 to 18, a place to stay near the venue, and the days blocked in the calendar.',
	outcome:
		'Flights on TAP, November 14 to 18, aisle seats, $812. An apartment in Príncipe Real held until Monday. The days are blocked in the calendar.',
	from: 0,
	to: 5.2,
	bursts: [
		{at: 0.005, calls: [entries.read('Flights'), calendar.list('November 14')]},
		{at: 5.0, calls: [calendar.create('Lisbon: Web Summit')]},
	],
	parts: [
		{
			title: 'Find flights',
			goal: 'Morning flights SFO to LIS on November 14, back on the 18th, aisle seats, carry-on only.',
			outcome: 'TAP via Newark, $812, aisle seats both ways.',
			from: 0.05,
			to: 2.2,
			bursts: [
				{
					at: 0.06,
					calls: [
						web.deepSearch('SFO to LIS November 14 morning flights'),
						web.read('https://www.google.com/travel/flights?q=SFO+LIS+Nov+14'),
						web.search('TAP Air Portugal SFO Lisbon seat map'),
					],
				},
				{at: 1.9, calls: [mail.read('Your TAP booking: 9KX2LM')]},
			],
		},
		{
			title: 'Find a place to stay',
			goal: 'An apartment within 20 minutes of the venue, quiet, with a desk.',
			outcome: 'An apartment in Príncipe Real, held until Monday.',
			from: 2.4,
			to: 4.8,
			bursts: [
				{
					at: 2.41,
					calls: [
						web.search('apartment with desk Príncipe Real Lisbon November'),
						web.read('https://www.airbnb.com/s/Principe-Real--Lisbon'),
						mail.send('Booking request: November 14 to 18'),
					],
				},
				{at: 4.5, calls: [mail.read('Re: Booking request: November 14 to 18')]},
			],
		},
	],
};
await seedTask(LISBON, now - 21 * HOUR, null);

// Earlier in the week, for zooming out: each with when it started, in days ago.
const EARLIER: Array<[number, Task]> = [
	[
		1.2,
		{
			title: 'Triage the inbox',
			goal: 'Go through the new emails, archive the newsletters and flag anything that needs an answer today.',
			outcome: '31 new emails: 22 archived, 4 flagged for today, 5 left to read.',
			from: 0,
			to: 0.25,
			bursts: [
				{
					at: 0.004,
					calls: [
						mail.search('is:unread'),
						mail.read('Re: Inquiry: 625 2nd St, Suite 210'),
						mail.flag('Re: Inquiry: 625 2nd St, Suite 210'),
						mail.archive('The Weekly Product Digest'),
						mail.archive('Your October statement is ready'),
						mail.read('Board meeting: agenda'),
						mail.flag('Board meeting: agenda'),
						mail.markRead('Welcome to the beta!'),
						mail.archive('Last chance: 20% off'),
						mail.read('Can we move our 1:1?'),
						mail.flag('Can we move our 1:1?'),
					],
				},
			],
		},
	],
	[
		1.6,
		{
			title: 'Book a table for Saturday',
			goal: 'A table for six on Saturday at 8 near home, somewhere with vegetarian options.',
			outcome: 'Booked Flour + Water for six on Saturday at 20:00, in the calendar.',
			from: 0,
			to: 0.12,
			bursts: [
				{
					at: 0.005,
					calls: [
						entries.read('Dietary preferences'),
						web.search('vegetarian friendly restaurants Mission table for six'),
						calendar.create('Dinner at Flour + Water (6 people)'),
					],
				},
			],
		},
	],
	[
		2.3,
		{
			title: 'Renew the car insurance',
			goal: 'The car insurance runs out next month. Compare three quotes and renew the best.',
			outcome:
				'Three quotes compared; the current insurer is cheapest after asking. Renewal is ready to sign.',
			from: 0,
			to: 0.6,
			bursts: [
				{
					at: 0.005,
					calls: [
						mail.search('insurance renewal'),
						mail.read('Your policy renews on November 18'),
						web.deepSearch('car insurance quotes California 2027 Tesla Model 3'),
						mail.send('Renewal quote for policy CA-55120'),
					],
				},
				{at: 0.5, calls: [mail.read('Re: Renewal quote for policy CA-55120')]},
			],
		},
	],
	[
		4.2,
		{
			title: 'Find a dentist near the office',
			goal: 'A dentist near the office who takes our insurance, with a cleaning before December.',
			outcome: 'Booked a cleaning at Embarcadero Dental on November 12 at 08:30.',
			from: 0,
			to: 0.4,
			bursts: [
				{
					at: 0.005,
					calls: [
						entries.read('Office'),
						web.search('dentist near 88 Spear St accepting Delta Dental'),
						calendar.list(),
						calendar.create('Dentist: cleaning'),
					],
				},
			],
		},
	],
	[
		5.1,
		{
			title: 'Cancel unused subscriptions',
			goal: 'Find the subscriptions nobody has used in three months and list them.',
			outcome: 'Four unused subscriptions, $86 a month; listed for Dana to cancel.',
			from: 0,
			to: 0.3,
			bursts: [
				{
					at: 0.005,
					calls: [
						money.transactions('subscription'),
						mail.search('subscription renewed'),
						pages.create('Subscriptions to cancel'),
					],
				},
			],
		},
	],
];
for (const [startedDaysAgo, task] of EARLIER) {
	await seedTask(task, now - startedDaysAgo * DAY, null);
}

// ---- A sign-in link -------------------------------------------------------------------------

const link = await signInLink(EMAIL, `/${WORKSPACE_SLUG}`);
const connectionCount = await db.connection.count({where: {orgId: org.id}});

console.log(
	`[demo] ${connectionCount} connections, 1 agent, ${taskCount} tasks and ${entryCount} activity entries for ${EMAIL}.`,
);
console.log(`[demo] Sign in, once, within 24 hours: ${link}`);
console.log(`[demo] Later, ask for a magic link for ${EMAIL}; the api prints it.`);
await db.$disconnect();
