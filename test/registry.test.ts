import assert from "node:assert/strict";
import test from "node:test";
import { createRegistry, defineProfile, noul } from "../index.ts";

function profile(name: string) {
	return defineProfile({
		name,
		questions: { ok: noul("ok?") },
		compose: () => ({ ok: true }),
	});
}

test("registry gets, checks, and lists profiles without exposing its array", () => {
	const first = profile("first");
	const registry = createRegistry([first]);
	assert.equal(registry.get("first"), first);
	assert.equal(registry.has("first"), true);
	const listed = registry.list();
	listed.length = 0;
	assert.equal(registry.list().length, 1);
});

test("registry rejects duplicate, empty, and reserved names", () => {
	assert.throws(() => createRegistry([profile("same"), profile("same")]), /Duplicate/);
	assert.throws(() => createRegistry([{ ...profile("valid"), name: " " }]), /must not be empty/);
	assert.throws(() => createRegistry([profile("jev-adhoc")]), /reserved/);
});
