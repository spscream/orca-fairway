# Fairway roadmap

## 0.3: sequential workflows

Implemented: a coordinator with an explicit allowlisted profile; analysis and clarification; approval of a subtask graph; profile selection after analysis; separate Orca dispatch; operator result review; persistent budget accounting and duplicate-dispatch prevention.

## 0.6: reports and opt-in automatic execution

Implemented: structured reports bound to workflow, step, plan and nonce; one explicit graph authorization; sequential routing and dispatch; native turn-end monitoring; automatic acceptance of passing executor reports; deadlines, launch bounds and pause/recovery gates. Manual review remains available. Unknown dispatch outcomes remain unknown. Reports are self-reported evidence, not independent quality verification.

Next: a separate reviewer profile and versioned revisions of remaining work, requiring renewed approval.

## Bounded automation

Add native Orca isolated worktrees, stronger project-wide locking and persistent wakeups independent of the panel/worker lifecycle. Current automation is restricted to one accepted graph and one executor, pauses on restart, and never retries an uncertain launch. Running agents remain under Orca stop controls.

## Measure routing quality

Collect an explicitly authorized, anonymized task set with expected profiles. Evaluate JEV decisions, fallback policy, and execution outcomes separately. Tune profile cards and confidence policy from measurements. One successful run does not establish cost savings or superior quality.

## Boundaries

No stage requires changing Orca itself. Transparent control of another agent's internal subagents requires a separately verified interface and is not currently claimed. Model-catalog freshness, account entitlement, and observed response models remain separate checks.
