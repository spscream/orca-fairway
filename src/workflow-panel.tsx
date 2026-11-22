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
    <Callout title="Сначала анализ, затем исполнители"><Text>Координатор читает документацию и уточняет задачу. После принятия анализа Fairway подбирает профиль для каждой подзадачи. Подготовка и подбор не запускают агентов.</Text></Callout>
    {!w || w.cancelled || finished ? <Stack gap="sm">
      <Textarea label="Задача для координатора" value={read(task)} maxLength={2000} rows={4} placeholder="Постановка задачи и ссылки на документацию, без секретов." onChange={v => set(task, v)} />
      <Select label="Профиль координатора" value={read(coordinatorProfile) || s?.config.fallback || ''} options={(s?.config.profiles ?? []).map(p => ({ value: p.id, label: `${p.id} · ${p.agent} · ${p.model} · ${p.effort ?? 'native'}` }))} onChange={v => set(coordinatorProfile, v)} />
      <Button disabled={waiting || !s?.workspace || !read(task).trim()} onPress={() => perform(() => plugin.request('fairway.workflow.create', { task: read(task), profileId: read(coordinatorProfile) || s!.config.fallback }))}>Подготовить анализ</Button>
    </Stack> : null}
    {w && !w.cancelled ? <Stack gap="md">
      <Card title="Координатор" description={`${w.coordinator.profile.agent} · ${w.coordinator.profile.model} · ${w.coordinator.profile.effort ?? 'native'}`}>
        <Stack gap="sm">
          <Text>Исходная задача: {w.task}</Text>
          <Text>Состояние запуска: {w.coordinator.state}. Подтверждение пары: {w.coordinator.evidence.source}.</Text>
          <Text muted>Координатор не назначает модели и не должен запускать исполнителей. Оплата его работы относится к выбранному агенту, отдельно от бюджета JEV.</Text>
          <Button disabled={waiting || !s?.config.execution || !w.coordinator.evidence.verified || w.coordinator.state !== 'shadow' || !!w.analysis} onPress={() => action('launchCoordinator')}>Запустить координатора через Orca</Button>
          {w.coordinator.state === 'dispatch_unknown' ? <Text tone="warning">Исход запуска координатора неизвестен. Проверьте Orca; повтор заблокирован.</Text> : null}
          <Text muted>Файл анализа в собственной папке Fairway:</Text><Code block>{w.artifact}</Code>
          <Button disabled={waiting || !!w.approvedHash} onPress={() => action('read')}>Прочитать анализ координатора</Button>
        </Stack>
      </Card>
      {w.analysis ? <Stack gap="sm">
        <Text weight="semibold">{w.analysis.summary}</Text>
        {w.analysis.assumptions.map((a, i) => <Text key={`a${i}`}>Допущение: {a}</Text>)}
        {w.analysis.questions.map((q, i) => <Text key={`q${i}`} tone="warning">Уточнить: {q}</Text>)}
        {w.analysis.sources.map((source, i) => <Text key={`s${i}`}>Источник: {source.reference} · {source.status}. {source.summary}</Text>)}
        <Text muted>Чтение источников заявлено координатором. Проверьте анализ и сведения перед принятием. JEV получит только показанные описания для подбора.</Text>
        <Button disabled={waiting || !!w.approvedHash || w.analysis.questions.length > 0 || w.analysis.sources.some(source => source.status !== 'read')} onPress={() => action('approve')}>Принять анализ и план</Button>
        {w.analysis.steps.map(step => {
          const run = w.runs[step.id], ready = step.dependsOn.every(id => w.runs[id]?.state === 'completed')
          const running = Object.values(w.runs).some(r => ['submitted', 'dispatch_pending', 'dispatch_unknown'].includes(r.state))
          return <Card key={step.id} title={step.title} description={`Зависимости: ${step.dependsOn.join(', ') || 'нет'}`}>
            <Stack gap="sm">
              <Text>{step.instructions}</Text><Text>Контекст: {step.context || 'не требуется'}</Text><Text>Проверка: {step.acceptance}</Text>
              <Text>Описание для JEV: {step.routingBrief}</Text><Text>Разрешённые агенты: {step.allowedAgents.join(', ')}.</Text>
              <Badge>{run?.state ?? 'ожидает принятия плана'}</Badge>
              {run?.plan ? <Text>Выбран: {run.plan.profile.agent} · {run.plan.profile.model} · {run.plan.profile.effort ?? 'native'} · {run.plan.reason}.</Text> : null}
              <Row gap="sm" wrap>
                <Button disabled={waiting || !w.approvedHash || !ready || running || (!!run && !['waiting', 'planned'].includes(run.state))} onPress={() => action('route', step.id)}>Подобрать исполнителя: {step.id}</Button>
                <Button disabled={waiting || !s?.config.execution || !ready || running || run?.state !== 'planned' || !run.plan?.evidence.verified || run.plan.state !== 'shadow'} onPress={() => action('launch', step.id)}>Запустить подзадачу: {step.id}</Button>
              </Row>
              {run?.state === 'submitted' ? <Stack gap="sm"><Input label={`Проверенный результат: ${step.id}`} value={read(review)} maxLength={160} placeholder="Кратко укажите результат и проверку, без кода и секретов." onChange={v => set(review, v)} /><Button disabled={waiting || !read(review).trim()} onPress={() => action('review', step.id)}>Подтвердить результат: {step.id}</Button></Stack> : null}
              {run?.state === 'dispatch_unknown' ? <Text tone="warning">Исход запуска неизвестен. Новый запуск и зависимые шаги заблокированы. Проверьте Orca.</Text> : null}
              {run?.review ? <Text>Принятый результат: {run.review}</Text> : null}
            </Stack>
          </Card>
        })}
      </Stack> : null}
      <Button variant="ghost" disabled={waiting} onPress={() => action('cancel')}>Закрыть план</Button>
      <Text muted>Закрытие блокирует дальнейшие действия Fairway. Уже запущенного агента останавливают в Orca.</Text>
    </Stack> : null}
  </Stack>
}
