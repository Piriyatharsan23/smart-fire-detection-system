import { createFileRoute } from "@tanstack/react-router";

function telegramToken() {
  return process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_API_KEY;
}

const BOT_COMMANDS = [
  { command: "start", description: "Subscribe and enable notifications" },
  { command: "stop", description: "Disable automatic alerts" },
  { command: "current", description: "Check current sensor values" },
  { command: "status", description: "Full system status and safety state" },
  { command: "smoke", description: "Smoke status" },
  { command: "flame", description: "Flame detection status" },
  { command: "temp", description: "Indoor and outdoor temperatures" },
  { command: "help", description: "Show this command list" },
];

async function telegram(method: string, body?: Record<string, unknown>) {
  const token = telegramToken();
  if (!token) {
    return Response.json(
      {
        ok: false,
        error:
          "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_API_KEY. Webhook cannot be registered automatically.",
      },
      { status: 500 },
    );
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = await response.json().catch(() => ({}));
  return Response.json(json, { status: response.ok ? 200 : response.status });
}

export const Route = createFileRoute("/api/telegram/setup")({
  server: {
    handlers: {
      GET: async () => telegram("getWebhookInfo"),
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const webhookUrl = `${url.origin}/api/telegram/webhook`;
        const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET;

        const webhookResponse = await telegram("setWebhook", {
          url: webhookUrl,
          drop_pending_updates: false,
          ...(secretToken ? { secret_token: secretToken } : {}),
        });
        if (!webhookResponse.ok) return webhookResponse;
        const commandsResponse = await telegram("setMyCommands", { commands: BOT_COMMANDS });
        if (!commandsResponse.ok) return commandsResponse;
        return Response.json({ ok: true, webhook: await webhookResponse.json(), commands: await commandsResponse.json() });
      },
    },
  },
});
