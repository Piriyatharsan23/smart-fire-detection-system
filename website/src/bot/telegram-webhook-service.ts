import { createClient } from "@supabase/supabase-js";

interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: {
      id: number | string;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
    text?: string;
  };
}

interface ReadingRow {
  ts: string;
  temp: number;
  temp_out: number | null;
  smoke: number;
  flame: number;
  status: string;
  smoke_voltage: number | null;
  smoke_percentage: number | null;
  indoor_temp_voltage: number | null;
  outdoor_temp_voltage: number | null;
  flame_voltage: number | null;
  current_amps: number | null;
  system_state: number | null;
}

interface DeviceRow {
  buzzer: boolean;
  fan: boolean;
  suppression: boolean;
}

interface ThresholdRow {
  temp: number;
  smoke: number;
  smoke_detection_threshold: number;
  rated_current: number;
  current_warning_pct: number;
}

const LOVABLE_TELEGRAM_GATEWAY = "https://connector-gateway.lovable.dev/telegram";

function supabaseServer() {
  const url = requiredEnv("SUPABASE_URL", "VITE_SUPABASE_URL");
  const key = requiredEnv(
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
  );

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function processTelegramWebhookUpdate(update: TelegramUpdate) {
  const text = update.message?.text?.trim();
  const chat = update.message?.chat;
  if (!chat || !text?.startsWith("/")) return { handled: false };

  const chatId = String(chat.id);
  const command = parseCommand(text);

  switch (command) {
    case "/start":
      await upsertSubscriber(chatId, chat.username ?? displayName(chat));
      await sendTelegramMessage(chatId, welcomeMessage(await snapshot()));
      return { handled: true };
    case "/stop":
      await disableSubscriber(chatId);
      await sendTelegramMessage(
        chatId,
        "🔕 <b>Notifications disabled</b>\nYou will no longer receive automatic Smart Monitoring alerts.\n\nSend /start to subscribe again.",
      );
      return { handled: true };
    case "/status":
    case "/current":
      await sendTelegramMessage(chatId, statusMessage(await snapshot()));
      return { handled: true };
    case "/smoke":
      await sendTelegramMessage(chatId, smokeMessage(await snapshot()));
      return { handled: true };
    case "/flame":
      await sendTelegramMessage(chatId, flameMessage(await snapshot()));
      return { handled: true };
    case "/temp":
      await sendTelegramMessage(chatId, tempMessage(await snapshot()));
      return { handled: true };
    case "/help":
      await sendTelegramMessage(chatId, helpMessage());
      return { handled: true };
    default:
      await sendTelegramMessage(
        chatId,
        "❔ <b>Unknown command</b>\nUse /help to view available commands.",
      );
      return { handled: true };
  }
}

export async function createTelegramCommandReply(update: TelegramUpdate) {
  const text = update.message?.text?.trim();
  const chat = update.message?.chat;
  if (!chat || !text?.startsWith("/")) return null;

  const chatId = String(chat.id);
  const command = text.split(/\s+/, 1)[0].split("@", 1)[0].toLowerCase();

  switch (command) {
    case "/start":
      await upsertSubscriber(chatId, chat.username ?? displayName(chat)).catch((error) => {
        console.error("[telegram-webhook] subscriber save failed", error);
      });
      return { chatId, text: welcomeMessage(await snapshot()) };
    case "/stop":
      await disableSubscriber(chatId).catch((error) => {
        console.error("[telegram-webhook] subscriber disable failed", error);
      });
      return {
        chatId,
        text: "🔕 <b>Notifications disabled</b>\nYou will no longer receive automatic Smart Monitoring alerts.\n\nSend /start to subscribe again.",
      };
    case "/status":
    case "/current":
      return { chatId, text: statusMessage(await snapshot()) };
    case "/smoke":
      return { chatId, text: smokeMessage(await snapshot()) };
    case "/flame":
      return { chatId, text: flameMessage(await snapshot()) };
    case "/temp":
      return { chatId, text: tempMessage(await snapshot()) };
    case "/help":
      return { chatId, text: helpMessage() };
    default:
      return { chatId, text: "❔ <b>Unknown command</b>\nUse /help to view available commands." };
  }
}

export async function sendTelegramMessage(chatId: string, text: string) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (botToken) {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: /^-?\d+$/.test(chatId) ? Number(chatId) : chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (!res.ok || json.ok === false) {
      throw new Error(json.description ?? `Telegram sendMessage failed with HTTP ${res.status}`);
    }
    return;
  }

  const lovableApiKey = process.env.LOVABLE_API_KEY;
  const telegramApiKey = process.env.TELEGRAM_API_KEY;
  if (!lovableApiKey || !telegramApiKey) {
    throw new Error("Configure TELEGRAM_BOT_TOKEN or both LOVABLE_API_KEY and TELEGRAM_API_KEY");
  }

  const res = await fetch(`${LOVABLE_TELEGRAM_GATEWAY}/sendMessage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableApiKey}`,
      "X-Connection-Api-Key": telegramApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: /^-?\d+$/.test(chatId) ? Number(chatId) : chatId,
      text,
      parse_mode: "HTML",
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  if (!res.ok || json.ok === false) {
    throw new Error(json.description ?? `Lovable Telegram send failed with HTTP ${res.status}`);
  }
}

async function snapshot() {
  const db = supabaseServer();
  const [readingRes, deviceRes, thresholdRes] = await Promise.all([
    db
      .from("sensor_readings")
      .select("*")
      .order("ts", { ascending: false })
      .order("id", { ascending: false })
      .limit(10),
    db.from("device_state").select("*").eq("id", 1).maybeSingle(),
    db.from("thresholds").select("*").eq("id", 1).maybeSingle(),
  ]);

  if (readingRes.error) throw readingRes.error;
  if (deviceRes.error) throw deviceRes.error;
  if (thresholdRes.error) throw thresholdRes.error;

  const readings = ((readingRes.data ?? []) as ReadingRow[]).map(normalizeReading);
  const reading = latestCompleteReading(readings);
  const devices = deviceRes.data as DeviceRow | null;
  const thresholds = normalizeThresholds(thresholdRes.data as Partial<ThresholdRow> | null);
  const smokeDetected =
    reading != null &&
    isSmokeDetected(reading);
  const fireProbability = reading && isBinarySmokeReading(reading)
    ? 0
    : estimateFireProbability([...readings].reverse(), thresholds);
  const stateLabel = stateLabelFor(reading, smokeDetected, fireProbability);

  return { reading, devices, thresholds, fireProbability, smokeDetected, stateLabel };
}

async function upsertSubscriber(chatId: string, username: string) {
  const { error } = await supabaseServer().from("telegram_subscribers").upsert(
    {
      chat_id: chatId,
      username,
      notifications_enabled: true,
    },
    { onConflict: "chat_id" },
  );
  if (error) throw error;
}

async function disableSubscriber(chatId: string) {
  const { error } = await supabaseServer()
    .from("telegram_subscribers")
    .update({ notifications_enabled: false })
    .eq("chat_id", chatId);
  if (error) throw error;
}

function welcomeMessage(data: Awaited<ReturnType<typeof snapshot>>) {
  return `👋 <b>Smart Monitoring System</b>\nTelegram notifications are enabled for this chat.\n\n${statusBlock(data)}\n\nUse /help to view commands.`;
}

function helpMessage() {
  return [
    "🧭 <b>Available Commands</b>",
    "",
    "/start - Subscribe and enable notifications",
    "/stop - Disable automatic alerts",
    "/current - Check current sensor values",
    "/status - Full system status and safety state",
    "/smoke - Smoke status",
    "/flame - Flame detection status",
    "/temp - Indoor and outdoor temperatures",
    "/help - Show this command list",
  ].join("\n");
}

function statusMessage(data: Awaited<ReturnType<typeof snapshot>>) {
  return [
    "<b>CURRENT SYSTEM STATUS</b>",
    currentSensorBlock(data),
    "",
    deviceBlock(data.devices),
    timeLine(data.reading?.ts),
  ].join("\n");
}

function smokeMessage(data: Awaited<ReturnType<typeof snapshot>>) {
  const r = data.reading;
  return [
    "<b>SMOKE SENSOR</b>",
    `Smoke Status: <b>${data.smokeDetected ? "DETECTED" : "Clear"}</b>`,
    timeLine(r?.ts),
  ].join("\n");
}

function flameMessage(data: Awaited<ReturnType<typeof snapshot>>) {
  const r = data.reading;
  return [
    "<b>FLAME SENSOR</b>",
    `Detection Status: <b>${r?.flame ? "FLAME DETECTED" : "Clear"}</b>`,
    timeLine(r?.ts),
  ].join("\n");
}

function tempMessage(data: Awaited<ReturnType<typeof snapshot>>) {
  const r = data.reading;
  const delta = r?.temp_out == null ? null : Number(r.temp) - Number(r.temp_out);
  return [
    "<b>TEMPERATURE SENSORS</b>",
    `Indoor Temperature: <b>${fmt(r?.temp, 1, "°C")}</b>`,
    `Outdoor Temperature: <b>${fmt(r?.temp_out, 1, "°C")}</b>`,
    `Delta T: <b>${fmt(delta, 1, "°C")}</b>`,
    timeLine(r?.ts),
  ].join("\n");
}

function statusBlock(data: Awaited<ReturnType<typeof snapshot>>) {
  const r = data.reading;
  return [
    `Safety State: <b>${escapeHtml(data.stateLabel)}</b>`,
    `System Status: <b>${escapeHtml(String(r?.status ?? "unknown").toUpperCase())}</b>`,
    `Smoke Status: <b>${data.smokeDetected ? "Detected ⚠️" : "Clear ✅"}</b>`,
    `Flame Status: <b>${r?.flame ? "Detected 🚨" : "Clear ✅"}</b>`,
  ].join("\n");
}

function currentSensorBlock(data: Awaited<ReturnType<typeof snapshot>>) {
  const r = data.reading;
  const delta = r?.temp_out == null ? null : Number(r.temp) - Number(r.temp_out);
  return [
    `Indoor Temp : <b>${fmt(r?.temp, 1, "°C")}</b>`,
    `Outdoor Temp: <b>${fmt(r?.temp_out, 1, "°C")}</b>`,
    `Delta T (in-out): <b>${fmt(delta, 1, "°C")}</b>`,
    `Smoke: <b>${data.smokeDetected ? "DETECTED" : "Clear"}</b>`,
    `Flame: <b>${r?.flame ? "DETECTED" : "Clear"}</b>`,
    `Current: <b>${fmt(r?.current_amps, 3, " A")}</b>`,
    `System State: <b>${escapeHtml(data.stateLabel)}</b>`,
  ].join("\n");
}

function deviceBlock(devices: DeviceRow | null) {
  return [
    `Fan: <b>${devices?.fan ? "ON" : "OFF"}</b>`,
    `Buzzer: <b>${devices?.buzzer ? "ON" : "OFF"}</b>`,
    `Suppression Relay: <b>${devices?.suppression ? "ON" : "OFF"}</b>`,
  ].join("\n");
}

function normalizeReading(row: ReadingRow): ReadingRow {
  return {
    ...row,
    temp: Number(row.temp),
    temp_out: nullableNumber(row.temp_out),
    smoke: Number(row.smoke),
    flame: Number(row.flame),
    smoke_voltage: nullableNumber(row.smoke_voltage),
    smoke_percentage: nullableNumber(row.smoke_percentage),
    indoor_temp_voltage: nullableNumber(row.indoor_temp_voltage),
    outdoor_temp_voltage: nullableNumber(row.outdoor_temp_voltage),
    flame_voltage: nullableNumber(row.flame_voltage),
    current_amps: nullableNumber(row.current_amps),
    system_state: nullableNumber(row.system_state),
  };
}

function latestCompleteReading(rows: ReadingRow[]) {
  const latest = rows[0];
  if (!latest) return null;
  const lastWithCurrent = rows.find((row) => row.current_amps != null);
  const lastWithTempOut = rows.find((row) => row.temp_out != null);
  return {
    ...latest,
    current_amps: latest.current_amps ?? lastWithCurrent?.current_amps ?? null,
    temp_out: latest.temp_out ?? lastWithTempOut?.temp_out ?? null,
  };
}

function normalizeThresholds(row: Partial<ThresholdRow> | null): ThresholdRow {
  return {
    temp: Number(row?.temp ?? 50),
    smoke: Number(row?.smoke ?? 400),
    smoke_detection_threshold: Number(row?.smoke_detection_threshold ?? 10),
    rated_current: Number(row?.rated_current ?? 10),
    current_warning_pct: Number(row?.current_warning_pct ?? 80),
  };
}

function estimateFireProbability(readings: ReadingRow[], thresholds: ThresholdRow) {
  if (!readings.length) return 0;
  const current = readings[readings.length - 1];
  const tempProx = Math.max(0, Number(current.temp ?? 0) / thresholds.temp);
  const currentAmps = current.current_amps == null ? 0 : Number(current.current_amps);
  const currentProx =
    (currentAmps / thresholds.rated_current) * (thresholds.current_warning_pct / 100);
  const smokeProx = smokePercentage(current) / 100;
  return 1 / (1 + Math.exp(-(-4 + 2.5 * tempProx + 2.0 * currentProx + 3.0 * smokeProx)));
}

function stateLabelFor(
  reading: ReadingRow | null,
  smokeDetected: boolean,
  fireProbability: number,
) {
  if (!reading) return "NO DATA";
  if (!isBinarySmokeReading(reading) && reading.system_state != null) {
    return (
      {
        0: "NORMAL",
        1: "WARNING",
        2: "AI FIRE-RISK ALERT",
        3: "SMOKE DETECTED",
        4: "HIGH FIRE RISK",
        5: "FIRE CONFIRMED",
      }[reading.system_state] ?? String(reading.status).toUpperCase()
    );
  }
  if (reading.flame) return "FIRE CONFIRMED";
  if (smokeDetected) return "SMOKE DETECTED";
  if (fireProbability >= 0.75) return "AI FIRE-RISK ALERT";
  return String(reading.status).toUpperCase();
}

function smokePercentage(reading: ReadingRow | null | undefined) {
  if (!reading) return 0;
  if (isBinarySmokeReading(reading)) return Number(reading.smoke) === 1 ? 100 : 0;
  if (reading.smoke_percentage != null) return Number(reading.smoke_percentage);
  return Math.max(0, Math.min(100, Number(reading.smoke ?? 0) / 10));
}

function isSmokeDetected(reading: ReadingRow) {
  return Number(reading.smoke) === 1;
}

function isBinarySmokeReading(reading: ReadingRow) {
  return Number(reading.smoke) === 0 || Number(reading.smoke) === 1;
}

function nullableNumber(value: unknown) {
  return value == null ? null : Number(value);
}

function fmt(value: number | null | undefined, digits = 1, suffix = "") {
  return value == null || Number.isNaN(Number(value))
    ? "—"
    : `${Number(value).toFixed(digits)}${suffix}`;
}

function timeLine(timestamp?: string) {
  const date = timestamp ? new Date(timestamp) : new Date();
  return `Time: <b>${escapeHtml(date.toLocaleString())}</b>`;
}

function displayName(chat: NonNullable<TelegramUpdate["message"]>["chat"]) {
  return [chat.first_name, chat.last_name].filter(Boolean).join(" ") || String(chat.id);
}

function parseCommand(text: string) {
  const spaced = /^\/\s+([a-z0-9_]+)(?:@\S+)?/i.exec(text);
  if (spaced) return `/${spaced[1].toLowerCase()}`;
  return text.split(/\s+/, 1)[0].split("@", 1)[0].toLowerCase();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function requiredEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  throw new Error(`Missing required environment variable: ${names.join(" or ")}`);
}
