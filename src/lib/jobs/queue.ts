import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobPayload, QueueClient, QueueMessage, QueueName } from "./runner";

/** QueueClient over the service-role Supabase client and the job_* SQL wrappers (docs/12-dev-ops.md §5). */
export function createSupabaseQueue(sb: SupabaseClient): QueueClient {
  const check = (error: { message: string } | null, what: string) => {
    if (error) throw new Error(`${what}: ${error.message}`);
  };
  return {
    async read(queue: QueueName, visibilityS: number, qty: number): Promise<QueueMessage[]> {
      const { data, error } = await sb.rpc("job_read", { p_queue: queue, p_vt: visibilityS, p_qty: qty });
      check(error, `job_read(${queue})`);
      return ((data ?? []) as { msg_id: number; read_ct: number; message: JobPayload }[]).map((r) => ({ msg_id: Number(r.msg_id), read_ct: r.read_ct, message: r.message }));
    },
    async remove(queue, msgId) {
      const { error } = await sb.rpc("job_delete", { p_queue: queue, p_msg_id: msgId });
      check(error, `job_delete(${queue})`);
    },
    async archive(queue, msgId) {
      const { error } = await sb.rpc("job_archive", { p_queue: queue, p_msg_id: msgId });
      check(error, `job_archive(${queue})`);
    },
    async send(queue, message, delayS) {
      const { error } = await sb.rpc("job_send", { p_queue: queue, p_message: message, p_delay_s: delayS });
      check(error, `job_send(${queue})`);
    },
  };
}
