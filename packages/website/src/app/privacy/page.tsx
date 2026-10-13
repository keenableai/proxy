import type {Metadata} from 'next';
import {LegalCode, LegalLink, LegalList, LegalPage, LegalSection} from '@/components/legal-page';
import {LEGAL} from '@/lib/legal';

export const metadata: Metadata = {
	title: 'Privacy policy · Personal Agent Proxy',
	description:
		'How Personal Agent Proxy accesses, uses, stores and shares your data, including Google user data.',
};

const GOOGLE_USER_DATA_POLICY = 'https://developers.google.com/terms/api-services-user-data-policy';

// What a Google sign-in for a connection asks for, as the connector requests it, in plain words.
const GOOGLE_SCOPES = [
	{
		scopes: ['openid', 'https://www.googleapis.com/auth/userinfo.email'],
		use: "Your Google account's email address, to name the connection.",
	},
	{
		scopes: ['https://www.googleapis.com/auth/gmail.modify'],
		use: 'Read your email in Gmail, mark it read, star and label it, archive it, move it to Trash, and write drafts. Personal Agent Proxy never deletes email for good.',
	},
	{
		scopes: ['https://www.googleapis.com/auth/gmail.send'],
		use: 'Send email as you.',
	},
	{
		scopes: ['https://www.googleapis.com/auth/drive'],
		use: 'Browse and search your Google Drive, including files shared with you and shared drives, open files, and create, rename, edit and move files to Trash.',
	},
	{
		scopes: ['https://www.googleapis.com/auth/documents'],
		use: 'Read and edit the content of your Google Docs.',
	},
	{
		scopes: ['https://www.googleapis.com/auth/spreadsheets'],
		use: 'Read and edit your Google Sheets.',
	},
	{
		scopes: ['https://www.googleapis.com/auth/presentations'],
		use: 'Read your Google Slides presentations.',
	},
];

