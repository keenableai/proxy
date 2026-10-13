import {describe, expect, mock, test} from 'bun:test';
import {Err, Ok, type Result} from 'ts-results-es';

import {ApiErr, type ApiError} from '@proxy/utils';

// Readable stand-ins for encryption; a credential stored under another key won't decrypt.
mock.module('../utils/secret-crypto', () => ({
	decryptSecret: (stored: string): Result<string, ApiError> => (stored.startsWith('enc:') ? Ok(stored.slice('enc:'.length)) : Err(ApiErr.internalError(new Error('Unreadable secret')))),
}));

const ALL_SCOPES = [
	'openid',
	'https://www.googleapis.com/auth/userinfo.email',
	'https://www.googleapis.com/auth/gmail.modify',
	'https://www.googleapis.com/auth/gmail.send',
	'https://www.googleapis.com/auth/drive',
	'https://www.googleapis.com/auth/documents',
	'https://www.googleapis.com/auth/spreadsheets',
	'https://www.googleapis.com/auth/presentations',
];

function google(scopes: string[]) {
	const credential = {accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: null, scopes, email: 'alex@example.com'};
	return {integrationId: 'google', credential: `enc:${JSON.stringify(credential)}`};
}

describe('unavailableActions', () => {
	test('a Google sign-in that granted every scope covers every action', async () => {
		const {unavailableActions} = await import('./unavailable');

		expect(unavailableActions(google(ALL_SCOPES)).unwrap()).toEqual([]);
	});

	test('a Google sign-in without Drive leaves Read files out', async () => {
		const {unavailableActions} = await import('./unavailable');

		expect(unavailableActions(google(ALL_SCOPES.filter((scope) => !scope.endsWith('/drive')))).unwrap()).toEqual(['readFiles']);
	});

	test('every other integration covers all its actions, whatever its credential', async () => {
		const {unavailableActions} = await import('./unavailable');

		expect(unavailableActions({integrationId: 'email', credential: 'v1.unreadable'}).unwrap()).toEqual([]);
		expect(unavailableActions({integrationId: 'info', credential: null}).unwrap()).toEqual([]);
	});

	test("a Google credential that won't decrypt or read is an internal error", async () => {
		const {unavailableActions} = await import('./unavailable');

		expect(unavailableActions({integrationId: 'google', credential: 'v1.other-key'}).unwrapErr().kind).toBe('internal_error');
		expect(unavailableActions({integrationId: 'google', credential: 'enc:{"accessToken":1}'}).unwrapErr().kind).toBe('internal_error');
		expect(unavailableActions({integrationId: 'google', credential: 'enc:not json'}).unwrapErr().kind).toBe('internal_error');
		expect(unavailableActions({integrationId: 'google', credential: null}).unwrapErr().kind).toBe('internal_error');
	});
});

describe('refuseUnavailable', () => {
	test('refuses turning an unavailable action on, not off or back to the default', async () => {
		const {findIntegration} = await import('@proxy/integrations');
		const {refuseUnavailable} = await import('./unavailable');
		const integration = findIntegration('google');
		if (!integration) {
			throw new Error('No Google integration');
		}

		expect(refuseUnavailable(integration, ['readFiles'], {readFiles: true}).unwrapErr()).toMatchObject({
			kind: 'validation_error',
			message: "Google didn't allow Read files at sign-in. Sign in to Google again to allow it.",
		});
		expect(refuseUnavailable(integration, ['readFiles'], {readFiles: false}).isOk()).toBe(true);
		expect(refuseUnavailable(integration, ['readFiles'], {readFiles: null}).isOk()).toBe(true);
		expect(refuseUnavailable(integration, [], {readFiles: true}).isOk()).toBe(true);
	});
});
