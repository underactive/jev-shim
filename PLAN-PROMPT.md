# Plan prompt: pi-jev

Plan a TypeScript package at `/Users/esison/Development/projects/pi/pi-jev` that makes TypeSafe's Jev model usable as a generic classifier from code and any OpenAI chat-completions client. Produce a step-by-step implementation plan with file layout, module responsibilities, data shapes, a test plan, and verification phases. Follow the rules in `~/.pi/agent/AGENTS.md`: erasable TypeScript only, no `any`, top-level imports only, no dynamic `import()`, and never commit.

## What Jev is

Jev is a System One model: clients send structured state and named Choice, Score, or Noul questions and receive typed answers with calibrated probabilities rather than generated text. Read the current TypeSafe API, primitive, state, model, confidence, intent-routing, and model-jaggedness documentation before writing the plan.

Use `@typesafe-ai/sdk` 0.6.0 and read its installed types rather than guessing. The plan must use the injectable `fetch` for unit-test stubs. Live tests must be gated on `TYPESAFE_API_KEY` and skipped when it is absent.

## Requirements

1. **Core library.** Provide a thin SDK client wrapper, a `Profile` contract, profile registry, OpenAI-message state helpers, and answer-composition helpers. Profiles provide a name, questions, optional `buildState(messages)`, and `compose(answers)`. Include filtering helpers, a named default state shape, transcript support, and conservative character-budget truncation below Jev's state limit.
2. **Generic profiles and ad-hoc mode.** Ship a raw-answer profile and a task-assessment profile demonstrating Choice, Score, and Noul. Support an optional ad-hoc request mode with a documented non-standard field, without allowing request data to set credentials, URLs, headers, retry policy, or executable code.
3. **OpenAI-compatible facade.** Build a framework-free `node:http` server exposing `POST /v1/chat/completions`, `GET /v1/models`, and `GET /health`. Return a standard non-streaming completion whose assistant content is the composed JSON string. Use OpenAI-shaped errors, bind loopback by default, reject streaming, and avoid logging request bodies unless debug logging is explicitly enabled.
4. **Programmatic entry points.** Export request-handler, server-construction, and server-start helpers. A consumer should be able to write a small module that imports its own profiles and starts the facade. The optional CLI may support only ad-hoc mode and must not dynamically load arbitrary modules.
5. **Scope.** Keep the package generic: do not add integrations, vendor-specific profiles, framework adapters, or provider-specific configuration files. The facade speaks the standard OpenAI chat-completions shape so any compatible client can call it.

## Decisions to make

- Profile selection precedence among the model field, a body override, and headers.
- Whether ad-hoc questions are in v1 and the exact request field name.
- Default state shape and profile-specific overrides.
- Character budget and truncation policy.
- Whether `stream: true` is rejected or represented as a single SSE response.
- Jev timeout and retry defaults relative to the facade deadline.
- What `/v1/models` advertises for each profile.
- Concurrency and rate-limit behavior without an internal queue.
- Deferred features and the v1 scope boundary.

## Verification

End with these phases, in order:

1. Run `npm run typecheck` and `npm test` with Jev stubbed.
2. If `TYPESAFE_API_KEY` is available, exercise Choice, Score, and Noul through the library and send one request through the facade with `curl`; otherwise report the live check as skipped.
3. Run the generic capability-profile example against a local OpenAI-compatible client and verify that its JSON response has the documented exact fields and rejects unknown fields.
4. Update `README.md` and `CHANGELOG.md` with generic usage and verification notes.
5. Do not commit anything.
