import {z} from 'zod';

import {Do} from '@proxy/utils';

import {signInRoutes} from '../connect-flow';
import {requireGoogleClient} from './google-client';
import {exchangeGoogleCode, googleAuthorizeUrl} from './google-oauth';

/**
 * Connecting a Google account by signing in to Google with the app's own Google client, the one
 * Google sign-in uses, asking for every scope at once. The account is the address signed in with,
 * so signing in again with it gives its connection the new tokens. A new Google connection lets
 * agents read Drive by default. Without a Google client set up, the start goes back to the catalog
 * with the error.
 */
export const {handleStart: handleStartGoogleRoute, handleCallback: handleGoogleCallbackRoute} = signInRoutes({
	integrationId: 'google',
	name: 'Google',
	keptSchema: z.null(),
	start: (request) =>
		Do(async ($) => {
			return {url: googleAuthorizeUrl($(requireGoogleClient()), request), kept: null};
		}),
	finish: ({redirectUri, code, verifier}) =>
		Do(async ($) => {
			const credential = $(await exchangeGoogleCode($(requireGoogleClient()), {redirectUri, code, verifier}));
			return {account: credential.email, credential, defaults: ['readFiles']};
		}),
});
