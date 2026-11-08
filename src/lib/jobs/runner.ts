import { NotConfiguredError } from "@/lib/ai/config";

/**
 * Job runner (docs/12-dev-ops.md §5). Reads messages from the pgmq queues, runs a handler per message and applies the
 * retry policy: up to 3 attempts, delays 30 s / 5 min / 30 min, then the message is archived (and logged).
 * It only talks to the `QueueClient` interface, so it is unit-tested with an in-memory queue.
 */
export const QUEUES = ["q_embed", "q_translate", "q_email"] as const;
export type QueueName = (typeof QUEUES)[number];

export const MAX_ATTEMPTS = 3;
export const DEFAULT_RETRY_DELAYS_S = [30, 300, 1800];

export interface JobPayload {
  type?: string;
  id?: string;
  attempt?: number;
  template?: string;
  lastError?: string;
  [key: string]: unknown;
}
export interface QueueMessage {
  msg_id: number;
  read_ct: number;
  message: JobPayload;
}
export interface QueueClient {
  read(queue: QueueName, visibilityS: number, qty: number): Promise<QueueMessage[]>;
  remove(queue: QueueName, msgId: number): Promise<void>;
  archive(queue: QueueName, msgId: number): Promise<void>;
  send(queue: QueueName, message: JobPayload, delayS: number): Promise<void>;
}

/** A handler resolves when the job is done. It throws NotConfiguredError when it cannot run (skipped, not retried). */
export type Handler = (message: JobPayload) => Promise<void>;

export interface RunOptions {
  queue: QueueClient;
  handlers: Partial<Record<QueueName, Handler>>;
  budgetMs?: number;
  batchSize?: number;
  visibilityS?: number;
  retryDelaysS?: number[];
  now?: () => number;
  log?: (event: string, data: Record<string, unknown>) => void;
}

export interface RunSummary {
  processed: number;
  succeeded: number;
  retried: number;
  archived: number;
  skipped: number;
  stoppedEarly: boolean;
  durationMs: number;
  byQueue: Record<string, { processed: number; succeeded: number; retried: number; archived: number; skipped: number }>;
}

export function parseRetryDelays(value: string | undefined): number[] {
  if (!value) return DEFAULT_RETRY_DELAYS_S;
  const parsed = value.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n >= 0);
  return parsed.length ? parsed : DEFAULT_RETRY_DELAYS_S;
}

export async function runJobs(opts: RunOptions): Promise<RunSummary> {
  const now = opts.now ?? Date.now;
  const started = now();
  const budget = opts.budgetMs ?? 50_000;
  const delays = opts.retryDelaysS ?? DEFAULT_RETRY_DELAYS_S;
  const log = opts.log ?? (() => undefined);
  const summary: RunSummary = { processed: 0, succeeded: 0, retried: 0, archived: 0, skipped: 0, stoppedEarly: false, durationMs: 0, byQueue: {} };

  outer: for (const queue of QUEUES) {
    const stats = (summary.byQueue[queue] = { processed: 0, succeeded: 0, retried: 0, archived: 0, skipped: 0 });
    const handler = opts.handlers[queue];
    if (!handler) continue;

    for (;;) {
      if (now() - started >= budget) {
        summary.stoppedEarly = true;
        break outer;
      }
      const batch = await opts.queue.read(queue, opts.visibilityS ?? 120, opts.batchSize ?? 20);
      if (batch.length === 0) break;

      for (const msg of batch) {
        if (now() - started >= budget) {
          summary.stoppedEarly = true; // unprocessed messages become visible again when their lease expires
          break outer;
        }
        const attempt = Number(msg.message.attempt ?? 1) || 1;
        summary.processed++;
        stats.processed++;
        try {
          await handler(msg.message);
          await opts.queue.remove(queue, msg.msg_id);
          summary.succeeded++;
          stats.succeeded++;
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          if (error instanceof NotConfiguredError) {
            await opts.queue.remove(queue, msg.msg_id);
            summary.skipped++;
            stats.skipped++;
            log("job.skipped", { queue, msgId: msg.msg_id, id: msg.message.id, reason: text });
          } else if (attempt >= MAX_ATTEMPTS) {
            await opts.queue.archive(queue, msg.msg_id);
            summary.archived++;
            stats.archived++;
            log("job.failed", { queue, msgId: msg.msg_id, id: msg.message.id, attempt, error: text });
          } else {
            const delay = delays[Math.min(attempt - 1, delays.length - 1)] ?? 0;
            await opts.queue.send(queue, { ...msg.message, attempt: attempt + 1, lastError: text.slice(0, 500) }, delay);
            await opts.queue.remove(queue, msg.msg_id);
            summary.retried++;
            stats.retried++;
            log("job.retry", { queue, msgId: msg.msg_id, id: msg.message.id, attempt, delayS: delay, error: text });
          }
        }
      }
    }
  }
  summary.durationMs = now() - started;
  return summary;
}
