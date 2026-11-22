# Fairway for Orca — отчёт 0.7.1

По явному запросу пользователя автоматическое выполнение больше не останавливается только из-за уверенности JEV ниже 0.6. При корректном ответе используется именно настроенный резервный профиль, если его агент разрешён для шага и модель/усилие подтверждены штатной проверкой. Исключённый резервный профиль не заменяется первым доступным. Повторных платных запросов для повышения уверенности нет. Исходная причина `low_confidence_fallback`, значение уверенности и учёт расходов сохраняются; панель показывает использование резерва на всех 11 языках Orca.

Ошибки ключа, соединения, тайм-ауты, некорректный или внедрённый выбор, неподтверждённые пары и неизвестный исход запуска по-прежнему приостанавливают план. Проверки разрешения, проекта, конфигурации и срока действия перед запуском сохранены. Открытие панели, обновление и перезапуск не продолжают план автоматически. Настройки, профили и накопленный учёт не сбрасываются. Новых зависимостей, разрешений и настроек нет.

## Проверки

```sh
npm run typecheck
npm run typecheck:core
npm test
node scripts/orca.mjs plugin test .orca/release-0.7.1 --json
node scripts/orca.mjs plugin check .orca/release-0.7.1 --json
node scripts/orca.mjs plugin validate .orca/release-0.7.1 --json
npm run audit:public  # из чистой копии .orca/release-0.7.1
git diff --cached --check
```

Результаты: 102/102 локальных теста, 136/136 через Orca; 16 сценариев панели без ошибок и предупреждений. Новые проверки покрывают уверенность 0 и 0.59, использование точного резерва, отсутствие повторного подбора/запуска, отсутствие действий до разрешения, неподтверждённый и исключённый резерв, ошибки транспорта и сообщение панели без запуска при открытии. Все задачи и ответы синтетические, транспорт и исполнители подменены. Живой сквозной запуск исполнителей не проводился.

Платных запросов: **0**, стоимость: **$0**. Дополнительные ИИ-агенты не запускались. Секретные файлы, значения ключей и другие рабочие репозитории не читались. Чужие незавершённые отчёты в этой рабочей копии сохранены и не включены в публикацию; чистая копия содержит только ранее отслеживаемые файлы интеграции и публичную версию этого отчёта.

Использование: после обновления до 0.7.1 нажмите «Продолжить автоматически» в ранее остановленном плане. Далее низкая уверенность сама по себе не требует ручного вмешательства при разрешённом и подтверждённом резерве. Реальный план в ходе разработки и установки не запускался.

Установка проверена: штатный `plugin update` обновил стабильный `spscream.fairway` с 0.7.0 до 0.7.1, сохранив прежнее разрешение. Повторное чтение списка плагинов подтвердило версию 0.7.1, состояние `running` и `needsReconsent: false`. Обе проверки GitHub CI для коммита выпуска прошли. Команда продолжения плана не вызывалась.

## Предыдущий выпуск: 0.7.0

# Fairway for Orca — verification report 0.7.0

Resolved a repeated automatic-continuation stop. Read-only UI metadata identified `budget_exhausted`, five cumulative JEV attempts and a conservative reservation of $0.065540. The old card merged budget, key, transport and choice failures into one generic instruction. Finite-mode authorization now checks whether the remaining unsubmitted graph fits the available attempt/reserve allowance before making another decision request; in-flight work can still finish without new allowance. The panel shows used/configured counts, reserved/configured amounts, decisions needed/available, distinct routing failure messages and a Settings shortcut. Futile continuation is disabled while a finite allowance cannot cover remaining work.

The operator then explicitly requested removal of JEV limits. Added `unlimitedJev`, default false for existing and new installations, with a native and localized **Unlimited JEV decisions** switch. Opting in disables aggregate attempt/reserve caps while retaining monotonic accounting. No counters or reservations are reset. Optional finite caps now accept nonnegative safe integers/microdollars rather than an artificial fixed $10/100 ceiling, allowing a meaningful return to finite mode after extended usage. Invalid numbers and accounting overflow still fail closed.

Unlimited mode retains per-request pricing validation, the price ceiling, bounded request/response sizes, no redirects, no automatic paid retries, profile allowlists and exact-pair verification. It does not change the decision model, enable JEV or execution by itself, create credits, bypass OpenRouter/key limits, or resume a paused workflow. The UI states that charges can exhaust the account balance or key limit and displays the active unlimited mode. Automatic graph/time/launch constraints remain unchanged. Settings changes continue to pause the runner.

## Verification

```sh
npm run typecheck
npm run typecheck:core
npm test
node scripts/orca.mjs plugin test .orca/release-0.7 --json
node scripts/orca.mjs plugin check .orca/release-0.7 --json
node scripts/orca.mjs plugin validate .orca/release-0.7 --json
npm run audit:public  # in the clean committed release copy
git diff --cached --check
```

