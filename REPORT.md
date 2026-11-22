# Fairway for Orca — verification report 0.3.1

This release makes the plugin interface and public documentation English. It translates panel labels, native Orca setting titles/descriptions, fixed error messages, status output, UI test locators, and synthetic check fixtures. It does not change protocol identifiers, configuration keys, persisted user content, permissions, decision policy, accounting, or dispatch behavior. Existing tasks and user-written profile descriptions retain their original language.

## Verification commands

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

Environment: Node.js 22.23.2, Orca 1.4.265, Plugin Host API 1.10. Orca content checks use the audited `.orca/plugin` snapshot, excluding local research and development dependencies. A clean committed release copy is also validated before tagging.

Results: **40/40** standalone tests and **52/52** tests through Orca, including UI/worker coverage. Both type checks, manifest validation, public-surface audit, and whitespace checks passed. Nine panel scenarios cover empty/ready state, unverified selection, settings, Pi, workflow preparation, questions, a selected step, and an uncertain dispatch. All nine scenarios passed without issues or warnings.

## English interface verification

Task, Settings, and Workflow panels were inspected in the current dark theme at 502×959. Captures reported `settled: true`, `errors: []`, and `pendingRequests: 0`. Screenshots in `assets/` were refreshed without editing image content. Settings and Workflow previews changed only the initial tab and its state key in a separate staged copy; no user input actions, agent dispatches, or paid requests were used. The temporary development plugin was unloaded afterward and the original public surface restaged for final checks. Light theme and the native Settings page were not separately inspected.

A Unicode scan of plugin source, check fixtures, manifest, and public Markdown found no remaining Cyrillic text. This is a check of shipped text, not a restriction on user content. No automatic translation or migration of user-authored tasks, profiles, or analysis was introduced.

## Coverage

Tests use synthetic tasks and mocked network/dispatch only. They cover offline/shadow defaults, missing key, invalid/injected choices, timeout, exhausted/corrupt budget, concurrent reservations, cancellation, stale configuration, workspace/task binding, metadata verification, safe argv, secret-free audit, duplicate dispatch, and lost receipts.

Additional coverage includes private Pi connection files and loopback authentication, explicit Pi briefs and pinned model pairs, shared native settings and migration without budget reset, profile editing, and execution disabled during verification.

Workflow tests cover preparation without execution, fixed coordinator profiles without JEV, strict analysis schema and duplicate keys, cycles/unknown dependencies, prohibited model fields, unresolved questions, unavailable/missing references, cross-agent selection, routing-brief-only JEV input, reviewed dependencies, concurrent dispatch, restart state, immutable approval, cancellation, shared accounting, symlink refusal, and bounded artifacts. A failure before persisted dispatch intent permits fresh selection; an uncertain actual launch never permits a blind retry.

## Live requests, costs, and blockers

Paid JEV requests during plugin development and tests: **0**. Cost: **$0**. No real coordinators, executors, extra AI agents, or Orca agent workers were launched. Existing credentials, secret files, and other work repositories were not read. Only the presence of `OPENROUTER_API_KEY` in the current environment was checked; it was absent. Live JEV testing remains blocked by the missing environment key.

Live coordinator creation of `analysis.json` and real end-to-end subtask execution remain unverified. Agents provide analysis using their own tools and permissions. Source reading is reported by the coordinator, not proven by metadata. Results are accepted by the operator. Internal subagents are not intercepted, and verified catalog entries do not establish entitlement, quota, or the actual responding model.

## Data and release boundaries

Only new integration source, synthetic tests, documentation, screenshots, and build/CI settings are published. Private research, transcripts, connection files, logs, and previous experimental results are excluded. `scripts/audit-public.mjs` checks public paths, symlinks, sizes, common key patterns, and personal absolute paths without printing matched content.

Workflow task text, analysis, instructions, and short accepted results are local working data, separate from metadata-only audit. Artifacts have no automatic deletion. Execution is sequential within a workflow, with no global folder lock, isolated worktrees, or autonomous graph scheduling. Closing a workflow does not stop a running agent.

## Previous releases

| Release | Verification and scope |
| --- | --- |
| 0.3.0 | 40/40 standalone tests, 52/52 through Orca, 9 scenarios; analyzed workflows and per-step routing; dark workflow screenshot inspected |
| 0.2.0 | 26/26 standalone tests, 36/36 through Orca, 5 scenarios; native settings, profile form, migration, dark settings screenshot |
| 0.1.0 | 26/26 standalone tests, 30/30 through Orca, 5 scenarios; direct routing, adapters, Pi extension, dark task screenshot |

All previous plugin releases also used synthetic checks with no paid JEV calls or real agent execution. Historical details remain in Git history.

Usage: [README](README.md), [workflows](docs/workflows.md), [Pi](docs/pi.md). Further development: [roadmap](docs/roadmap.md).
