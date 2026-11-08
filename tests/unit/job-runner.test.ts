import { describe, expect, it } from "vitest";
import { NotConfiguredError } from "../../src/lib/ai/config";
import {
  DEFAULT_RETRY_DELAYS_S, MAX_ATTEMPTS, parseRetryDelays, runJobs,
  type JobPayload, type QueueClient, type QueueMessage, type QueueName,
} from "../../src/lib/jobs/runner";

/** In-memory pgmq: read() leases messages, send() appends (the delay is recorded, not simulated). */
class MemoryQueue implements QueueClient {
  messages: Record<string, (QueueMessage & { leased: boolean })[]> = {};
  archived: { queue: string; message: JobPayload }[] = [];
  sent: { queue: string; message: JobPayload; delayS: number }[] = [];
  private nextId = 1;

  add(queue: QueueName, message: JobPayload) {
    (this.messages[queue] ??= []).push({ msg_id: this.nextId++, read_ct: 0, message, leased: false });
  }
  async read(queue: QueueName, _vt: number, qty: number) {
    const visible = (this.messages[queue] ?? []).filter((m) => !m.leased).slice(0, qty);
    visible.forEach((m) => { m.leased = true; m.read_ct++; });
    return visible;
  }
  async remove(queue: QueueName, id: number) {
    this.messages[queue] = (this.messages[queue] ?? []).filter((m) => m.msg_id !== id);
  }
  async archive(queue: QueueName, id: number) {
    const m = (this.messages[queue] ?? []).find((x) => x.msg_id === id);
    if (m) this.archived.push({ queue, message: m.message });
    await this.remove(queue, id);
  }
  async send(queue: QueueName, message: JobPayload, delayS: number) {
    this.sent.push({ queue, message, delayS });
    this.add(queue, message);
  }
  left(queue: QueueName) {
    return (this.messages[queue] ?? []).length;
  }
}

const ok = async () => undefined;

describe("runJobs", () => {
  it("runs a successful job once and removes it", async () => {
    const q = new MemoryQueue();
    q.add("q_embed", { type: "embed", id: "f1", attempt: 1 });
    const seen: string[] = [];
    const summary = await runJobs({ queue: q, handlers: { q_embed: async (m) => void seen.push(String(m.id)) } });
    expect(seen).toEqual(["f1"]);
    expect(summary).toMatchObject({ processed: 1, succeeded: 1, retried: 0, archived: 0, skipped: 0, stoppedEarly: false });
    expect(q.left("q_embed")).toBe(0);
  });

  it("retries a failing job with growing delays (30 s, 5 min), then archives it after 3 attempts", async () => {
    const q = new MemoryQueue();
    q.add("q_email", { type: "q_email", id: "x", template: "t", attempt: 1 });
    const calls: number[] = [];
    const summary = await runJobs({
      queue: q,
      handlers: { q_email: async (m) => { calls.push(Number(m.attempt)); throw new Error("boom"); } },
    });
    expect(calls).toEqual([1, 2, 3]);
    expect(q.sent.map((s) => [s.message.attempt, s.delayS])).toEqual([[2, DEFAULT_RETRY_DELAYS_S[0]], [3, DEFAULT_RETRY_DELAYS_S[1]]]);
    expect(q.sent[0]!.message.lastError).toBe("boom");
    expect(q.archived).toHaveLength(1);
    expect(q.archived[0]!.message.attempt).toBe(MAX_ATTEMPTS);
    expect(summary).toMatchObject({ processed: 3, succeeded: 0, retried: 2, archived: 1 });
    expect(q.left("q_email")).toBe(0);
  });

  it("a job that fails once and then succeeds is retried only once", async () => {
    const q = new MemoryQueue();
    q.add("q_translate", { type: "translate", id: "f", attempt: 1 });
    let n = 0;
    const summary = await runJobs({ queue: q, handlers: { q_translate: async () => { if (n++ === 0) throw new Error("flaky"); } } });
    expect(summary).toMatchObject({ processed: 2, succeeded: 1, retried: 1, archived: 0 });
    expect(q.archived).toHaveLength(0);
  });

  it("skips (does not retry) jobs whose service is not configured", async () => {
    const q = new MemoryQueue();
    q.add("q_embed", { type: "embed", id: "f", attempt: 1 });
    const logs: string[] = [];
    const summary = await runJobs({
      queue: q,
      handlers: { q_embed: async () => { throw new NotConfiguredError("embeddings"); } },
      log: (event) => logs.push(event),
    });
    expect(summary).toMatchObject({ processed: 1, skipped: 1, retried: 0, archived: 0 });
    expect(q.left("q_embed")).toBe(0);
    expect(logs).toEqual(["job.skipped"]);
  });

  it("uses custom retry delays and caps the delay index at the last value", async () => {
    const q = new MemoryQueue();
    q.add("q_email", { attempt: 1 });
    await runJobs({ queue: q, handlers: { q_email: async () => { throw new Error("x"); } }, retryDelaysS: [0] });
    expect(q.sent.map((s) => s.delayS)).toEqual([0, 0]);
  });

  it("treats a message without an attempt number as attempt 1", async () => {
    const q = new MemoryQueue();
    q.add("q_embed", { type: "embed", id: "f" });
    await runJobs({ queue: q, handlers: { q_embed: async () => { throw new Error("x"); } } });
    expect(q.sent[0]!.message.attempt).toBe(2);
  });

  it("does not touch queues that have no handler", async () => {
    const q = new MemoryQueue();
    q.add("q_translate", { id: "a" });
    const summary = await runJobs({ queue: q, handlers: { q_embed: ok } });
    expect(summary.processed).toBe(0);
    expect(q.left("q_translate")).toBe(1);
  });

  it("stops when the time budget is used up, leaving the rest for the next run", async () => {
    const q = new MemoryQueue();
    for (let i = 0; i < 5; i++) q.add("q_embed", { id: String(i), attempt: 1 });
    let clock = 0;
    const summary = await runJobs({
      queue: q,
      handlers: { q_embed: async () => { clock += 400; } },
      budgetMs: 1000,
      now: () => clock,
    });
    expect(summary.stoppedEarly).toBe(true);
    expect(summary.succeeded).toBe(3); // 0 ms, 400 ms, 800 ms are inside the budget
    expect(q.left("q_embed")).toBe(2);
  });

  it("processes more than one batch", async () => {
    const q = new MemoryQueue();
    for (let i = 0; i < 45; i++) q.add("q_embed", { id: String(i), attempt: 1 });
    const summary = await runJobs({ queue: q, handlers: { q_embed: ok }, batchSize: 20 });
    expect(summary.succeeded).toBe(45);
    expect(summary.byQueue.q_embed).toMatchObject({ processed: 45, succeeded: 45 });
  });
});

describe("parseRetryDelays", () => {
  it("parses a comma list and falls back to the defaults", () => {
    expect(parseRetryDelays("0,0")).toEqual([0, 0]);
    expect(parseRetryDelays(" 5 , 10 ")).toEqual([5, 10]);
    expect(parseRetryDelays(undefined)).toEqual(DEFAULT_RETRY_DELAYS_S);
    expect(parseRetryDelays("abc,-1")).toEqual(DEFAULT_RETRY_DELAYS_S);
  });
});
