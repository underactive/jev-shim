import assert from "node:assert/strict";
import test from "node:test";
import { assertQuestionsFit, truncateState, truncateText } from "../index.ts";

test("truncateText returns an exact head/tail-marked length", () => {
	const value = truncateText("abcdefghijklmnopqrstuvwxyz".repeat(5), 50);
	assert.equal(value.length, 50);
	assert.match(value, /…\[truncated \d+ chars\]…/);
	assert.ok(value.startsWith("abc"));
	assert.ok(value.endsWith("xyz"));
});

test("truncateState preserves an under-budget value by identity", () => {
	const state = { text: "short" };
	const result = truncateState(state, JSON.stringify(state).length);
	assert.equal(result.state, state);
	assert.equal(result.truncated, false);
});

test("truncateState shortens the longest leaf and measures serialized escaping", () => {
	const state = { short: "keep", long: `head${"\\\"".repeat(100)}tail` };
	const result = truncateState(state, 100);
	assert.equal(result.truncated, true);
	assert.ok(JSON.stringify(result.state).length <= 100);
	assert.equal((result.state as { short: string }).short, "keep");
	assert.match((result.state as { long: string }).long, /truncated/);
});

test("truncateState drops array middle elements while preserving ends", () => {
	const state = { values: Array.from({ length: 20 }, (_, index) => `v${index}`) };
	const result = truncateState(state, 30).state as { values: string[] };
	assert.equal(result.values[0], "v0");
	assert.equal(result.values.at(-1), "v19");
	assert.ok(result.values.length < 20);
});

test("Unicode is budgeted on the final JSON representation", () => {
	const result = truncateState({ text: "😀".repeat(100) }, 80);
	assert.ok(JSON.stringify(result.state).length <= 80);
});

test("structural overhead, oversized questions, and invalid limits reject", () => {
	assert.throws(() => truncateState({ extremely_long_key_name: true }, 2), /cannot be truncated/);
	assert.throws(() => assertQuestionsFit({ q: "x".repeat(20) }, 10), /questions payload/);
	assert.throws(() => truncateText("abc", 0), /positive integer/);
});
