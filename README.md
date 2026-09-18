# @underactive/jev-shim

Typed Jev classifiers and a framework-free OpenAI chat-completions facade for Node.js.

Jev is a System One model: applications send structured state and named Choice, Score, or Noul questions, then receive typed judgments and probabilities rather than generated text. This package adds reusable profiles, state shaping and truncation, typed answer helpers, and an HTTP facade for any OpenAI-compatible client.

## Requirements

- Node.js 22.19 or newer
- A TypeSafe API key in `TYPESAFE_API_KEY`

```sh
npm install @underactive/jev-shim
export TYPESAFE_API_KEY=…
```

The package ships compiled ESM and declarations in `dist/`; ordinary Node consumers do not need TypeScript type stripping or a loader. TypeScript sources are included for inspection.

## Library usage

```ts
import {
	classify,
	createJevClient,
	taskAssessmentProfile,
} from "@underactive/jev-shim";

const result = await classify(
	createJevClient(),
	taskAssessmentProfile,
	[{ role: "user", content: "Add a health endpoint and test it." }],
);

console.log(result.output);
console.log(result.model, result.usage, result.truncated);
```

`taskAssessmentProfile` demonstrates Choice, Score, and Noul in one request. `rawAnswersProfile(name, questions)` creates a generic profile that preserves each typed answer, including Choice probabilities and confidence, Score probabilities, legend and confidence, and the Noul probability.

### Defining a profile

```ts
import {
	asChoice,
	choice,
	defineProfile,
	type JsonObject,
} from "@underactive/jev-shim";

export const intentProfile = defineProfile({
	name: "intent",
	questions: {
		intent: choice("Select the primary intent.", {
			billing: "Charges, invoices, refunds, and payment failures.",
			technical: "Bugs, outages, and integration failures.",
			other: "No listed intent applies.",
		}),
	},
	compose(answers): JsonObject {
		const answer = asChoice(answers, "intent");
		return {
			intent: answer.choice,
			confidence: answer.confidence,
			probabilities: { ...answer.probabilities },
		};
	},
});
```

A `Profile` supplies:

- a unique `name`;
- one or more SDK `questions`;
- an optional `buildState(messages)` function;
- `compose(answers)`, which returns the JSON exposed to callers;
- an optional `maxStateChars` budget.

The default state is `{ opening_task, latest_message? }`, built from the first and last user messages after removing system and developer messages. It avoids sending an entire chat transcript when most of it is irrelevant. Use `transcriptState` explicitly when a profile needs the full ordered transcript.

Choice and Score confidence measures distribution concentration, not overall workflow correctness. Noul is directly the probability of “yes” and has no separate confidence. Do not transfer thresholds between primitives without calibration.

## State budget

`DEFAULT_MAX_STATE_CHARS` is 40,000 characters. This uses a documented heuristic of two characters per token, targeting roughly 20k tokens and leaving headroom beneath Jev 1.13's 32k-token limit for state plus the longest question. It is not a tokenizer.

Truncation measures the final serialized JSON, including keys and escaping. It shortens the longest string leaves first, retaining a 70% head and 30% tail around an explicit marker, then removes middle array elements while retaining array ends. Questions are never truncated. A state whose structural overhead cannot fit is rejected.

Filter state before relying on truncation. Jev reads literally, loses accuracy with irrelevant context, does not reliably count or calculate, is not hardened against adversarial state, and does not generate text.

## OpenAI-compatible facade

### OpenAI client quickstart

The process running the facade needs the real TypeSafe credential. The OpenAI client calling the loopback facade does not: facade authentication is out of scope in v1.

Start a server with the shipped `task-assessment` profile:

```sh
export TYPESAFE_API_KEY=…
cat > serve.mjs <<'EOF'
import { startServer, taskAssessmentProfile } from "@underactive/jev-shim";

const facade = await startServer([taskAssessmentProfile], { port: 4179 });
console.error(`jev-shim listening on ${facade.url}`);
EOF
node serve.mjs
```

Configure any OpenAI chat-completions client with:

| Setting | Value |
| --- | --- |
| Base URL | `http://127.0.0.1:4179/v1` |
| API key | Any non-empty placeholder, such as `local`; the v1 facade ignores inbound authorization |
| Model | A profile name returned by `GET /v1/models`, such as `task-assessment` |
| Streaming | Disabled; `stream: true` returns 400 |

Discover the profiles exposed by the running process:

```sh
curl -s http://127.0.0.1:4179/v1/models
```