export default function PrivacyPage() {
	return (
		<LegalPage title="Privacy policy">
			<LegalSection title="Who this covers">
				<p>
					Personal Agent Proxy holds the accounts and information your AI agents work with. You
					connect your services once and give each agent a login of its own, and each agent can do
					only what you allowed it. {LEGAL.legalEntity} runs the hosted service (&quot;we&quot;).
				</p>
				<p>
					This policy covers the hosted service at{' '}
					<LegalLink href="https://app.personalagentproxy.com">
						app.personalagentproxy.com
					</LegalLink>
					, this website and the docs at docs.personalagentproxy.com. Personal Agent Proxy is open
					source, and anyone can run a copy on their own server. A self-hosted copy is run by
					whoever hosts it, and this policy doesn&apos;t cover it.
				</p>
			</LegalSection>

			<LegalSection title="Your account">
				<p>
					You sign in with a link sent to your email address or with Google. With an email link, we
					keep your email address; the link is sent through Resend, an email delivery service. With
					Google, we ask Google only for your basic profile and keep your name, your email address,
					the address of your profile picture, your Google account id and the tokens Google returns
					for that sign-in. Signing in with Google gives Personal Agent Proxy no access to your
					Gmail, Drive or anything else in your Google account; that takes a Google connection,
					below.
				</p>
				<p>
					Each browser you sign in with is a session, kept in a cookie for 30 days or until you sign
					out. Your account has one organization, which holds your connections, your agents and
					their activity log.
				</p>
			</LegalSection>

			<LegalSection title="Your connections">
				<p>
					A connection is a service you connect: a mailbox with an app password, Google, Granola,
					Notion or Linear by signing in to them, or a PostgreSQL or MySQL database with a database
					user. We store what Personal Agent Proxy needs to reach the service, its app password,
					OAuth tokens or database password, encrypted at rest with AES-256-GCM under a key kept
					outside the database. We also keep the account the connection is for as the service names
					it, such as an email address, and which actions your agents may take with it.
				</p>
				<p>
					Nothing is synced or copied ahead of time. Each time one of your agents asks for
					something, Personal Agent Proxy fetches it from the service at that moment, hands it to
					the agent and keeps none of it, apart from the activity log described below.
				</p>
				<p>
					Information you type into Personal Agent Proxy itself, such as addresses, payment cards
					and notes, is stored in our database, encrypted the same way.
				</p>
			</LegalSection>

			<LegalSection title="Google user data">
				<p>
					When you connect a Google account, Google asks for your consent to the scopes below. Its
					consent screen lets you untick any of them; Personal Agent Proxy keeps the list of what
					you granted and uses only that.
				</p>
				<LegalList>
					{GOOGLE_SCOPES.map(({scopes, use}) => (
						<li key={scopes.join(' ')}>
							{scopes.map((scope, index) => (
								<span key={scope}>
									{index > 0 && ' and '}
									<LegalCode>{scope}</LegalCode>
								</span>
							))}
							: {use}
						</li>
					))}
				</LegalList>
				<p>
					<span className="text-foreground">How we use it.</span> Only to show it to, and act on it
					for, the AI agents you gave a login, with only the actions you ticked for each of them,
					each time one of your agents asks. Every request to Google is made at that moment; nothing
					is synced or copied ahead of time. We use Google user data for nothing else.
				</p>
				<p>
					<span className="text-foreground">What we store.</span> The tokens Google issues for the
					connection, with the scopes you granted and the account&apos;s email address, encrypted at
					rest with AES-256-GCM; the account&apos;s email address again as the connection&apos;s
					name; and the activity log. For each request an agent makes, the activity log keeps the
					agent, the connection, the action, whether it was allowed or denied, when, the title of
					the record it touched, such as an email&apos;s subject line or a file&apos;s name, and
					what a list searched for. The activity log is the one place data from Google is kept, and
					it is metadata you see on your own Activity page. The bodies of your emails and the
					contents of your files are never stored.
				</p>
				<p>
					<span className="text-foreground">Who it is shared with.</span> You, and the agents you
					authorized, each acting through a login you made and can revoke at any time. When one of
					your agents asks for your Google user data, Personal Agent Proxy transfers what it asked
					for to that agent, and so to the company that runs it, such as Anthropic for Claude,
					OpenAI for ChatGPT or The Interaction Company for Poke. This transfer to a third party is
					made only to provide the feature you asked for, only with the actions you ticked for that
					agent, and that company handles the data under its own terms and privacy policy. We share
					Google user data with no one else, except where the law requires it.
				</p>
				<p>
					<span className="text-foreground">What we never do.</span> No one at Personal Agent Proxy
					reads your Google user data, unless you ask us to for support and give your explicit
					consent, it is needed to investigate abuse or keep the service secure, or the law requires
					it. Google user data is never used to train, develop or improve any AI or machine learning
					model, ours or anyone else&apos;s; Personal Agent Proxy runs no model. It is never sold,
					never used for advertising, never transferred to data brokers or information resellers,
					and never used to determine creditworthiness or for lending.
				</p>
				<p>
					Personal Agent Proxy&apos;s use and transfer to any other app of information received from
					Google APIs will adhere to the{' '}
					<LegalLink href={GOOGLE_USER_DATA_POLICY}>Google API Services User Data Policy</LegalLink>
					, including the Limited Use requirements.
				</p>
				<p>
					<span className="text-foreground">Ending access.</span> Disconnecting the Google
					connection in Personal Agent Proxy revokes its tokens at Google and deletes them. You can
					also remove Personal Agent Proxy&apos;s access at{' '}
					<LegalLink href="https://myaccount.google.com/permissions">
						myaccount.google.com/permissions
					</LegalLink>
					, after which your agents&apos; requests to Google fail.
				</p>
			</LegalSection>

			<LegalSection title="Agents and the activity log">
				<p>
					You decide which agents get a login and what each may do with each connection. An
					agent&apos;s password is shown to you once; we keep only a hash of it. An agent that signs
					in through its own app over MCP gets tokens of which we keep only a hash.
				</p>
				<p>
					Every request an agent makes through a connection is checked against what you allowed it
					at that moment and written to the activity log, allowed or denied. You see the log on the
					Activity page, and you can change what an agent may do, revoke its login or delete it at
					any time.
				</p>
			</LegalSection>

			<LegalSection title="Cookies">
				<p>
					The app uses cookies to keep you signed in, to keep an agent signed in, to carry a sign-in
					with Google or to a service there and back, and to remember whether its sidebar is open.
					The docs use one cookie, for their sidebar; this website sets none. There are no
					advertising or analytics cookies. The theme you pick is kept in your browser&apos;s
					storage.
				</p>
			</LegalSection>

			<LegalSection title="Hosting and security">
				<p>
					The hosted service and its database run on Render, in its Oregon region in the United
					States; if you use it from elsewhere, your data is transferred there. Everything between
					your browser or your agents and Personal Agent Proxy is encrypted in transit with TLS, as
					are its requests to Google. A database you connect uses the encryption you choose when you
					connect it. Credentials and Information are encrypted at rest, and the database accepts
					connections only from our own services on Render. The server writes errors to its logs,
					which Render keeps.
				</p>
			</LegalSection>

			<LegalSection title="Retention and deletion">
				<LegalList>
					<li>
						A connection&apos;s credentials are kept until you disconnect it, which deletes them. A
						Google connection&apos;s tokens are revoked at Google first.
					</li>
					<li>Information records are kept until you delete them.</li>
					<li>
						The activity log is kept as long as your account exists. Nothing removes older entries,
						and an agent&apos;s or a connection&apos;s entries stay after the agent or the
						connection is deleted.
					</li>
					<li>A session ends after 30 days or when you sign out.</li>
					<li>
						To delete your account, write to {LEGAL.contactEmail}. We delete your account, your
						organization and everything in it: connections and their credentials, Information,
						agents and their logins, and the activity log. Deleting the account deletes your Google
						tokens but doesn&apos;t itself revoke them at Google, so disconnect Google first or
						remove access at myaccount.google.com/permissions.
					</li>
				</LegalList>
			</LegalSection>

			<LegalSection title="Open source and self-hosting">
				<p>
					The code that runs the hosted service is public at{' '}
					<LegalLink href="https://github.com/personalagentproxy/proxy">
						github.com/personalagentproxy/proxy
					</LegalLink>
					, so you can check what this policy says against it.
				</p>
				<p>
					Whoever runs a self-hosted copy controls the data in it and decides what happens to it. A
					self-hosted copy sends us one anonymous message a day, through PostHog, with a random id
					for the installation, its version and the time, and nothing else, unless its host turns it
					off; the{' '}
					<LegalLink href="https://docs.personalagentproxy.com/self-hosting/telemetry/">
						docs
					</LegalLink>{' '}
					say how. The hosted service sends none.
				</p>
			</LegalSection>

			<LegalSection title="Your choices">
				<p>
					You see your connections, your agents and their activity in the app at any time. To get a
					copy of your data, or to have it corrected or deleted, write to {LEGAL.contactEmail}.
				</p>
			</LegalSection>

			<LegalSection title="Changes and contact">
				<p>
					When this policy changes, the new version is posted on this page with a new effective
					date. Questions about privacy go to {LEGAL.contactEmail}.
				</p>
			</LegalSection>
		</LegalPage>
	);
}
