import { createServer as createHttpServer, type IncomingMessage, type RequestListener, type Server, type ServerResponse } from "node:http";
import { TypeSafeClient, type Usage } from "@typesafe-ai/sdk";
import { ADHOC_PROFILE_NAME, adhocProfile, parseAdhocSpec } from "./adhoc.ts";
import { classify, createJevClient, JevFailure, type JevClientOptions } from "./client.ts";
import { completionBody, errorBody } from "./completion.ts";
import { normalizeMessages } from "./messages.ts";
import { createRegistry } from "./registry.ts";
import { RequestError, type JsonObject, type Profile } from "./types.ts";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4179;
const DEFAULT_REQUEST_TIMEOUT_MS = 25_000;
const DEFAULT_MAX_BODY_BYTES = 1_048_576;

export interface FacadeOptions {
	client?: TypeSafeClient;
	jev?: JevClientOptions;
	adhoc?: boolean;
	requestTimeoutMs?: number;
	maxBodyBytes?: number;
	maxInFlight?: number;
	debug?: boolean;
	logger?: (line: string) => void;
	now?: () => number;
	idFactory?: () => string;
}

export interface StartServerOptions extends FacadeOptions {
	host?: string;
	port?: number;
}

export interface StartedServer {
	server: Server;
	host: string;
	port: number;
	url: string;
	close(): Promise<void>;
}

interface RequestLog {
	method: string;
	path: string;
	profile?: string;
	status: number;
	latency_ms: number;
	input_tokens?: number;
	output_tokens?: number;
	truncated?: boolean;
	body?: unknown;
	output?: JsonObject;
	upstream_error?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: number, name: string): number {
	if (!Number.isInteger(value) || value <= 0) {
		throw new RequestError(`${name} must be a positive integer.`, 400, "invalid_option", name);
	}
	return value;
}

function sendJson(response: ServerResponse, status: number, body: unknown, headers?: Record<string, string>): void {
	const json = JSON.stringify(body);
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(json),
		...headers,
	});
	response.end(json);
}

function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const declaredLength = Number(request.headers["content-length"]);
		if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
			request.resume();
			reject(new RequestError(`Request body exceeds ${maxBytes} bytes.`, 413, "body_too_large"));
			return;
		}
		const chunks: Buffer[] = [];
		let bytes = 0;
		let settled = false;
		request.on("data", (chunk: Buffer) => {
			if (settled) return;
			bytes += chunk.length;
			if (bytes > maxBytes) {
				settled = true;
				request.resume();
				reject(new RequestError(`Request body exceeds ${maxBytes} bytes.`, 413, "body_too_large"));
				return;
			}
			chunks.push(chunk);
		});
		request.on("end", () => {
			if (settled) return;
			settled = true;
			const text = Buffer.concat(chunks).toString("utf8");
			try {
				resolve(JSON.parse(text));
			} catch {
				reject(new RequestError("Request body must be valid JSON.", 400, "invalid_json"));
			}
		});
		request.on("error", (error) => {
			if (settled) return;
			settled = true;
			reject(error);
		});
	});
}

function profileNames(profiles: Profile[], adhoc: boolean): string[] {
	const names = profiles.map((profile) => profile.name);
	if (adhoc) names.push(ADHOC_PROFILE_NAME);
	return names;
}

function resolveProfileName(body: Record<string, unknown>): string {
	if (Object.hasOwn(body, "jev_profile")) {
		if (typeof body.jev_profile !== "string" || body.jev_profile.trim().length === 0) {
			throw new RequestError("jev_profile must be a non-empty string.", 400, "invalid_request", "jev_profile");
		}
		return body.jev_profile;
	}
	if (typeof body.model !== "string" || body.model.trim().length === 0) {
		throw new RequestError("model must be a non-empty string.", 400, "invalid_request", "model");
	}
	return body.model;
}

function retryAfterHeader(failure: JevFailure): Record<string, string> | undefined {
	if (failure.retryAfter !== undefined) return { "retry-after": failure.retryAfter };
	if (failure.retryAfterMs !== undefined) return { "retry-after": String(Math.ceil(failure.retryAfterMs / 1_000)) };
	return undefined;
}

