import { atom, Badge, Button, Callout, Card, Code, Heading, Input, KeyValue, plugin, read, Row, Select, set, Spinner, Stack, Switch, Tab, Tabs, Text, Textarea, settings, type PanelContext } from 'orca'
import type { Agent, Config, Effort, Plan, Profile } from './core/types.ts'
import { DEFAULT_CONFIG } from './core/config.ts'
import { budgetFromText } from './core/preferences.ts'
import type { Status } from './protocol.ts'
import { workflowPanel } from './workflow-panel.tsx'
const state = atom<Status | null>(null)
const launching = atom(false)
const task = atom(''), agent = atom<Agent>('codex'), plan = atom<Plan | null>(null)
const journal = atom('[]')
const draft = atom<Config>(DEFAULT_CONFIG), budget = atom('0.1'), calls = atom('5'), selectedProfile = atom(0), dirty = atom(false), saving = atom(false)
const apiKey = atom(''), busy = atom(false), error = atom(''), activeId = atom<string | null>(null)
const tab = atom('tab', 'task', { persist: 'plugin' })
function showError(e: unknown): void {
  const code = e instanceof Error ? e.message : ''
  const known: Record<string, string> = {
    local_workspace_required: 'Нужно локальное рабочее пространство Orca.', execution_disabled: 'Запуск выключен в настройках Fairway.',
    profile_unverified: 'Пара модели и усилия не подтверждена.', plan_changed: 'Задача или настройки изменились. Подберите профиль заново.',
    plan_not_launchable: 'Решение отменено, просрочено или уже использовано.', plan_already_consumed: 'Повторный запуск этого решения запрещён.',
    no_profiles_for_agent: 'Добавьте профили выбранного агента в настройках.', invalid_config: 'Проверьте настройки профилей.', invalid_task: 'Описание должно занимать от 1 до 4096 байт UTF-8.',
    invalid_budget: 'Бюджет: от 0 до 10 USD, не более 6 знаков после точки или запятой.', invalid_call_limit: 'Лимит попыток: целое число от 0 до 100.',
    invalid_profile_id: 'Идентификатор: латинская буква, затем буквы, цифры, дефис или подчёркивание; до 40 символов.',
    invalid_model: 'Укажите точный идентификатор модели без пробелов и команд.', invalid_description: 'Описание профиля: от 1 до 400 символов.',
    duplicate_profile: 'Идентификаторы профилей должны быть уникальными.', invalid_fallback: 'Выберите существующий резервный профиль.',
    invalid_pi_pair: 'Для Pi укажите provider/model и допустимое усилие.', invalid_codex_pair: 'Для Codex укажите модель без имени провайдера и допустимое усилие.',
    invalid_cursor_pair: 'Для Cursor нужен точный идентификатор модели; auto не разрешён.',
    workflow_active: 'Закройте текущий план или завершите его подзадачи.', workflow_task_too_large: 'Постановка для координатора: до 2000 байт UTF-8.',
    workflow_workspace_changed: 'План относится к другому рабочему пространству.', analysis_not_found: 'Координатор ещё не записал файл анализа.',
    invalid_analysis: 'Файл анализа не соответствует формату или превышает лимиты.', invalid_dependencies: 'В плане повторяются шаги, есть цикл или неизвестная зависимость.',
    analysis_needs_clarification: 'Сначала уточните вопросы и недоступные источники с координатором.', analysis_already_approved: 'Принятый план нельзя заменить. Создайте новый план.',
    analysis_missing_sources: 'В анализе должны быть указаны все ссылки из исходной задачи.',
    dependencies_not_reviewed: 'Сначала подтвердите результаты зависимостей.', workflow_running: 'Сначала проверьте результат уже запущенной подзадачи.',
    step_not_launchable: 'Сначала подберите и подтвердите профиль подзадачи.', workflow_not_ready: 'План ещё не готов или уже закрыт.',
    invalid_review: 'Подтверждение результата: от 1 до 160 байт UTF-8, без кода и секретов.'
  }
  set(error, known[code] ?? 'Операция не завершена. Проверьте настройки и доступность Orca; секреты и вывод процессов скрыты.')
}
function apply(s: Status, reset = !read(dirty)): void {
  set(state, s); set(plan, s.lastPlan)
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
  change({ profiles: [...config.profiles, { id: `profile-${n}`, agent: 'codex', model: '', effort: 'medium', description: '', operatorConfirmed: false }] })
  set(selectedProfile, config.profiles.length)
}
function removeProfile(): void {
  const config = read(draft); if (config.profiles.length <= 1) return
  const profiles = config.profiles.filter((_, i) => i !== read(selectedProfile))
  change({ profiles, fallback: profiles.some(p => p.id === config.fallback) ? config.fallback : profiles[0]!.id }); set(selectedProfile, 0)
}
async function refresh(): Promise<void> { try { apply(await plugin.request('fairway.status')) } catch (e) { showError(e) } }
export function setup(ctx: PanelContext): void { ctx.subscriptions.push(settings.onDidChange(() => { void refresh() })); void refresh() }
async function route(): Promise<void> {
  const id = Array.from({ length: 36 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
  set(activeId, id); set(busy, true); set(error, ''); set(plan, null)
  try { const p = await plugin.request('fairway.plan', { id, task: read(task), agent: read(agent) }, { timeoutMs: 30_000 }); if (read(activeId) === id) { set(plan, p); set(state, await plugin.request('fairway.status')) } }
  catch (e) { showError(e) } finally { set(busy, false) }
}
async function cancel(): Promise<void> {
  const id = read(activeId) ?? read(plan)?.id
  set(activeId, null); set(plan, null)
  if (id) try { await plugin.request('fairway.cancel', { id }) } catch (e) { showError(e) }
}
async function launch(): Promise<void> {
  const p = read(plan); if (!p) return
  set(busy, true); set(launching, true); set(activeId, null); set(error, '')
  try { set(plan, await plugin.request('fairway.launch', { id: p.id, task: read(task) }, { timeoutMs: 45_000 })) }
  catch (e) { showError(e) } finally { set(busy, false); set(launching, false) }
}
async function save(): Promise<void> {
  set(error, ''); set(saving, true)
  try {
    if (!/^\d+$/.test(read(calls).trim()) || Number(read(calls)) > 100) throw new Error('invalid_call_limit')
    const config = { ...read(draft), budgetMicrousd: budgetFromText(read(budget)), maxCalls: Number(read(calls)) }
    const result = await plugin.request('fairway.config', { config: JSON.stringify(config) })
    set(activeId, null); apply(result, true); set(plan, null)
  } catch (e) { showError(e) } finally { set(saving, false) }
}
async function keySave(): Promise<void> {
  try { await plugin.request('fairway.key', { key: read(apiKey) }); set(apiKey, ''); await refresh() } catch (e) { set(apiKey, ''); showError(e) }
}
async function bridge(enabled: boolean): Promise<void> {
  try { await plugin.request('fairway.bridge', { enabled }); await refresh() } catch (e) { showError(e) }
}
function settingsForm() {
  const config = read(draft), profile = config.profiles[read(selectedProfile)] ?? config.profiles[0]!
  const options = config.profiles.map((p, i) => ({ value: String(i), label: `${p.id || 'Без идентификатора'} · ${p.agent} · ${p.model || 'модель не задана'}` }))
  const efforts = profile.agent === 'pi' ? ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] : ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  return <Stack gap="md">
    <Card title="Режим и лимиты" description="Эти же параметры доступны в Settings → Plugins → Fairway.">
      <Stack gap="sm">
        <Switch label="Разрешить платные запросы JEV" checked={config.live} onChange={live => change({ live })} />
        <Switch label="Разрешить явный запуск через Orca" checked={config.execution} onChange={execution => change({ execution })} />
        <Input label="Общий бюджет JEV, USD" value={read(budget)} onChange={v => { set(budget, v); set(dirty, true) }} />
        <Input label="Лимит попыток JEV" value={read(calls)} onChange={v => { set(calls, v); set(dirty, true) }} />
        <Text muted>Подбор не запускает агента. Лимиты накопленные: сохранение не обнуляет учёт расходов.</Text>
      </Stack>
    </Card>
    <Card title="Разрешённые профили" description="До 24 профилей. Доступность пары проверяется отдельно перед запуском.">
      <Stack gap="sm">
        <Select label="Редактируемый профиль" value={String(read(selectedProfile))} options={options} onChange={v => set(selectedProfile, Number(v))} />
        <Row gap="sm" wrap><Button icon="add" disabled={config.profiles.length >= 24} onPress={addProfile}>Добавить профиль</Button><Button icon="delete" variant="ghost" disabled={config.profiles.length <= 1} onPress={removeProfile}>Удалить профиль</Button></Row>
        <Input label="Идентификатор профиля" value={profile.id} maxLength={40} onChange={id => editProfile({ id })} />
        <Select label="Агент профиля" value={profile.agent} options={[{ value: 'codex', label: 'Codex' }, { value: 'pi', label: 'Pi' }, { value: 'cursor', label: 'Cursor Agent' }]} onChange={v => editProfile({ agent: v as Agent, model: '', effort: v === 'cursor' ? null : 'medium', operatorConfirmed: false })} />
        <Input label="Модель профиля" value={profile.model} maxLength={120} placeholder={profile.agent === 'pi' ? 'provider/model' : 'Точный идентификатор из каталога агента'} onChange={model => editProfile({ model, operatorConfirmed: false })} />
        {profile.agent === 'cursor' ? <Text muted>Усилие входит в нативный идентификатор Cursor. Отдельный параметр не передаётся; auto запрещён.</Text> : <Select label="Усилие профиля" value={profile.effort ?? 'medium'} options={efforts.map(value => ({ value, label: value }))} onChange={v => editProfile({ effort: v as Effort, operatorConfirmed: false })} />}
        <Textarea label="Когда выбирать профиль" value={profile.description} maxLength={400} rows={3} placeholder="Класс задач, сложность и условия выбора; без секретов." onChange={description => editProfile({ description })} />
        {profile.agent === 'pi' ? <Switch label="Я проверил эту пару в Pi" checked={profile.operatorConfirmed} onChange={operatorConfirmed => editProfile({ operatorConfirmed })} /> : <Text muted>Проверка по метаданным агента обязательна. Ручное подтверждение не обходит её.</Text>}
        <Select label="Резервный профиль" value={config.fallback} options={config.profiles.map(p => ({ value: p.id, label: p.id || 'Без идентификатора' }))} onChange={fallback => change({ fallback })} />
      </Stack>
    </Card>
  </Stack>
}
export default function Panel() {
  const s = read(state), p = read(plan), waiting = read(busy)
  return <Stack gap="md">
    <Row justify="between"><Heading>Fairway</Heading><Badge tone={s?.config.execution ? 'warning' : 'neutral'}>{s?.config.execution ? 'Явный запуск' : 'Наблюдение'}</Badge></Row>
    <Text muted>Маршрут задачи → модель и усилие → штатный запуск Orca.</Text>
    {read(error) ? <Callout tone="danger" title="Операция остановлена"><Text>{read(error)}</Text></Callout> : null}
    <Tabs label="Раздел" value={read(tab)} onChange={v => { set(tab, v); if (v === 'history') void plugin.request('fairway.history').then(r => set(journal, r.json)).catch(showError) }}>
      <Tab value="workflow" label="План">{workflowPanel(s, w => {
        set(error, '')
        const current = read(state); if (current) set(state, { ...current, workflow: w })
        void plugin.request('fairway.status').then(next => set(state, next)).catch(showError)
      }, showError)}</Tab>
      <Tab value="task" label="Задача">
        <Stack gap="md">
          <Callout tone="neutral" title={s?.config.live ? 'JEV включён' : 'Без сети'}><Text>{s?.config.live ? 'JEV получает только введённое описание и карточки разрешённых профилей.' : 'Выбирается резервный профиль. Платных запросов нет.'}</Text></Callout>
          {!s?.workspace ? <Text tone="warning">Откройте локальное рабочее пространство Orca.</Text> : null}
          <Select label="Исполнитель" disabled={read(launching)} value={read(agent)} options={[{ value: 'codex', label: 'Codex' }, { value: 'pi', label: 'Pi' }, { value: 'cursor', label: 'Cursor Agent' }]} onChange={v => { void cancel(); set(agent, v as Agent) }} />
          <Textarea label="Описание задачи" disabled={read(launching)} value={read(task)} rows={6} maxLength={4096} placeholder="Короткая постановка без секретов и исходного кода" onChange={v => { void cancel(); set(task, v) }} />
          <Row gap="sm" wrap><Button icon="branch" disabled={waiting || !read(task).trim() || !s?.workspace} onPress={route}>Подобрать профиль</Button><Button variant="ghost" disabled={read(launching) || (!waiting && (!p || p.state !== 'shadow'))} onPress={cancel}>Отменить подбор</Button></Row>
          {waiting ? <Spinner label="Выполняется операция" /> : null}
          {p ? <Card title={p.profile.model} description={`${p.profile.agent} · ${p.profile.effort ?? 'усилие в идентификаторе Cursor'}`}>
            <Stack gap="sm">
              <KeyValue items={[{ label: 'Причина', value: p.reason }, { label: 'Подтверждение', value: p.evidence.source }, { label: 'Уверенность', value: p.confidence === null ? '—' : p.confidence.toFixed(2) }, { label: 'Состояние', value: p.state }]} />
              {!p.evidence.verified ? <Text tone="warning">Запуск заблокирован: подтвердите точную пару по метаданным агента.</Text> : null}
              <Button icon="play" disabled={waiting || !s?.config.execution || !p.evidence.verified || p.state !== 'shadow'} onPress={launch}>Запустить через Orca</Button>
              {p.state === 'submitted' ? <Text tone="success">Orca приняла запуск. Фактически отвечавшая модель пока не подтверждена.</Text> : null}
              {p.state === 'dispatch_unknown' ? <Text tone="warning">Результат запуска неизвестен. Проверьте Orca перед новым запуском.</Text> : null}
            </Stack>
          </Card> : null}
        </Stack>
      </Tab>
      <Tab value="settings" label="Настройки">
        <Stack gap="md">
          <Text>Изменения применяются только к Fairway. Сохранение отменяет незавершённые решения.</Text>
          {settingsForm()}
          <Row gap="sm" wrap>
            <Button disabled={read(saving) || !s || !read(dirty)} onPress={save}>Сохранить настройки</Button>
            <Button variant="ghost" disabled={read(saving) || !read(dirty)} onPress={async () => { try { apply(await plugin.request('fairway.status'), true); set(error, '') } catch (e) { showError(e) } }}>Отменить изменения</Button>
          </Row>
          {read(dirty) ? <Text tone="warning">Есть несохранённые изменения. Штатные настройки Orca применяются сразу; сохранение этой формы заменит их показанными значениями.</Text> : null}
          <Input label="Ключ OpenRouter" type="password" value={read(apiKey)} onChange={v => set(apiKey, v)} placeholder={s?.keyPresent ? 'Ключ сохранён в Orca' : 'Не задан'} />
          <Row gap="sm" wrap><Button onPress={keySave}>Сохранить ключ</Button><Button variant="ghost" onPress={async () => { set(apiKey, ''); await keySave() }}>Удалить ключ</Button></Row>
          <Text muted>Ключ хранится в защищённом хранилище Orca. Файлы .env и ключи агентов не читаются.</Text>
        </Stack>
      </Tab>
      <Tab value="pi" label="Pi Auto">
        <Stack gap="md">
          <Text>Дополнительное расширение Pi запрашивает только решение. Модель и авторизацию сохраняет Pi.</Text>
          <Switch label="Локальный сервис решений Pi" checked={!!s?.bridgePath} onChange={v => { void bridge(v) }} />
          {s?.bridgePath ? <Code block>{s.bridgePath}</Code> : null}
          <Text muted>Подключение и проверка пар описаны в docs/pi.md. Это не HTTP-прокси генерации и не переключатель стандартного списка моделей Orca.</Text>
        </Stack>
      </Tab>
      <Tab value="history" label="Журнал"><Stack gap="sm"><Text muted>Последние 20 событий. Текст задач, ключи и ответы API сюда не записываются.</Text><Code block>{read(journal)}</Code></Stack></Tab>
    </Tabs>
    <Text muted size="xs">Попыток JEV: {s?.ledger.calls ?? 0}. Резерв: ${((s?.ledger.reservedMicrousd ?? 0) / 1e6).toFixed(6)}.</Text>
    <Button variant="ghost" size="sm" icon="refresh" onPress={refresh}>Обновить состояние</Button>
  </Stack>
}
