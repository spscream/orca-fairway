import { t } from './ui-i18n.ts'
import type { Message } from './core/i18n.ts'
import { atom, Badge, Button, Callout, Card, Code, Collapsible, Heading, Image, Input, KeyValue, plugin, read, RelativeTime, Row, Select, set, Spinner, Stack, Switch, Tab, Tabs, Text, Textarea, settings, type PanelContext } from 'orca'
import type { Agent, Config, Effort, Plan, Profile } from './core/types.ts'
import { PROFILE_LEVELS } from './core/profile-level.ts'
import { DEFAULT_CONFIG } from './core/config.ts'
import { budgetFromText } from './core/preferences.ts'
import type { Status } from './protocol.ts'
import { workflowPanel, clearWorkflowDrafts, reconcileWorkflow } from './workflow-panel.tsx'
import type { BalanceItem } from './core/balance.ts'
import { bytes, displayState } from './ui-presentation.ts'
import { knownErrorCode } from './core/ui-errors.ts'
const state = atom<Status | null>(null)
const launching = atom(false)
const task = atom('taskDraft', '', { persist: 'workspace' }), agent = atom<Agent>('agentDraft', 'codex', { persist: 'workspace' }), plan = atom<Plan | null>(null)
const journal = atom<string | null>(null), journalLoading = atom(false), journalError = atom(false)
const boundPlan = atom<string | null>(null), uncertain = atom<string | null>('uncertainDispatch', null, { persist: 'workspace' })
const keyBusy = atom(false), keySaved = atom(false), balanceError = atom(false)
const balanceLoading = atom(false), balanceEpoch = atom(0)
const draft = atom<Config>('configDraft', DEFAULT_CONFIG, { persist: 'workspace' }), budget = atom('budgetDraft', '0.1', { persist: 'workspace' }), calls = atom('callsDraft', '5', { persist: 'workspace' }), selectedProfile = atom('profileDraft', 0, { persist: 'workspace' }), dirty = atom('configDirty', false, { persist: 'workspace' }), saving = atom(false)
const apiKey = atom(''), busy = atom(false), error = atom<Message | ''>(''), activeId = atom<string | null>(null)
const tab = atom('tab', 'task', { persist: 'plugin' })
function showError(e: unknown): void {
  const known: Record<string, Message> = {
    automatic_budget_exhausted: 'The JEV allowance cannot cover the remaining steps. Increase the limits in Settings, then continue.',
    automatic_workflow_active: 'Another workflow is running automatically. Pause it before starting this plan.', automatic_running: 'Pause automatic execution before using manual controls.',
    local_workspace_required: 'A local Orca workspace is required.', execution_disabled: 'Execution is disabled in Fairway settings.',
    profile_unverified: 'The model and effort pair is unverified.', plan_changed: 'The task or settings changed. Select a profile again.',
    plan_not_launchable: 'The decision was cancelled, expired, or already used.', plan_already_consumed: 'This decision cannot be dispatched again.',
    no_profiles_for_agent: 'Add profiles for the selected agent in Settings.', invalid_config: 'Check the profile settings.', invalid_task: 'The description must contain 1–4096 UTF-8 bytes.',
    invalid_budget: 'Budget must be nonnegative, with up to 6 decimal places.', invalid_call_limit: 'The attempt limit must be a nonnegative integer.',
    invalid_profile_id: 'ID: start with a lowercase ASCII letter; use letters, digits, hyphens or underscores, up to 40 characters.',
    invalid_effort: 'Select a supported effort.', invalid_model: 'Enter an exact model ID without spaces or commands.', invalid_description: 'The profile description must contain 1–400 characters.',
    invalid_profile_level: 'Assign a profile level or leave it unranked.', duplicate_profile: 'Profile IDs must be unique.', invalid_fallback: 'Select an existing fallback profile.',
    invalid_pi_pair: 'For Pi, enter provider/model and a supported effort.', invalid_codex_pair: 'For Codex, enter a model without a provider prefix and a supported effort.',
    invalid_cursor_pair: 'Cursor requires an exact model ID; auto is not allowed.',
    coordinator_prompt_too_large: 'The prepared coordinator prompt exceeds 65536 UTF-8 bytes.',
    workflow_active: 'Close the current workflow or complete its subtasks.', workflow_task_too_large: 'The coordinator task must fit within 8192 UTF-8 bytes.',
    workflow_workspace_changed: 'This workflow belongs to another workspace.', analysis_not_found: 'The coordinator has not written the analysis file yet.',
    invalid_analysis: 'The analysis file is invalid or exceeds the limits.', invalid_dependencies: 'The workflow contains duplicate steps, a cycle, or an unknown dependency.',
    analysis_needs_clarification: 'Resolve open questions and unavailable sources with the coordinator first.', analysis_already_approved: 'An approved workflow cannot be replaced. Create a new workflow.',
    analysis_missing_sources: 'The analysis must list every URL from the original task.',
    dependencies_not_reviewed: 'Review and accept dependency results first.', workflow_running: 'Review the currently dispatched subtask first.',
    step_not_launchable: 'Select and verify a subtask profile first.', workflow_not_ready: 'The workflow is not ready or has been closed.',
    invalid_review: 'The result review must contain 1–160 UTF-8 bytes, without code or secrets.'
  }
  const code = knownErrorCode(e, new Set(Object.keys(known)))
  set(error, (code && known[code]) || 'The operation did not complete. Check the settings and Orca availability. Secrets and process output are hidden.')
}
function apply(s: Status, reset = !read(dirty)): void {
  set(state, s); set(plan, s.lastPlan); reconcileWorkflow(s.workflow)
  if (read(uncertain) && s.lastPlan?.id === read(uncertain) && ['submitted', 'dispatch_failed', 'cancelled'].includes(s.lastPlan.state)) set(uncertain, null)
  if (reset) { set(draft, s.config); set(budget, String(s.config.budgetMicrousd / 1e6)); set(calls, String(s.config.maxCalls)); set(selectedProfile, 0); set(dirty, false) }
}
function change(update: Partial<Config>): void { set(draft, { ...read(draft), ...update }); set(dirty, true) }
function editProfile(update: Partial<Profile>): void {
  const config = read(draft), index = read(selectedProfile), previous = config.profiles[index]!
  const profiles = config.profiles.map((p, i) => i === index ? { ...p, ...update } : p)
  change({ profiles, fallback: config.fallback === previous.id && update.id !== undefined ? update.id : config.fallback })
}
function addProfile(): void {
  const config = read(draft); if (config.profiles.length >= 24) return
  let n = 1; while (config.profiles.some(p => p.id === `profile-${n}`)) n++
  change({ profiles: [...config.profiles, { id: `profile-${n}`, agent: 'codex', model: '', effort: 'medium', description: '', level: null, operatorConfirmed: false }] })
  set(selectedProfile, config.profiles.length)
}
function removeProfile(): void {
  const config = read(draft); if (config.profiles.length <= 1) return
  const profiles = config.profiles.filter((_, i) => i !== read(selectedProfile))
  change({ profiles, fallback: profiles.some(p => p.id === config.fallback) ? config.fallback : profiles[0]!.id }); set(selectedProfile, 0)
}
async function refresh(): Promise<void> { try { apply(await plugin.request('fairway.status')) } catch (e) { showError(e) } }
async function loadHistory(): Promise<void> {
  set(journalLoading, true); set(journalError, false)
  try { set(journal, (await plugin.request('fairway.history')).json) } catch { set(journalError, true) } finally { set(journalLoading, false) }
}
export function setup(ctx: PanelContext): void {
  const timer = setInterval(() => { if (read(state)?.workflow?.automatic?.state === 'running') void refresh() }, 2500)
  ctx.subscriptions.push({ dispose: () => clearInterval(timer) })
 ctx.subscriptions.push(settings.onDidChange(() => { void refresh() })); void refresh(); if (read(tab) === 'history') void loadHistory() }
