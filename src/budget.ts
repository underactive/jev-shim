import { RequestError } from "./types.ts";
import type { JsonObject, JsonValue } from "./types.ts";

export const CHARS_PER_TOKEN = 2;
export const DEFAULT_MAX_STATE_CHARS = 40_000;

const TRUNCATION_MARKER_PREFIX = "…[truncated ";
const TRUNCATION_MARKER_SUFFIX = " chars]…";
const MAX_MARKER_FIT_ITERATIONS = 10;
const MAX_STATE_TRUNCATION_ITERATIONS = 10_000;

function invalidRequest(message: string, param: string): RequestError {
  return new RequestError(message, 400, "invalid_request", param);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw invalidRequest(`${name} must be a positive integer`, name);
  }
}

function buildTruncationMarker(removedChars: number): string {
  return `${TRUNCATION_MARKER_PREFIX}${removedChars}${TRUNCATION_MARKER_SUFFIX}`;
}

/**
 * Truncates `text` to exactly `max` characters, keeping the longest
 * head (70%) and tail (30%) of the original content and inserting an
 * explicit `…[truncated N chars]…` marker between them. The returned
 * string's length is exactly `max` (never approximately `max`).
 *
 * Throws `RequestError` if `max` is not a positive integer, or if `max`
 * is too small for the marker itself to fit.
 */
export function truncateText(text: string, max: number): string {
  assertPositiveInteger(max, "max");

  if (text.length <= max) {
    return text;
  }

  const length = text.length;
  let markerLength = buildTruncationMarker(length).length;

  for (let iteration = 0; iteration < MAX_MARKER_FIT_ITERATIONS; iteration++) {
    const available = max - markerLength;
    if (available < 0) {
      throw invalidRequest(
        `truncation marker (${markerLength} chars) does not fit within max=${max}`,
        "max"
      );
    }

    const headLength = Math.floor(available * 0.7);
    const tailLength = available - headLength;
    const removedChars = length - headLength - tailLength;
    const marker = buildTruncationMarker(removedChars);

    if (marker.length === markerLength) {
      const head = text.slice(0, headLength);
      const tail = tailLength > 0 ? text.slice(length - tailLength) : "";
      return `${head}${marker}${tail}`;
    }

    markerLength = marker.length;
  }

  throw invalidRequest(`unable to compute a stable truncation marker for max=${max}`, "max");
}

/**
 * Attempts to shrink `value` to at most `desiredTarget` characters using the
 * exact-length marker truncation from `truncateText`. If `desiredTarget` is
 * too small for any marker to fit, tries progressively larger target
 * lengths (the smallest achievable) rather than emptying the leaf, so a
 * leaf that is fundamentally too short to carry a marker is left untouched
 * and reported as unchanged, deferring to array-element dropping instead of
 * destroying head/tail content.
 */
function shrinkLeafToAtMost(
  value: string,
  desiredTarget: number
): { value: string; changed: boolean } {
  if (desiredTarget >= value.length) {
    return { value, changed: false };
  }
  for (let target = Math.max(desiredTarget, 1); target < value.length; target++) {
    try {
      return { value: truncateText(value, target), changed: true };
    } catch {
      continue;
    }
  }
  return { value, changed: false };
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface StringLeafHandle {
  length: number;
  get(): string;
  set(next: string): void;
}

function collectStringLeaves(
  value: JsonValue,
  setHere: (next: string) => void,
  out: StringLeafHandle[]
): void {
  if (typeof value === "string") {
    out.push({ length: value.length, get: () => value, set: setHere });
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectStringLeaves(
        item,
        (next) => {
          value[index] = next;
        },
        out
      );
    });
    return;
  }

  if (isJsonObject(value)) {
    for (const key of Object.keys(value)) {
      collectStringLeaves(
        value[key],
        (next) => {
          value[key] = next;
        },
        out
      );
    }
  }
}

