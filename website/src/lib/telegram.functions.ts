import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

const InputSchema = z.object({
  chatId: z.string().trim().min(1).max(64),
  body: z.string().trim().min(1).max(4000),
});

export const sendTelegramAlert = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const result = await sendOne(data.chatId, data.body);
    return { messageId: result };
  });

const BroadcastSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  dedupeKey: z.string().trim().max(120).optional(),
});

export const broadcastTelegramAlert = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => BroadcastSchema.parse(input))
  .handler(async ({ data }) => {
    const url = process.env.SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY!;
    const db = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: subs, error } = await db
      .from("telegram_subscribers")
      .select("chat_id")
      .eq("notifications_enabled", true);
    if (error) throw new Error(error.message);
    const chats: string[] = (subs ?? []).map((s: any) => String(s.chat_id));
    let sent = 0;
    const errors: string[] = [];
    for (const chatId of chats) {
      try {
        await sendOne(chatId, data.body);
        sent += 1;
      } catch (e: any) {
        errors.push(`${chatId}: ${e?.message ?? e}`);
      }
    }
    return { sent, total: chats.length, errors };
  });

async function sendOne(chatId: string, body: string): Promise<number | undefined> {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
  const TELEGRAM_API_KEY = process.env.TELEGRAM_API_KEY;
  if (!TELEGRAM_API_KEY) throw new Error("TELEGRAM_API_KEY is not configured");

  const res = await fetch(`${GATEWAY_URL}/sendMessage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": TELEGRAM_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: /^-?\d+$/.test(chatId) ? Number(chatId) : chatId,
      text: body,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.ok === false) {
    throw new Error(json?.description || `Telegram error ${res.status}`);
  }
  return json?.result?.message_id as number | undefined;
}
