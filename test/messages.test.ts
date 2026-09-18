import assert from "node:assert/strict";
import test from "node:test";
import {
	dropTrailing,
	firstAndLastUser,
	normalizeMessages,
	withoutSystemMessages,
	type ChatMessage,
} from "../index.ts";

test("normalizeMessages joins text parts and normalizes assistant tool calls", () => {
	assert.deepEqual(normalizeMessages([
		{ role: "user", content: [{ type: "text", text: "one" }, { type: "text", text: "two" }] },
		{ role: "assistant", content: null, tool_calls: [{ id: "call" }] },
	]), [
		{ role: "user", content: "one\ntwo" },
		{ role: "assistant", content: "" },
	]);
});

test("normalizeMessages rejects malformed and non-text messages with paths", () => {
	for (const value of [null, {}, "messages"]) {
		assert.throws(() => normalizeMessages(value), /messages must be an array/);
	}
	assert.throws(() => normalizeMessages([{ role: "user", content: [{ type: "image_url", image_url: {} }] }]), /messages\[0\]\.content\[0\]\.type/);
	assert.throws(() => normalizeMessages([{ role: "assistant", content: null, tool_calls: [] }]), /must not be null/);
	assert.throws(() => normalizeMessages([{ role: "unknown", content: "x" }]), /messages\[0\]\.role/);
});

test("message helpers filter instructions, trailing messages, and first/last users without mutation", () => {
	const messages: ChatMessage[] = [
		{ role: "system", content: "s" },
		{ role: "developer", content: "d" },
		{ role: "user", content: "u1" },
		{ role: "assistant", content: "a" },
		{ role: "user", content: "u2" },
		{ role: "user", content: "u3" },
		{ role: "user", content: "tail" },
	];
	const snapshot = structuredClone(messages);
	assert.deepEqual(withoutSystemMessages(messages).map((message) => message.content), ["u1", "a", "u2", "u3", "tail"]);
	assert.deepEqual(dropTrailing(messages, (message) => message.content === "tail").map((message) => message.content), ["s", "d", "u1", "a", "u2", "u3"]);
	assert.notStrictEqual(dropTrailing(messages, () => false), messages);
	assert.deepEqual(firstAndLastUser(messages).map((message) => message.content), ["u1", "tail"]);
	assert.deepEqual(firstAndLastUser([{ role: "user", content: "only" }]), [{ role: "user", content: "only" }]);
	assert.deepEqual(firstAndLastUser([{ role: "assistant", content: "none" }]), []);
	assert.deepEqual(messages, snapshot);
});
