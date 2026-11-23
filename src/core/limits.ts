// Task and Plan use the same input limit. The Plan sends only its separate routing brief.
export const TASK_BYTES = 8192
export const COORDINATOR_TASK_BYTES = TASK_BYTES
export const ROUTING_BRIEF_BYTES = 4096
export const COORDINATOR_PROMPT_BYTES = 65536
export const WORKFLOW_PROMPT_BYTES = 65536

// Conservative full-context JEV reservation, shared by worker and panel.
export const RESERVATION_MICROUSD = 13_108
