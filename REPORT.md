# Fairway for Orca — verification report 0.4.2

Replaced the upright buoy artwork with a top-down channel symbol: an ivory trapezoid between separate red and green diamond markers. The icon path and panel code are unchanged. Export: PNG, 256×256, 56349 bytes. No configuration, permissions, localization, or routing changes.

Checks: `npm run validate`, live `plugin dev watch` component check, `npm run audit:public`, and `git diff --check`. The panel screenshot was inspected at 502×959 with `settled: true`, `errors: []`, and `pendingRequests: 0`; the development plugin was unloaded afterward. Code tests were not repeated for this artwork-only change; 55/55 passed in 0.4.1. CI runs the standalone suite on the published commit.

One image-generation request was used for this replacement. No JEV requests, real agent launches, or new access to secrets. Existing integration and host API limitations remain unchanged.

## Previous release: 0.4.1

Added an original nautical buoy icon, generated from a visual brief without source code or private data. The plugin manifest references `assets/fairway-icon.png`; the same bundled asset appears beside the Fairway heading. Technical export: PNG, 256×256, 58672 bytes, within Orca’s minimum 128×128 and maximum 256 KB constraints. The original generated image is retained outside the public repository; only the exported icon is shipped.

The current version-matched panel manifest allows only built-in sidebar symbols, so its `branch` activity icon remains. The custom asset is used in the plugin listing and panel header. No permissions, localization keys, settings, routing logic, or runtime dependencies changed.

Verification: `npm run typecheck`, `npm run test:orca` (**55/55**), `npm run check:orca` (**9 scenarios**, no issues or warnings), `npm run validate`, `npm run audit:public`, and `git diff --check`. The live panel screenshot was inspected at 502×959 in the current dark theme: `settled: true`, `errors: []`, `pendingRequests: 0`. The temporary development plugin was unloaded after inspection. `assets/panel-dark.png` was refreshed.

One image-generation request was used for the icon. OpenRouter/JEV requests: **0**; JEV cost: **$0**. No real coordinators or execution agents were launched. Existing live-integration blockers and host localization limitations remain unchanged.

## Previous release: 0.4.0

The panel now follows the host application's UI language through `env.locale`. All 11 built-in locales observed in Orca 1.4.265 are included: `en`, `de`, `es`, `fr`, `ja`, `ko`, `pt`, `ru`, `tr`, `zh`, and `zh-Hant`. Each contains all 143 panel messages. Locale discovery used shipped resource filenames and the version-matched API, without reading user settings, credentials, or other work repositories.

There is no separate language preference, runtime translation API, or additional dependency. Regional tags resolve to the supported base language; explicit Chinese script overrides region, and Taiwan/Hong Kong/Macao select Traditional Chinese when no script is given. Unknown community language packs fall back to English.

## Results and exact commands

```sh
npm ci --ignore-scripts
npm run types:orca
npm run typecheck
npm run typecheck:core
npm test
npm run test:orca
npm run check:orca
npm run validate
npm run audit:public
git diff --check
```

- Standalone tests: **42/42**.
- Tests through Orca, including panel and worker: **55/55**.
- Panel check: **9 scenarios**, no issues or warnings.
- Both type checks, manifest validation, public-surface audit, and whitespace checks pass.
- Every catalog has the same typed keys, nonempty translations, and unchanged numeric limits.
- Panel tests mount all 11 host locales, exercise localized settings and errors, open workflow controls, preserve user-written descriptions, and verify no accidental selection or dispatch requests.

Environment: Node.js 22.23.2, Orca 1.4.265, Plugin Host API 1.10. Checks stage only the audited public surface in `.orca/plugin`. A clean committed release copy is validated before tagging.

## Visual verification

Russian, German, and Traditional Chinese Settings previews are inspected in the current dark theme at 502×959. All three captures reported `settled: true`, `errors: []`, and `pendingRequests: 0`. The staged preview changes only the initial tab/state key and the locale passed to the translation helper. Global Orca language preferences and installed plugin source are not changed. After review, the temporary plugin is unloaded and the original source is restaged for final checks.

Screenshots: `assets/settings-ru-dark.png`, `assets/settings-de-dark.png`, and `assets/settings-zh-Hant-dark.png`. Existing English screenshots remain valid examples of the English locale. Other locale layouts are exercised in panel tests; light theme, every language's glyph rendering, and live changes to the application's global language were not separately inspected. Initial translations have not received independent native-speaker review.

## Host limitations and preserved behavior

The version-matched manifest API accepts plain strings for native Settings labels and command titles. It has no documented locale map or dynamic label method. Worker commands have no documented UI-locale field. Those static labels and status output remain English; the panel, including its complete Settings form and human-readable errors, is localized. No application language pack or manifest rewriting is used as a workaround.

User tasks, profile descriptions, analysis, reviews, identifiers, effort values, references, audit records, and diagnostic codes are not translated or migrated. Routing, permissions, budget accounting, execution defaults, and settings keys are unchanged. Error state stores source message keys, allowing render-time translation using the host locale.

The current check-scenario API does not expose a locale option. All-language verification uses the documented `mount(..., { locale })` test API, separate from the nine check scenarios.

## Live requests and security boundaries

Paid JEV requests during implementation and tests: **0**. Cost: **$0**. No real coordinators, executors, extra AI agents, or Orca agent workers were launched. No secret files or existing working source code were sent externally. Only the presence of `OPENROUTER_API_KEY` was checked in this session; it was absent, so live JEV testing remains blocked. Translation uses bundled static data only.

Existing synthetic coverage still checks invalid choices, injection, timeout, missing key, budget exhaustion/corruption, concurrent reservations, cancellation, task/workspace/configuration binding, metadata verification, safe argv, secret-free audit, and duplicate/uncertain dispatch.

Workflow coverage includes structured analysis, source/question gates, dependency review, cross-agent routing, routing-brief-only JEV input, immutable approval, restart state, bounded private artifacts, and refusal of symbolic links. Pi coverage includes private loopback capabilities, explicit briefs, and pinned physical pairs.

Live coordinator artifact creation and real end-to-end execution remain unverified. Source reading is reported by the coordinator, not proven by metadata. Results require operator review; internal subagents are not intercepted. Artifact cleanup, a global workspace lock, isolated worktrees, and autonomous graph execution are not implemented. Verified catalogs do not establish account entitlement, quota, or the actual responding model.

## Public data and history

Only new integration code, synthetic tests, documentation, screenshots, and build/CI configuration are published. Private research, transcripts, logs, connection files, and old experimental results remain excluded. The audit checks public paths, symlinks, sizes, common key patterns, and personal absolute paths without printing matched contents.

| Release | Verification and scope |
| --- | --- |
| 0.3.1 | 40 standalone / 52 Orca tests, 9 scenarios; English UI and documentation, refreshed screenshots |
| 0.3.0 | 40 standalone / 52 Orca tests, 9 scenarios; coordinator workflows and per-step routing |
| 0.2.0 | 26 standalone / 36 Orca tests, 5 scenarios; native settings and profile form |
| 0.1.0 | 26 standalone / 30 Orca tests, 5 scenarios; direct routing, native adapters, Pi extension |

Previous plugin releases also used synthetic checks with no paid JEV calls or real agent execution. Historical details remain in Git history.

Usage: [README](README.md), [localization](docs/localization.md), [workflows](docs/workflows.md), [Pi](docs/pi.md). Next steps: [roadmap](docs/roadmap.md).