Final results: **99/99** standalone tests, **132/132** through Orca, and **16** panel scenarios without issues or warnings. Both type checks and source validation pass; the committed release copy is independently checked before publication. Coverage includes finite preflight, money/call boundary arithmetic, legacy reason classification, old-config migration to finite mode, explicit opt-in, accounting beyond old caps, preservation across restart and return to capped mode, per-request price protection, safe-integer overflow, disabled continuation, the Settings shortcut, localized financial disclosure and no accidental execution when saving the mode. All 11 locale catalogs contain 223 typed messages.

The operator’s pending architecture-audit additions to working REPORT.md and unreleased evidence remain intact. Only this release header plus the previously committed public report are staged for publication; no pending audit contents or private paths are included. Disposable test/release copies contain only reviewed integration source. A native installed-settings check is performed after update; enabling the requested flag does not authorize or dispatch the current plan.

Paid/model requests in implementation and tests: **0**, cost **$0**. No extra AI agents or real executors were launched or messaged. No secret files, key values or other working repositories were accessed. Existing usage, settings, plans and operator artifacts are preserved. No new dependencies or capabilities were added.

Usage: in Settings enable **Unlimited JEV decisions**, save once, then return to Workflow and explicitly continue. The operator authorized this setting for the current installation; its five used attempts remain recorded. In finite mode, the panel explains insufficient allowance instead of repeatedly attempting a paused route. Actual automatic executor progression remains untested by this patch because real worker launches were excluded.

Post-install verification on Orca 1.4.269: the stable plugin updated from 0.6.1 to 0.7.0 at commit `6b1fd44daeb8`. With no pending settings draft, the explicitly authorized unlimited switch was enabled and saved through the installed UI. Read-back showed the switch on, Save disabled, the unlimited status badge, and unchanged cumulative accounting of six attempts / $0.078648 observed immediately before this setting change. Other settings and profiles were preserved. No workflow continuation, agent launch or model request was performed. The currently visible workspace had no loaded workflow, so availability of the original plan's Continue action was not asserted. Both release CI runs passed.

## Previous release: 0.6.1


Raised the coordinator-description limit from 2000 to **8192 UTF-8 bytes**. Counters now explicitly say bytes in every supported UI locale, so Russian text is not mistaken for an equivalent character count. The observed 3386-byte case is covered by the panel regression test and becomes eligible for preparation without truncation.

The change covers the entire request path: raw input, generated coordinator instructions, engine planning, persisted plan, profile refresh and explicit dispatch. The complete local coordinator prompt has a separate **65536-byte** cap. Its plan records an explicit coordinator purpose; extended planning requires a forced allowlisted profile and forbids routed-description options. No JEV call or budget reservation is made for coordinator-profile preparation. Ordinary routed tasks retain the 4096-byte cap, routing briefs retain their existing bound, and paid request/accounting controls are unchanged. Safe argv dispatch and task/config/workspace hashes are preserved.

## Checks and commands

```sh
npm run typecheck
npm run typecheck:core
npm test
node scripts/orca.mjs plugin test .orca/release-0.6.1 --json
node scripts/orca.mjs plugin check .orca/release-0.6.1 --json
node scripts/orca.mjs plugin validate .orca/release-0.6.1 --json
npm run audit:public  # in the clean committed release copy
git diff --check
```

Final results: **90/90** standalone tests, **121/121** through Orca, and **14** panel scenarios without issues or warnings. Both type checks, manifest validation and the clean-release source audit pass. New regressions use synthetic Cyrillic text at 8192 bytes, refuse overflow, check 3386-byte input readiness and explicit byte labels, preserve full text through refresh/dispatch, exercise worst-case JSON escaping, reject unbounded coordinator envelopes and preserve the ordinary routing limit. They assert zero JEV requests and no accidental execution during preparation. All 11 locale catalogs contain 211 typed messages.

The committed release copy excludes the operator’s existing, untracked audit reports without changing those files or Git exclusions. Checks use mocks only; no real coordinator or executor was launched, no workflow was created or approved on the operator’s behalf, no secret files or other working repositories were read. Paid/model requests: **0**, cost: **$0**. No permissions or dependencies were added. The existing stored drafts, settings, budget and workflows are preserved.

Usage: after updating to **0.6.1**, the coordinator field accepts 8192 UTF-8 bytes. A task of 3386 bytes fits. Preparing still does not launch an agent; launching remains explicit. Full live coordinator execution is intentionally unverified; synthetic tests cover the exact stored text and dispatch boundary.

## Previous release: 0.6.0