async function route(): Promise<void> {
  if (read(uncertain) || bytes(read(task)) > 4096) return
  const id = Array.from({ length: 36 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
  set(activeId, id); set(busy, true); set(error, ''); set(plan, null)
  try { const p = await plugin.request('fairway.plan', { id, task: read(task), agent: read(agent) }, { timeoutMs: 30_000 }); if (read(activeId) === id) { set(plan, p); set(boundPlan, p.id); set(state, await plugin.request('fairway.status')) } }
  catch (e) { showError(e) } finally { set(busy, false) }
}
async function cancel(): Promise<void> {
  const id = read(activeId) ?? read(plan)?.id
  set(activeId, null); set(plan, null); set(boundPlan, null)
  if (id) try { await plugin.request('fairway.cancel', { id }) } catch (e) { showError(e) }
}
async function launch(): Promise<void> {
  const p = read(plan); if (!p || read(uncertain) || read(boundPlan) !== p.id || !read(task).trim() || bytes(read(task)) > 4096) return
  set(busy, true); set(launching, true); set(activeId, null); set(error, '')
  set(uncertain, p.id)
  try { set(plan, await plugin.request('fairway.launch', { id: p.id, task: read(task) }, { timeoutMs: 45_000 })); set(uncertain, null) }
  catch (e) { set(uncertain, p.id); set(plan, { ...p, state: 'dispatch_unknown' }); showError(e); await refresh() } finally { set(busy, false); set(launching, false) }
}
async function save(): Promise<void> {
  set(error, ''); set(saving, true)
  try {
    if (!read(draft).unlimitedJev && (!/^\d+$/.test(read(calls).trim()) || !Number.isSafeInteger(Number(read(calls))))) throw new Error('invalid_call_limit')
    const config = { ...read(draft), budgetMicrousd: read(draft).unlimitedJev ? read(draft).budgetMicrousd : budgetFromText(read(budget)), maxCalls: read(draft).unlimitedJev ? read(draft).maxCalls : Number(read(calls)) }
    const result = await plugin.request('fairway.config', { config: JSON.stringify(config) })
    set(activeId, null); apply(result, true); set(plan, null)
  } catch (e) { showError(e) } finally { set(saving, false) }
}
async function keySave(remove = false): Promise<void> {
  if (read(keyBusy) || (!remove && !read(apiKey).trim())) return
  set(keyBusy, true); set(keySaved, false); set(error, '')
  set(balanceEpoch, read(balanceEpoch) + 1); set(balanceLoading, false)
  const current = read(state); if (current) set(state, { ...current, balance: null })
  try { await plugin.request('fairway.key', { key: remove ? '' : read(apiKey) }); set(apiKey, ''); await refresh(); set(keySaved, true) } catch (e) { set(apiKey, ''); showError(e) } finally { set(keyBusy, false) }
}
async function refreshBalance(): Promise<void> {
  const epoch = read(balanceEpoch) + 1; set(balanceEpoch, epoch); set(balanceLoading, true); set(balanceError, false)
  try {
    const balance = await plugin.request('fairway.balance', undefined, { timeoutMs: 12_000 })
    const current = read(state); if (current && read(balanceEpoch) === epoch) set(state, { ...current, balance })
  } catch (e) { if (read(balanceEpoch) === epoch) set(balanceError, true) }
  finally { if (read(balanceEpoch) === epoch) set(balanceLoading, false) }
}
function balanceText(value?: BalanceItem): string {
  if (!value) return t('Not checked')
  if (value.state === 'available' && value.remainingUsd !== null) return '$' + value.remainingUsd.toFixed(4)
  const messages: Record<Exclude<BalanceItem['state'], 'available'>, Message> = {
    unlimited: 'No key limit', restricted: 'Management key required', unavailable: 'Unavailable',
    missing_key: 'Not set', invalid_key: 'Invalid key', timeout: 'Request timed out'
  }
  return value.state === 'available' ? t('Unavailable') : t(messages[value.state])
}
async function bridge(enabled: boolean): Promise<void> {
  try { await plugin.request('fairway.bridge', { enabled }); await refresh() } catch (e) { showError(e) }
}
function settingsForm() {
  const config = read(draft), profile = config.profiles[read(selectedProfile)] ?? config.profiles[0]!
  const options = config.profiles.map((p, i) => ({ value: String(i), label: `${p.id || t("No ID")} · ${p.agent} · ${p.model || t("model not set")}` }))
  const efforts = profile.agent === 'pi' ? ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] : ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  return <Stack gap="md">
    <Card title={t("Mode and limits")} description={t("These settings are also available in Settings → Plugins → Fairway.")}>
      <Stack gap="sm">
        <Switch label={t("Allow paid JEV requests")} checked={config.live} onChange={live => change({ live })} />
        <Switch label={t("Allow explicit execution through Orca")} checked={config.execution} onChange={execution => change({ execution })} />
        <Switch label={t("Unlimited JEV decisions")} checked={config.unlimitedJev} onChange={unlimitedJev => change({ unlimitedJev })} />
        {config.unlimitedJev ? <Text tone="warning">{t('No JEV attempt or reserve cap. Usage accounting continues; charges can exhaust the OpenRouter balance or key limit.')}</Text> : null}
        <Input label={t("Total JEV budget, USD")} disabled={config.unlimitedJev} value={read(budget)} onChange={v => { set(budget, v); set(dirty, true) }} />
        <Input label={t("JEV attempt limit")} disabled={config.unlimitedJev} value={read(calls)} onChange={v => { set(calls, v); set(dirty, true) }} />
        <Text muted>{t("Selecting a profile never starts an agent. Limits are cumulative; saving does not reset accounting.")}</Text>
      </Stack>
    </Card>
    <Card title={t("Allowed profiles")} description={t("Up to 24 profiles. Pair availability is verified separately before dispatch.")}>
      <Stack gap="sm">
        <Select label={t("Profile to edit")} value={String(read(selectedProfile))} options={options} onChange={v => set(selectedProfile, Number(v))} />
        <Row gap="sm" wrap><Button icon="add" disabled={config.profiles.length >= 24} onPress={addProfile}>{t("Add profile")}</Button><Button icon="delete" variant="ghost" disabled={config.profiles.length <= 1} onPress={removeProfile}>{t("Delete profile")}</Button></Row>
        <Input label={t("Profile ID")} value={profile.id} maxLength={40} onChange={id => editProfile({ id })} />
        <Select label={t("Profile agent")} value={profile.agent} options={[{ value: 'codex', label: 'Codex' }, { value: 'pi', label: 'Pi' }, { value: 'cursor', label: 'Cursor Agent' }]} onChange={v => editProfile({ agent: v as Agent, model: '', effort: v === 'cursor' ? null : 'medium', operatorConfirmed: false })} />
        <Input label={t("Profile model")} value={profile.model} maxLength={120} placeholder={profile.agent === 'pi' ? 'provider/model' : t("Exact ID from the agent catalog")} onChange={model => editProfile({ model, operatorConfirmed: false })} />
        {profile.agent === 'cursor' ? <Text muted>{t("Cursor effort is encoded in its native model ID. No separate effort flag is sent; auto is not allowed.")}</Text> : <Select label={t("Profile effort")} value={profile.effort ?? 'medium'} options={efforts.map(value => ({ value, label: value === 'none' ? t("none") : value }))} onChange={v => editProfile({ effort: v as Effort, operatorConfirmed: false })} />}
        <Select label={t("Profile level")} value={profile.level ?? 'unranked'} options={[{ value: 'unranked', label: t("Unranked") }, ...PROFILE_LEVELS.map(value => ({ value, label: value }))]} onChange={v => editProfile({ level: v === 'unranked' ? null : v as Profile['level'] })} />
        <Text muted>{t("Levels apply only below the confidence threshold: routine < standard < deep. Unknown levels use the fallback.")}</Text>
        <Textarea label={t("When to choose this profile")} value={profile.description} maxLength={400} rows={3} placeholder={t("Task class, complexity, and selection criteria; no secrets.")} onChange={description => editProfile({ description })} />
        {profile.agent === 'pi' ? <Switch label={t("I verified this pair in Pi")} checked={profile.operatorConfirmed} onChange={operatorConfirmed => editProfile({ operatorConfirmed })} /> : <Text muted>{t("Agent metadata verification is required. Manual confirmation cannot bypass it.")}</Text>}
        <Select label={t("Fallback profile")} value={config.fallback} options={config.profiles.map(p => ({ value: p.id, label: p.id || t("No ID") }))} onChange={fallback => change({ fallback })} />
      </Stack>
    </Card>
  </Stack>
}
export default function Panel() {
  const s = read(state), p = read(plan), waiting = read(busy), errorMessage = read(error)
  return <Stack gap="md">
    <Row justify="between" align="center" wrap><Row gap="sm" align="center"><Image src="assets/fairway-icon.png" alt="Fairway" size="xs" rounded /><Heading>Fairway</Heading></Row><Badge tone={s?.config.execution ? 'warning' : 'neutral'}>{!s ? t("Working") : s.config.execution ? t("Explicit execution") : t("Shadow mode")}</Badge></Row>
    <Text muted>{t("Task → model and effort → native Orca dispatch.")}</Text>
    {errorMessage ? <Callout tone="danger" title={t("Operation stopped")}><Text>{t(errorMessage)}</Text></Callout> : null}
    {!s ? <Spinner label={t("Working")} /> : null}
    {read(uncertain) && !waiting ? <Callout tone="warning" title={t("The dispatch outcome is unknown. Inspect Orca before starting anything again.")}><Button variant="ghost" onPress={refresh}>{t("Refresh status")}</Button></Callout> : null}
    <Tabs label={t("Section")} value={read(tab)} onChange={v => { set(tab, v); if (v === 'history') void loadHistory() }}>
      <Tab value="workflow" label={t("Workflow")}>{workflowPanel(s, w => {
        set(error, ''); reconcileWorkflow(w)
        const current = read(state); if (current) set(state, { ...current, workflow: w })
        void plugin.request('fairway.status').then(next => set(state, next)).catch(showError)
      }, showError, () => set(tab, 'settings'))}</Tab>
      <Tab value="task" label={t("Task")}>
        <Stack gap="md">
          {s ? <Callout tone="neutral" title={s?.config.live ? t("JEV enabled") : t("JEV disabled")}><Text>{s?.config.live ? t("JEV receives only the entered description and allowed profile cards.") : t("Uses the fallback profile. No paid requests.")}</Text></Callout> : null}
          {!s?.workspace ? <Text tone="warning">{t("Open a local Orca workspace.")}</Text> : null}
          <Text muted size="xs">{t("Drafts are saved locally for this workspace. The key field is never saved.")}</Text>
          <Select label={t("Agent")} disabled={read(launching)} value={read(agent)} options={[{ value: 'codex', label: 'Codex' }, { value: 'pi', label: 'Pi' }, { value: 'cursor', label: 'Cursor Agent' }]} onChange={v => { void cancel(); set(agent, v as Agent) }} />
          <Textarea label={t("Task description")} disabled={read(launching)} value={read(task)} rows={6} maxLength={4096} placeholder={t("A short task description without secrets or source code")} onChange={v => { void cancel(); set(task, v) }} />
          <Text tone={bytes(read(task)) > 4096 ? "warning" : "neutral"}>{t('UTF-8 bytes')}: {bytes(read(task))} / 4096</Text>
          <Row gap="sm" wrap><Button icon="branch" disabled={waiting || !!read(uncertain) || !read(task).trim() || bytes(read(task)) > 4096 || !s?.workspace} onPress={route}>{t("Select profile")}</Button><Button variant="ghost" disabled={read(launching) || (!waiting && (!p || p.state !== 'shadow'))} onPress={cancel}>{t("Cancel selection")}</Button></Row>
          {waiting ? <Spinner label={t("Working")} /> : null}
          {p ? <Card title={p.profile.model} description={`${p.profile.agent} · ${p.profile.effort ?? t("effort encoded in the Cursor ID")}`}>
            <Stack gap="sm">
              <KeyValue items={[{ label: t("Reason"), value: p.reason === 'offline' ? t('Uses the fallback profile. No paid requests.') : p.reason === 'selected' ? t('Profile selected') : displayState(p.reason) }, { label: t("Verification"), value: p.evidence.verified ? t("Pair verified") : t("The model and effort pair is unverified.") }, { label: t("Confidence"), value: p.confidence === null ? '—' : p.confidence.toFixed(2) }, { label: t("State"), value: displayState(p.state) }]} />
              <Collapsible title={t("Details")}><Code block>{JSON.stringify({ reason: p.reason, source: p.evidence.source, state: p.state }, null, 2)}</Code></Collapsible>
              {read(boundPlan) !== p.id && p.state === 'shadow' ? <Text tone="warning">{t("Select a profile again for the current task.")}</Text> : null}
              {!s?.config.execution ? <Button variant="ghost" onPress={() => set(tab, 'settings')}>{t("Enable execution in Settings.")}</Button> : null}
              {!p.evidence.verified ? <Text tone="warning">{t("Dispatch blocked: verify the exact pair using agent metadata.")}</Text> : null}
              <Button icon="play" disabled={!!read(uncertain) || read(boundPlan) !== p.id || !read(task).trim() || waiting || !s?.config.execution || !p.evidence.verified || p.state !== 'shadow'} onPress={launch}>{t("Launch through Orca")}</Button>
              {p.state === 'submitted' ? <Text tone="success">{t("Orca accepted the dispatch. The model that actually responds is not yet verified.")}</Text> : null}
              {p.state === 'dispatch_unknown' ? <Text tone="warning">{t("The dispatch outcome is unknown. Inspect Orca before starting anything again.")}</Text> : null}
            </Stack>
          </Card> : null}
        </Stack>
      </Tab>
      <Tab value="settings" label={t("Settings")}>
        <Stack gap="md">
          <Text muted>{t("Drafts are saved locally for this workspace. The key field is never saved.")}</Text>
          <Button variant="ghost" disabled={waiting || read(saving)} onPress={() => { void cancel(); set(task, ''); set(apiKey, ''); clearWorkflowDrafts(); if (s) apply(s, true) }}>{t("Clear drafts")}</Button>
          <Text>{t("Changes apply only to Fairway. Saving cancels pending decisions.")}</Text>
          {settingsForm()}
          <Row gap="sm" wrap>
            <Button disabled={read(saving) || !s || !read(dirty)} onPress={save}>{t("Save settings")}</Button>
            <Button variant="ghost" disabled={read(saving) || !read(dirty)} onPress={async () => { try { apply(await plugin.request('fairway.status'), true); set(error, '') } catch (e) { showError(e) } }}>{t("Discard changes")}</Button>
          </Row>
          {read(dirty) ? <Text tone="warning">{t("You have unsaved changes. Native Orca settings apply immediately; saving this form replaces them with the displayed values.")}</Text> : null}
          <Input label={t("OpenRouter key")} type="password" value={read(apiKey)} onChange={v => set(apiKey, v)} placeholder={s?.keyPresent ? t("Key saved in Orca") : t("Not set")} />
          <Row gap="sm" wrap><Button disabled={read(keyBusy) || !read(apiKey).trim()} onPress={() => keySave()}>{t("Save key")}</Button><Button variant="ghost" disabled={read(keyBusy) || !s?.keyPresent} onPress={() => keySave(true)}>{t("Delete key")}</Button></Row>
          {read(keyBusy) ? <Spinner label={t("Working")} /> : null}
          {read(keySaved) ? <Text tone="success">{t("Key updated")}</Text> : null}
          <Text muted>{t("The key stays in Orca secret storage. No .env files or agent credentials are read.")}</Text>
        </Stack>
      </Tab>
      <Tab value="pi" label="Pi Auto">
        <Stack gap="md">
          <Text>{t("The optional Pi extension requests decisions only. Pi retains model execution and authentication.")}</Text>
          <Switch label={t("Local Pi decision service")} checked={!!s?.bridgePath} onChange={v => { void bridge(v) }} />
          {s?.bridgePath ? <Code block>{s.bridgePath}</Code> : null}
          <Text muted>{t("See docs/pi.md for setup and pair verification. This is not a generation proxy or a switch for the native Orca model list.")}</Text>
        </Stack>
      </Tab>
      <Tab value="history" label={t("Audit log")}><Stack gap="sm"><Text muted>{t("Last 20 events. Task text, keys, and API responses are never recorded here.")}</Text>{read(journalLoading) ? <Spinner label={t("Working")} /> : read(journalError) ? <Text tone="warning">{t("Unable to load events. Try again.")}</Text> : read(journal) === '[]' ? <Text muted>{t("No events yet")}</Text> : <Stack gap="sm">{(() => { try { return (JSON.parse(read(journal) || '[]') as Record<string, unknown>[]).map((event, i) => <Text key={String(i)}>{typeof event.at === 'number' ? new Date(event.at).toLocaleString() : '—'} · {displayState(String(event.state ?? ''))} · {String(event.profile ?? event.stepId ?? event.agent ?? '—')}</Text>) } catch { return <Text>{t("Unable to load events. Try again.")}</Text> } })()}<Collapsible title={t("Details")}><Code block>{read(journal) || '[]'}</Code></Collapsible></Stack>}<Button variant="ghost" disabled={read(journalLoading)} onPress={loadHistory}>{t("Refresh status")}</Button></Stack></Tab>
    </Tabs>
    <Card title={t('OpenRouter balance')}>
      <Stack gap="sm">
        {read(balanceLoading) ? <Spinner label={t('Refresh balance')} /> : null}
        {read(balanceError) ? <Text tone="warning">{t('Unable to refresh balance. Try again.')}</Text> : null}
        <Stack gap="xs"><Text muted>{t('Account balance')}</Text><Text>{balanceText(s?.balance?.account)}</Text></Stack>
        <Stack gap="xs"><Text muted>{t('Key limit remaining')}</Text><Text>{balanceText(s?.balance?.key)}</Text></Stack>
        <Text muted size="xs">{t('Read-only request; separate from the Fairway budget.')}</Text>
        {!s?.keyPresent ? <Text muted>{t('Save an OpenRouter key in Settings.')}</Text> : null}
        {s?.balance ? <Text muted size="xs">{t('Last checked:')} <RelativeTime at={s.balance.checkedAt} /></Text> : null}
        <Button variant="ghost" size="sm" icon="refresh" disabled={!s?.keyPresent || read(balanceLoading)} onPress={refreshBalance}>{t('Refresh balance')}</Button>
      </Stack>
    </Card>
    {s?.config.unlimitedJev ? <Badge tone="warning">{t('Unlimited JEV decisions')}</Badge> : null}
    <Text muted size="xs">{t('JEV attempts:')} {s?.ledger.calls ?? 0}. {t('Reserved:')} ${((s?.ledger.reservedMicrousd ?? 0) / 1e6).toFixed(6)}.</Text>
    <Button variant="ghost" size="sm" icon="refresh" onPress={refresh}>{t("Refresh status")}</Button>
  </Stack>
}
