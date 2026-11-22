import { routingBudget } from './core/routing-budget.ts'
import { COORDINATOR_TASK_BYTES } from './core/limits.ts'
import { automaticPanel } from './automatic-panel.tsx'
import { t } from './ui-i18n.ts'
import { atom, Badge, Button, Callout, Code, Collapsible, Spinner, Input, plugin, read, Row, Select, set, Stack, Text, Textarea } from 'orca'
import { bytes, displayState } from './ui-presentation.ts'
import type { Message } from './core/i18n.ts'
import type { Status, WorkflowAction } from './protocol.ts'
import type { Workflow, AnalysisIssue } from './core/workflow.ts'
const task = atom('coordinatorDraft', '', { persist: 'workspace' }), coordinatorProfile = atom('coordinatorProfileDraft', '', { persist: 'workspace' }), pending = atom(false), review = atom<Record<string, string>>('reviewDrafts', {}, { persist: 'workspace' }), validation = atom<AnalysisIssue | null>(null)
const uncertain = atom<{ workflowId: string; stepId?: string } | null>('uncertainWorkflowDispatch', null, { persist: 'workspace' })
const expanded = atom<Record<string, boolean>>({})
const operation = atom<Message>('Working')
export function reconcileWorkflow(w: Workflow | null): void {
  const target = read(uncertain)
  if (!w || !target || target.workflowId !== w.id) return
  const state = target.stepId ? w.runs[target.stepId]?.plan?.state : w.coordinator.state
  if (w.cancelled || (state && ['submitted', 'dispatch_failed', 'cancelled'].includes(state))) set(uncertain, null)
}
export function clearWorkflowDrafts(): void { set(task, ''); set(review, {}); set(coordinatorProfile, '') }
export function workflowPanel(s: Status | null, changed: (w: Workflow) => void, error: (e: unknown) => void, openSettings?: () => void) {
  const w = s?.workflow, waiting = read(pending)
  const locked = !!w && read(uncertain)?.workflowId === w.id
  const currentStep = w?.analysis?.steps.find(step => ['submitted', 'dispatch_pending', 'dispatch_unknown'].includes(w.runs[step.id]?.state ?? ''))
    ?? w?.analysis?.steps.find(step => w.runs[step.id]?.state !== 'completed' && step.dependsOn.every(id => w.runs[id]?.state === 'completed'))
    ?? w?.analysis?.steps.find(step => w.runs[step.id]?.state !== 'completed')
  const currentState = currentStep ? w?.runs[currentStep.id]?.state : null
  const nextAction: Message = w?.automatic?.state === 'running' && w.automatic.reason !== 'legacy_review' ? 'Waiting for the executor to finish and report checks.' : w?.automatic?.state === 'paused' ? 'Continue automatically' : !w?.approvedHash ? 'Run plan automatically' : currentState === 'submitted' ? 'Reviewed result:' : currentState === 'dispatch_unknown' || locked ? 'The dispatch outcome is unknown. Further dispatch and dependent steps are blocked. Inspect Orca.' : currentState === 'dispatch_pending' ? 'Dispatch in progress' : currentState === 'planned' ? (!s?.config.execution ? 'Enable execution in Settings.' : 'Launch subtask:') : 'Select agent:'
  const finished = !!w?.analysis && w.analysis.steps.every(step => w.runs[step.id]?.state === 'completed')
  async function perform(fn: () => Promise<Workflow>): Promise<void> {
    if (read(pending)) return
    set(pending, true)
    try { changed(await fn()) } catch (e) { error(e) } finally { set(pending, false) }
  }
  const action = (action: WorkflowAction, stepId?: string) => perform(async () => {
    set(validation, null)
    const labels: Partial<Record<WorkflowAction, Message>> = { startAutomatic: 'Run plan automatically', pauseAutomatic: 'Pause automatic execution', refreshCoordinator: 'Refresh coordinator profile', launchCoordinator: 'Launch coordinator through Orca', read: 'Read coordinator analysis', approve: 'Approve analysis and workflow', route: 'Select profile', launch: 'Launch through Orca', review: 'Reviewed result:', cancel: 'Close workflow' }
    set(operation, labels[action] ?? 'Working')
    if (action === 'launch' || action === 'launchCoordinator') set(uncertain, { workflowId: w!.id, ...(stepId ? { stepId } : {}) })
    let result: Workflow
    try { result = await plugin.request('fairway.workflow.action', { id: w!.id, action, ...(stepId === undefined ? {} : { stepId }), ...(action === 'review' ? { review: read(review)[w!.id + ':' + stepId] ?? '' } : {}) }, { timeoutMs: 60_000 }) }
    catch (e) {
      if (action === 'startAutomatic' || action === 'pauseAutomatic') {
        try { const next = await plugin.request('fairway.status'); const expected = action === 'startAutomatic' ? 'running' : 'paused'; if (next.workflow?.id === w!.id && next.workflow.automatic?.state === expected) return next.workflow } catch { /* Keep the original safe error. */ }
      }
      if (action === 'launch' || action === 'launchCoordinator') {
        set(uncertain, { workflowId: w!.id, ...(stepId ? { stepId } : {}) })
        try { const next = await plugin.request('fairway.status'); if (next.workflow) { reconcileWorkflow(next.workflow); changed(next.workflow) } } catch { /* Remain blocked until inspected. */ }
      }
      if (action === 'read') {
        try { const check = await plugin.request('fairway.workflow.inspect', { id: w!.id }); set(validation, check.issue ?? null) } catch { /* Keep the original safe error. */ }
      }
      throw e
    }
    if (action === 'cancel' || action === 'launch' || action === 'launchCoordinator') set(uncertain, null)
    if (action === 'review') set(review, {})
    return result
  })
  return <Stack gap="md">
    <Callout title={t("Analyze first, then select agents")}><Text>{t("The coordinator reads documentation and clarifies the task. After you approve the analysis, Fairway selects a profile for each subtask. Preparation and selection never start agents.")}</Text></Callout>
    {waiting ? <Spinner label={t(read(operation))} /> : null}
    {!waiting && (locked || w?.coordinator.state === 'dispatch_unknown' || Object.values(w?.runs ?? {}).some(run => run.state === 'dispatch_unknown')) ? <Callout tone="warning" title={t("The dispatch outcome is unknown. Further dispatch and dependent steps are blocked. Inspect Orca.")} /> : null}
    {!w || w.cancelled || finished ? <Stack gap="sm">
      <Text muted size="xs">{t("Drafts are saved locally for this workspace. The key field is never saved.")}</Text>
      <Textarea label={t("Coordinator task")} value={read(task)} maxLength={COORDINATOR_TASK_BYTES} rows={4} placeholder={t("Task description and documentation links, without secrets.")} onChange={v => set(task, v)} />
      <Text tone={bytes(read(task)) > COORDINATOR_TASK_BYTES ? "warning" : "neutral"}>{t('UTF-8 bytes')}: {bytes(read(task))} / {COORDINATOR_TASK_BYTES}</Text>
      <Select label={t("Coordinator profile")} value={read(coordinatorProfile) || s?.config.fallback || ''} options={(s?.config.profiles ?? []).map(p => ({ value: p.id, label: `${p.id} · ${p.agent} · ${p.model} · ${p.effort ?? 'native'}` }))} onChange={v => set(coordinatorProfile, v)} />
      <Button disabled={waiting || !s?.workspace || !read(task).trim() || bytes(read(task)) > COORDINATOR_TASK_BYTES} onPress={() => { set(operation, 'Prepare analysis'); return perform(() => plugin.request('fairway.workflow.create', { task: read(task), profileId: read(coordinatorProfile) || s!.config.fallback })) }}>{t("Prepare analysis")}</Button>
    </Stack> : null}
    {w && !w.cancelled ? <Stack gap="md">
      {read(validation) ? <Callout tone="warning" title={t('Analysis validation details')}><Text>{t('Ask the coordinator to correct the listed fields and rewrite the analysis file.')}</Text><Code block>{JSON.stringify(read(validation), null, 2)}</Code></Callout> : null}
      {w.analysis ? <Callout title={finished ? t("Workflow completed") : currentStep?.title}><Text>{t("Accepted result:")} {w.analysis.steps.filter(step => w.runs[step.id]?.state === 'completed').length} / {w.analysis.steps.length}</Text><Text>{finished ? t("Workflow completed") : t(nextAction)}</Text></Callout> : null}
      <Collapsible title={t("Coordinator")} open={read(expanded)[w.id + ':coordinator'] ?? (!w.analysis || w.coordinator.state === 'dispatch_unknown')} onChange={open => set(expanded, { ...read(expanded), [w.id + ':coordinator']: open })}>
      <Text>{w.coordinator.profile.agent} · {w.coordinator.profile.model} · {w.coordinator.profile.effort ?? 'native'}</Text>
        <Stack gap="sm">
          <Text>{t("Original task:")} {w.task}</Text>
          <Text>{t("Dispatch state:")} {displayState(w.coordinator.state)}. {t('Pair verification:')} {w.coordinator.evidence.verified ? t("Pair verified") : t("The model and effort pair is unverified.")}.</Text>
          {w.coordinator.evidence.source === 'codex_catalog_version_mismatch' ? <Text tone="warning">{t('Codex catalog and CLI versions differ. Update the selected account catalog, then refresh this profile.')}</Text> : null}
          <Text muted>{t("The coordinator does not select models and is instructed not to launch agents. Its execution is billed by the selected agent, separately from the JEV budget.")}</Text>
          {!s?.config.execution ? <Text tone="warning">{t("Enable execution in Settings.")}</Text> : !w.coordinator.evidence.verified ? <Text tone="warning">{t("Dispatch blocked: verify the exact pair using agent metadata.")}</Text> : null}
          <Button disabled={locked || waiting || !s?.config.execution || !w.coordinator.evidence.verified || w.coordinator.state !== 'shadow' || !!w.analysis} onPress={() => action('launchCoordinator')}>{t("Launch coordinator through Orca")}</Button>
          <Button variant="ghost" disabled={waiting || w.coordinator.state !== 'shadow' || !!w.analysis} onPress={() => action('refreshCoordinator')}>{t('Refresh coordinator profile')}</Button>
          {w.coordinator.state === 'dispatch_unknown' ? <Text tone="warning">{t("The coordinator dispatch outcome is unknown. Inspect Orca; retries are blocked.")}</Text> : null}
          <Collapsible title={t("Details")}><Code block>{JSON.stringify({ state: w.coordinator.state, source: w.coordinator.evidence.source }, null, 2)}</Code></Collapsible>
          <Text muted>{t("Analysis file in the private Fairway directory:")}</Text><Code block>{w.artifact}</Code>
          <Button disabled={waiting || !!w.approvedHash} onPress={() => action('read')}>{t("Read coordinator analysis")}</Button>
          {!w.analysis && w.coordinator.state === 'shadow' ? <Text muted>{t('Launch the coordinator before reading its analysis.')}</Text> : null}
        </Stack>
      </Collapsible>
      {w.analysis ? <Stack gap="sm">
        <Text weight="semibold">{w.analysis.summary}</Text>
        <Collapsible title={t("Analysis details")}>
        {w.analysis.assumptions.map((a, i) => <Text key={`a${i}`}>{t("Assumption:")} {a}</Text>)}
        {w.analysis.sources.map((source, i) => <Text key={`s${i}`}>{t("Source:")} {source.reference} · {displayState(source.status)}. {source.summary}</Text>)}
        <Text muted>{t("Source reading is reported by the coordinator. Review the analysis before approval. JEV receives only the displayed routing briefs.")}</Text>
        </Collapsible>
        {w.analysis.questions.length > 0 || w.analysis.sources.some(source => source.status !== 'read') ? <Text tone="warning">{t("Resolve open questions and unavailable sources with the coordinator first.")}</Text> : null}
        {w.analysis.questions.map((q, i) => <Text key={i} tone="warning">{t('Open question:')} {q}</Text>)}
        {w.analysis.steps.map(step => <Text key={step.id}>{step.title} · {t('Dependencies:')} {step.dependsOn.join(', ') || t('none')} · {t('Acceptance:')} {step.acceptance} · {t('Allowed agents:')} {step.allowedAgents.join(', ')}{step.reviewRequired ? ' · ' + t('Reviewed result:') : ''}</Text>)}
      {automaticPanel(s, action, waiting || locked, openSettings)}
        {w.automatic?.state !== 'running' ? <Collapsible title={t("Manual controls")}><Button disabled={waiting || !!w.approvedHash || w.analysis.questions.length > 0 || w.analysis.sources.some(source => source.status !== 'read')} onPress={() => action('approve')}>{t("Approve analysis and workflow")}</Button></Collapsible> : null}
        {w.analysis.steps.map(step => {
          const reviewText = read(review)[w.id + ':' + step.id] ?? ''
          const run = w.runs[step.id], ready = step.dependsOn.every(id => w.runs[id]?.state === 'completed')
          const running = Object.values(w.runs).some(r => ['submitted', 'dispatch_pending', 'dispatch_unknown'].includes(r.state))
          return <Collapsible key={step.id} title={step.title} open={read(expanded)[w.id + ':' + step.id] ?? (step.id === currentStep?.id || run?.state === 'dispatch_unknown')} onChange={open => set(expanded, { ...read(expanded), [w.id + ':' + step.id]: open })} description={`${displayState(run?.state ?? 'waiting', w.automatic?.state === 'running' && !!run?.result)} · ${t('Dependencies:')} ${step.dependsOn.join(', ') || t("none")}`}>
            <Stack gap="sm">
              <Badge>{w.automatic?.state === 'running' && run?.state === 'submitted' && run.result ? t('Waiting for the executor to finish and report checks.') : displayState(run?.state ?? 'waiting', w.automatic?.state === 'running' && !!run?.result)}</Badge>
              {!w.approvedHash ? <Text tone="warning">{t("Approve analysis and workflow")}</Text> : !ready ? <Text tone="warning">{t("Review and accept dependency results first.")} {step.dependsOn.filter(id => w.runs[id]?.state !== 'completed').join(', ')}</Text> : running && run?.state !== 'submitted' ? <Text tone="warning">{w.automatic?.state === 'running' ? t('Waiting for the executor to finish and report checks.') : t("Review the currently dispatched subtask first.")}</Text> : !s?.config.execution ? <Text tone="warning">{t("Enable execution in Settings.")}</Text> : run?.state === 'planned' && !run.plan?.evidence.verified ? <Text tone="warning">{t("Dispatch blocked: verify the exact pair using agent metadata.")}</Text> : null}
              {w.automatic?.state !== 'running' ? <Row gap="sm" wrap>
                <Button disabled={locked || waiting || !w.approvedHash || !ready || running || (!!run && !['waiting', 'planned'].includes(run.state))} onPress={() => action('route', step.id)}>{t("Select agent:")} {step.id}</Button>
                <Button disabled={locked || waiting || !s?.config.execution || !ready || running || run?.state !== 'planned' || !run.plan?.evidence.verified || run.plan.state !== 'shadow'} onPress={() => action('launch', step.id)}>{t("Launch subtask:")} {step.id}</Button>
              </Row> : null}
              {run?.state === 'submitted' && (w.automatic?.state !== 'running' || !run.result) ? <Stack gap="sm"><Input label={`${t('Reviewed result:')} ${step.id}`} value={reviewText} maxLength={160} placeholder={t("Briefly describe the result and checks, without code or secrets.")} onChange={v => set(review, { ...read(review), [w.id + ':' + step.id]: v })} /><Text tone={bytes(reviewText) > 160 ? "warning" : "neutral"}>{t('UTF-8 bytes')}: {bytes(reviewText)} / 160</Text><Button disabled={locked || waiting || !reviewText.trim() || bytes(reviewText) > 160} onPress={() => action('review', step.id)}>{t("Accept result:")} {step.id}</Button></Stack> : null}
              <Text>{step.instructions}</Text><Text>{t("Context:")} {step.context || t("not required")}</Text><Text>{t("Acceptance:")} {step.acceptance}</Text>
              <Collapsible title={t("Details")}><Text>{t("JEV routing brief:")} {step.routingBrief}</Text><Text>{t("Allowed agents:")} {step.allowedAgents.join(', ')}.</Text>{run?.plan ? <Code block>{JSON.stringify({ state: run.plan.state, reason: run.plan.reason, source: run.plan.evidence.source }, null, 2)}</Code> : null}</Collapsible>
              {run?.plan && !(run.plan.reason === 'budget_exhausted' && s && routingBudget(s.config, s.ledger, w).sufficient) ? <Text>{t("Selected:")} {run.plan.profile.agent} · {run.plan.profile.model} · {run.plan.profile.effort ?? 'native'} · {displayState(run.plan.reason)}.</Text> : null}
              {run?.state === 'dispatch_unknown' ? <Text tone="warning">{t("The dispatch outcome is unknown. Further dispatch and dependent steps are blocked. Inspect Orca.")}</Text> : null}
              {run?.review ? <Text>{t("Accepted result:")} {run.review}</Text> : null}
              {run?.result && w.automatic?.state !== 'running' ? <Button disabled={waiting} onPress={() => action('inspectResult', step.id)}>{t('Read executor report')}</Button> : null}
              {run?.outcome ? <Collapsible title={t('Executor report')}>
                <Text>{t('Step completion:')} {run.outcome.status} · {run.outcome.summary}</Text>
                {run.outcome.checks.map((check, i) => <Text key={`check${i}`} tone={check.status === 'failed' ? 'warning' : 'neutral'}>{check.status} · {check.name}: {check.evidence}</Text>)}
                <Text>{t('Audit findings:')} {run.outcome.findings?.length ?? '—'}</Text>
                {run.outcome.findings?.map((finding, i) => <Text key={`finding${i}`} tone="warning">{finding.severity} · {finding.summary}: {finding.evidence}</Text>)}
                {run.outcome.questions.map((question, i) => <Text key={`question${i}`} tone="warning">{t('Open question:')} {question}</Text>)}
                <Text muted>{t('Audit completion and product defects are separate. Findings do not prove product readiness.')}</Text>
              </Collapsible> : null}
            </Stack>
          </Collapsible>
        })}
      </Stack> : null}
      <Button variant="ghost" disabled={waiting} onPress={() => action('cancel')}>{t("Close workflow")}</Button>
      <Text muted>{t("Closing blocks further Fairway actions. Stop any running agent in Orca.")}</Text>
    </Stack> : null}
  </Stack>
}