Send a standard OpenAI chat-completions request:

```sh
curl -s http://127.0.0.1:4179/v1/chat/completions \
  -H 'authorization: Bearer local' \
  -H 'content-type: application/json' \
  -d '{
    "model": "task-assessment",
    "stream": false,
    "messages": [
      {"role": "user", "content": "Add a health endpoint and test it."}
    ]
  }'
```

The outer response is a normal non-streaming chat completion. The assistant `content` is a **JSON string**, not prose. This abbreviated example keeps the inner JSON parseable:

```json
{
  "id": "chatcmpl-example",
  "object": "chat.completion",
  "created": 1789710000,
  "model": "task-assessment",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "{\"category\":{\"type\":\"choice\",\"choice\":\"implementation\"}}"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 123,
    "completion_tokens": 45,
    "total_tokens": 168
  }
}
```

Parse the inner result before using its fields:

```js
const completion = await response.json();
const classification = JSON.parse(completion.choices[0].message.content);
```

#### Node OpenAI SDK

With the facade already running:

```sh
npm install openai
```

```js
import OpenAI from "openai";

const client = new OpenAI({
	baseURL: "http://127.0.0.1:4179/v1",
	apiKey: "local", // Required by the SDK; ignored by the v1 loopback facade.
});

const completion = await client.chat.completions.create({
	model: "task-assessment",
	stream: false,
	messages: [{ role: "user", content: "Add a health endpoint and test it." }],
});

const content = completion.choices[0]?.message.content;
if (content === null || content === undefined) {
	throw new Error("jev-shim returned no classification content");
}
const classification = JSON.parse(content);
console.log(classification);
```

#### Python OpenAI SDK

With the facade already running:

```sh
python -m pip install openai
```

```python
import json
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:4179/v1",
    api_key="local",  # Required by the SDK; ignored by the v1 loopback facade.
)

completion = client.chat.completions.create(
    model="task-assessment",
    stream=False,
    messages=[
        {"role": "user", "content": "Add a health endpoint and test it."},
    ],
)

content = completion.choices[0].message.content
if content is None:
    raise RuntimeError("jev-shim returned no classification content")
classification = json.loads(content)
print(classification)
```

For projects with no registered profile, run the ad-hoc-only server:

```sh
export TYPESAFE_API_KEY=…
jev-shim-adhoc --host 127.0.0.1 --port 4179
```

