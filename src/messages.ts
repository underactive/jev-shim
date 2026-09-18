import { RequestError } from "./types.ts";

export type ChatRole = "system" | "developer" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

interface TextContentPart {
  type: "text";
  text: string;
}

const CHAT_ROLES: ReadonlySet<string> = new Set([
  "system",
  "developer",
  "user",
  "assistant",
  "tool",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasToolCalls(raw: Record<string, unknown>): boolean {
  return Array.isArray(raw["tool_calls"]) && raw["tool_calls"].length > 0;
}

function invalidRequest(message: string, param: string): RequestError {
  return new RequestError(message, 400, "invalid_request", param);
}

function normalizeRole(role: unknown, path: string): ChatRole {
  if (typeof role !== "string" || !CHAT_ROLES.has(role)) {
    throw invalidRequest(
      `${path} must be one of: system, developer, user, assistant, tool`,
      path
    );
  }
  return role as ChatRole;
}

function normalizeContentPart(part: unknown, path: string): TextContentPart {
  if (!isPlainObject(part)) {
    throw invalidRequest(`${path} must be an object`, path);
  }
  const type = part["type"];
  if (type !== "text") {
    throw invalidRequest(
      `${path}.type must be "text" (non-text content parts are not supported)`,
      `${path}.type`
    );
  }
  const text = part["text"];
  if (typeof text !== "string") {
    throw invalidRequest(`${path}.text must be a string`, `${path}.text`);
  }
  return { type: "text", text };
}

function normalizeContent(content: unknown, path: string, allowNull: boolean): string {
  if (content === null) {
    if (allowNull) {
      return "";
    }
    throw invalidRequest(
      `${path} must not be null (only assistant tool-call turns may have null content)`,
      path
    );
  }
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part, index) => normalizeContentPart(part, `${path}[${index}]`).text)
      .join("\n");
  }
  throw invalidRequest(
    `${path} must be a string or an array of {type:"text",text:string} content parts`,
    path
  );
}

export function normalizeMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) {
    throw invalidRequest("messages must be an array", "messages");
  }
  return raw.map((item, index) => {
    const path = `messages[${index}]`;
    if (!isPlainObject(item)) {
      throw invalidRequest(`${path} must be an object`, path);
    }
    const role = normalizeRole(item["role"], `${path}.role`);
    const allowNullContent = role === "assistant" && hasToolCalls(item);
    const content = normalizeContent(item["content"], `${path}.content`, allowNullContent);
    return { role, content };
  });
}

export function withoutSystemMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((message) => message.role !== "system" && message.role !== "developer");
}

export function dropTrailing(
  messages: ChatMessage[],
  predicate: (message: ChatMessage) => boolean
): ChatMessage[] {
  if (messages.length === 0) {
    return [...messages];
  }
  const last = messages[messages.length - 1];
  if (predicate(last)) {
    return messages.slice(0, -1);
  }
  return [...messages];
}

export function firstAndLastUser(messages: ChatMessage[]): ChatMessage[] {
  const userMessages = messages.filter((message) => message.role === "user");
  if (userMessages.length === 0) {
    return [];
  }
  if (userMessages.length === 1) {
    return [userMessages[0]];
  }
  return [userMessages[0], userMessages[userMessages.length - 1]];
}