Added opt-in sequential plan execution. After reviewing analysis, one **Run plan automatically** action approves that exact graph and authorizes its remaining steps in the same local workspace. Fairway selects each ready step’s allowlisted model/effort through JEV (or the explicitly configured offline fallback), verifies metadata, and dispatches one executor at a time through Orca. A step advances only after native completion metadata and a correctly bound executor report with passing checks and no questions. This is automatic acceptance of self-reported evidence, not independent quality verification.

Reports are strict private JSON, at most 8192 bytes, bound to workflow ID, step ID, plan ID and a random nonce. They contain a short summary, 1–8 checks with evidence and at most four questions. Reports are neither sent to JEV nor copied into the audit. No commands from reports are executed. Exact result paths are generated by Fairway; traversal, symlinks and oversized files are refused. Native monitoring accepts only the matching structured session, agent and workspace, or a matching terminal idle verdict without a blocked reason. Unknown metadata never implies completion.

## Authorization and stopping

Automation is off unless explicitly started. Shadow/execution defaults remain unchanged. Authorization is bound to one graph and configuration, at most eight launches, a 30-minute wait per step and a two-hour window. Those timeouts stop further Fairway actions; they do not kill a running agent or hard-cap its billing. Existing persistent JEV call/cost reservations still apply; executor and coordinator charges belong to their own agents. Live routing errors, exhausted budgets, unverified pairs, questions, failed checks, invalid/missing reports and uncertain dispatch pause rather than silently fall through to a fallback launch.

Pause interrupts selection and prevents future dispatch; already accepted launches remain under Orca’s stop controls. Settings/key changes pause automation. Plugin activation, restart and update never resume an authorized graph automatically. The worker uses a bounded periodic loop; the panel refreshes progress while active. A reaped/restarted worker requires explicit continuation. Switching the selected project cannot retarget the stored authorization. Only one automatic graph is active, with no automatic retries of uncertain launches. Work already submitted in the old manual mode receives one manual review, then later steps can be automated.

## Interface and concurrent work

The release preserves and integrates UI improvements concurrently produced by the operator’s UX executor in this checkout: compact details, progress/next-action guidance, localized statuses, per-workspace drafts and byte counters, explicit key-save feedback, journal loading/error states and persistent unknown-dispatch locks. Automatic execution has one primary action and hides per-step manual controls while active. All 11 built-in locales contain 209 typed messages. The executor’s unreleased audit/fix reports contain local paths and are excluded from publication without changing their contents.

## Exact checks

```sh
npm run typecheck
npm run typecheck:core
npm test
npm run test:orca
npm run check:orca
npm run validate
npm run audit:public
git diff --check
```

Final results: **88/88** standalone tests, **119/119** through Orca, and **14** panel scenarios without issues or warnings. Both type checks, manifest validation, source audit and whitespace checks pass. After Orca restarted and updated to 1.4.269, the version-matched guides were reloaded and the same checks passed again before publication. The standalone and Orca suites use only synthetic tasks and mocked AI runtimes/transports. Coverage includes one-time authorization, sequential profile changes, no dispatch before authorization, no duplicate execution, budget exhaustion, missing key, invalid/injected choice, report binding, failed checks/questions, settings/pause/restart, legacy manual review, deadlines, corrupt limits, provisional reports while an agent is still working, and safe native-monitor argv. Existing routing, balance, cancellation, locale and secret-free logging checks remain included.

During working-tree checks, the two unreleased operator reports were temporarily excluded through the repository-local Git exclude file; they are not staged or copied into the public snapshot. The temporary exclusions are removed after release checks. A clean committed release copy is independently validated and tested. A Russian synthetic running-state panel was visually inspected at 502 pixels wide, with no render errors or pending requests. The temporary development plugin was unloaded and final staging removes its artificial status values. No production workflow was enabled or continued by these checks.

Paid/model requests during this implementation: **0**. Cost: **$0**. No additional coordinators, executors or AI workers were launched or messaged by this session. No secret files or other work repositories were read; no existing working source was sent to OpenRouter. No new dependencies or permissions were added. Existing operator-started agents and their artifacts were preserved.

Post-install check on Orca 1.4.269: the stable plugin updated from 0.5.4 to 0.6.0 with its existing consent, settings and accounting retained. The installed panel rendered with no errors or pending requests. A read-only observation of this session returned `working`, confirming the structured-session metadata path. Only the Workflow tab was opened; no automatic authorization, approval, agent launch or paid request followed. Both release CI runs passed. Screenshots and runtime diagnostics remain private.

## Remaining limits and usage

No real end-to-end automatic agent run was performed. Structured-chat and terminal completion adapters are covered synthetically; terminal hook availability and account entitlement still depend on the host. Executor checks are self-reported. Independent review agents, isolated worktrees, a lock over unrelated agents in the project, internal-subagent interception and a persistent wakeup service are not implemented. An idle or restarted worker pauses; Orca must stay running. Report/quality failures require operator intervention.