function upstreamBody(failure: JevFailure): unknown {
	const cause = failure.cause;
	if (isRecord(cause) && Object.hasOwn(cause, "body")) return cause.body;
	return cause instanceof Error ? cause.message : undefined;
}

export function createRequestHandler(profiles: Profile[], options: FacadeOptions = {}): RequestListener {
	const registry = createRegistry(profiles);
	const adhocEnabled = options.adhoc ?? false;
	const requestTimeoutMs = positiveInteger(options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS, "requestTimeoutMs");
	const maxBodyBytes = positiveInteger(options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES, "maxBodyBytes");
	if (options.maxInFlight !== undefined) positiveInteger(options.maxInFlight, "maxInFlight");
	const client = options.client ?? createJevClient(options.jev);
	const logger = options.logger ?? console.error;
	const debug = options.debug === true || process.env.PI_JEV_DEBUG === "1";
	const now = options.now ?? Date.now;
	const created = Math.floor(now() / 1_000);
	const knownPaths = new Set(["/v1/chat/completions", "/v1/models", "/health"]);
	let inFlight = 0;

	return (request, response) => {
		void (async () => {
			const started = now();
			const method = request.method ?? "GET";
			const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
			const log: RequestLog = { method, path: pathname, status: 500, latency_ms: 0 };
			try {
				if (!knownPaths.has(pathname)) {
					log.status = 404;
					sendJson(response, 404, errorBody(404, "Route not found.", { code: "not_found" }));
					return;
				}
				const expectedMethod = pathname === "/v1/chat/completions" ? "POST" : "GET";
				if (method !== expectedMethod) {
					log.status = 405;
					sendJson(
						response,
						405,
						errorBody(405, `Method ${method} is not allowed for ${pathname}.`, { code: "method_not_allowed" }),
						{ allow: expectedMethod },
					);
					return;
				}
				if (pathname === "/health") {
					log.status = 200;
					sendJson(response, 200, { ok: true, profiles: profileNames(registry.list(), adhocEnabled) });
					return;
				}
				if (pathname === "/v1/models") {
					log.status = 200;
					sendJson(response, 200, {
						object: "list",
						data: profileNames(registry.list(), adhocEnabled).map((id) => ({
							id,
							object: "model",
							created,
							owned_by: "jev-shim",
						})),
					});
					return;
				}
				if (options.maxInFlight !== undefined && inFlight >= options.maxInFlight) {
					log.status = 503;
					sendJson(response, 503, errorBody(503, "The Jev facade is at its in-flight limit.", {
						type: "server_error",
						code: "overloaded",
					}));
					return;
				}

				const rawBody = await readJsonBody(request, maxBodyBytes);
				if (!isRecord(rawBody)) {
					throw new RequestError("Request body must be a JSON object.", 400, "invalid_request");
				}
				if (debug) log.body = rawBody;
				if (rawBody.stream === true) {
					throw new RequestError("Streaming is not supported.", 400, "stream_not_supported", "stream");
				}
				const name = resolveProfileName(rawBody);
				log.profile = name;
				const messages = normalizeMessages(rawBody.messages);
				let profile: Profile;
				if (name === ADHOC_PROFILE_NAME) {
					if (!adhocEnabled) {
						throw new RequestError("Ad-hoc mode is disabled.", 400, "adhoc_disabled", "model");
					}
					if (!Object.hasOwn(rawBody, "jev")) {
						throw new RequestError("jev is required for the jev-adhoc profile.", 400, "invalid_adhoc", "jev");
					}
					profile = adhocProfile(parseAdhocSpec(rawBody.jev));
				} else {
					if (Object.hasOwn(rawBody, "jev")) {
						throw new RequestError(
							"jev is only allowed when the resolved profile is jev-adhoc.",
							400,
							"adhoc_not_allowed",
							"jev",
						);
					}
					const registered = registry.get(name);
					if (registered === undefined) {
						throw new RequestError(
							`Unknown profile "${name}". Registered profiles: ${profileNames(registry.list(), adhocEnabled).join(", ") || "none"}.`,
							400,
							"unknown_profile",
							Object.hasOwn(rawBody, "jev_profile") ? "jev_profile" : "model",
						);
					}
					profile = registered;
				}

				const controller = new AbortController();
				const abort = () => controller.abort();
				request.once("aborted", abort);
				response.once("close", () => {
					if (!response.writableEnded) abort();
				});
				const timer = setTimeout(abort, requestTimeoutMs);
				inFlight += 1;
				let classification;
				try {
					classification = await classify(client, profile, messages, {
						signal: controller.signal,
						deadlineMs: requestTimeoutMs,
					});
				} finally {
					clearTimeout(timer);
					request.removeListener("aborted", abort);
					inFlight -= 1;
				}
				log.input_tokens = classification.usage.input_tokens;
				log.output_tokens = classification.usage.output_tokens;
				log.truncated = classification.truncated;
				if (debug) log.output = classification.output;
				log.status = 200;
				sendJson(response, 200, completionBody({
					profileName: profile.name,
					content: classification.output,
					usage: classification.usage,
					now,
					idFactory: options.idFactory,
				}));
			} catch (error) {
				if (response.headersSent) return;
				if (error instanceof RequestError) {
					log.status = error.status;
					sendJson(response, error.status, errorBody(error.status, error.message, {
						code: error.code,
						param: error.param,
					}));
					return;
				}
				if (error instanceof JevFailure) {
					log.upstream_error = upstreamBody(error);
					if (error.kind === "timeout") {
						log.status = 504;
						sendJson(response, 504, errorBody(504, "The Jev request timed out.", {
							type: "timeout_error",
							code: "timeout",
						}));
						return;
					}
					if (error.kind === "rate_limit") {
						log.status = 429;
						sendJson(response, 429, errorBody(429, "Jev rate limit exceeded.", {
							type: "rate_limit_error",
							code: "rate_limit",
						}), retryAfterHeader(error));
						return;
					}
					log.status = 502;
					sendJson(response, 502, errorBody(502, "The Jev classifier request failed.", {
						type: "server_error",
						code: error.kind,
					}));
					return;
				}
				log.status = 500;
				sendJson(response, 500, errorBody(500, "The profile failed to compose a response.", {
					type: "server_error",
					code: "profile_error",
				}));
			} finally {
				log.latency_ms = Math.max(0, now() - started);
				logger(JSON.stringify(log));
			}
		})().catch((error: unknown) => {
			if (!response.headersSent) {
				sendJson(response, 500, errorBody(500, "Unhandled server error.", { code: "server_error" }));
			}
			logger(JSON.stringify({
				method: request.method ?? "GET",
				path: request.url ?? "/",
				status: 500,
				error: error instanceof Error ? error.message : String(error),
			}));
		});
	};
}

export function createServer(profiles: Profile[], options: FacadeOptions = {}): Server {
	return createHttpServer(createRequestHandler(profiles, options));
}

export async function startServer(profiles: Profile[], options: StartServerOptions = {}): Promise<StartedServer> {
	const host = options.host ?? DEFAULT_HOST;
	const port = options.port ?? DEFAULT_PORT;
	if (!Number.isInteger(port) || port < 0 || port > 65_535) {
		throw new RequestError("port must be an integer between 0 and 65535.", 400, "invalid_option", "port");
	}
	const server = createServer(profiles, options);
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, host, () => {
			server.removeListener("error", reject);
			resolve();
		});
	});
	const address = server.address();
	if (address === null || typeof address === "string") {
		server.close();
		throw new Error("HTTP server did not expose a TCP address.");
	}
	return {
		server,
		host,
		port: address.port,
		url: `http://${host}:${address.port}`,
		close: () => new Promise<void>((resolve, reject) => {
			server.close((error) => error === undefined ? resolve() : reject(error));
		}),
	};
}
