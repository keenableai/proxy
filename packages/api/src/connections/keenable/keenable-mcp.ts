import {type Result} from 'ts-results-es';
import {z} from 'zod';

import {ApiErr, type ApiError} from '@proxy/utils';

import {parseToolJson} from '../mcp/mcp-client';
import type {McpServer} from '../mcp/mcp-oauth';

/**
 * Keenable's MCP server, at the address that takes a sign-in or an API key (its keyless one is
 * `/mcp` beside it), and what its tools answer when asked for JSON: a search's results each a
 * page's address, title, publish date where known and a snippet of its text, and a page read its
 * title and text as Markdown. A page it couldn't read fails the tool, saying why in words: "Error
 * fetching https://…: The page does not exist at this URL.". Results are written out as Exa writes
 * its own, so an agent reads them all the same. Its sign-in is Keenable's Supabase authorization
 * server, as the server's protected resource metadata names it.
 */

const SERVER = 'https://api.keenable.ai/mcp-oauth';

const AUTH_BASE = 'https://caqmfcgrdovyjdhfnwzw.supabase.co/auth/v1';

export const KEENABLE: McpServer = {
	name: 'Keenable',
	// Keenable labels each request with the app it came from, `keenable_title` where a client can't
	// set its `X-Keenable-Title` header; the tokens are for the address without it.
	url: `${SERVER}?keenable_title=personal-agent-proxy`,
	resource: SERVER,
	registerUrl: `${AUTH_BASE}/oauth/clients/register`,
	authorizeUrl: `${AUTH_BASE}/oauth/authorize`,
	tokenUrl: `${AUTH_BASE}/oauth/token`,
	// Supabase's own default; Keenable asks for nothing more.
	scope: 'email',
	toolError: (text) => ApiErr.validationError(`Keenable turned it down: ${text.trim() || 'it didn’t say why'}`),
};

const resultSchema = z.object({
	url: z.string(),
	title: z.string().nullish(),
	// `2026-10-27T00:39:34Z`, where Keenable knows it.
	published_at: z.string().nullish(),
	// The page's text where it fits the query, as it is, with its line breaks. Its `description` is
	// always empty.
	snippet: z.string().nullish(),
});

const searchSchema = z.object({results: z.array(resultSchema)});

const pageSchema = z.object({url: z.string(), title: z.string().nullish(), content: z.string().nullish()});

/** A `search_web_pages` answer written out as Exa writes its results: a block a page, between "---" lines. */
export function formatKeenableResults(text: string): Result<string, ApiError> {
	return parseToolJson(text, searchSchema).map(({results}) =>
		results
			.map((result) =>
				[`Title: ${result.title || result.url}`, `URL: ${result.url}`, `Published: ${result.published_at?.slice(0, 10) || 'N/A'}`, 'Highlights:', (result.snippet ?? '').trim()].join('\n'),
			)
			.join('\n\n---\n\n'),
	);
}

/** A page's title and text out of what `fetch_page_content` answers. */
export function parseKeenablePage(text: string): Result<{title: string; content: string}, ApiError> {
	return parseToolJson(text, pageSchema).map((page) => ({title: page.title ?? '', content: (page.content ?? '').trim()}));
}
