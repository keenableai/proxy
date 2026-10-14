import {type ApiError, Do} from '@proxy/utils';
import {countAccountConnections} from '@proxy/db/connection';

import {log, serializeError} from '../observability/log';
import {readGoogleCredential, revokeGoogleTokens} from './google/google-oauth';

/**
 * What is undone at the provider before a connection is deleted, where the provider has a way:
 * Google's grant is revoked, so its tokens stop working there too. Only Google has one so far. A
 * grant is the account's for the app's Google client as a whole, every refresh token it has, so
 * it is kept while another connection, in this organization or any other, is for the same
 * account. A failure is logged and the connection is deleted anyway; the person can still revoke
 * it at myaccount.google.com/permissions.
 */

type DisconnectedConnection = {id: string; integrationId: string; account: string; credential: string | null};

export async function beforeDisconnect(connection: DisconnectedConnection): Promise<void> {
	if (connection.integrationId !== 'google') {
		return;
	}

	const revoked = await Do<void, ApiError>(async ($) => {
		const sharing = $(await countAccountConnections({integrationId: connection.integrationId, account: connection.account}));
		if (sharing > 1) {
			log.info('Kept the Google grant another connection uses', {connectionId: connection.id});
			return;
		}
		$(await revokeGoogleTokens($(readGoogleCredential(connection.credential))));
	});
	if (revoked.isErr()) {
		const error = revoked.error;
		log.warn('Revoking a Google connection at Google failed', {connectionId: connection.id, kind: error.kind, ...('cause' in error ? serializeError(error.cause) : {})});
	}
}
