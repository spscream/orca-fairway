# Fairway for Orca

An Orca plugin that uses JEV to select an allowlisted **agent + model + effort** profile, then explicitly dispatches the task through Orca. Supports Codex, Pi, and Cursor Agent without changing Orca itself.

**Offline and shadow mode by default.** Selecting a profile never starts an agent. Example profiles do not prove that a model is available on your machine.

![Fairway in shadow mode](assets/panel-dark.png)

## Install

Requires **Orca 1.4.265+**. Development requires **Node.js 22+**. There are no runtime dependencies or build steps: Orca loads TypeScript directly.

```sh
orca plugin install spscream/orca-fairway@v0.3.1 --json
```

The first command reports `approval_required` and lists the requested access. Review it, then run the exact command Orca provides with its `--approve` fingerprint. Installation does not run `npm install` or enable paid requests. On Linux outside an Orca terminal, use `orca-ide` rather than the system screen reader named `orca`. No additional catalog is required.

Access: a trusted Node worker running as your user, own storage and secrets, own Orca settings, workspace metadata, and agent dispatch. The worker invokes the Orca CLI; it is not a sandbox for untrusted code.

## First task

1. Open a local Orca workspace and the **Fairway** panel.
2. In **Task**, enter a short description without secrets or source code.
3. Click **Select profile**. Defaults select a fallback without network access.
4. Review the model, effort, and verification source. Unverified pairs cannot launch.
5. For JEV decisions, save an **OpenRouter key**, enable **Allow paid JEV requests**, and click **Save settings**.
6. To dispatch, enable **Allow explicit execution through Orca**, save, select a profile again, then click **Launch through Orca**.

Only the entered description and configured profile cards go to JEV. Project files, conversation history, tools, and attachments are not collected automatically. The entered task is passed to the selected agent only after explicit dispatch. `live` permits paid decisions; `execution` permits the separate launch button. Neither enables automatic execution or changes ordinary Orca chats and global agent settings.

## Analyze first, then select agents

The **Workflow** tab provides: task and references → coordinator → approved analysis → per-subtask profile selection → explicit dispatch → result review.

The coordinator uses an explicitly selected profile, reads documentation with its own tools, asks questions in its Orca chat, and writes structured analysis to a private Fairway directory. JEV selects subtask profiles after approval. Only the displayed `routingBrief` goes to JEV; local context and execution instructions are kept separate.

Preparing or approving analysis never starts agents. Every launch requires a separate button and enabled execution. Dependent steps unlock after you review and accept predecessor results. This release runs steps sequentially within a workflow; autonomous scheduling and interception of internal subagents are not implemented.

See [workflow instructions](docs/workflows.md) and the [roadmap](docs/roadmap.md).

## Settings and profiles

**Settings → Plugins → Fairway** exposes JEV requests, explicit execution, total budget in USD, and the attempt limit. Native settings apply immediately. Version 0.1.0 settings migrate once without resetting accounting.

The panel's **Settings** tab contains the same preferences and a profile editor. Changes in this form apply with **Save settings**; no JSON editing is required.

1. Select a profile or click **Add profile**.
2. Enter a unique ID, agent, and exact model ID.
3. Select an effort for Codex/Pi. Cursor effort is encoded in its native model ID.
4. Describe when JEV should choose the profile.
5. For Pi, confirm the pair after checking it yourself. Changing its model or effort clears confirmation.
6. Choose a **Fallback profile** and save. Deleting the fallback selects the first remaining profile.

![Fairway settings, upper section](assets/settings-dark.png)

The masked key field saves separately to Orca secret storage, never ordinary settings. Saving a dirty form replaces native settings with the displayed values. **Discard changes** reloads current values.

Up to 24 profiles are allowed. Defaults are unverified examples. Unknown fields, duplicate IDs or JSON keys, invalid types, and effort `ultra` are rejected. JEV returns a profile ID; launch parameters come exclusively from configuration. Confidence threshold 0.6 is an initial policy, not a measured success probability. Errors, low confidence, or a missing key use the configured fallback when eligible, otherwise the first eligible profile. No eligible profiles means refusal.

Saving settings cancels pending decisions. Changed tasks, effective configuration, workspace, or a ten-minute expiry require selecting a profile again.

