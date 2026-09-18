import assert from "node:assert/strict";
import test from "node:test";
import type { Fetch } from "@typesafe-ai/sdk";
import {
	classify,
	createJevClient,
	JevFailure,
	noul,
	rawAnswersProfile,
} from "../index.ts";
import { cannedSystemOneResult, jsonResponse, recordingFetch } from "./helpers/jev-fetch.ts";

const profile = rawAnswersProfile("raw", { ready: noul("Ready?") });
const okResult = cannedSystemOneResult({ ready: { type: "noul", noul: 0.75 } }, {
	model: "jev-1.13.0",
	inputTokens: 9,
	outputTokens: 2,
});

function client(fetch: Fetch, timeout = 100) {
	return createJevClient({
		apiKey: "test",
		baseURL: "http://jev.test",
		fetch,
		timeout,
		retry: { maxRetries: 0 },
		logLevel: "off",
	});
}

test("classify sends state, resolved model, and questions through the SDK", async () => {
	const recorded = recordingFetch(() => jsonResponse(okResult));
	const result = await classify(client(recorded.fetch), profile, [{ role: "user", content: "task" }]);
	assert.equal(recorded.requests[0].url, "http://jev.test/v1/systemone");
	assert.equal(recorded.requests[0].method, "POST");
	assert.deepEqual(recorded.requests[0].body, {
		state: { opening_task: "task" },
		questions: JSON.parse(JSON.stringify(profile.questions)) as unknown,
		model: "jev-latest",
	});
	assert.deepEqual(result.output, { ready: { type: "noul", noul: 0.75 } });
	assert.equal(result.model, "jev-1.13.0");
	assert.deepEqual(result.usage, { input_tokens: 9, output_tokens: 2 });
});

test("classify maps HTTP API failures", async () => {
	const cases: Array<[number, JevFailure["kind"]]> = [
		[401, "auth"],
		[422, "invalid_request"],
		[529, "api"],
	];
	for (const [status, kind] of cases) {
		const recorded = recordingFetch(() => jsonResponse({ error: { message: "failed" } }, status));
		await assert.rejects(
			classify(client(recorded.fetch), profile, [{ role: "user", content: "task" }]),
			(error: unknown) => error instanceof JevFailure && error.kind === kind && error.status === status,
		);
	}
});

test("classify preserves rate-limit delay", async () => {
	const recorded = recordingFetch(() => jsonResponse({}, 429, { "retry-after": "7" }));
	await assert.rejects(
		classify(client(recorded.fetch), profile, [{ role: "user", content: "task" }]),
		(error: unknown) => error instanceof JevFailure
			&& error.kind === "rate_limit"
			&& error.retryAfter === "7"
			&& error.retryAfterMs === 7_000,
	);
});

test("classify maps connection failures", async () => {
	const fetch: Fetch = async () => { throw new Error("offline"); };
	await assert.rejects(
		classify(client(fetch), profile, [{ role: "user", content: "task" }]),
		(error: unknown) => error instanceof JevFailure && error.kind === "connection",
	);
});

test("classify enforces the SDK per-attempt timeout", async () => {
	const fetch: Fetch = (_input, init) => new Promise<Response>((_resolve, reject) => {
		init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
	});
	await assert.rejects(
		classify(client(fetch, 10), profile, [{ role: "user", content: "task" }], { deadlineMs: 1_000 }),
		(error: unknown) => error instanceof JevFailure && error.kind === "timeout",
	);
});

test("classify propagates caller cancellation into the injected fetch", async () => {
	let observedAbort = false;
	const fetch: Fetch = (_input, init) => new Promise<Response>((_resolve, reject) => {
		init?.signal?.addEventListener("abort", () => {
			observedAbort = true;
			reject(init.signal?.reason);
		}, { once: true });
	});
	const controller = new AbortController();
	const promise = classify(client(fetch), profile, [{ role: "user", content: "task" }], {
		signal: controller.signal,
	});
	controller.abort();
	await assert.rejects(promise, (error: unknown) => error instanceof JevFailure && error.kind === "timeout");
	assert.equal(observedAbort, true);
});
