import assert from "node:assert/strict";
import test from "node:test";
import {
	classify,
	createJevClient,
	startServer,
	taskAssessmentProfile,
	type JsonObject,
} from "../index.ts";

const skip = process.env.TYPESAFE_API_KEY === undefined ? "TYPESAFE_API_KEY not set" : false;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

test("live Jev answers Choice, Score, and Noul", { skip }, async () => {
	const result = await classify(createJevClient(), taskAssessmentProfile, [
		{ role: "user", content: "Add a health endpoint and a test that asserts it returns HTTP 200." },
	]);
	const category = result.output.category;
	const clarity = result.output.clarity;
	const selfContained = result.output.self_contained;
	assert.ok(isRecord(category));
	assert.equal(category.type, "choice");
	assert.equal(typeof category.choice, "string");
	assert.ok(isRecord(clarity));
	assert.equal(clarity.type, "score");
	assert.equal(typeof clarity.score, "number");
	assert.ok(isRecord(selfContained));
	assert.equal(selfContained.type, "noul");
	assert.equal(typeof selfContained.noul, "number");
	assert.ok((selfContained.noul as number) >= 0 && (selfContained.noul as number) <= 1);
	assert.ok(result.usage.input_tokens > 0);
});

test("live facade round trip", { skip }, async () => {
	const server = await startServer([taskAssessmentProfile], {
		port: 0,
		logger: () => {},
	});
	try {
		const response = await fetch(`${server.url}/v1/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model: "task-assessment",
				messages: [{ role: "user", content: "Explain why the sky appears blue." }],
			}),
		});
		assert.equal(response.status, 200);
		const body = await response.json() as JsonObject;
		assert.equal(body.object, "chat.completion");
		assert.equal(body.model, "task-assessment");
		const choices = body.choices;
		assert.ok(Array.isArray(choices));
		const first = choices[0];
		assert.ok(isRecord(first));
		assert.ok(isRecord(first.message));
		assert.equal(typeof first.message.content, "string");
		const content = JSON.parse(first.message.content as string) as unknown;
		assert.ok(isRecord(content));
		assert.ok(isRecord(content.category));
		assert.ok(isRecord(content.clarity));
		assert.ok(isRecord(content.self_contained));
	} finally {
		await server.close();
	}
});
