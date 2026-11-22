# Changelog

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