## Adapter verification

| Agent | Parameters | Pre-dispatch verification |
| --- | --- | --- |
| Codex | Orca `--model` and `--effort` | Exact pair in non-secret `models_cache.json`, no older than 7 days, matching `codex --version` |
| Pi | `provider/model`; Orca maps effort to `--thinking` | Explicit `operatorConfirmed: true`; the Auto extension also checks the Pi model registry |
| Cursor | Exact native alias, `effort: null` | Exact alias from `cursor-agent --list-models`; effort, if any, is part of that alias |

Cursor `auto` is excluded because it does not fix a concrete model. Pi efforts: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, after checking the pair. Manual confirmation cannot bypass Codex or Cursor catalogs.

A mismatched Codex catalog version blocks dispatch. Refresh model metadata through the appropriate Codex version and select again. Fairway does not start a chat to refresh it or read authentication files. A catalog entry does not prove account entitlement or quota.

An accepted Orca dispatch does not prove task completion or the model that actually responded. Observed model/effort fields remain unknown. A lost dispatch response consumes the decision: inspect Orca before any new launch.

## Pi Auto

The optional extension registers `fairway/auto`. It routes once and pins the physical pair to the session branch; Pi retains authentication and generation. It sends only an explicit `/fairway-brief`, never expanded `@files`, history, or source from the current message. See [Pi setup](docs/pi.md).

## Budget, network, and data

Decision model: `typesafe/jev-1.14`; endpoint: `https://openrouter.ai/api/alpha/decisions`. Before each POST, public metadata must confirm bounded input pricing, free output, and context length 262144. Requests specify `provider.max_price` of $0.05/M input and $0 output, with `allow_fallbacks: false`. Unknown pricing prevents the POST.

Each attempt permanently reserves **13108 microdollars ($0.013108)** before network access: the rounded-up cost of the full context at the price ceiling. Defaults: 5 attempts and $0.10. Hard configuration bounds: $10 and 100 attempts. Errors and timeouts do not refund reservations; saving or restarting does not reset them. This accounts for JEV decisions only. Coordinator and executor costs belong to their agents.

Limits: 16 KiB request, 4096-byte UTF-8 task, 64 KiB response, 8-second network stage. Redirects and automatic paid retries are disabled.

The JEV key stays in own Orca secret storage. Fairway does not read `.env` files, extract subscription credentials, or move authentication across providers. Child CLIs do not inherit `OPENROUTER_API_KEY` or `OPENROUTER_TOKEN`; configure their own authentication separately if needed.

Audit storage keeps 200 metadata events; **Audit log** displays the latest 20. No task text, HTTP bodies, process output, or keys are logged. Routing plans store task/workspace hashes rather than task text. Workflow data separately contains the original task, analysis, instructions, and accepted summaries, stored locally. Analysis files live under `~/.config/fairway-for-orca/workflows/` without automatic deletion. Removing plugin data removes local accounting, not the account-wide OpenRouter limit.

## Development

```sh
npm ci --ignore-scripts
npm test
npm run types:orca
npm run typecheck
npm run typecheck:core
npm run test:orca
npm run check:orca
npm run validate
npm run audit:public
```

`npm test` works without Orca. Tests use synthetic tasks, mocked network/dispatch, and temporary local HTTP/filesystem fixtures. No real agents start and no existing credentials are read. Types and UI checks match the installed Orca.

Orca checks stage the audited public surface in `.orca/plugin`, excluding `node_modules` and private research. For visual development, run `npm run stage:plugin`, then `node scripts/orca.mjs plugin dev watch .orca/plugin --check --shot .orca/shots --json`; restage after edits. Git installation receives the clean public files directly.

See [architecture](docs/architecture.md), [verification report](REPORT.md), and [security boundaries](SECURITY.md).

## Release status

0.3.1 makes the interface and documentation English without changing settings keys, persisted data, protocols, or routing behavior. Offline tests and Orca scenarios pass. Live end-to-end adapter execution and paid JEV calls from the plugin remain unverified; no savings or quality superiority is claimed.

Remote workspaces, mobile UI, transparent Auto in the native Orca model list, a universal generation proxy, and per-tool model switching are not supported.
