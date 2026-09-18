import { choice, noul, score, type EntryType, type Questions } from "@typesafe-ai/sdk";
import { answersToJson } from "./answers.ts";
import { defaultBuildState } from "./state.ts";
import { defineProfile, RequestError, type JsonValue, type Profile } from "./types.ts";

export const ADHOC_PROFILE_NAME = "jev-adhoc";

export interface AdhocSpec {
	state?: JsonValue;
	questions: Questions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
	if (value === null || typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(isJsonValue);
	return isRecord(value) && Object.values(value).every(isJsonValue);
}

function assertKnownKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, path: string): void {
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) {
			throw new RequestError(`Unknown field ${path}.${key}.`, 400, "invalid_adhoc", `${path}.${key}`);
		}
	}
}

function entry(value: unknown, path: string): EntryType {
	if (!isJsonValue(value) || typeof value === "number" || typeof value === "boolean") {
		throw new RequestError(`${path} must be text, an object, an array, or null.`, 400, "invalid_adhoc", path);
	}
	return value;
}

export function parseAdhocSpec(value: unknown): AdhocSpec {
	if (!isRecord(value)) {
		throw new RequestError("jev must be an object.", 400, "invalid_adhoc", "jev");
	}
	assertKnownKeys(value, new Set(["state", "questions"]), "jev");
	if (!isRecord(value.questions)) {
		throw new RequestError("jev.questions must be an object.", 400, "invalid_adhoc", "jev.questions");
	}
	const questionEntries = Object.entries(value.questions);
	if (questionEntries.length === 0) {
		throw new RequestError("jev.questions must contain at least one question.", 400, "invalid_adhoc", "jev.questions");
	}
	const questions: Questions = {};
	for (const [id, rawQuestion] of questionEntries) {
		const path = `jev.questions.${id}`;
		if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
			throw new RequestError(`${path} has an invalid question id.`, 400, "invalid_adhoc", path);
		}
		if (!isRecord(rawQuestion)) {
			throw new RequestError(`${path} must be an object.`, 400, "invalid_adhoc", path);
		}
		assertKnownKeys(rawQuestion, new Set(["type", "instructions", "criteria"]), path);
		const instructions = rawQuestion.instructions === undefined
			? null
			: entry(rawQuestion.instructions, `${path}.instructions`);
		if (rawQuestion.type === "choice") {
			if (!isRecord(rawQuestion.criteria)) {
				throw new RequestError(`${path}.criteria must be an object.`, 400, "invalid_adhoc", `${path}.criteria`);
			}
			const options = Object.entries(rawQuestion.criteria);
			if (options.length < 1 || options.length > 255) {
				throw new RequestError(`${path}.criteria must contain 1 to 255 options.`, 400, "invalid_adhoc", `${path}.criteria`);
			}
			const criteria: Record<string, EntryType> = {};
			for (const [label, description] of options) {
				if (label.length === 0) {
					throw new RequestError(`${path}.criteria contains an empty option label.`, 400, "invalid_adhoc", `${path}.criteria`);
				}
				criteria[label] = entry(description, `${path}.criteria.${label}`);
			}
			questions[id] = choice(instructions, criteria);
			continue;
		}
		if (rawQuestion.type === "score") {
			if (!Array.isArray(rawQuestion.criteria) || rawQuestion.criteria.length < 2 || rawQuestion.criteria.length > 10) {
				throw new RequestError(`${path}.criteria must contain 2 to 10 ordered levels.`, 400, "invalid_adhoc", `${path}.criteria`);
			}
			const levels = rawQuestion.criteria.map((level, index) => entry(level, `${path}.criteria.${index}`));
			questions[id] = score(instructions, levels as [EntryType, EntryType, ...EntryType[]]);
			continue;
		}
		if (rawQuestion.type === "noul") {
			let criteria: { true?: EntryType; false?: EntryType } | undefined;
			if (rawQuestion.criteria !== undefined && rawQuestion.criteria !== null) {
				if (!isRecord(rawQuestion.criteria)) {
					throw new RequestError(`${path}.criteria must be an object or null.`, 400, "invalid_adhoc", `${path}.criteria`);
				}
				assertKnownKeys(rawQuestion.criteria, new Set(["true", "false"]), `${path}.criteria`);
				criteria = {};
				if (rawQuestion.criteria.true !== undefined) criteria.true = entry(rawQuestion.criteria.true, `${path}.criteria.true`);
				if (rawQuestion.criteria.false !== undefined) criteria.false = entry(rawQuestion.criteria.false, `${path}.criteria.false`);
			}
			questions[id] = noul(instructions, criteria);
			continue;
		}
		throw new RequestError(`${path}.type must be choice, score, or noul.`, 400, "invalid_adhoc", `${path}.type`);
	}
	if (
		value.state !== undefined
		&& (!isJsonValue(value.state) || typeof value.state === "number" || typeof value.state === "boolean")
	) {
		throw new RequestError("jev.state must be text, an object, an array, or null.", 400, "invalid_adhoc", "jev.state");
	}
	return value.state === undefined ? { questions } : { state: value.state, questions };
}

export function adhocProfile(spec: AdhocSpec): Profile {
	const hasState = Object.hasOwn(spec, "state");
	return defineProfile({
		name: ADHOC_PROFILE_NAME,
		description: "Request-defined Jev questions",
		questions: spec.questions,
		buildState: (messages) => hasState ? spec.state ?? null : defaultBuildState(messages),
		compose: answersToJson,
	});
}
