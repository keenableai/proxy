import {Err, Ok, type Result} from 'ts-results-es';

import {ApiErr, type ApiError} from '@proxy/utils';
import type {Integration} from '@proxy/integrations';

import {readGoogleCredential} from './google/google-oauth';
import {unavailableGoogleActions} from './google/scopes';

/**
 * The actions a connection's sign-in didn't cover, which no default or agent setting turns on:
 * Google's consent screen lets a person untick some of what is asked for, so its connections keep
 * what Google granted. Every other integration's sign-in covers all its actions.
 */

type StoredConnection = {integrationId: string; credential: string | null};

/** The connection's actions its sign-in didn't cover, in the catalog's order. */
export function unavailableActions(connection: StoredConnection): Result<string[], ApiError> {
	if (connection.integrationId !== 'google') {
		return Ok([]);
	}
	return readGoogleCredential(connection.credential).map(unavailableGoogleActions);
}

/** The refusal of an action the sign-in didn't cover, saying how to allow it. */
export function unavailableError(integration: Integration, actionId: string): ApiError {
	const label = integration.actions.find((action) => action.id === actionId)?.label ?? actionId;
	return ApiErr.validationError(`${integration.name} didn't allow ${label} at sign-in. Sign in to ${integration.name} again to allow it.`);
}

/** Refuses turning on an action the sign-in didn't cover; turning one off, or back to the default, is fine. */
export function refuseUnavailable(integration: Integration, unavailable: string[], actions: Record<string, boolean | null>): Result<void, ApiError> {
	const turnedOn = Object.keys(actions).find((id) => actions[id] === true && unavailable.includes(id));
	if (turnedOn !== undefined) {
		return Err(unavailableError(integration, turnedOn));
	}
	return Ok(undefined);
}
