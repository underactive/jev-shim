import {
	APIConnectionError,
	APIError,
	APITimeoutError,
	APIUserAbortError,
	AuthenticationError,
	RateLimitError,
	TypeSafeClient,
	UnprocessableEntityError,
	type EntryType,
	type Questions,
	type SystemOneResult,
	type TypeSafeClientConfig,
	type Usage,
} from "@typesafe-ai/sdk";
import { assertQuestionsFit, truncateState } from "./budget.ts";
import type { ChatMessage } from "./messages.ts";
import { RequestError, type JsonObject, type JsonValue, type Profile } from "./types.ts";

export type JevFailureKind = "timeout" | "rate_limit" | "auth" | "invalid_request" | "connection" | "api";

export class JevFailure extends Error {
	readonly kind: JevFailureKind;
	readonly status: number | undefined;
	readonly retryAfterMs: number | undefined;
	readonly retryAfter: string | undefined;

	constructor(
		kind: JevFailureKind,
		message: string,
		options: { status?: number; retryAfterMs?: number; retryAfter?: string; cause?: unknown } = {},
	) {
		super(message, { cause: options.cause });
		this.name = "JevFailure";
		this.kind = kind;
		this.status = options.status;
		this.retryAfterMs = options.retryAfterMs;
		this.retryAfter = options.retryAfter;
	}
}

export type JevClientOptions = TypeSafeClientConfig;

export function createJevClient(options: JevClientOptions = {}): TypeSafeClient {
	return new TypeSafeClient({
		defaultModel: "jev-latest",
		timeout: 10_000,
		logLevel: "warn",
		...options,
		retry: { maxRetries: 1, ...options.retry },
	});
}

export interface ClassifyOptions {
	signal?: AbortSignal;
	deadlineMs?: number;
}

export interface Classification {
	output: JsonObject;
	model: string;
	usage: Usage;
	truncated: boolean;
}

function mapJevError(error: unknown, deadlineSignal: AbortSignal, callerSignal?: AbortSignal): JevFailure {
	if (error instanceof RateLimitError) {
		return new JevFailure("rate_limit", "Jev rate limit exceeded.", {
			status: error.status,
			retryAfterMs: error.retryAfterMs,
			retryAfter: error.headers.get("retry-after") ?? undefined,
			cause: error,
		});
	}
	if (error instanceof AuthenticationError || (error instanceof APIError && error.status === 403)) {
		return new JevFailure("auth", "Jev authentication failed.", { status: error.status, cause: error });
	}
	if (error instanceof UnprocessableEntityError || (error instanceof APIError && error.status === 400)) {
		return new JevFailure("invalid_request", "Jev rejected the classifier request.", {
			status: error.status,
			cause: error,
		});
	}
	if (error instanceof APITimeoutError || error instanceof APIUserAbortError || deadlineSignal.aborted || callerSignal?.aborted) {
		return new JevFailure("timeout", "Jev request timed out or was aborted.", { cause: error });
	}
	if (error instanceof APIConnectionError) {
		return new JevFailure("connection", "Could not connect to Jev.", { cause: error });
	}
	if (error instanceof APIError) {
		return new JevFailure("api", "Jev API request failed.", { status: error.status, cause: error });
	}
	return new JevFailure("api", "Unexpected Jev client failure.", { cause: error });
}

function asEntryType(state: JsonValue): EntryType {
	if (typeof state === "number" || typeof state === "boolean") {
		throw new RequestError(
			"Profile state must be text, an object, an array, or null.",
			400,
			"invalid_profile_state",
		);
	}
	return state;
}

export async function classify(
	client: TypeSafeClient,
	profile: Profile,
	messages: ChatMessage[],
	options: ClassifyOptions = {},
): Promise<Classification> {
	const deadlineMs = options.deadlineMs ?? 25_000;
	if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
		throw new RequestError("deadlineMs must be a positive number.", 400, "invalid_deadline", "deadlineMs");
	}
	const builtState = profile.buildState(messages);
	assertQuestionsFit(profile.questions, profile.maxStateChars);
	const { state, truncated } = truncateState(builtState, profile.maxStateChars);
	const deadlineSignal = AbortSignal.timeout(deadlineMs);
	const signal = options.signal === undefined
		? deadlineSignal
		: AbortSignal.any([options.signal, deadlineSignal]);
	let result: SystemOneResult<Questions>;
	try {
		result = await client.systemOne(
			{ state: asEntryType(state), questions: profile.questions },
			{ signal },
		);
	} catch (error) {
		throw mapJevError(error, deadlineSignal, options.signal);
	}
	return {
		output: profile.compose(result.answers),
		model: result.model,
		usage: result.usage,
		truncated,
	};
}
