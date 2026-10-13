import type {Metadata} from 'next';
import {LegalLink, LegalList, LegalPage, LegalSection} from '@/components/legal-page';
import {LEGAL} from '@/lib/legal';

export const metadata: Metadata = {
	title: 'Terms of service · Personal Agent Proxy',
	description: 'The terms for using the hosted Personal Agent Proxy.',
};

export default function TermsPage() {
	return (
		<LegalPage title="Terms of service">
			<LegalSection title="The service">
				<p>
					Personal Agent Proxy holds the accounts and information your AI agents work with: you
					connect your services, give each agent a login of its own, and decide what each may do.
					These terms cover the hosted service at{' '}
					<LegalLink href="https://app.personalagentproxy.com">
						app.personalagentproxy.com
					</LegalLink>
					, run by {LEGAL.legalEntity} (&quot;we&quot;). By using it, you agree to them. The code is
					open source under the MIT License; a copy you run yourself is under that license, not
					these terms.
				</p>
			</LegalSection>

			<LegalSection title="Your account">
				<p>
					You keep your sign-in safe, and you are responsible for what is done with your account.
					The <LegalLink href="/privacy/">privacy policy</LegalLink> says what we do with your data.
				</p>
			</LegalSection>

			<LegalSection title="Your agents">
				<p>
					You choose which agents get a login and what each may do with each connection. You are
					responsible for the agents you authorize and for what they do with the access you give
					them, including the emails they send and the files and records they change. Each agent is
					run by its own company under that company&apos;s terms, and we are not responsible for
					what an agent does within the access you gave it.
				</p>
			</LegalSection>

			<LegalSection title="Acceptable use">
				<p>You agree not to use Personal Agent Proxy to:</p>
				<LegalList>
					<li>break the law or help anyone else break it;</li>
					<li>
						connect a service you have no right to use, or use a connected service against its own
						terms, such as by sending spam;
					</li>
					<li>
						reach accounts or data that aren&apos;t yours, or test, probe or attack the service
						without our permission;
					</li>
					<li>overload the service or get in the way of anyone else using it.</li>
				</LegalList>
			</LegalSection>

			<LegalSection title="No warranty">
				<p>
					The service is provided as is and as available, without warranties of any kind, express or
					implied, including merchantability, fitness for a particular purpose and non-infringement.
					We don&apos;t promise it will be uninterrupted, error-free or that it will keep working
					with every connected service.
				</p>
			</LegalSection>

			<LegalSection title="Limitation of liability">
				<p>
					To the extent the law allows, we are not liable for any indirect, incidental, special,
					consequential or punitive damages, or for lost data, profits or revenue, arising from your
					use of the service or from what your agents do with it. Where the law doesn&apos;t allow
					this limit, our liability is limited to the smallest amount it allows.
				</p>
			</LegalSection>

			<LegalSection title="Ending">
				<p>
					You can stop using the service at any time, disconnect your connections, and ask us to
					delete your account by writing to {LEGAL.contactEmail}. We can suspend or end your access
					if you break these terms or to protect the service or others.
				</p>
			</LegalSection>

			<LegalSection title="Governing law">
				<p>These terms are governed by the laws of {LEGAL.jurisdiction}.</p>
			</LegalSection>

			<LegalSection title="Changes and contact">
				<p>
					When these terms change, the new version is posted on this page with a new effective date;
					using the service after that means you accept it. Questions go to {LEGAL.contactEmail}.
				</p>
			</LegalSection>
		</LegalPage>
	);
}
