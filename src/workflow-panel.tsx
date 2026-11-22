import { t } from './ui-i18n.ts'
import { atom, Badge, Button, Callout, Card, Code, Input, plugin, read, Row, Select, set, Stack, Text, Textarea } from 'orca'
import type { Status, WorkflowAction } from './protocol.ts'
import type { Workflow } from './core/workflow.ts'
const task = atom(''), coordinatorProfile = atom(''), pending = atom(false), review = atom('')
export function workflowPanel(s: Status | null, changed: (w: Workflow) => void, error: (e: unknown) => void) {
  const w = s?.workflow, waiting = read(pending)
  const finished = !!w?.analysis && w.analysis.steps.every(step => w.runs[step.id]?.state === 'completed')
  async function perform(fn: () => Promise<Workflow>): Promise<void> {
    set(pending, true)
    try { changed(await fn()) } catch (e) { error(e) } finally { set(pending, false) }
  }
  const action = (action: WorkflowAction, stepId?: string) => perform(async () => {
    const result = await plugin.request('fairway.workflow.action', { id: w!.id, action, stepId, ...(action === 'review' ? { review: read(review) } : {}) }, { timeoutMs: 60_000 })
    if (action === 'review') set(review, '')
    return result
  })
  return <Stack gap="md">
    <Callout title={t("Analyze first, then select agents")}><Text>{t("The coordinator reads documentation and clarifies the task. After you approve the analysis, Fairway selects a profile for each subtask. Preparation and selection never start agents.")}</Text></Callout>
    {!w || w.cancelled || finished ? <Stack gap="sm">
      <Textarea label={t("Coordinator task")} value={read(task)} maxLength={2000} rows={4} placeholder={t("Task description and documentation links, without secrets.")} onChange={v => set(task, v)} />
      <Select label={t("Coordinator profile")} value={read(coordinatorProfile) || s?.config.fallback || ''} options={(s?.config.profiles ?? []).map(p => ({ value: p.id, label: `${p.id} · ${p.agent} · ${p.model} · ${p.effort ?? 'native'}` }))} onChange={v => set(coordinatorProfile, v)} />
      <Button disabled={waiting || !s?.workspace || !read(task).trim()} onPress={() => perform(() => plugin.request('fairway.workflow.create', { task: read(task), profileId: read(coordinatorProfile) || s!.config.fallback }))}>{t("Prepare analysis")}</Button>
    </Stack> : null}
    {w && !w.cancelled ? <Stack gap="md">
      <Card title={t("Coordinator")} description={`${w.coordinator.profile.agent} · ${w.coordinator.profile.model} · ${w.coordinator.profile.effort ?? 'native'}`}>
        <Stack gap="sm">
          <Text>{t("Original task:")} {w.task}</Text>
          <Text>{t("Dispatch state:")} {w.coordinator.state}. {t('Pair verification:')} {w.coordinator.evidence.source}.</Text>
          <Text muted>{t("The coordinator does not select models and is instructed not to launch agents. Its execution is billed by the selected agent, separately from the JEV budget.")}</Text>
          <Button disabled={waiting || !s?.config.execution || !w.coordinator.evidence.verified || w.coordinator.state !== 'shadow' || !!w.analysis} onPress={() => action('launchCoordinator')}>{t("Launch coordinator through Orca")}</Button>
          {w.coordinator.state === 'dispatch_unknown' ? <Text tone="warning">{t("The coordinator dispatch outcome is unknown. Inspect Orca; retries are blocked.")}</Text> : null}
          <Text muted>{t("Analysis file in the private Fairway directory:")}</Text><Code block>{w.artifact}</Code>
          <Button disabled={waiting || !!w.approvedHash} onPress={() => action('read')}>{t("Read coordinator analysis")}</Button>
        </Stack>
      </Card>
      {w.analysis ? <Stack gap="sm">
        <Text weight="semibold">{w.analysis.summary}</Text>
        {w.analysis.assumptions.map((a, i) => <Text key={`a${i}`}>{t("Assumption:")} {a}</Text>)}
        {w.analysis.questions.map((q, i) => <Text key={`q${i}`} tone="warning">{t("Open question:")} {q}</Text>)}
        {w.analysis.sources.map((source, i) => <Text key={`s${i}`}>{t("Source:")} {source.reference} · {source.status}. {source.summary}</Text>)}
        <Text muted>{t("Source reading is reported by the coordinator. Review the analysis before approval. JEV receives only the displayed routing briefs.")}</Text>
        <Button disabled={waiting || !!w.approvedHash || w.analysis.questions.length > 0 || w.analysis.sources.some(source => source.status !== 'read')} onPress={() => action('approve')}>{t("Approve analysis and workflow")}</Button>
        {w.analysis.steps.map(step => {
          const run = w.runs[step.id], ready = step.dependsOn.every(id => w.runs[id]?.state === 'completed')
          const running = Object.values(w.runs).some(r => ['submitted', 'dispatch_pending', 'dispatch_unknown'].includes(r.state))
          return <Card key={step.id} title={step.title} description={`${t('Dependencies:')} ${step.dependsOn.join(', ') || t("none")}`}>
            <Stack gap="sm">
              <Text>{step.instructions}</Text><Text>{t("Context:")} {step.context || t("not required")}</Text><Text>{t("Acceptance:")} {step.acceptance}</Text>
              <Text>{t("JEV routing brief:")} {step.routingBrief}</Text><Text>{t("Allowed agents:")} {step.allowedAgents.join(', ')}.</Text>
              <Badge>{run?.state ?? t("awaiting workflow approval")}</Badge>
              {run?.plan ? <Text>{t("Selected:")} {run.plan.profile.agent} · {run.plan.profile.model} · {run.plan.profile.effort ?? 'native'} · {run.plan.reason}.</Text> : null}
              <Row gap="sm" wrap>
                <Button disabled={waiting || !w.approvedHash || !ready || running || (!!run && !['waiting', 'planned'].includes(run.state))} onPress={() => action('route', step.id)}>{t("Select agent:")} {step.id}</Button>
                <Button disabled={waiting || !s?.config.execution || !ready || running || run?.state !== 'planned' || !run.plan?.evidence.verified || run.plan.state !== 'shadow'} onPress={() => action('launch', step.id)}>{t("Launch subtask:")} {step.id}</Button>
              </Row>
              {run?.state === 'submitted' ? <Stack gap="sm"><Input label={`${t('Reviewed result:')} ${step.id}`} value={read(review)} maxLength={160} placeholder={t("Briefly describe the result and checks, without code or secrets.")} onChange={v => set(review, v)} /><Button disabled={waiting || !read(review).trim()} onPress={() => action('review', step.id)}>{t("Accept result:")} {step.id}</Button></Stack> : null}
              {run?.state === 'dispatch_unknown' ? <Text tone="warning">{t("The dispatch outcome is unknown. Further dispatch and dependent steps are blocked. Inspect Orca.")}</Text> : null}
              {run?.review ? <Text>{t("Accepted result:")} {run.review}</Text> : null}
            </Stack>
          </Card>
        })}
      </Stack> : null}
      <Button variant="ghost" disabled={waiting} onPress={() => action('cancel')}>{t("Close workflow")}</Button>
      <Text muted>{t("Closing blocks further Fairway actions. Stop any running agent in Orca.")}</Text>
    </Stack> : null}
  </Stack>
}
