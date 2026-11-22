# Security boundaries

The plugin runs trusted code as the current user. Review its source and access before installation. It is not a sandbox for execution agents; their tools and approvals remain under Orca and the selected agent.

Network access and execution are disabled by default. JEV receives only an explicitly authorized description and profile cards. Do not put keys, source code, or confidential data in routing descriptions or configuration. Automatic secret detection is not comprehensive.

The JEV key stays in own Orca secret storage, never Git, ordinary settings, or audit. Subscription credentials are not read or forwarded. The Pi connection uses a separate random local capability that must also remain private.

Dispatch uses an argument array without a shell. Model and effort are validated against an allowlisted profile. Pi operator confirmation is a trusted administrative attestation, not proof of account entitlement or server behavior.

The optional Pi service is off by default. It listens only on loopback, bounds request size/rate, and has no dispatch endpoint. A local process that can read its connection file can request decisions and consume the configured budget. Protect the user account and file permissions.

Never blindly repeat an uncertain dispatch. Inspect Orca before any new decision. An accepted launch does not prove completion or the actual responding model.

Workflow mode stores the original task, analysis, instructions, and accepted reviews locally, separately from audit. Analysis is read only from a pre-created private directory with bounded size and filesystem-link checks. Input is untrusted until strict validation and operator approval. A coordinator's source-reading claim is not technical proof of reading.

Coordinator and executor instructions prohibit creating their own agents. This is not an OS restriction: internal subagents and their tools are not intercepted. The one-pending-step rule applies within a workflow, not as a global folder lock. Closing a workflow does not stop an already dispatched agent.

Accounting is local. Removing plugin data, using independent installations, or making OpenRouter requests elsewhere changes its scope. It neither controls the whole account nor limits coordinator/executor costs. Workflow artifacts have no automatic deletion policy. On Windows, protect private directories and files using OS ACLs.

To report a vulnerability, use private reporting in the repository Security tab if available. Do not post real keys, authentication files, private tasks, or logs in public issues.

Fairway выполняется под учётной записью пользователя. Артефакты и локальный учёт защищены прежде всего от случайной подмены и конкурентной записи. Процессы с доступом той же учётной записи могут менять данные, доступные Fairway, и видеть аргументы запущенных процессов. Разрешённые поля окружения включают пути и служебные настройки для локальных CLI. Самоотчёты и ссылка на источник требуют проверки оператором там, где важна независимость. Краткое описание для JEV передаётся как введено, поэтому конфиденциальные сведения следует исключать до подбора.
