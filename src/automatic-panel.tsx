import { Badge, Button, Card, Code, Collapsible, Stack, Text } from 'orca'
import { t } from './ui-i18n.ts'
import type { Message } from './core/i18n.ts'
import type { Status, WorkflowAction } from './protocol.ts'
import type { AutomaticReason } from './core/workflow.ts'
export function automaticPanel(s: Status | null, action: (action: WorkflowAction) => unknown, waiting: boolean) {
  const w = s?.workflow
  if (!w?.analysis || w.cancelled) return null
  const a = w.automatic, running = a?.state === 'running', complete = w.analysis.steps.every(step => w.runs[step.id]?.state === 'completed')
  const messages: Record<AutomaticReason, Message> = {
    paused: 'Automatic execution is paused.', interrupted: 'The worker restarted. Review the current step before continuing.',
    settings_changed: 'The task or settings changed. Select a profile again.', expired: 'The automatic execution time or launch limit was reached.',
    execution_disabled: 'Execution is disabled in Fairway settings.', routing_failed: 'Automatic routing stopped. Check JEV, the budget, and the key.',
    unverified: 'The model and effort pair is unverified.', dispatch_unknown: 'The dispatch outcome is unknown. Further dispatch and dependent steps are blocked. Inspect Orca.',
    agent_blocked: 'The executor needs your input. Open its Orca chat.', monitor_unavailable: 'Orca could not confirm the executor state. Automatic execution is paused.',
    result_missing: 'The executor report is missing or invalid.', result_invalid: 'The executor report is missing or invalid.',
    checks_failed: 'The executor reported failed checks. Review the result before continuing.', legacy_review: 'This step started manually. Accept its result once; the following steps will run automatically.',
    step_timeout: 'The automatic execution time or launch limit was reached.', operation_failed: 'The operation did not complete. Check the settings and Orca availability. Secrets and process output are hidden.'
  }
  const blocked = w.analysis.questions.length > 0 || w.analysis.sources.some(source => source.status !== 'read') || Object.values(w.runs).some(run => ['dispatch_pending', 'dispatch_unknown', 'dispatch_failed'].includes(run.state))
  return <Card title={t('Automatic execution')}>
    <Stack gap="sm">
      <Badge tone={a?.state === 'paused' ? 'warning' : 'neutral'}>{w.analysis.steps.filter(step => w.runs[step.id]?.state === 'completed').length} / {w.analysis.steps.length}</Badge>
      <Text weight="semibold">{complete ? t('Plan completed') : t('Profiles are selected and steps run one at a time.')}</Text>
      {a?.reason ? <Text tone="warning">{t(messages[a.reason])}</Text> : null}
      {!complete ? <>
        {!running ? <Text muted>{t('Running approves this analysis and authorizes the remaining steps in this workspace.')}</Text> : null}
        <Text muted>{t('Executor reports are accepted automatically after Orca confirms completion; this is not independent verification.')}</Text>
        <Collapsible title={t("Details")}><Text muted size="xs">{t('Up to 8 launches, 30 minutes per step, 2 hours total. JEV uses the configured budget; executor usage is billed separately.')}</Text><Code block>{w.workspace.path}</Code></Collapsible>
        {running ? <Button onPress={() => action('pauseAutomatic')}>{t('Pause automatic execution')}</Button> : <Button disabled={waiting || !s?.config.execution || blocked} onPress={() => action('startAutomatic')}>{a ? t('Continue automatically') : t('Run plan automatically')}</Button>}
        <Text muted size="xs">{t('Automatic limits stop new launches; running agents must be stopped in Orca.')}</Text>
      </> : null}
    </Stack>
  </Card>
}
