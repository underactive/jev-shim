import { randomBytes } from "node:crypto";
import type { Usage } from "@typesafe-ai/sdk";
import type { JsonObject } from "./types.ts";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export interface ChatCompletionBody {
	id: string;
	object: "chat.completion";
	created: number;
	model: string;
	choices: [{
		index: 0;
		message: { role: "assistant"; content: string };
		finish_reason: "stop";
	}];
	usage: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

export interface CompletionBodyOptions {
	profileName: string;
	content: JsonObject;
	usage: Usage;
	now?: () => number;
	idFactory?: () => string;
}

export interface ErrorBodyOptions {
	type?: string;
	code?: string;
	param?: string;
}

export interface OpenAIErrorBody {
	error: {
		message: string;
		type: string;
		param: string | null;
		code: string | null;
	};
}

function completionId(): string {
	let suffix = "";
	while (suffix.length < 24) {
		for (const byte of randomBytes(32)) {
			if (byte >= 248) continue;
			suffix += BASE62[byte % BASE62.length];
			if (suffix.length === 24) break;
		}
	}
	return `chatcmpl-${suffix}`;
}

export function completionBody(options: CompletionBodyOptions): ChatCompletionBody {
	const now = options.now ?? Date.now;
	return {
		id: options.idFactory?.() ?? completionId(),
		object: "chat.completion",
		created: Math.floor(now() / 1_000),
		model: options.profileName,
		choices: [{
			index: 0,
			message: { role: "assistant", content: JSON.stringify(options.content) },
			finish_reason: "stop",
		}],
		usage: {
			prompt_tokens: options.usage.input_tokens,
			completion_tokens: options.usage.output_tokens,
			total_tokens: options.usage.input_tokens + options.usage.output_tokens,
		},
	};
}

function defaultErrorType(status: number): string {
	if (status === 400 || status === 413) return "invalid_request_error";
	if (status === 401) return "authentication_error";
	if (status === 429) return "rate_limit_error";
	if (status === 504) return "timeout_error";
	return "server_error";
}

export function errorBody(
	status: number,
	message: string,
	options: ErrorBodyOptions = {},
): OpenAIErrorBody {
	return {
		error: {
			message,
			type: options.type ?? defaultErrorType(status),
			param: options.param ?? null,
			code: options.code ?? null,
		},
	};
}
