/**
 * Generic capability-classifier verification fixture for an OpenAI-compatible
 * routing consumer. It exercises this package's facade with a strict,
 * machine-validated four-field verdict.
 *
 * This file is intentionally not exported from the package (see `index.ts`)
 * and is intentionally absent from `package.json`'s `files` array: it is a
 * manual e2e fixture and a typechecked usage example, not shipped code. It
 * depends only on this package's public surface (`../index.ts`) plus
 * `node:url`.
 *
 * The rules and trailing instruction below are local example data for
 * exercising a strict classifier contract.
 */

import { pathToFileURL } from "node:url";
import {
	asChoice,
	asNoul,
	choice,
	defaultBuildState,
	defineProfile,
	dropTrailing,
	noul,
	startServer,
	withoutSystemMessages,
	type Answers,
	type ChatMessage,
	type JsonObject,
	type JsonValue,
	type Profile,
} from "../index.ts";

/**
 * The nine efficient-agent capability-card rules plus the `none` fallback
 * used when no rule applies. The `id`, boundary-defining lead-in verb
 * ("Route to the Efficient model when" / "Treat the route as uncertain
 * when" / "Prefer the Capable model when"), and full sentence for SUP-1
 * through LIM-2 are local example criteria. `none`/`unmatched` is the
 * profile's fallback option for the "no rule applies" case.
 */
export const CAPABILITY_RULES = [
	{
		id: "SUP-1",
		boundary: "supported",
		description:
			"Route to the Efficient model when the task provides a complete output contract and a deterministic local validator that covers the material requirements.",
	},
	{
		id: "SUP-2",
		boundary: "supported",
		description:
			"Route to the Efficient model when all required inputs are available, the target environment can be inspected, and correctness can be verified end-to-end without inaccessible external state.",
	},
	{
		id: "SUP-3",
		boundary: "supported",
		description:
			"Route to the Efficient model when mathematical behavior, interfaces, shapes, data types, tolerances, and performance requirements are explicit and exercised by a representative harness.",
	},
	{
		id: "SUP-4",
		boundary: "supported",
		description:
			"Route to the Efficient model when the required mechanism is identified, the relevant search space is bounded, and the success condition is executable. Do not infer this rule merely from the task's technical domain.",
	},
	{
		id: "SUP-5",
		boundary: "supported",
		description:
			"Route to the Efficient model when reconstruction or behavioral reproduction is constrained by an executable reference, parser, format specification, or checker strong enough to distinguish correct from merely plausible output.",
	},
	{
		id: "UNC-1",
		boundary: "uncertain",
		description:
			"Treat the route as uncertain when multiple reasonable interpretations of preprocessing, representation, indexing, naming, or output placement would produce different results and neither the instructions nor a validator resolve the choice.",
	},
	{
		id: "UNC-2",
		boundary: "uncertain",
		description:
			"Treat the route as uncertain when success requires finding every relevant item across heterogeneous inputs or environment state, but the task does not define the search boundary or provide a completeness check.",
	},
	{
		id: "LIM-1",
		boundary: "unsupported",
		description:
			"Prefer the Capable model when correctness depends primarily on extracting precise information from noisy visual, temporal, or rendered media and no machine-checkable extraction or replay mechanism is available.",
	},
	{
		id: "LIM-2",
		boundary: "unsupported",
		description:
			"Prefer the Capable model when success depends on reproducing undocumented reference behavior, hidden intermediate state, or an unknown configuration, and small deviations fail despite satisfying the visible specification.",
	},
	{
		id: "none",
		boundary: "unmatched",
		description: "No capability-card rule applies to the task's hardest material requirement.",
	},
] as const;

type CapabilityRule = (typeof CAPABILITY_RULES)[number];
export type RuleId = CapabilityRule["id"];
export type Boundary = CapabilityRule["boundary"];

function buildRuleToBoundary(rules: readonly CapabilityRule[]): Record<RuleId, Boundary> {
	const table = {} as Record<RuleId, Boundary>;
	for (const rule of rules) {
		table[rule.id] = rule.boundary;
	}
	return table;
}

/**
 * Rule id to capability boundary, derived from {@link CAPABILITY_RULES} so
 * the pairing has exactly one source of truth (the table above), matching
 * the enforced pairing in `is_valid` at `llm_class.rs:60-73`.
 */
export const RULE_TO_BOUNDARY: Readonly<Record<RuleId, Boundary>> = buildRuleToBoundary(CAPABILITY_RULES);

function buildPrimaryRuleCriteria(rules: readonly CapabilityRule[]): Record<string, string> {
	const criteria: Record<string, string> = {};
	for (const rule of rules) {
		criteria[rule.id] = rule.description;
	}
	return criteria;
}

/**
 * The trailing user message a classifier client may append when it requests
 * a structured result. `buildState` drops a trailing user message that
 * matches this exact instruction.
 */
export const TRAILING_ROUTING_INSTRUCTION =
	"Route the conversation above. Output ONLY the routing JSON object, nothing else.";

/**
 * Jev questions backing the verdict. Wording is this profile's own (not
 * upstream text): a Noul for `p_solve` and a Choice over the capability-card
 * rules for `primary_rule`, whose descriptions are the verbatim card
 * sentences above.
 */
