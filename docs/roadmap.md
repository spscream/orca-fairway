# Fairway roadmap

## 0.3: sequential workflows

Implemented: a coordinator with an explicit allowlisted profile; analysis and clarification; approval of a subtask graph; profile selection after analysis; separate Orca dispatch; operator result review; persistent budget accounting and duplicate-dispatch prevention.

## Next: executor reports

Define structured reports bound to dispatch IDs, with checks and evidence. Receiving a report should prepare review material, not automatically accept success. Unknown dispatch outcomes must remain unknown. Then add a separate reviewer profile and versioned revisions of remaining work, requiring renewed approval.

## Bounded automation

Add native Orca isolated worktrees, authorization for a specific accepted graph, dispatch limits, stopping, and verifiable recovery. Only then allow ready steps to start automatically under a single explicit operator authorization. Unknown execution remains a stop condition, never a reason for a fresh retry.

## Measure routing quality

Collect an explicitly authorized, anonymized task set with expected profiles. Evaluate JEV decisions, fallback policy, and execution outcomes separately. Tune profile cards and confidence policy from measurements. One successful run does not establish cost savings or superior quality.

## Boundaries

No stage requires changing Orca itself. Transparent control of another agent's internal subagents requires a separately verified interface and is not currently claimed. Model-catalog freshness, account entitlement, and observed response models remain separate checks.
