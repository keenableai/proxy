import {Err, Result} from 'ts-results-es';
import type {z} from 'zod';

import {ApiErr, type ApiError, Do, parseSchema, requirePresent} from '@proxy/utils';
import {updateConnectionCredential} from '@proxy/db/connection';

import {log} from '../observability/log';
import {decryptSecret, encryptSecret} from '../utils/secret-crypto';

/**
 * A connection's OAuth tokens, kept fresh: read from the encrypted credential, refreshed as they
 * run out, one refresh at a time per connection on each server, and saved only over the ones they
 * replace. The MCP integrations use it; what a credential holds and how it is refreshed is the
 * provider's.
 */

type StoredConnection = {id: string; credential: string | null};

/** How one provider's credential is read and refreshed. */
export type TokenRefresher<C> = {
	// The provider's name in errors and logs: "Notion".
	name: string;
	// What the decrypted credential holds.
	schema: z.ZodType<C>;
	isExpiring: (credential: C) => boolean;
	// New tokens; turned down once the provider revoked the sign-in.
	refresh: (credential: C) => Promise<Result<C, ApiError>>;
};

// The credential as stored, encrypted, beside what it holds.
type Session<C> = {stored: string; credential: C};

// Refreshes under way on this server, by connection and the credential they replace, so requests
// running at once share one: Notion turns down a refresh token used after it was replaced, and
// revokes the whole sign-in for it. Each holds the new credential as stored, which every request
// sharing it reads for itself.
const renewing = new Map<string, Promise<Result<string, ApiError>>>();

function readSession<C>(refresher: TokenRefresher<C>, stored: string | null): Result<Session<C>, ApiError> {
	return Do<Session<C>, ApiError>(($) => {
		const present = $(requirePresent(stored, ApiErr.internalError(new Error(`${refresher.name} connection without a credential`))));
		const json = $(decryptSecret(present));
		const parsed = $(Result.wrap((): unknown => JSON.parse(json)).mapErr((cause) => ApiErr.internalError(cause)));
		return {stored: present, credential: $(parseSchema(refresher.schema, parsed))};
	});
}

// New tokens, saved for the next request unless another server saved its own first; this request
// goes on with these either way.
function refresh<C>(refresher: TokenRefresher<C>, connectionId: string, session: Session<C>): Promise<Result<string, ApiError>> {
	return Do(async ($) => {
		const credential = $(await refresher.refresh(session.credential));
		const stored = $(encryptSecret(JSON.stringify(credential)));
		const saved = $(await updateConnectionCredential({connectionId, credential: stored, previous: session.stored}));
		if (!saved) {
			log.warn(`${refresher.name} tokens were refreshed twice at once`, {connectionId});
		}
		return stored;
	});
}

// The refresh replacing this credential, started unless one already is.
function sharedRefresh<C>(refresher: TokenRefresher<C>, connectionId: string, session: Session<C>): Promise<Result<string, ApiError>> {
	const key = `${connectionId}:${session.stored}`;
	const running = renewing.get(key);
	if (running) {
		return running;
	}
	const renewal = refresh(refresher, connectionId, session).finally(() => renewing.delete(key));
	renewing.set(key, renewal);
	return renewal;
}

async function renew<C>(refresher: TokenRefresher<C>, connectionId: string, session: Session<C>): Promise<Result<Session<C>, ApiError>> {
	const stored = await sharedRefresh(refresher, connectionId, session);
	return stored.andThen((renewed) => readSession(refresher, renewed));
}

/**
 * Makes a call with a connection's credential: refreshed first when it is running out, and once
 * more when the provider turns it down anyway. A connection the provider won't refresh any more is
 * `credentials_rejected`, and has to be signed in again.
 */
export function callWithToken<C, T>(refresher: TokenRefresher<C>, connection: StoredConnection, call: (credential: C) => Promise<Result<T, ApiError>>): Promise<Result<T, ApiError>> {
	return Do(async ($) => {
		const read = $(readSession(refresher, connection.credential));
		const session = refresher.isExpiring(read.credential) ? $(await renew(refresher, connection.id, read)) : read;
		const first = await call(session.credential);
		if (first.isOk() || first.error.kind !== 'credentials_rejected') {
			return $(first);
		}
		if (session !== read) {
			return $(Err(first.error));
		}

		const renewed = $(await renew(refresher, connection.id, session));
		return $(await call(renewed.credential));
	});
}
