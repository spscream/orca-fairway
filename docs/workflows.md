# Coordinator and subtasks

Use this mode when an ambiguous task or documentation reference needs analysis before choosing an execution profile.

![Fairway workflow tab](../assets/workflow-dark.png)

1. Open **Workflow** in a local Orca workspace. Enter a task and references, up to 2000 UTF-8 bytes.
2. Select a **Coordinator profile** and click **Prepare analysis**. The allowlisted pair is verified; neither JEV nor an agent starts.
3. Enable explicit execution if needed. After a configuration or catalog change, use **Refresh coordinator profile** to recheck the existing task. A shadow coordinator can be refreshed without launching or paying for a JEV decision. Codex verification prefers the available binary’s offline bundled catalog, so a cache last written by another client no longer blocks a supported pair.
4. Click **Launch coordinator through Orca**. Answer clarification questions in its chat. The coordinator is instructed to read sources, analyze the task, and write `analysis.json` at the displayed private path.
5. Click **Read coordinator analysis**. Review conclusions, assumptions, sources, instructions, acceptance criteria, and routing briefs. Reading sources is reported by the coordinator, not technically proven by Fairway.
6. Resolve questions and unavailable sources in the coordinator chat and request an updated file. Approval is blocked until they are resolved. All HTTP(S) links from the task must appear in the source list.
7. Click **Approve analysis and workflow**. The accepted content is immutable; revisions require a new workflow. Up to 8 unique steps with an acyclic dependency graph are allowed.
8. For a ready step, click **Select agent**. JEV chooses among allowed Codex, Pi, and Cursor profiles eligible for that step. It receives only the displayed `routingBrief`, up to 800 bytes, plus profile cards. Offline mode uses an eligible fallback.
9. Review the pair and click **Launch subtask**. The executor receives local context, acceptance criteria, and accepted summaries of dependencies. A workflow permits only one dispatched step awaiting review.
10. Inspect the work in Orca, enter a review of up to 160 UTF-8 bytes, then click **Accept result**. This is your attestation after checking, not automated quality verification. Dependent steps unlock.

Selection never authorizes execution. `submitted` means Orca accepted the dispatch, not that the task finished. A lost response produces `dispatch_unknown`, blocking retries and dependent work. Inspect Orca. **Close workflow** does not stop a running agent or prove it has finished.

The coordinator profile is explicit because the task has not yet been analyzed. Coordinator and executor costs belong to their respective agents. The Fairway budget covers JEV decisions only, shared across direct routing and workflows.

## Storage and boundaries

Own Orca storage contains the task, accepted analysis, instructions, states, and short reviews. These are local working data, separate from the metadata-only audit. Analysis files live under `~/.config/fairway-for-orca/workflows/<id>/`; Unix directories have mode 0700. They stay outside Git and are not automatically deleted on workflow closure.

Only `analysis.json` in a pre-created private directory is read. Limit: 32768 bytes. Duplicate JSON keys, extra fields, and symbolic links are rejected. Paths supplied by the coordinator are neither executed nor used for file reads. On Windows, manage ACLs through the OS.

The plugin does not fetch source documents or automatically send them to JEV. The coordinator uses its own tools and Orca permissions. Instructions prohibit it from creating agents, but this is not an OS sandbox. Fairway controls only dispatches that pass through it; internal subagents and other running agents are not intercepted.

Steps run sequentially within a workflow in the selected workspace. Isolated worktrees, a global folder lock, automatic result acceptance, autonomous replanning, and recovery of unknown dispatch outcomes are not implemented. Reselect a step profile if its effective configuration or decision expiry changes before launch.

The coordinator prompt defines the analysis schema (`src/core/workflow.ts`). `instructions`, `context`, and `acceptance` are execution data; `routingBrief` is the separately reviewed JEV input. Model-selection fields in analysis are forbidden: dispatch parameters always come from allowlisted profiles.