Usage: read the coordinator analysis, then choose **Run plan automatically**. Use **Pause automatic execution** to stop further launches. For a step already started manually, accept its result once; the remaining steps can continue automatically. Correct a pause condition, inspect the current agent if needed and choose **Continue automatically**. Never create a new launch to recover an unknown dispatch. Details: [automatic execution](docs/automatic.md).

## Previous release: 0.5.4


Resolved another invalid-analysis report in a newly created workflow. Its file contained 14 sources, exceeding the previous limit of 12. The prior release had checked a different workflow artifact, which is why that validation result did not establish this file’s validity. The source count limit was also missing from the coordinator instructions. The new limit is 32 sources; the overall 32768-byte cap, strict schema, field bounds, dependency checks and approval gates remain in force. The prompt now discloses all collection and byte limits and explicitly distinguishes UTF-8 bytes from characters.

Failed reads now request a separate read-only inspection. The panel displays only a static field path, validation rule, and numeric actual/maximum values. Field contents, source references, task text and exception prose are excluded. Byte bounds name their field, collection failures show counts, schema failures identify the affected object, and dependency errors identify steps. All 11 languages include the two added UI messages, for 162 keys total. Successful retry clears the prior error and diagnostics.

## Verification

```sh
npm run typecheck
npm run typecheck:core
npm test
npm run test:orca
npm run check:orca
npm run validate
npm run audit:public
git diff --check
```

Results: **74/74** standalone tests, **92/92** through Orca and **12** panel scenarios with no issues or warnings. Type checks, manifest validation and public-surface audit pass. New synthetic coverage accepts 14 sources, rejects 33 with exact metadata, reports UTF-8 field lengths, proves inspection is read-only and workspace-bound, verifies prompt constraints, and tests diagnostics followed by a successful retry. Existing dispatch, budget and injection checks remain green.

The current private artifact was read through a temporary handler inside the actual Orca worker using the production `Workflows.read`, strict parser and private-artifact reader. Result: valid, 14 sources, 3 steps. This probe used a synthetic in-memory store, so it neither changed nor approved the operator’s workflow. No artifact text was copied into tests or published. The temporary development plugin was unloaded; restaging removes the private diagnostic handler and workflow identifier before release.

Post-install verification: version 0.5.4 was installed successfully. Orca Computer Use activated only **Read coordinator analysis** in the stable plugin, with background delivery. The loaded analysis then exposed **Approve analysis and workflow** in the actual UI; the panel reported no rendering errors or pending requests. This read persisted the loaded analysis in the existing workflow as intended. No approval, routing, agent launch, key change or other UI action followed. The screenshot and accessibility evidence remain private. Both release CI runs passed.

Paid/model requests: **0**, cost **$0**. No OpenRouter requests, new coordinators, executors or AI workers were launched. No secret files or other working repositories were read. Native plugin workers and synthetic tests only. No dependencies or permissions were added.

Usage: update to **0.5.4**, then click **Read coordinator analysis** on the current plan. Its existing file now passes the actual worker path; no rewrite or coordinator restart is needed. Future rejected files identify the offending field. The operator still reviews and explicitly approves analysis before any routing or execution.

## Previous release: 0.5.3


Fixed two operator-reported workflow failures. Orca had actually started the coordinator chat, but Fairway expected `result.launch`, the wrapper used by worktree creation, instead of the direct `result.outcome` returned by `agent launch`. The receipt parser now accepts both shapes and requires a recognized surface, bounded handle and delivered prompt (`journaled` or `handed-to-terminal`). Only dispatch identifiers are retained; task text, raw response, warnings and receipt prose are discarded. Incomplete replies remain unknown and cannot be launched again.

A second read error was an assumption of 202 UTF-8 bytes exceeding a previously undocumented 200-byte limit. Assumptions/questions now have explicit 400-byte limits, at most eight entries each, stated in the coordinator prompt. The 32 KiB file limit, strict keys, source gates, routing-brief limits and dependency checks are preserved. The existing private artifact was checked locally and validates with three steps; its contents were not changed or used as a test fixture. No analysis was approved or dispatched on the operator’s behalf.

## Evidence and scope

Read-only Orca metadata confirmed that the coordinator chat already existed and was working in this repository. No new agent was launched, messaged, resumed or stopped. REA statically inspected exactly three shipped CLI modules (`agent-launch`, `agent-launch-request`, `agent-launch-recovery`); selected handlers return the direct launch result and format its outcome/receipt. Parent Evidence: `ev_b6b2ba5f9ab69708269078886e759946645474eb65b7a1d491470f22b2c4f00a`. The retained evidence and installed application source remain private, outside the published surface. This is partial static inspection, not full-app analysis or a new observed launch. The lost original receipt cannot be reconstructed from a chat title, so the existing unknown state is not silently changed to submitted.

