import { routingBudget, storedRoutingFailure } from './core/routing-budget.ts'
import { RESERVATION_MICROUSD } from './core/limits.ts'
import { Badge, Button, Card, Code, Collapsible, Stack, Text } from 'orca'
import { t } from './ui-i18n.ts'
import type { Message } from './core/i18n.ts'
import type { Status, WorkflowAction } from './protocol.ts'
import type { AutomaticReason } from './core/workflow.ts'
export function automaticPanel(s: Status | null, action: (action: WorkflowAction) => unknown, waiting: boolean, openSettings?: () => void) {
  const w = s?.workflow
  if (!w?.analysis || w.cancelled) return null
  const a = w.automatic, running = a?.state === 'running', complete = w.analysis.steps.every(step => w.runs[step.id]?.state === 'completed')
  const allowance = routingBudget(s!.config, s!.ledger, w), hasSubmitted = Object.values(w.runs).some(run => run.state === 'submitted')
  const budgetBlocked = !allowance.sufficient && !hasSubmitted, keyBlocked = !!s?.config.live && !s.keyPresent && !hasSubmitted
  const recordedCause = a?.reason === 'routing_failed' ? storedRoutingFailure(w) : a?.reason
  const cause = recordedCause === 'budget_exhausted' && allowance.sufficient ? 'paused' : recordedCause
  const messages: Record<AutomaticReason, Message> = {
    budget_exhausted: 'The JEV allowance cannot cover the remaining steps. Increase the limits in Settings, then continue.',
    missing_key: 'Save an OpenRouter key in Settings.', routing_timeout: 'Request timed out',
    low_confidence: 'JEV could not select a profile confidently. Review the profile descriptions before retrying.',
    invalid_choice: 'JEV returned an invalid choice. Automatic execution is paused.',
    pricing_unbounded: 'JEV pricing could not be bounded. No decision request was sent.',
    http_error: 'OpenRouter rejected the request or was unavailable. Check the key and service status.',
    paused: 'Automatic execution is paused.', interrupted: 'The worker restarted. Review the current step before continuing.',
    settings_changed: 'Settings changed. Continue to select profiles under the new settings.', expired: 'The automatic execution time or launch limit was reached.',
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
      {Object.values(w.runs).some(run => run.state === 'submitted' && run.plan?.reason === 'low_confidence_fallback') ? <Text tone="warning">{t('Low JEV confidence. Using the configured fallback profile.')}</Text> : null}
      {!running && budgetBlocked ? <Text tone="warning">{t(messages.budget_exhausted)}</Text> : null}
      {!running && keyBlocked && cause !== 'missing_key' ? <Text tone="warning">{t('Save an OpenRouter key in Settings.')}</Text> : null}
      {cause && !(budgetBlocked && cause === 'budget_exhausted') ? <Text tone="warning">{t(messages[cause])}</Text> : null}
      {!complete ? <>
        {!running ? <Text muted>{t('Running approves this analysis and authorizes the remaining steps in this workspace.')}</Text> : null}
        <Text muted>{t('Executor reports are accepted automatically after Orca confirms completion; this is not independent verification.')}</Text>
        {s?.config.live ? <Stack gap="xs"><Text>{t('JEV attempts:')} {s.ledger.calls} / {s.config.unlimitedJev ? t('Unlimited') : s.config.maxCalls}</Text><Text>{t('Reserved:')} ${(s.ledger.reservedMicrousd / 1e6).toFixed(6)} / {s.config.unlimitedJev ? t('Unlimited') : '$' + (s.config.budgetMicrousd / 1e6).toFixed(6)}</Text><Text>{t('Decisions needed for remaining steps:')} {allowance.needed}; {t('Available decisions:')} {s.config.unlimitedJev ? t('Unlimited') : allowance.affordable}</Text></Stack> : null}
        <Collapsible title={t("Details")}><Text>{t('One JEV decision reserves:')} ${(RESERVATION_MICROUSD / 1e6).toFixed(6)}</Text><Text muted size="xs">{t('Up to 8 launches, 30 minutes per step, 2 hours total. JEV uses the configured budget; executor usage is billed separately.')}</Text><Code block>{w.workspace.path}</Code></Collapsible>
        {running ? <Button onPress={() => action('pauseAutomatic')}>{t('Pause automatic execution')}</Button> : <Button disabled={waiting || !s?.config.execution || blocked || budgetBlocked || keyBlocked} onPress={() => action('startAutomatic')}>{a ? t('Continue automatically') : t('Run plan automatically')}</Button>}
        {!running && openSettings ? <Button variant="ghost" onPress={openSettings}>{t('Settings')}</Button> : null}
        <Text muted size="xs">{t('Automatic limits stop new launches; running agents must be stopped in Orca.')}</Text>
      </> : null}
    </Stack>
  </Card>
}
