import assert from "node:assert/strict";
import test from "node:test";
import { adhocProfile, parseAdhocSpec, type RequestError } from "../index.ts";

const valid = {
	questions: {
		kind: { type: "choice", instructions: "kind?", criteria: { a: "A", b: null } },
		score: { type: "score", instructions: "score?", criteria: ["low", "high"] },
		ready: { type: "noul", instructions: "ready?", criteria: { true: "yes", false: "no" } },
	},
};

test("parseAdhocSpec builds all primitive types", () => {
	const parsed = parseAdhocSpec(valid);
	assert.deepEqual(parsed.questions, valid.questions);
});

test("explicit ad-hoc state, including null, beats message state", () => {
	const objectProfile = adhocProfile(parseAdhocSpec({ ...valid, state: { supplied: true } }));
	assert.deepEqual(objectProfile.buildState([{ role: "user", content: "ignored" }]), { supplied: true });
	const nullProfile = adhocProfile(parseAdhocSpec({ ...valid, state: null }));
	assert.equal(nullProfile.buildState([{ role: "user", content: "ignored" }]), null);
	const fallback = adhocProfile(parseAdhocSpec(valid));
	assert.deepEqual(fallback.buildState([{ role: "user", content: "used" }]), { opening_task: "used" });
});

test("ad-hoc validation reports the offending path", () => {
	const cases: Array<[unknown, string]> = [
		[{ questions: { "bad id": { type: "noul" } } }, "jev.questions.bad id"],
		[{ questions: { q: { type: "choice", criteria: {} } } }, "jev.questions.q.criteria"],
		[{ questions: { q: { type: "score", criteria: ["one"] } } }, "jev.questions.q.criteria"],
		[{ questions: { q: { type: "other" } } }, "jev.questions.q.type"],
		[{ ...valid, apiKey: "secret" }, "jev.apiKey"],
		[{ ...valid, state: true }, "jev.state"],
	];
	for (const [value, param] of cases) {
		assert.throws(() => parseAdhocSpec(value), (error: unknown) => {
			assert.equal((error as RequestError).param, param);
			return true;
		});
	}
});

test("noul accepts omitted criteria and unknown question fields reject", () => {
	assert.equal(parseAdhocSpec({ questions: { q: { type: "noul" } } }).questions.q.type, "noul");
	assert.throws(() => parseAdhocSpec({ questions: { q: { type: "noul", executable: "code" } } }), /Unknown field/);
});
