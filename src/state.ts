import type { ChatMessage } from "./messages.ts";
import { firstAndLastUser, withoutSystemMessages } from "./messages.ts";
import type { JsonObject } from "./types.ts";

function roleTaggedTranscript(messages: ChatMessage[]): string {
  return messages.map((message) => `${message.role}: ${message.content}`).join("\n");
}

/**
 * Default Jev state shape: `{ opening_task, latest_message? }` built from the
 * first and last user message, after dropping system messages.
 *
 * - `latest_message` is omitted when it is identical to `opening_task`.
 * - When there is no user message at all, falls back to a role-tagged
 *   transcript of the remaining (non-system) messages, preserving order.
 */
export function defaultBuildState(messages: ChatMessage[]): JsonObject {
  const filtered = withoutSystemMessages(messages);
  const userTurns = firstAndLastUser(filtered);

  if (userTurns.length === 0) {
    return { transcript: roleTaggedTranscript(filtered) };
  }

  const openingTask = userTurns[0].content;
  if (userTurns.length === 1) {
    return { opening_task: openingTask };
  }

  const latestMessage = userTurns[1].content;
  if (latestMessage === openingTask) {
    return { opening_task: openingTask };
  }

  return { opening_task: openingTask, latest_message: latestMessage };
}

/**
 * Full role-tagged transcript of every message, preserving order, for
 * profiles that want the complete turn list rather than the reduced
 * `defaultBuildState` shape.
 */
export function transcriptState(messages: ChatMessage[]): JsonObject {
  return { transcript: roleTaggedTranscript(messages) };
}
