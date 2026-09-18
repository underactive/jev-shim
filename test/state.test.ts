import assert from "node:assert/strict";
import test from "node:test";
import { defaultBuildState, transcriptState } from "../index.ts";

test("defaultBuildState uses opening and latest distinct user messages", () => {
	assert.deepEqual(defaultBuildState([
		{ role: "system", content: "drop" },
		{ role: "user", content: "opening" },
		{ role: "assistant", content: "answer" },
		{ role: "user", content: "latest" },
	]), { opening_task: "opening", latest_message: "latest" });
	assert.deepEqual(defaultBuildState([
		{ role: "user", content: "same" },
		{ role: "user", content: "same" },
	]), { opening_task: "same" });
});

test("defaultBuildState falls back to a filtered role-ordered transcript", () => {
	assert.deepEqual(defaultBuildState([
		{ role: "developer", content: "drop" },
		{ role: "assistant", content: "first" },
		{ role: "tool", content: "second" },
	]), { transcript: "assistant: first\ntool: second" });
});

test("transcriptState preserves every role and order", () => {
	assert.deepEqual(transcriptState([
		{ role: "system", content: "s" },
		{ role: "user", content: "u" },
	]), { transcript: "system: s\nuser: u" });
});
