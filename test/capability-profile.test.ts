import assert from "node:assert/strict";
import test from "node:test";
import type { Answers } from "../index.ts";
import {
	CAPABILITY_RULES,
	RULE_TO_BOUNDARY,
	TRAILING_ROUTING_INSTRUCTION,
	buildState,
	compose,
	isValidVerdict,
} from "../examples/capability-profile.ts";

function answers(rule: string, pSolve: number): Answers {
	return {
		primary_rule: {
			type: "choice",
			choice: rule,
			confidence: 0.8,
			probabilities: { [rule]: 0.8 },
		},
		p_solve: { type: "noul", noul: pSolve },
	} as unknown as Answers;
}

test("every capability rule composes a valid exact verdict", () => {
	for (const rule of CAPABILITY_RULES) {
		const verdict = compose(answers(rule.id, 0.6));
		assert.deepEqual(Object.keys(verdict).sort(), [
			"capability_boundary",
			"crux",
			"p_solve",
			"primary_rule",
		]);
		assert.equal(verdict.capability_boundary, RULE_TO_BOUNDARY[rule.id]);
		assert.equal(isValidVerdict(verdict), true, rule.id);
	}
});

test("deny-unknown-fields and the rule pairing are enforced", () => {
	const verdict = compose(answers("SUP-1", 0.5));
	assert.equal(isValidVerdict({ ...verdict, explanation: "extra" }), false);
	assert.equal(isValidVerdict({ ...verdict, capability_boundary: "unsupported" }), false);
	assert.equal(isValidVerdict({ ...verdict, crux: "  " }), false);
});

test("invalid p_solve values are rejected rather than clamped", () => {
	assert.throws(() => compose(answers("SUP-1", 1.5)), /between 0 and 1/);
	assert.throws(() => compose(answers("SUP-1", Number.NaN)), /between 0 and 1/);
});

test("unknown rule ids are rejected", () => {
	assert.throws(() => compose(answers("SUP-99", 0.5)), /unknown primary_rule/);
});

test("buildState removes packaged instructions and trailing routing instruction", () => {
	assert.deepEqual(buildState([
		{ role: "system", content: "rubric" },
		{ role: "developer", content: "hidden rubric" },
		{ role: "user", content: "Implement the task" },
		{ role: "assistant", content: "Working" },
		{ role: "user", content: `  ${TRAILING_ROUTING_INSTRUCTION}  ` },
	]), { opening_task: "Implement the task" });
});