export const capabilityQuestions = {
	p_solve: noul(
		"Estimate the probability that an efficient model completes this whole task correctly in one fresh run under the actual harness, tools, and budget. Use only the visible task and the qualitative capability card. Do not invent hidden state or empirical success rates. This is whole-task success probability, not confidence in your assessment and not a routing recommendation.",
	),
	primary_rule: choice(
		"Select the single capability-card rule that best describes the hardest material requirement for completing the whole task correctly. Use none when no rule applies. Treat rule ids as opaque labels and choose by description.",
		buildPrimaryRuleCriteria(CAPABILITY_RULES),
	),
};

/**
 * Drops system/developer messages (the profile carries its own wording) and,
 * if present, the exact trailing classifier instruction a client appends under
 * `recent_turn_window`, before reducing to the default `{ opening_task,
 * latest_message? }` state shape.
 */
export function buildState(messages: ChatMessage[]): JsonValue {
	const withoutInstructions = withoutSystemMessages(messages);
	const withoutTrailingInstruction = dropTrailing(
		withoutInstructions,
		(message) => message.role === "user" && message.content.trim() === TRAILING_ROUTING_INSTRUCTION,
	);
	return defaultBuildState(withoutTrailingInstruction);
}

/**
 * Composes a four-field capability verdict: `crux`, `primary_rule`,
 * `capability_boundary`,
 * `p_solve`, and nothing else.
 *
 * - `primary_rule` unknown to the capability card throws (Jev returning a
 *   choice label outside the criteria it was given is a contract
 *   violation, not a value to paper over).
 * - `capability_boundary` is read from {@link RULE_TO_BOUNDARY}, so the pair
 *   is always internally consistent by construction.
 * - `crux` is the chosen rule's description, because Jev cannot generate
 *   free text.
 * - `p_solve` is the Noul answer passed through unclamped;
 *   `asNoul` already rejects a non-finite or out-of-range value (a Jev
 *   contract violation), so it is never silently clamped into range here.
 */
export function compose(answers: Answers): JsonObject {
	const primaryRuleAnswer = asChoice(answers, "primary_rule");
	const rule = CAPABILITY_RULES.find((candidate) => candidate.id === primaryRuleAnswer.choice);
	if (rule === undefined) {
		const known = CAPABILITY_RULES.map((candidate) => candidate.id).join(", ");
		throw new Error(`Jev selected an unknown primary_rule "${primaryRuleAnswer.choice}"; expected one of: ${known}.`);
	}
	const pSolveAnswer = asNoul(answers, "p_solve");
	return {
		crux: rule.description,
		primary_rule: rule.id,
		capability_boundary: rule.boundary,
		p_solve: pSolveAnswer.noul,
	};
}

export const capabilityProfile: Profile = defineProfile({
	name: "jev-capability",
	description: "Example capability verdict profile built on Jev.",
	questions: capabilityQuestions,
	buildState,
	compose,
});

const VERDICT_KEYS: readonly string[] = ["capability_boundary", "crux", "p_solve", "primary_rule"];

/**
 * Test-only validation for this example's strict verdict contract.
 *
 * The verdict is intentionally exact: it contains exactly
 * `crux`, `primary_rule`, `capability_boundary`, `p_solve`; `is_valid`
 * `p_solve` in `0.0..=1.0`, a non-blank `crux`, and the enforced
 * rule-to-boundary pairing. This function checks those four
 * things against a parsed JSON value, using {@link RULE_TO_BOUNDARY} as the
 * single source of truth for the pairing. Not used by `compose` or by any
 * runtime code path; it exists so the profile's output can be asserted
 * against the real upstream contract in tests.
 */
export function isValidVerdict(value: unknown): boolean {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	const expectedKeys = [...VERDICT_KEYS].sort();
	if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
		return false;
	}
	const { crux, primary_rule: primaryRule, capability_boundary: capabilityBoundary, p_solve: pSolve } = record;
	if (typeof crux !== "string" || crux.trim().length === 0) {
		return false;
	}
	if (typeof primaryRule !== "string" || typeof capabilityBoundary !== "string") {
		return false;
	}
	if (typeof pSolve !== "number" || !Number.isFinite(pSolve) || pSolve < 0 || pSolve > 1) {
		return false;
	}
	return RULE_TO_BOUNDARY[primaryRule as RuleId] === capabilityBoundary;
}

// --- Manual e2e entry point -------------------------------------------------
//
// Starts this package's own OpenAI chat-completions facade (`startServer`,
// `src/server.ts`) serving only this profile for manual integration testing.

interface CliOptions {
	host: string;
	port: number;
}

function parseCliOptions(argv: readonly string[]): CliOptions {
	let host = "127.0.0.1";
	let port = 4179;
	for (let index = 0; index < argv.length; index++) {
		const flag = argv[index];
		if (flag === "--host") {
			const value = argv[index + 1];
			if (value === undefined) {
				throw new Error("--host requires a value");
			}
			host = value;
			index++;
			continue;
		}
		if (flag === "--port") {
			const value = argv[index + 1];
			if (value === undefined) {
				throw new Error("--port requires a value");
			}
			const parsed = Number(value);
			if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
				throw new Error(`--port must be an integer in [0, 65535], got "${value}"`);
			}
			port = parsed;
			index++;
			continue;
		}
	}
	return { host, port };
}

function isMainModule(): boolean {
	const entry = process.argv[1];
	if (entry === undefined) {
		return false;
	}
	return import.meta.url === pathToFileURL(entry).href;
}

if (isMainModule()) {
	const { host, port } = parseCliOptions(process.argv.slice(2));
	const server = await startServer([capabilityProfile], { host, port, adhoc: true });
	console.error(`jev-capability fixture listening on ${server.url}`);
}
