import type {
	ChoiceResponse,
	NoulResponse,
	ScoreResponse,
} from "@typesafe-ai/sdk";
import type { Answers, JsonObject, JsonValue } from "./types.ts";

function assertProbability(value: number, path: string): void {
	if (!Number.isFinite(value) || value < 0 || value > 1) {
		throw new Error(`${path} must be a finite number between 0 and 1.`);
	}
}

function getAnswer(answers: Answers, id: string): Answers[string] {
	const answer = answers[id];
	if (answer === undefined) {
		throw new Error(`Missing answer for question "${id}".`);
	}
	return answer;
}

function probabilityMap(values: Readonly<Record<string, number>>, path: string): JsonObject {
	const output: JsonObject = {};
	for (const [key, value] of Object.entries(values)) {
		assertProbability(value, `${path}.${key}`);
		output[key] = value;
	}
	return output;
}

export function asChoice(answers: Answers, id: string): ChoiceResponse {
	const answer = getAnswer(answers, id);
	if (answer.type !== "choice") {
		throw new Error(`Answer "${id}" is ${answer.type}, expected choice.`);
	}
	if (typeof answer.choice !== "string" || answer.choice.length === 0) {
		throw new Error(`Answer "${id}" has an invalid choice.`);
	}
	assertProbability(answer.confidence, `${id}.confidence`);
	probabilityMap(answer.probabilities, `${id}.probabilities`);
	return answer;
}

export function asScore(answers: Answers, id: string): ScoreResponse {
	const answer = getAnswer(answers, id);
	if (answer.type !== "score") {
		throw new Error(`Answer "${id}" is ${answer.type}, expected score.`);
	}
	if (!Number.isFinite(answer.score)) {
		throw new Error(`${id}.score must be finite.`);
	}
	assertProbability(answer.confidence, `${id}.confidence`);
	probabilityMap(answer.probabilities, `${id}.probabilities`);
	return answer;
}

export function asNoul(answers: Answers, id: string): NoulResponse {
	const answer = getAnswer(answers, id);
	if (answer.type !== "noul") {
		throw new Error(`Answer "${id}" is ${answer.type}, expected noul.`);
	}
	assertProbability(answer.noul, `${id}.noul`);
	return answer;
}

export function answersToJson(answers: Answers): JsonObject {
	const output: JsonObject = {};
	for (const [id, raw] of Object.entries(answers)) {
		if (raw.type === "choice") {
			const answer = asChoice(answers, id);
			output[id] = {
				type: answer.type,
				choice: answer.choice,
				confidence: answer.confidence,
				probabilities: probabilityMap(answer.probabilities, `${id}.probabilities`),
			};
			continue;
		}
		if (raw.type === "score") {
			const answer = asScore(answers, id);
			const legend: JsonObject = {};
			for (const [score, description] of Object.entries(answer.legend)) {
				legend[score] = description as JsonValue;
			}
			output[id] = {
				type: answer.type,
				score: answer.score,
				confidence: answer.confidence,
				legend,
				probabilities: probabilityMap(answer.probabilities, `${id}.probabilities`),
			};
			continue;
		}
		const answer = asNoul(answers, id);
		output[id] = { type: answer.type, noul: answer.noul };
	}
	return output;
}
