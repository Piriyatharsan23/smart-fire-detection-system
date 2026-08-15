import { createFileRoute } from "@tanstack/react-router";
import { createHash, timingSafeEqual } from "crypto";
import { createTelegramCommandReply } from "@/bot/telegram-webhook-service";

function deriveSecret(apiKey: string) {
  return createHash("sha256").update(`telegram-webhook:${apiKey}`).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({ ok: true, service: "smart-monitoring-telegram-webhook" }),
      POST: async ({ request }) => {
        const apiKey = process.env.TELEGRAM_API_KEY;
        const configured = process.env.TELEGRAM_WEBHOOK_SECRET;
        const expected = configured ?? (apiKey ? deriveSecret(apiKey) : "");
        const received = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
        if (expected && !safeEqual(received, expected)) {
          return Response.json({ ok: false, error: "invalid webhook secret" }, { status: 401 });
        }
        try {
          const update = await request.json();
          const reply = await createTelegramCommandReply(update);
          if (!reply) return Response.json({ ok: true, handled: false });
          return Response.json({
            method: "sendMessage",
            chat_id: /^-?\d+$/.test(reply.chatId) ? Number(reply.chatId) : reply.chatId,
            text: reply.text,
            parse_mode: "HTML",
            disable_web_page_preview: true,
          });
        } catch (error) {
          console.error("[telegram-webhook] failed", error);
          return Response.json({ ok: false, error: "webhook handler failed" }, { status: 500 });
        }
      },
    },
  },
});