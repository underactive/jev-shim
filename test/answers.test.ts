import assert from "node:assert/strict";
import test from "node:test";
import {
	answersToJson,
	asChoice,
	asNoul,
	asScore,
	type Answers,
} from "../index.ts";

function fixture(): Answers {
	return {
		kind: { type: "choice", choice: "a", confidence: 0.7, probabilities: { a: 0.7, b: 0.3 } },
		quality: {
			type: "score",
			score: 1.25,
			confidence: 0.8,
			legend: { 0: "low", 1: "medium", 2: "high" },
			probabilities: { 0: 0.1, 1: 0.55, 2: 0.35 },
		},
		ready: { type: "noul", noul: 0.9 },
	} as unknown as Answers;
}

test("typed answer extractors discriminate and preserve fields", () => {
	const answers = fixture();
	assert.equal(asChoice(answers, "kind").choice, "a");
	assert.equal(asScore(answers, "quality").score, 1.25);
	assert.equal(asNoul(answers, "ready").noul, 0.9);
	assert.throws(() => asNoul(answers, "kind"), /expected noul/);
	assert.throws(() => asChoice(answers, "missing"), /Missing answer/);
});

test("answersToJson preserves full typed result fields", () => {
	assert.deepEqual(answersToJson(fixture()), {
		kind: { type: "choice", choice: "a", confidence: 0.7, probabilities: { a: 0.7, b: 0.3 } },
		quality: {
			type: "score",
			score: 1.25,
			confidence: 0.8,
			legend: { 0: "low", 1: "medium", 2: "high" },
			probabilities: { 0: 0.1, 1: 0.55, 2: 0.35 },
		},
		ready: { type: "noul", noul: 0.9 },
	});
});

test("invalid probabilities and non-finite scores are rejected", () => {
	const answers = fixture();
	(answers.ready as { noul: number }).noul = 1.5;
	assert.throws(() => asNoul(answers, "ready"), /between 0 and 1/);
	(answers.quality as { score: number }).score = Number.NaN;
	assert.throws(() => asScore(answers, "quality"), /must be finite/);
	(answers.kind as { confidence: number }).confidence = -1;
	assert.throws(() => asChoice(answers, "kind"), /between 0 and 1/);
});
