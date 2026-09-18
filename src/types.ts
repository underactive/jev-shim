import type { Questions, SystemOneResult } from "@typesafe-ai/sdk";
import type { ChatMessage } from "./messages.ts";
import { defaultBuildState } from "./state.ts";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
	[key: string]: JsonValue;
}

export type Answers = SystemOneResult<Questions>["answers"];

export interface Profile {
	name: string;
	description?: string;
	questions: Questions;
	buildState(messages: ChatMessage[]): JsonValue;
	compose(answers: Answers): JsonObject;
	maxStateChars: number;
}

export interface ProfileSpec {
	name: string;
	description?: string;
	questions: Questions;
	buildState?: (messages: ChatMessage[]) => JsonValue;
	compose: (answers: Answers) => JsonObject;
	maxStateChars?: number;
}

export class RequestError extends Error {
	readonly status: number;
	readonly code: string;
	readonly param: string | undefined;

	constructor(message: string, status = 400, code = "invalid_request", param?: string) {
		super(message);
		this.name = "RequestError";
		this.status = status;
		this.code = code;
		this.param = param;
	}
}

export function defineProfile(spec: ProfileSpec): Profile {
	if (typeof spec.name !== "string" || spec.name.trim().length === 0) {
		throw new RequestError("Profile name must be a non-empty string.", 400, "invalid_profile", "name");
	}
	if (Object.keys(spec.questions).length === 0) {
		throw new RequestError("A profile must define at least one question.", 400, "invalid_profile", "questions");
	}
	const maxStateChars = spec.maxStateChars ?? 40_000;
	if (!Number.isInteger(maxStateChars) || maxStateChars <= 0) {
		throw new RequestError("maxStateChars must be a positive integer.", 400, "invalid_profile", "maxStateChars");
	}
	return {
		name: spec.name,
		description: spec.description,
		questions: spec.questions,
		buildState: spec.buildState ?? defaultBuildState,
		compose: spec.compose,
		maxStateChars,
	};
}