## Validation and usage

```sh
npm run typecheck
npm run typecheck:core
npm test
npm run test:orca
npm run check:orca
npm run validate
npm run audit:public
git diff --check
```

Results: **72/72** standalone tests, **89/89** through Orca and **12** panel scenarios without issues or warnings. Type checks, manifest validation and source audit pass. Synthetic regressions cover direct/wrapped/terminal receipts, delivered versus pending prompts, identifier injection, stripped private fields, one-time dispatch, reading analysis from an existing unknown coordinator, localized byte boundaries and array limits. Previous safety and budget coverage remains green.

Paid/model requests: **0**. Cost: **$0**. No requests to OpenRouter or model providers were made by this patch. No secret files or other working repositories were read. No new permissions, dependencies or language keys were introduced. Updating the stable plugin preserves the existing workflow and running coordinator.

Usage: update to **0.5.3**, then click **Read coordinator analysis** in the existing plan. The already-produced artifact now validates; inspect it before approval. Do not launch the coordinator again. Future confirmed launches show submitted; genuinely lost replies still block retries. Actual task execution and automatic reconciliation remain outside this patch.

## Previous release: 0.5.2


Resolved the reported balance timeout. Anonymous diagnostics isolated the network problem: curl and Node HTTPS with `family: 4` reached OpenRouter and received the expected HTTP 401, while Node fetch timed out and explicit IPv6 failed. Fairway now uses a dedicated built-in HTTPS transport with IPv4 selected per request. It does not modify global Node, DNS, proxy, or operating-system settings. The same transport is used for balance, JEV pricing metadata and decision requests.

The transport permits only four exact OpenRouter URLs and their expected GET/POST methods. It preserves certificate verification, forbids redirects, has no retries, rejects header injection, bounds request and response sizes, and destroys stalled or oversized responses. Caller cancellation and a hard 10-second maximum cover connection and body consumption; balance retains its shorter 8-second deadline and 16 KiB limit. JEV retains its 64 KiB response limit and conservative cost reservation. Raw error text and failed response bodies are discarded. The change adds no dependencies, permissions, or UI messages.

## Results and commands

```sh
npm run typecheck
npm run typecheck:core
npm test
npm run test:orca
npm run check:orca
npm run validate
npm run audit:public
git diff --check
```

Results: **66/66** standalone tests, **83/83** through Orca, **12** panel scenarios without issues or warnings. Type checks, manifest validation and source audit pass. New synthetic tests cover IPv4/TLS options, endpoint and method restrictions, injected headers, redirects, discarded error bodies, oversized and duplicate JSON, cancellation before send, stalled connections, truncated responses, and no retry of a decision POST. Existing budget, fallback, injection, timeout and no-accidental-execution coverage remains green.

A temporary development worker verified the repaired transport in the actual Orca host. An authenticated read-only balance refresh returned `available` for both account funds and key limit. The credential was accessed only by the plugin’s own secret API; its value and monetary amounts were not printed or written to diagnostic logs. The temporary worker was unloaded, and final restaging removes its private diagnostic handler. The installed stable plugin is updated without resetting settings, keys or workflows.

## Requests, cost and limits

Paid JEV/model requests: **0**. Cost: **$0**. The authenticated live check made exactly two read-only GETs, to `/api/v1/credits` and `/api/v1/key`. Network diagnostics also made eight anonymous request/connection attempts: five reached the key endpoint with HTTP 401 and three failed during connection. No tasks, prompts or source code were sent. No secret files, other working repositories, real coordinators, executors or extra AI workers were accessed or launched.

Balance retrieval is now verified in this host; paid routing and real end-to-end agent execution remain untested. A normal key succeeded here; account-query access can still depend on key permissions. This transport requires direct IPv4 HTTPS connectivity. IPv6-only and proxy-only networks need a future transport option; the current change does not discover or read proxy credentials.

Usage: open Fairway and click **Refresh balance** after updating to **0.5.2**. Account funds, key limit and the local Fairway budget remain distinct. Failed results never become fabricated zero funds, and no balance is persisted or included in the routing audit.

## Previous release: 0.5.1


Resolved the shared-cache conflict without rewriting Codex files. The installed CLI documents `codex debug models --bundled` as skipping refresh and dumping only the catalog shipped with that binary. Fairway now prefers this offline metadata command. Metadata-only checks in both the coordinator shell and the actual Orca plugin worker verified the synthetic `gpt-6.1-sol` / `medium` pair with source `codex_bundled_catalog`. No prompt, task, network request or agent session is used. The command’s help and catalog were read locally; no external code or secret files were accessed.

