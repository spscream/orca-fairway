// Coordinator input stays local. Routed descriptions keep their separate, smaller limit.
export const COORDINATOR_TASK_BYTES = 8192
export const COORDINATOR_PROMPT_BYTES = 65536
export const WORKFLOW_PROMPT_BYTES = 65536

// Conservative full-context JEV reservation, shared by worker and panel.
export const RESERVATION_MICROUSD = 13_108
