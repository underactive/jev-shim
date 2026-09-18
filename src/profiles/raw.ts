import type { Questions } from "@typesafe-ai/sdk";
import { answersToJson } from "../answers.ts";
import { defineProfile, type Profile, type ProfileSpec } from "../types.ts";

export type RawAnswersProfileOverrides = Partial<Pick<ProfileSpec, "description" | "buildState" | "maxStateChars">>;

export function rawAnswersProfile(
	name: string,
	questions: Questions,
	overrides: RawAnswersProfileOverrides = {},
): Profile {
	return defineProfile({
		name,
		description: overrides.description ?? "Returns every typed Jev answer as JSON.",
		questions,
		buildState: overrides.buildState,
		maxStateChars: overrides.maxStateChars,
		compose: answersToJson,
	});
}
