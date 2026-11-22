import { atom, Badge, Button, Callout, Card, Code, Heading, Input, KeyValue, plugin, read, Row, Select, set, Spinner, Stack, Switch, Tab, Tabs, Text, Textarea, type PanelContext } from 'orca'
import type { Agent, Plan } from './core/types.ts'
import type { Status } from './protocol.ts'
const state = atom<Status | null>(null)
const launching = atom(false)
const task = atom(''), agent = atom<Agent>('codex'), plan = atom<Plan | null>(null)
const journal = atom('[]')
const configText = atom(''), apiKey = atom(''), busy = atom(false), error = atom(''), activeId = atom<string | null>(null)
const tab = atom('tab', 'task', { persist: 'plugin' })
function showError(e: unknown): void {
  const code = e instanceof Error ? e.message : ''
  const known: Record<string, string> = {
    local_workspace_required: 'Нужно локальное рабочее пространство Orca.', execution_disabled: 'Запуск выключен в настройках Fairway.',
    profile_unverified: 'Пара модели и усилия не подтверждена.', plan_changed: 'Задача или настройки изменились. Подберите профиль заново.',
    plan_not_launchable: 'Решение отменено, просрочено или уже использовано.', plan_already_consumed: 'Повторный запуск этого решения запрещён.',
    no_profiles_for_agent: 'Добавьте профили выбранного агента в настройках.', invalid_config: 'Проверьте JSON настроек.', invalid_task: 'Описание должно занимать от 1 до 4096 байт UTF-8.'
  }
  set(error, known[code] ?? 'Операция не завершена. Проверьте настройки и доступность Orca; секреты и вывод процессов скрыты.')
}
function apply(s: Status): void { set(state, s); set(configText, JSON.stringify(s.config, null, 2)); set(plan, s.lastPlan) }
async function refresh(): Promise<void> { try { apply(await plugin.request('fairway.status')) } catch (e) { showError(e) } }
export function setup(_ctx: PanelContext): void { void refresh() }
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
  set(error, '')
  try { apply(await plugin.request('fairway.config', { config: read(configText) })); set(plan, null) } catch (e) { showError(e) }
}
async function keySave(): Promise<void> {
  try { await plugin.request('fairway.key', { key: read(apiKey) }); set(apiKey, ''); await refresh() } catch (e) { set(apiKey, ''); showError(e) }
}
async function bridge(enabled: boolean): Promise<void> {
  try { await plugin.request('fairway.bridge', { enabled }); await refresh() } catch (e) { showError(e) }
}
export default function Panel() {
  const s = read(state), p = read(plan), waiting = read(busy)
  return <Stack gap="md">
    <Row justify="between"><Heading>Fairway</Heading><Badge tone={s?.config.execution ? 'warning' : 'neutral'}>{s?.config.execution ? 'Явный запуск' : 'Наблюдение'}</Badge></Row>
    <Text muted>Маршрут задачи → модель и усилие → штатный запуск Orca.</Text>
    {read(error) ? <Callout tone="danger" title="Операция остановлена"><Text>{read(error)}</Text></Callout> : null}
    <Tabs label="Раздел" value={read(tab)} onChange={v => { set(tab, v); if (v === 'history') void plugin.request('fairway.history').then(r => set(journal, r.json)).catch(showError) }}>
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
          <Textarea label="Настройки JSON" rows={16} value={read(configText)} onChange={v => set(configText, v)} />
          <Button onPress={save}>Сохранить настройки</Button>
          <Text muted>live: запросы JEV. execution: кнопка явного запуска. Оба выключены по умолчанию.</Text>
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
