import { choice, noul, score } from "@typesafe-ai/sdk";
import { rawAnswersProfile } from "./raw.ts";

export const taskAssessmentQuestions = {
	category: choice("Which category best describes the task's primary requested outcome?", {
		implementation: "Create or change executable code or configuration.",
		investigation: "Diagnose, research, explain, or review an existing system.",
		documentation: "Create or revise prose documentation.",
		operation: "Run, deploy, migrate, or otherwise operate a system.",
		other: "None of the other categories describes the primary outcome.",
	}),
	clarity: score("How clear and testable is the requested outcome?", [
		"The requested outcome is absent or contradictory.",
		"The goal is discernible but material requirements are missing.",
		"The main outcome is stated, with several details left implicit.",
		"The outcome and most constraints are explicit and testable.",
		"The outcome, constraints, and verification criteria are complete and unambiguous.",
	]),
	self_contained: noul(
		"Can the task be attempted from the supplied state without obtaining essential missing requirements from the requester?",
		{
			true: "The supplied state contains enough requirements to begin a correct attempt.",
			false: "An essential requirement must be obtained from the requester first.",
		},
	),
} as const;

export const taskAssessmentProfile = rawAnswersProfile(
	"task-assessment",
	taskAssessmentQuestions,
	{ description: "Classifies task category, clarity, and self-containment in one Jev call." },
);