Only model IDs, visibility and supported efforts affect verification. The raw bundled data includes other built-in fields, which are ignored and never logged, stored or sent externally. Execution uses fixed argv without a shell, strips OpenRouter/bridge tokens, enforces a 10-second timeout and a 2 MiB output bound. A malformed response, duplicate matching IDs or an unsupported pair fails closed. Only command failure allows the legacy selected-account cache path, still requiring exact CLI version and freshness. Shared cache files are never written. Availability in a bundled catalog does not establish account entitlement or quota.

Exact validation commands:

```sh
npm run typecheck
npm run typecheck:core
npm test
npm run test:orca
npm run check:orca
npm run validate
npm run audit:public
git diff --check
```

Final results: **59/59** standalone tests, **76/76** through Orca and **12** panel scenarios, with no issues or warnings. Both type checks, manifest validation and the public-source audit passed. Added offline coverage for bounded fixed argv and stripped secrets, no shared-cache access, exact model/visibility/effort rejection, malformed/duplicate/oversized data (including a real synthetic child-process overflow), and timeout with a mismatched cache. The change adds no dependencies, permissions or UI messages.

Paid requests: **0**. Cost: **$0**. External requests: **0** for this patch. No coordinators, executors, extra AI agents or Orca agent workers were launched. No real task or other working repository was accessed. This session’s API key was not used. End-to-end agent execution remains untested by design.

Usage: after updating to 0.5.1, click **Refresh coordinator profile** in the existing shadow workflow. An exact pair present in the available binary’s bundled catalog becomes verifiable without manually recreating the shared cache. The operator can then explicitly launch the coordinator. No real workflow was refreshed or dispatched during implementation.

## Previous release: 0.5.0


Added explicit, read-only OpenRouter balance refresh and repaired workflow action requests. Requests without a subtask now omit `stepId` instead of sending `undefined`, which Orca rejects before the handler. Safe domain error codes survive the panel bridge; raw process output remains hidden. Existing unstarted workflows can refresh their coordinator profile without re-entering the task, contacting JEV, or launching an agent.

Codex verification now reads the selected Orca account’s non-secret model catalog. Version, freshness, exact model and exact effort checks remain mandatory. A real local metadata-only check found a shared catalog created by client **0.165.0** while the available CLI reports **0.171.0**. This remains a dispatch blocker until the matching Codex client refreshes that account’s catalog. An earlier successful preflight was transient: another client subsequently rewrote the shared cache. Fairway neither rewrites that cache nor starts a chat to refresh it. The real task and its repository were not accessed or executed.

## Verification

Exact commands:

```sh
npm run typecheck
npm run typecheck:core
npm test
npm run test:orca
npm run check:orca
npm run validate
npm run audit:public
git diff --check
```

Results: **54/54** standalone tests, **71/71** through Orca, **12** panel scenarios with no issues or warnings. Type checks and manifest validation passed. Synthetic regressions cover the omitted field, bridged errors, coordinator refresh, selected-account metadata, explicit balance access, missing key, forbidden account funds, key limits, malformed responses, bounded response size, timeout, request coalescing, cache lifetime, and key-change cancellation. Existing invalid-choice, injection, missing-key, budget-exhaustion and no-accidental-execution coverage remains green. All 11 UI locales contain 160 typed messages.

A temporary development panel was visually checked using clearly marked synthetic funds. It was unloaded afterward. Diagnostic handlers and artificial balance values existed only in the private staged copy and are removed by the final restaging. No extra permissions or runtime dependencies were added. A clean committed copy is validated before the release tag; the stable plugin is updated through Orca without resetting user settings, keys, or workflows.

## Network, cost and remaining blockers

Paid JEV/model requests: **0**. Paid cost: **$0**. No coordinators, executors or extra AI agents were launched. `OPENROUTER_API_KEY` was absent in this session. Secret files and other working repositories were not inspected. Existing source code and real task descriptions were not sent to OpenRouter.