function findLargestDroppableArray(value: JsonValue): JsonValue[] | null {
  if (Array.isArray(value)) {
    let best: JsonValue[] | null = value.length > 2 ? value : null;
    for (const item of value) {
      const candidate = findLargestDroppableArray(item);
      if (candidate && (!best || candidate.length > best.length)) {
        best = candidate;
      }
    }
    return best;
  }

  if (isJsonObject(value)) {
    let best: JsonValue[] | null = null;
    for (const key of Object.keys(value)) {
      const candidate = findLargestDroppableArray(value[key]);
      if (candidate && (!best || candidate.length > best.length)) {
        best = candidate;
      }
    }
    return best;
  }

  return null;
}

/**
 * Truncates `state` so that `JSON.stringify(result.state).length` is at
 * most `maxChars` (measured on the final serialized form, including keys,
 * escaping, and any inserted markers).
 *
 * Strategy: repeatedly shrink the longest string leaf first (never slicing
 * the serialized JSON text itself). If exhausting string-leaf truncation
 * still cannot meet the budget, drop array elements from the middle,
 * preserving head and tail elements. Throws `RequestError` if the
 * non-text structural overhead (keys, brackets, braces, commas) alone
 * cannot fit within `maxChars`.
 */
export function truncateState(
  state: JsonValue,
  maxChars: number
): { state: JsonValue; truncated: boolean } {
  assertPositiveInteger(maxChars, "maxChars");

  const initialSerialized = JSON.stringify(state);
  if (initialSerialized.length <= maxChars) {
    return { state, truncated: false };
  }

  let workingState: JsonValue = JSON.parse(initialSerialized) as JsonValue;

  // Phase 1: shrink string leaves, longest first, in a single priority pass.
  // A leaf too short to carry a real truncation marker is left untouched
  // (`changed: false`) so its head/tail content survives for phase 2.
  const leaves: StringLeafHandle[] = [];
  collectStringLeaves(
    workingState,
    (next) => {
      workingState = next;
    },
    leaves
  );
  leaves.sort((a, b) => b.length - a.length);

  for (const leaf of leaves) {
    const currentLength = JSON.stringify(workingState).length;
    if (currentLength <= maxChars) {
      return { state: workingState, truncated: true };
    }

    const excess = currentLength - maxChars;
    const currentValue = leaf.get();
    const desiredTarget = Math.max(0, currentValue.length - excess);
    if (desiredTarget >= currentValue.length) {
      continue;
    }

    const { value: shrunk, changed } = shrinkLeafToAtMost(currentValue, desiredTarget);
    if (changed) {
      leaf.set(shrunk);
    }
  }

  for (let iteration = 0; iteration < MAX_STATE_TRUNCATION_ITERATIONS; iteration++) {
    const currentLength = JSON.stringify(workingState).length;
    if (currentLength <= maxChars) {
      return { state: workingState, truncated: true };
    }

    const droppable = findLargestDroppableArray(workingState);
    if (!droppable) {
      break;
    }

    droppable.splice(Math.floor(droppable.length / 2), 1);
  }

  const finalLength = JSON.stringify(workingState).length;
  if (finalLength > maxChars) {
    throw invalidRequest(
      `state cannot be truncated to fit within maxChars=${maxChars}; ` +
        `minimum achievable size is ${finalLength} chars of non-text structural overhead`,
      "maxChars"
    );
  }

  return { state: workingState, truncated: true };
}

/**
 * Rejects `questions` locally (before ever calling Jev) if its serialized
 * form exceeds `maxChars`.
 */
export function assertQuestionsFit(questions: unknown, maxChars: number): void {
  assertPositiveInteger(maxChars, "maxChars");

  const length = JSON.stringify(questions).length;
  if (length > maxChars) {
    throw invalidRequest(
      `questions payload of ${length} chars exceeds max=${maxChars}`,
      "questions"
    );
  }
}
