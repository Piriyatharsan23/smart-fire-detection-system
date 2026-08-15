import { createFileRoute } from "@tanstack/react-router";
import { createTelegramCommandReply } from "@/bot/telegram-webhook-service";

export const Route = createFileRoute("/api/telegram/webhook")({
  server: {
    handlers: {
      GET: async () => {
        return Response.json({
          ok: true,
          service: "smart-monitoring-telegram-webhook",
        });
      },
      POST: async ({ request }) => {
        const configuredSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
        const receivedSecret = request.headers.get("x-telegram-bot-api-secret-token");

        if (configuredSecret && receivedSecret !== configuredSecret) {
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
