# Changelog

## 0.8.6

- Show the cached OpenRouter account balance in a compact button.
- Move balance details, key limit and JEV usage to the Statistics section.

## 0.8.5

- Check pause immediately before dispatch and guard the automatic slot until the preceding executor finishes.
- Share JEV accounting through a locked local ledger, recover late reports, and revoke prepared decisions after key changes.
- Show plan scope and billing before approval. Add optional operator review, compact navigation, and safer input handling.

## 0.7.0

- Add explicit unlimited JEV decisions: aggregate attempt/reserve caps are optional; accounting and bounded per-request pricing remain enforced.
- Preserve finite limits for existing installations; native and localized settings expose the mode and its billing implications.
- Distinguish budget, key, timeout, confidence, invalid-choice, pricing and HTTP routing failures.
- Show needed/available decisions, cumulative usage and a Settings shortcut; preflight a finite allowance before authorizing the remaining graph.
- Keep in-flight monitoring available without new allowance and prevent futile continuation/reselection when caps cannot cover remaining work.

## 0.6.1

- Raise coordinator descriptions from 2000 to 8192 UTF-8 bytes and label counters explicitly as bytes.
- Keep a separate 65536-byte local coordinator envelope, including instructions and JSON escaping, throughout prepare, refresh and dispatch.
- Extended envelopes require an explicit coordinator purpose and forced allowlisted profile; JEV routing retains its original limits and never receives the expanded coordinator task.

## 0.6.0

- One explicit automatic-plan authorization replaces per-step selection, launch and result-acceptance clicks.
- Sequential JEV routing, exact pair verification, native Orca completion monitoring and strict private result contracts.
- Pause on questions, failed checks, missing or invalid results, routing failures, budget exhaustion, configuration/key changes and uncertain launches; never resume on plugin activation.
- Bound authorization to one graph, 8 launches, a 30-minute per-step wait and a 2-hour window; agent billing remains separate from JEV accounting.
- Preserve manual workflows and one-time review of already-submitted legacy work.
- Integrate the operator’s concurrent UX improvements: workspace drafts, UTF-8 counters, clearer states, compact details, key-save feedback, loading and audit states, and persistent unknown-dispatch locks.
- Complete UI coverage for all 11 supported locales.

## 0.5.4

- Allow up to 32 analysis sources while preserving the 32 KiB file bound.
- State every coordinator collection and text limit, including UTF-8 byte semantics.
- Add read-only, metadata-only analysis inspection and localized field diagnostics after failed reads.
- Verify the current private artifact through the actual Orca worker without modifying its workflow.

## 0.5.3

- Recognize the direct `agent launch` response, as well as wrapped receipts, with explicit prompt-delivery confirmation.
- Keep only dispatch identifiers; incomplete responses still block retries.
- Specify the previously omitted assumptions/questions limits in the coordinator prompt and allow up to 400 UTF-8 bytes per item, at most eight each.
- Verify that an existing unknown coordinator can provide valid analysis without another launch.

## 0.5.2

- Fix OpenRouter connection timeouts on hosts with broken IPv6 routing by using a dedicated IPv4 HTTPS transport for balance and JEV.
- Preserve TLS certificate verification, fixed endpoint/method allowlists, response limits, cancellation and hard deadlines; never follow redirects or retry requests.
- Add synthetic transport coverage and verify authenticated read-only balance access inside the Orca plugin host.

## 0.5.1

- Verify Codex pairs against `codex debug models --bundled` from the available binary, with no network refresh or agent launch.
- Avoid shared-cache version conflicts without modifying Codex files; retain strict version/freshness checks for older-client cache fallback.
- Reject malformed catalogs, duplicate model IDs, unsupported pairs, and oversized responses; bound the metadata command to 10 seconds and 2 MiB.

## 0.5.0

- Explicit OpenRouter balance refresh: separate account funds and key-limit values, permission-aware errors, timeout and in-memory caching.
- Codex verification uses the Orca-selected managed account catalog rather than an unrelated system cache.
- Existing shadow coordinators can refresh their verified profile without losing the task or launching an agent.
- Workflow actions omit undefined optional fields, fixing host-side invalid-input failures.
- Fixed error-code propagation and wrapped error mapping; added guidance before reading missing analysis.
- Updated all 11 UI locales; no new permissions or dependencies.

## 0.4.4

- Changed the native panel/tab symbol from branch to flag to match the maritime identity.
- Custom buoy artwork, settings, permissions, and execution behavior unchanged.

## 0.4.3

- Adopted the selected open-frame buoy direction: broad float, X brace, flat lantern cap, and waves.
- Original artwork in Fairway colors; plugin icon and panel screenshot updated.

## 0.4.2

- Replaced the upright buoy with a top-down fairway between red and green diamond markers.
- Refreshed the plugin icon and panel screenshot; behavior and permissions unchanged.

## 0.4.1

- Original red/ivory nautical buoy icon for the plugin listing and panel header.
- Bundled 256×256 PNG; no extra access or runtime dependencies.
- Sidebar activity icon remains built-in due to the current Orca panel API.

## 0.4.0

- Panel language automatically follows Orca `env.locale`, without an override setting.
- Complete 143-message catalogs for all 11 built-in Orca locales.
- Regional language matching, Chinese script/region handling, and English fallback for unknown language packs.
- Coverage tests for every catalog, preserved numeric limits, localized forms/errors, and unchanged user-authored data.
- Native manifest labels and worker status output remain English under the current host API.

## 0.3.1

- English interface, native Orca settings, validation messages, and status command.
- English documentation, synthetic UI fixtures, and refreshed screenshots.
- Settings keys, persisted user content, protocols, permissions, and execution behavior unchanged.

## 0.3.0

- Workflow tab with preparation and explicit coordinator dispatch using a verified profile.
- Structured documentation analysis, questions, sources, and an acyclic graph of up to 8 subtasks.
- Per-step agent/model/effort selection using a separate JEV routing brief.
- Sequential Orca dispatch, operator result review, and dependency gates.
- Private analysis artifacts, immutable approved analysis, and duplicate-dispatch protection.

## 0.2.0

- Native Settings → Plugins → Fairway preferences for modes and limits.
- Profile form replacing JSON editing: add, delete, fallback, agent, and effort.
- Budget in USD, legacy configuration migration, and preserved cumulative accounting.
- Pi pair confirmation cleared after model/effort changes; form and shared-settings tests.

## 0.1.0

- Standalone Orca plugin with a panel and configurable profiles.
- JEV 1.14, strict responses, fallback, and persistent bounded accounting.
- Explicit Codex/Pi/Cursor dispatch with task binding and duplicate prevention.
- Optional Pi Auto extension using an explicit brief.
- Offline/shadow defaults and synthetic core, adapter, and Orca UI checks.
