// What `bun run seed` and `bun run demo` share: the checks that they run against the local database
// only, the api's encryption, wiping a person's workspace and a sign-in link for them.
import {createCipheriv, createHash, randomBytes} from 'node:crypto';

import {db} from '../src';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

const DAY = 24 * 60 * 60 * 1000;

// Both delete what they find under the email they seed, so never against anything but the local
// database.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !URL.canParse(databaseUrl) || !LOCAL_HOSTS.has(new URL(databaseUrl).hostname)) {
	console.error('[seed] DATABASE_URL is not the local database; see .env.example.');
	process.exit(1);
}

const encryptionKey = process.env.ENCRYPTION_KEY;
const authSecret = process.env.AUTH_SECRET;
if (!encryptionKey || !authSecret) {
	console.error('[seed] ENCRYPTION_KEY and AUTH_SECRET are needed; see .env.example.');
	process.exit(1);
}
const key = Buffer.from(encryptionKey, 'base64');

/** Encrypted in the api's format (`packages/api/src/utils/secret-crypto.ts`), so it can read what is seeded. */
export function encrypt(plaintext: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const parts = [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url'));
	return ['v1', ...parts].join('.');
}

/** Deletes the person with this email and the organizations they own, with all that is in them. */
export async function wipeUser(email: string): Promise<void> {
	const existing = await db.user.findUnique({where: {email}, select: {id: true}});
	if (!existing) {
		return;
	}
	// The organizations they own: one they were invited into is someone else's.
	const orgs = await db.organization.findMany({
		where: {ownerUserId: existing.id},
		select: {id: true},
	});
	const orgIds = orgs.map((org) => org.id);
	await db.auditEntry.deleteMany({where: {orgId: {in: orgIds}}});
	await db.agentTask.deleteMany({where: {orgId: {in: orgIds}}});
	await db.organization.deleteMany({where: {id: {in: orgIds}}});
	await db.user.delete({where: {id: existing.id}});
}

/**
 * A magic link as the api makes one (`packages/api/src/auth/email.ts`), to `callbackPath` after
 * signing in: only the token's hash is stored, and it works once, within a day.
 */
export async function signInLink(email: string, callbackPath: string): Promise<string> {
	const token = randomBytes(32).toString('hex');
	await db.verificationToken.create({
		data: {
			identifier: email,
			token: createHash('sha256').update(`${token}${authSecret}`).digest('hex'),
			expires: new Date(Date.now() + DAY),
		},
	});
	const apiUrl = process.env.VITE_PROXY_API_URL ?? 'http://localhost:4000';
	const query = new URLSearchParams({token, email, callbackUrl: callbackPath});
	return `${apiUrl}/auth/email/verify?${query}`;
}