Then use model `jev-adhoc` and send the `jev` object shown in [Ad-hoc mode](#ad-hoc-mode). `jev` is a non-standard top-level field. OpenAI SDKs commonly expose this as `extra_body`; clients that strip unknown fields cannot use ad-hoc mode and must call a registered profile instead. The same restriction applies to the optional `jev_profile` override.

OpenAI-only agent constraints:

- This endpoint classifies; it does not generate a natural-language answer.
- Always JSON-decode `choices[0].message.content`.
- Use profile names from `/v1/models`, not Jev's underlying model id.
- Allow up to the facade's 25-second deadline and avoid multiplying it with unnecessary caller retries.
- The default loopback endpoint has no inbound authentication and must not be exposed as a trusted network service.

### Server APIs

```ts
import { startServer } from "@underactive/jev-shim";
import { intentProfile } from "./intent-profile.js";

const facade = await startServer([intentProfile], {
	host: "127.0.0.1",
	port: 4179,
});

console.error(facade.url);
```

Exports:

- `createRequestHandler(profiles, options)` for mounting as a Node request listener;
- `createServer(profiles, options)` for an unlistened `node:http` server;
- `startServer(profiles, options)` for binding and receiving an async `close()` handle.

Routes:

- `POST /v1/chat/completions`
- `GET /v1/models`
- `GET /health`

The facade is non-streaming. `stream: true` returns 400. Common generation-only fields such as `temperature`, `max_tokens`, `max_completion_tokens`, and `response_format` are accepted and ignored.

### Profile selection

The optional top-level `jev_profile` body field has precedence over `model` when it is a non-empty string. A malformed `jev_profile` is an error; it never falls back to `model`. Header-based selection is not supported.

```json
{
  "model": "client-visible-model",
  "jev_profile": "intent",
  "messages": [{ "role": "user", "content": "I was charged twice." }]
}
```

The response is a standard non-streaming chat completion. `choices[0].message.content` is a compact JSON string containing the profile's composed result. The response `model` is the resolved profile name, not the underlying Jev model id.

### Ad-hoc mode

Ad-hoc requests are disabled unless `adhoc: true` is passed. They must explicitly resolve to the reserved profile `jev-adhoc`; a `jev` field on any other profile returns `adhoc_not_allowed`.

```json
{
  "model": "jev-adhoc",
  "messages": [{ "role": "user", "content": "The customer asked for a refund." }],
  "jev": {
    "questions": {
      "refund": {
        "type": "noul",
        "instructions": "Is the customer requesting a refund?"
      },
      "tone": {
        "type": "choice",
        "instructions": "Select the tone.",
        "criteria": { "calm": null, "frustrated": null }
      }
    }
  }
}
```

`jev.state`, when present, replaces message-derived state, including an explicit `null`. Ad-hoc input cannot set credentials, URLs, headers, retry policy, or executable composition logic.

Run an ad-hoc-only facade with:

```sh
jev-shim-adhoc --host 127.0.0.1 --port 4179
```

Use `--help` for options. Passing credentials on the command line may expose them in process listings; prefer `TYPESAFE_API_KEY`.

## Errors

Errors use `{ "error": { "message", "type", "param", "code" } }`.

| Status | Meaning |
| --- | --- |
| 400 | Invalid JSON, messages, profile selection, streaming, or ad-hoc input |
| 404 | Unknown path |
| 405 | Wrong method for a known path |
| 413 | Body exceeds the default 1 MiB limit |
| 429 | Jev rate limit; upstream `retry-after` is forwarded |
| 500 | Profile composition failure |
| 502 | Jev authentication, validation, connection, overload, or API failure |
| 503 | Optional `maxInFlight` limit reached |
| 504 | Facade deadline or Jev attempt timeout |

Upstream bodies are not returned to clients.

## Timeouts, retries, and load

The default SDK policy is 10 seconds per attempt with one retry, while the facade applies a 25-second total deadline. Caller cancellation aborts Jev work. `maxInFlight` is optional and defaults to unlimited; excess requests receive 503 rather than queueing.

TypeSafe currently publishes Jev 1.13 limits of 250,000 input tokens per second and 1,200 requests per minute, and warns that both limits may change dynamically. The facade does not hardcode either service limit. `maxInFlight` is only a local safety valve, not a rate limiter.

A caller's retries multiply the facade deadline. Set retries to zero unless a deliberate larger budget is acceptable. A forwarded 429 remains useful when retries are enabled if the caller honors `Retry-After`.

## Logging and privacy

The facade writes one JSON line per request with method, path, resolved profile, status, latency, truncation, and Jev token counts. Request bodies and composed output are omitted unless `debug: true` or `PI_JEV_DEBUG=1`. Question text is not exposed by `/v1/models`.

Loopback binding is the default, but loopback is not authentication against other local processes. The facade has no authentication layer in v1.

## Examples

`examples/capability-profile.ts` demonstrates a strict four-field classifier profile served through the generic facade. It is a typechecked usage example and is not included in the published package.

## Verification status

The suite covers SDK serialization, profile composition, errors, deadlines, facade routes, privacy logging, and the capability-profile contract. With `TYPESAFE_API_KEY` available, all 42 tests passed with no skips. The packed tarball imports and its compiled CLI runs without a TypeScript loader under Node 22.19 and Node 24.18.

Live verification on 2026-09-18 produced these single-run observations:

- Direct `jev-capability`: 425 ms, 862 prompt + 128 completion tokens (990 total), `SUP-2` / `supported`, `p_solve = 0.8`.
- Direct `jev-adhoc` Choice + Score + Noul: 126 ms, 392 prompt + 64 completion tokens (456 total).
- Easy prompt: 1,701 ms end to end, routed to `google/gemini-2.5-flash-lite`; classifier usage was 983 tokens.
- Hard undocumented-protocol prompt: 1,193 ms end to end, routed to `openai/gpt-4o`; classifier usage was 1,036 tokens.
- `/v1/stats` recorded two successful classifier calls, 2,019 classifier tokens, and 216.25 ms average classifier latency.
- Adding a fifth verdict field produced the expected `parse_error` and strong-target fallback to `openai/gpt-4o` in 1,359 ms. The field was reverted and all 42 tests passed again.

These are verification samples, not stable latency or calibration benchmarks.

## v1 scope

Not included: streaming, Anthropic or Responses API formats, Pi extension integration, header profile selection, facade authentication, per-profile rate limits, `/v1/models/{id}`, dynamic profile loading, or managed facade lifecycle.

## License

MIT
