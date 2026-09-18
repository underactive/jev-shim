import type { Fetch } from "@typesafe-ai/sdk";
import {
	startServer,
	type FacadeOptions,
	type JsonObject,
	type Profile,
	type StartedServer,
} from "../../index.ts";

export interface RecordedRequest {
	url: string;
	method: string;
	headers: Headers;
	body: unknown;
	signal: AbortSignal | null;
}

export type FetchHandler = (request: RecordedRequest, index: number) => Response | Promise<Response>;

export interface RecordingFetch {
	fetch: Fetch;
	requests: RecordedRequest[];
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}

export function cannedSystemOneResult(
	answers: JsonObject,
	overrides: { model?: string; inputTokens?: number; outputTokens?: number } = {},
): JsonObject {
	return {
		model: overrides.model ?? "jev-1.13.0",
		answers,
		usage: {
			input_tokens: overrides.inputTokens ?? 12,
			output_tokens: overrides.outputTokens ?? 3,
		},
	};
}

export function recordingFetch(handler: FetchHandler): RecordingFetch {
	const requests: RecordedRequest[] = [];
	const fetch: Fetch = async (input, init) => {
		const rawBody = init?.body;
		const body = typeof rawBody === "string" && rawBody.length > 0 ? JSON.parse(rawBody) : undefined;
		const request: RecordedRequest = {
			url: input,
			method: init?.method ?? "GET",
			headers: new Headers(init?.headers),
			body,
			signal: init?.signal ?? null,
		};
		requests.push(request);
		return handler(request, requests.length - 1);
	};
	return { fetch, requests };
}

export async function startTestServer(
	profiles: Profile[],
	handler: FetchHandler,
	options: Omit<FacadeOptions, "client" | "jev"> = {},
): Promise<StartedServer & { requests: RecordedRequest[] }> {
	const recorded = recordingFetch(handler);
	const started = await startServer(profiles, {
		...options,
		host: "127.0.0.1",
		port: 0,
		jev: {
			apiKey: "test-key",
			baseURL: "http://jev.test",
			fetch: recorded.fetch,
			timeout: 100,
			retry: { maxRetries: 0 },
			logLevel: "off",
		},
	});
	return Object.assign(started, { requests: recorded.requests });
}
