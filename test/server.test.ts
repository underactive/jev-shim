import assert from "node:assert/strict";
import test from "node:test";
import {
	noul,
	rawAnswersProfile,
	type JsonObject,
} from "../index.ts";
import {
	cannedSystemOneResult,
	jsonResponse,
	startTestServer,
	type FetchHandler,
} from "./helpers/jev-fetch.ts";

const profile = rawAnswersProfile("raw", { ready: noul("Ready?") });
const success = cannedSystemOneResult({ ready: { type: "noul", noul: 0.8 } }, {
	inputTokens: 11,
	outputTokens: 4,
});

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function post(url: string, body: unknown): Promise<Response> {
	return fetch(`${url}/v1/chat/completions`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

async function errorCode(response: Response): Promise<string | null> {
	const body = await response.json() as unknown;
	assert.ok(isRecord(body) && isRecord(body.error));
	return typeof body.error.code === "string" ? body.error.code : null;
}

test("facade returns the exact non-streaming completion envelope", async () => {
	const lines: string[] = [];
	const server = await startTestServer([profile], () => jsonResponse(success), {
		logger: (line) => lines.push(line),
		now: () => 1_700_000_000_000,
		idFactory: () => "chatcmpl-test",
	});
	try {
		const response = await post(server.url, {
			model: "raw",
			messages: [{ role: "user", content: "task" }],
			temperature: 0,
			max_completion_tokens: 10,
			response_format: { type: "json_object" },
		});
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), {
			id: "chatcmpl-test",
			object: "chat.completion",
			created: 1_700_000_000,
			model: "raw",
			choices: [{
				index: 0,
				message: { role: "assistant", content: "{\"ready\":{\"type\":\"noul\",\"noul\":0.8}}" },
				finish_reason: "stop",
			}],
			usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 },
		});
		assert.equal(server.requests.length, 1);
		assert.equal(lines.length, 1);
		assert.equal(lines[0].includes("task"), false);
	} finally {
		await server.close();
	}
});

test("facade validates chat requests and lists registered profiles", async () => {
	const server = await startTestServer([profile], () => jsonResponse(success), { logger: () => {} });
	try {
		const cases: Array<[unknown, string]> = [
			[{ model: "raw", stream: true, messages: [] }, "stream_not_supported"],
			[{ model: "raw" }, "invalid_request"],
			[{ model: "missing", messages: [] }, "unknown_profile"],
			[{ model: "raw", jev: { questions: {} }, messages: [] }, "adhoc_not_allowed"],
			[{ model: "jev-adhoc", jev: { questions: {} }, messages: [] }, "adhoc_disabled"],
			[{ model: "raw", jev_profile: 7, messages: [] }, "invalid_request"],
		];
		for (const [body, code] of cases) {
			const response = await post(server.url, body);
			assert.equal(response.status, 400);
			assert.equal(await errorCode(response), code);
		}
		const unknown = await post(server.url, { model: "missing", messages: [] });
		assert.match(await unknown.text(), /raw/);
		const malformed = await fetch(`${server.url}/v1/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{",
		});
		assert.equal(malformed.status, 400);
		assert.equal(await errorCode(malformed), "invalid_json");
	} finally {
		await server.close();
	}
});

test("health, models, not-found, and method handling use JSON envelopes", async () => {
	const server = await startTestServer([profile], () => jsonResponse(success), {
		adhoc: true,
		logger: () => {},
		now: () => 2_000,
	});
	try {
		const health = await fetch(`${server.url}/health?probe=1`);
		assert.deepEqual(await health.json(), { ok: true, profiles: ["raw", "jev-adhoc"] });
		const models = await fetch(`${server.url}/v1/models`);
		assert.deepEqual(await models.json(), {
			object: "list",
			data: [
				{ id: "raw", object: "model", created: 2, owned_by: "jev-shim" },
				{ id: "jev-adhoc", object: "model", created: 2, owned_by: "jev-shim" },
			],
		});
		assert.equal((await fetch(`${server.url}/missing`)).status, 404);
		const wrongMethod = await fetch(`${server.url}/health`, { method: "POST" });
		assert.equal(wrongMethod.status, 405);
		assert.equal(wrongMethod.headers.get("allow"), "GET");
	} finally {
		await server.close();
	}
});

test("oversized bodies return 413", async () => {
	const server = await startTestServer([profile], () => jsonResponse(success), {
		maxBodyBytes: 32,
		logger: () => {},
	});
	try {
		const response = await post(server.url, { model: "raw", messages: [], padding: "x".repeat(100) });
		assert.equal(response.status, 413);
		assert.equal(await errorCode(response), "body_too_large");
	} finally {
		await server.close();
	}
});

test("upstream 529 maps to 502 and 429 preserves retry-after", async () => {
	for (const [handler, expectedStatus, code, retryAfter] of [
		[(() => jsonResponse({ detail: "busy" }, 529)) as FetchHandler, 502, "api", null],
		[(() => jsonResponse({ detail: "slow" }, 429, { "retry-after": "9" })) as FetchHandler, 429, "rate_limit", "9"],
	] as const) {
		const server = await startTestServer([profile], handler, { logger: () => {} });
		try {
			const response = await post(server.url, { model: "raw", messages: [] });
			assert.equal(response.status, expectedStatus);
			assert.equal(await errorCode(response), code);
			assert.equal(response.headers.get("retry-after"), retryAfter);
		} finally {
			await server.close();
		}
	}
});

test("facade deadline maps an abort-aware upstream to 504", async () => {
	const handler: FetchHandler = (request) => new Promise<Response>((_resolve, reject) => {
		request.signal?.addEventListener("abort", () => reject(request.signal?.reason), { once: true });
	});
	const server = await startTestServer([profile], handler, {
		requestTimeoutMs: 20,
		logger: () => {},
	});
	try {
		const response = await post(server.url, { model: "raw", messages: [] });
		assert.equal(response.status, 504);
		assert.equal(await errorCode(response), "timeout");
	} finally {
		await server.close();
	}
});

test("maxInFlight rejects excess work without queueing", async () => {
	let resolveFirst: ((response: Response) => void) | undefined;
	const handler: FetchHandler = (_request, index) => index === 0
		? new Promise<Response>((resolve) => { resolveFirst = resolve; })
		: jsonResponse(success);
	const server = await startTestServer([profile], handler, {
		maxInFlight: 1,
		requestTimeoutMs: 1_000,
		logger: () => {},
	});
	try {
		const first = post(server.url, { model: "raw", messages: [] });
		while (server.requests.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));
		const second = await post(server.url, { model: "raw", messages: [] });
		assert.equal(second.status, 503);
		assert.equal(await errorCode(second), "overloaded");
		assert.ok(resolveFirst);
		resolveFirst(jsonResponse(success));
		assert.equal((await first).status, 200);
	} finally {
		await server.close();
	}
});

test("debug logging includes request and composed output", async () => {
	const lines: string[] = [];
	const server = await startTestServer([profile], () => jsonResponse(success), {
		debug: true,
		logger: (line) => lines.push(line),
	});
	try {
		assert.equal((await post(server.url, { model: "raw", messages: [{ role: "user", content: "visible-debug" }] })).status, 200);
		assert.equal(lines.length, 1);
		assert.match(lines[0], /visible-debug/);
		assert.match(lines[0], /output/);
	} finally {
		await server.close();
	}
});
