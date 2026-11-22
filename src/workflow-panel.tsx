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
    <Callout title="Analyze first, then select agents"><Text>The coordinator reads documentation and clarifies the task. After you approve the analysis, Fairway selects a profile for each subtask. Preparation and selection never start agents.</Text></Callout>
    {!w || w.cancelled || finished ? <Stack gap="sm">
      <Textarea label="Coordinator task" value={read(task)} maxLength={2000} rows={4} placeholder="Task description and documentation links, without secrets." onChange={v => set(task, v)} />
      <Select label="Coordinator profile" value={read(coordinatorProfile) || s?.config.fallback || ''} options={(s?.config.profiles ?? []).map(p => ({ value: p.id, label: `${p.id} · ${p.agent} · ${p.model} · ${p.effort ?? 'native'}` }))} onChange={v => set(coordinatorProfile, v)} />
      <Button disabled={waiting || !s?.workspace || !read(task).trim()} onPress={() => perform(() => plugin.request('fairway.workflow.create', { task: read(task), profileId: read(coordinatorProfile) || s!.config.fallback }))}>Prepare analysis</Button>
    </Stack> : null}
    {w && !w.cancelled ? <Stack gap="md">
      <Card title="Coordinator" description={`${w.coordinator.profile.agent} · ${w.coordinator.profile.model} · ${w.coordinator.profile.effort ?? 'native'}`}>
        <Stack gap="sm">
          <Text>Original task: {w.task}</Text>
          <Text>Dispatch state: {w.coordinator.state}. Pair verification: {w.coordinator.evidence.source}.</Text>
          <Text muted>The coordinator does not select models and is instructed not to launch agents. Its execution is billed by the selected agent, separately from the JEV budget.</Text>
          <Button disabled={waiting || !s?.config.execution || !w.coordinator.evidence.verified || w.coordinator.state !== 'shadow' || !!w.analysis} onPress={() => action('launchCoordinator')}>Launch coordinator through Orca</Button>
          {w.coordinator.state === 'dispatch_unknown' ? <Text tone="warning">The coordinator dispatch outcome is unknown. Inspect Orca; retries are blocked.</Text> : null}
          <Text muted>Analysis file in the private Fairway directory:</Text><Code block>{w.artifact}</Code>
          <Button disabled={waiting || !!w.approvedHash} onPress={() => action('read')}>Read coordinator analysis</Button>
        </Stack>
      </Card>
      {w.analysis ? <Stack gap="sm">
        <Text weight="semibold">{w.analysis.summary}</Text>
        {w.analysis.assumptions.map((a, i) => <Text key={`a${i}`}>Assumption: {a}</Text>)}
        {w.analysis.questions.map((q, i) => <Text key={`q${i}`} tone="warning">Open question: {q}</Text>)}
        {w.analysis.sources.map((source, i) => <Text key={`s${i}`}>Source: {source.reference} · {source.status}. {source.summary}</Text>)}
        <Text muted>Source reading is reported by the coordinator. Review the analysis before approval. JEV receives only the displayed routing briefs.</Text>
        <Button disabled={waiting || !!w.approvedHash || w.analysis.questions.length > 0 || w.analysis.sources.some(source => source.status !== 'read')} onPress={() => action('approve')}>Approve analysis and workflow</Button>
        {w.analysis.steps.map(step => {
          const run = w.runs[step.id], ready = step.dependsOn.every(id => w.runs[id]?.state === 'completed')
          const running = Object.values(w.runs).some(r => ['submitted', 'dispatch_pending', 'dispatch_unknown'].includes(r.state))
          return <Card key={step.id} title={step.title} description={`Dependencies: ${step.dependsOn.join(', ') || 'none'}`}>
            <Stack gap="sm">
              <Text>{step.instructions}</Text><Text>Context: {step.context || 'not required'}</Text><Text>Acceptance: {step.acceptance}</Text>
              <Text>JEV routing brief: {step.routingBrief}</Text><Text>Allowed agents: {step.allowedAgents.join(', ')}.</Text>
              <Badge>{run?.state ?? 'awaiting workflow approval'}</Badge>
              {run?.plan ? <Text>Selected: {run.plan.profile.agent} · {run.plan.profile.model} · {run.plan.profile.effort ?? 'native'} · {run.plan.reason}.</Text> : null}
              <Row gap="sm" wrap>
                <Button disabled={waiting || !w.approvedHash || !ready || running || (!!run && !['waiting', 'planned'].includes(run.state))} onPress={() => action('route', step.id)}>Select agent: {step.id}</Button>
                <Button disabled={waiting || !s?.config.execution || !ready || running || run?.state !== 'planned' || !run.plan?.evidence.verified || run.plan.state !== 'shadow'} onPress={() => action('launch', step.id)}>Launch subtask: {step.id}</Button>
              </Row>
              {run?.state === 'submitted' ? <Stack gap="sm"><Input label={`Reviewed result: ${step.id}`} value={read(review)} maxLength={160} placeholder="Briefly describe the result and checks, without code or secrets." onChange={v => set(review, v)} /><Button disabled={waiting || !read(review).trim()} onPress={() => action('review', step.id)}>Accept result: {step.id}</Button></Stack> : null}
              {run?.state === 'dispatch_unknown' ? <Text tone="warning">The dispatch outcome is unknown. Further dispatch and dependent steps are blocked. Inspect Orca.</Text> : null}
              {run?.review ? <Text>Accepted result: {run.review}</Text> : null}
            </Stack>
          </Card>
        })}
      </Stack> : null}
      <Button variant="ghost" disabled={waiting} onPress={() => action('cancel')}>Close workflow</Button>
      <Text muted>Closing blocks further Fairway actions. Stop any running agent in Orca.</Text>
    </Stack> : null}
  </Stack>
}
