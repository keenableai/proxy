import {type ApiError, Do} from '@proxy/utils';

import {log, serializeError} from '../observability/log';
import {readGoogleCredential, revokeGoogleTokens} from './google/google-oauth';

/**
 * What is undone at the provider before a connection is deleted, where the provider has a way:
 * Google's grant is revoked, so its tokens stop working there too. Only Google has one so far. A
 * failure is logged and the connection is deleted anyway; the person can still revoke it at
 * myaccount.google.com/permissions.
 */

type DisconnectedConnection = {id: string; integrationId: string; credential: string | null};

export async function beforeDisconnect(connection: DisconnectedConnection): Promise<void> {
	if (connection.integrationId !== 'google') {
		return;
	}

	const revoked = await Do<void, ApiError>(async ($) => {
		$(await revokeGoogleTokens($(readGoogleCredential(connection.credential))));
	});
	if (revoked.isErr()) {
		const error = revoked.error;
		log.warn('Revoking a Google connection at Google failed', {connectionId: connection.id, kind: error.kind, ...('cause' in error ? serializeError(error.cause) : {})});
	}
}