One anonymous metadata GET from the actual plugin host to the public OpenRouter model endpoint timed out (`ETIMEDOUT`). No credential or generation request was involved. A balance query may also have been initiated through the operator’s temporary panel; its observed result was unavailable, and this implementation does not retain a request audit or raw account response. No paid endpoint was invoked by the checks. Live balance retrieval and paid JEV routing remain unverified because of host connectivity and the absent session key. Account funds additionally require access accepted by the [credits endpoint](https://openrouter.ai/docs/api/api-reference/credits/get-remaining-credits); the ordinary-key [current-key endpoint](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key) exposes a separate key limit. No additional management key was requested or created.

Balance requests use the existing plugin-owned secret, at most two fixed GET endpoints per refresh, no redirects, an 8-second deadline, and a 16 KiB response limit. They are explicit, coalesced, cached only in memory for 30 seconds, and cancelled on key replacement. Missing/unavailable funds never become zero. The display does not replace the persistent JEV budget or reserve money. Key and account metadata are not added to audit logs.

Usage: open Fairway and click **Refresh balance**. For an existing shadow coordinator, first update its selected account’s Codex catalog through the matching client, then click **Refresh coordinator profile**. Launch only after verification succeeds; wait for the coordinator’s artifact before **Read coordinator analysis**. Real end-to-end execution remains unverified and was deliberately left to the operator.

## Previous release: 0.4.4


Changed `contributes.panels[0].icon` from `branch` to the supported built-in `flag`. The custom buoy PNG remains the plugin-listing and panel-header image. No code, permissions, configuration schema, or execution behavior changed.

Checks: `npm run validate`, `npm run audit:public`, and `git diff --check`. No code tests or agent runs are needed for the manifest-only visual change. CI runs the standalone suite. The release is applied with `orca plugin update spscream.fairway --environment local --json`; the installed panel metadata is checked for `icon: flag` afterward. OpenRouter requests: 0.

## Previous release: 0.4.3

Adopted the operator-selected open-frame buoy direction. Original artwork uses a broad coral float, a short ivory X-braced frame, a flat coral lantern cap, and turquoise waves. The reference was used as a design direction, not copied as an asset. Export: PNG, 256×256, 64052 bytes; manifest and panel asset paths unchanged.

Checks: `npm run validate`, live `plugin dev watch` component check, `npm run audit:public`, and `git diff --check`. Panel screenshot inspected at 502×959: `settled: true`, `errors: []`, `pendingRequests: 0`. The temporary development plugin was unloaded. Code tests were not repeated for the artwork-only change; CI runs the standalone suite on the published commit. The last full Orca suite passed 55/55 in 0.4.1.

One image-generation request was used for this design. No JEV requests, real agent launches, new permissions, routing changes, or access to secrets. Sidebar icon restrictions remain unchanged.

## Previous release: 0.4.2

Replaced the upright buoy artwork with a top-down channel symbol: an ivory trapezoid between separate red and green diamond markers. The icon path and panel code are unchanged. Export: PNG, 256×256, 56349 bytes. No configuration, permissions, localization, or routing changes.

Checks: `npm run validate`, live `plugin dev watch` component check, `npm run audit:public`, and `git diff --check`. The panel screenshot was inspected at 502×959 with `settled: true`, `errors: []`, and `pendingRequests: 0`; the development plugin was unloaded afterward. Code tests were not repeated for this artwork-only change; 55/55 passed in 0.4.1. CI runs the standalone suite on the published commit.

One image-generation request was used for this replacement. No JEV requests, real agent launches, or new access to secrets. Existing integration and host API limitations remain unchanged.

## Previous release: 0.4.1

Added an original nautical buoy icon, generated from a visual brief without source code or private data. The plugin manifest references `assets/fairway-icon.png`; the same bundled asset appears beside the Fairway heading. Technical export: PNG, 256×256, 58672 bytes, within Orca’s minimum 128×128 and maximum 256 KB constraints. The original generated image is retained outside the public repository; only the exported icon is shipped.

The current version-matched panel manifest allows only built-in sidebar symbols, so its `branch` activity icon remains. The custom asset is used in the plugin listing and panel header. No permissions, localization keys, settings, routing logic, or runtime dependencies changed.

Verification: `npm run typecheck`, `npm run test:orca` (**55/55**), `npm run check:orca` (**9 scenarios**, no issues or warnings), `npm run validate`, `npm run audit:public`, and `git diff --check`. The live panel screenshot was inspected at 502×959 in the current dark theme: `settled: true`, `errors: []`, `pendingRequests: 0`. The temporary development plugin was unloaded after inspection. `assets/panel-dark.png` was refreshed.

One image-generation request was used for the icon. OpenRouter/JEV requests: **0**; JEV cost: **$0**. No real coordinators or execution agents were launched. Existing live-integration blockers and host localization limitations remain unchanged.

## Previous release: 0.4.0

The panel now follows the host application's UI language through `env.locale`. All 11 built-in locales observed in Orca 1.4.265 are included: `en`, `de`, `es`, `fr`, `ja`, `ko`, `pt`, `ru`, `tr`, `zh`, and `zh-Hant`. Each contains all 143 panel messages. Locale discovery used shipped resource filenames and the version-matched API, without reading user settings, credentials, or other work repositories.

There is no separate language preference, runtime translation API, or additional dependency. Regional tags resolve to the supported base language; explicit Chinese script overrides region, and Taiwan/Hong Kong/Macao select Traditional Chinese when no script is given. Unknown community language packs fall back to English.

## Results and exact commands

```sh
npm ci --ignore-scripts
npm run types:orca
npm run typecheck
npm run typecheck:core
npm test
npm run test:orca
npm run check:orca
npm run validate
npm run audit:public
git diff --check
```

- Standalone tests: **42/42**.
- Tests through Orca, including panel and worker: **55/55**.
- Panel check: **9 scenarios**, no issues or warnings.
- Both type checks, manifest validation, public-surface audit, and whitespace checks pass.
- Every catalog has the same typed keys, nonempty translations, and unchanged numeric limits.
- Panel tests mount all 11 host locales, exercise localized settings and errors, open workflow controls, preserve user-written descriptions, and verify no accidental selection or dispatch requests.

Environment: Node.js 22.23.2, Orca 1.4.265, Plugin Host API 1.10. Checks stage only the audited public surface in `.orca/plugin`. A clean committed release copy is validated before tagging.

## Visual verification

Russian, German, and Traditional Chinese Settings previews are inspected in the current dark theme at 502×959. All three captures reported `settled: true`, `errors: []`, and `pendingRequests: 0`. The staged preview changes only the initial tab/state key and the locale passed to the translation helper. Global Orca language preferences and installed plugin source are not changed. After review, the temporary plugin is unloaded and the original source is restaged for final checks.

Screenshots: `assets/settings-ru-dark.png`, `assets/settings-de-dark.png`, and `assets/settings-zh-Hant-dark.png`. Existing English screenshots remain valid examples of the English locale. Other locale layouts are exercised in panel tests; light theme, every language's glyph rendering, and live changes to the application's global language were not separately inspected. Initial translations have not received independent native-speaker review.

## Host limitations and preserved behavior

The version-matched manifest API accepts plain strings for native Settings labels and command titles. It has no documented locale map or dynamic label method. Worker commands have no documented UI-locale field. Those static labels and status output remain English; the panel, including its complete Settings form and human-readable errors, is localized. No application language pack or manifest rewriting is used as a workaround.

User tasks, profile descriptions, analysis, reviews, identifiers, effort values, references, audit records, and diagnostic codes are not translated or migrated. Routing, permissions, budget accounting, execution defaults, and settings keys are unchanged. Error state stores source message keys, allowing render-time translation using the host locale.

The current check-scenario API does not expose a locale option. All-language verification uses the documented `mount(..., { locale })` test API, separate from the nine check scenarios.

## Live requests and security boundaries

Paid JEV requests during implementation and tests: **0**. Cost: **$0**. No real coordinators, executors, extra AI agents, or Orca agent workers were launched. No secret files or existing working source code were sent externally. Only the presence of `OPENROUTER_API_KEY` was checked in this session; it was absent, so live JEV testing remains blocked. Translation uses bundled static data only.

Existing synthetic coverage still checks invalid choices, injection, timeout, missing key, budget exhaustion/corruption, concurrent reservations, cancellation, task/workspace/configuration binding, metadata verification, safe argv, secret-free audit, and duplicate/uncertain dispatch.

Workflow coverage includes structured analysis, source/question gates, dependency review, cross-agent routing, routing-brief-only JEV input, immutable approval, restart state, bounded private artifacts, and refusal of symbolic links. Pi coverage includes private loopback capabilities, explicit briefs, and pinned physical pairs.

Live coordinator artifact creation and real end-to-end execution remain unverified. Source reading is reported by the coordinator, not proven by metadata. Results require operator review; internal subagents are not intercepted. Artifact cleanup, a global workspace lock, isolated worktrees, and autonomous graph execution are not implemented. Verified catalogs do not establish account entitlement, quota, or the actual responding model.

## Public data and history

Only new integration code, synthetic tests, documentation, screenshots, and build/CI configuration are published. Private research, transcripts, logs, connection files, and old experimental results remain excluded. The audit checks public paths, symlinks, sizes, common key patterns, and personal absolute paths without printing matched contents.

| Release | Verification and scope |
| --- | --- |
| 0.3.1 | 40 standalone / 52 Orca tests, 9 scenarios; English UI and documentation, refreshed screenshots |
| 0.3.0 | 40 standalone / 52 Orca tests, 9 scenarios; coordinator workflows and per-step routing |
| 0.2.0 | 26 standalone / 36 Orca tests, 5 scenarios; native settings and profile form |
| 0.1.0 | 26 standalone / 30 Orca tests, 5 scenarios; direct routing, native adapters, Pi extension |

Previous plugin releases also used synthetic checks with no paid JEV calls or real agent execution. Historical details remain in Git history.

Usage: [README](README.md), [localization](docs/localization.md), [workflows](docs/workflows.md), [Pi](docs/pi.md). Next steps: [roadmap](docs/roadmap.md).
