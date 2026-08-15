import { loadEnvFile } from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Status = "normal" | "warning" | "danger" | string;

interface SensorReadingRow {
  id: number;
  ts: string;
  temp: number;
  temp_out: number | null;
  smoke: number;
  flame: number;
  status: Status;
  smoke_voltage: number | null;
  smoke_baseline: number | null;
  smoke_percentage: number | null;
  indoor_temp_voltage: number | null;
  outdoor_temp_voltage: number | null;
  flame_voltage: number | null;
  current_amps: number | null;
  system_state: number | null;
}

interface DeviceStateRow {
  buzzer: boolean;
  fan: boolean;
  suppression: boolean;
  updated_at: string;
}

interface ThresholdRow {
  temp: number;
  smoke: number;
  smoke_detection_threshold: number;
  rated_current: number;
  current_warning_pct: number;
  current_critical_pct: number;
  temp_delta_warning: number;
}

interface Snapshot {
  reading: SensorReadingRow | null;
  devices: DeviceStateRow | null;
  thresholds: ThresholdRow;
  fireProbability: number;
  smokeDetected: boolean;
  flameDetected: boolean;
  systemStateLabel: string;
  arduinoConnected: boolean;
  sensorFailure: string | null;
}

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

const DEFAULT_THRESHOLDS: ThresholdRow = {
  temp: 50,
  smoke: 400,
  smoke_detection_threshold: 10,
  rated_current: 10,
  current_warning_pct: 80,
  current_critical_pct: 100,
  temp_delta_warning: 15,
};

const STATE_LABELS: Record<number, string> = {
  0: "NORMAL",
  1: "WARNING",
  2: "AI FIRE-RISK ALERT",
  3: "SMOKE DETECTED",
  4: "HIGH FIRE RISK",
  5: "FIRE CONFIRMED",
};

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

loadLocalEnv();

const TELEGRAM_TOKEN = requiredEnv("TELEGRAM_BOT_TOKEN", "TELEGRAM_API_KEY");
const SUPABASE_URL = requiredEnv("SUPABASE_URL", "VITE_SUPABASE_URL");
const SUPABASE_KEY = requiredEnv(
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
);

const FIRE_PROBABILITY_THRESHOLD = numberEnv("FIRE_PROBABILITY_ALERT_THRESHOLD", 0.75);
const ARDUINO_STALE_SECONDS = numberEnv("ARDUINO_STALE_SECONDS", 60);
const POLL_INTERVAL_MS = numberEnv("TELEGRAM_POLL_INTERVAL_MS", 1200);
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { params: { eventsPerSecond: 10 } },
});

let latestSnapshot: Snapshot | null = null;
let lastAlertFingerprint = "";
let lastUpdateId = 0;
let stopping = false;

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

void main().catch((error) => {
  console.error("[telegram-bot] fatal", error);
  process.exitCode = 1;
});

async function main() {
  console.log("[telegram-bot] starting Smart Monitoring Telegram bot");
  await telegram("setMyCommands", { commands: BOT_COMMANDS }).catch((error) => {
    console.warn("[telegram-bot] command menu update failed", error);
  });
  latestSnapshot = await buildSnapshot();
  lastAlertFingerprint = snapshotFingerprint(latestSnapshot);

  subscribeToRealtime(supabase);
  void monitorArduinoConnection();
  await pollTelegramCommands();
}

function subscribeToRealtime(client: SupabaseClient) {
  client
    .channel("telegram-bot-monitor")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "sensor_readings" },
      async () => {
        await refreshAndAlert("sensor_reading");
      },
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "device_state" },
      async () => {
        await refreshAndAlert("device_state");
      },
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "thresholds" },
      async () => {
        latestSnapshot = await buildSnapshot();
      },
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "connection_log" },
      async (payload) => {
        const row = payload.new as { level?: string; message?: string };
        const message = `${row.level ?? ""} ${row.message ?? ""}`.toLowerCase();
        if (/(disconnect|lost|offline|closed|failed|error)/i.test(message)) {
          await refreshAndAlert("arduino_disconnect");
        } else if (/(connect|serial open|rx|online|ready)/i.test(message)) {
          await refreshAndAlert("arduino_reconnect");
        } else if (/sensor.*(fail|error|fault)|critical sensor/i.test(message)) {
          await broadcast(
            `🛠 <b>CRITICAL SENSOR FAILURE</b>\n${escapeHtml(row.message ?? "Sensor fault reported.")}\n\n${timeLine()}`,
          );
        }
      },
    )
    .subscribe((status) => {
      console.log(`[telegram-bot] realtime status: ${status}`);
    });
}

async function pollTelegramCommands() {
  while (!stopping) {
    try {
      const updates = await telegram<{ result: TelegramUpdate[] }>("getUpdates", {
        timeout: 25,
        offset: lastUpdateId + 1,
        allowed_updates: ["message"],
      });

      for (const update of updates.result ?? []) {
        lastUpdateId = update.update_id;
        await handleUpdate(update);
      }
    } catch (error) {
      console.error("[telegram-bot] polling error", error);
      await delay(POLL_INTERVAL_MS);
    }
  }
}

async function handleUpdate(update: TelegramUpdate) {
  const message = update.message;
  const text = message?.text?.trim();
  if (!message || !text?.startsWith("/")) return;

  const chatId = String(message.chat.id);
  const command = parseCommand(text);

  try {
    switch (command) {
      case "/start":
        await upsertSubscriber(chatId, message.chat.username ?? displayName(message.chat));
        latestSnapshot = await buildSnapshot();
        await sendMessage(chatId, welcomeMessage(latestSnapshot));
        break;
      case "/stop":
        await disableSubscriber(chatId);
        await sendMessage(
          chatId,
          "🔕 <b>Notifications disabled</b>\nYou will no longer receive automatic Smart Monitoring alerts.\n\nSend /start to subscribe again.",
        );
        break;
      case "/status":
      case "/current":
        latestSnapshot = await buildSnapshot();
        await sendMessage(chatId, statusMessage(latestSnapshot));
        break;
      case "/smoke":
        latestSnapshot = await buildSnapshot();
        await sendMessage(chatId, smokeMessage(latestSnapshot));
        break;
      case "/flame":
        latestSnapshot = await buildSnapshot();
        await sendMessage(chatId, flameMessage(latestSnapshot));
        break;
      case "/temp":
        latestSnapshot = await buildSnapshot();
        await sendMessage(chatId, temperatureMessage(latestSnapshot));
        break;
      case "/help":
        await sendMessage(chatId, helpMessage());
        break;
      default:
        await sendMessage(
          chatId,
          `❔ <b>Unknown command</b>\nUse /help to view available commands.`,
        );
    }
  } catch (error) {
    console.error("[telegram-bot] command error", error);
    await sendMessage(
      chatId,
      "⚠️ <b>Unable to process request</b>\nPlease try again in a few seconds.",
    );
  }
}

async function refreshAndAlert(reason: string) {
  const previous = latestSnapshot;
  const next = await buildSnapshot();
  latestSnapshot = next;

  const fingerprint = snapshotFingerprint(next);
  if (fingerprint === lastAlertFingerprint) return;

  const message = buildAlertMessage(previous, next, reason);
  lastAlertFingerprint = fingerprint;
  if (message) await broadcast(message);
}

async function buildSnapshot(): Promise<Snapshot> {
  const [readingsRes, devicesRes, thresholdsRes] = await Promise.all([
    supabase
      .from("sensor_readings")
      .select("*")
      .order("ts", { ascending: false })
      .order("id", { ascending: false })
      .limit(10),
    supabase.from("device_state").select("*").eq("id", 1).maybeSingle(),
    supabase.from("thresholds").select("*").eq("id", 1).maybeSingle(),
  ]);

  if (readingsRes.error) throw readingsRes.error;
  if (devicesRes.error) throw devicesRes.error;
  if (thresholdsRes.error) throw thresholdsRes.error;

  const rows = ((readingsRes.data ?? []) as SensorReadingRow[]).map(normalizeReading);
  const reading = latestCompleteReading(rows);
  const thresholds = normalizeThresholds((thresholdsRes.data ?? {}) as Partial<ThresholdRow>);
  const devices = devicesRes.data ? normalizeDevices(devicesRes.data as DeviceStateRow) : null;
  const smokeDetected = reading
    ? isSmokeDetected(reading)
    : false;
  const fireProbability = reading && isBinarySmokeReading(reading)
    ? 0
    : estimateFireProbability([...rows].reverse(), thresholds);
  const flameDetected = !!reading?.flame;
  const systemState = reading && !isBinarySmokeReading(reading) && reading.system_state != null
    ? reading.system_state
    : deriveSystemState(reading, thresholds, fireProbability, smokeDetected);
  const arduinoConnected = reading
    ? Date.now() - new Date(reading.ts).getTime() <= ARDUINO_STALE_SECONDS * 1000
    : false;

  return {
    reading,
    devices,
    thresholds,
    fireProbability,
    smokeDetected,
    flameDetected,
    systemStateLabel:
      STATE_LABELS[systemState] ?? String(reading?.status ?? "UNKNOWN").toUpperCase(),
    arduinoConnected,
    sensorFailure: detectSensorFailure(reading),
  };
}

function buildAlertMessage(previous: Snapshot | null, next: Snapshot, reason: string) {
  const r = next.reading;
  const devices = next.devices;
  const changedState = previous?.systemStateLabel !== next.systemStateLabel;
  const recovered =
    previous &&
    (previous.smokeDetected ||
      previous.flameDetected ||
      previous.fireProbability >= FIRE_PROBABILITY_THRESHOLD ||
      previous.systemStateLabel !== "NORMAL") &&
    !next.smokeDetected &&
    !next.flameDetected &&
    next.fireProbability < FIRE_PROBABILITY_THRESHOLD &&
    next.systemStateLabel === "NORMAL";

  if (recovered) {
    return `✅ <b>SYSTEM RECOVERED</b>\nSmoke and flame conditions cleared.\nSystem returned to <b>NORMAL</b> state.\n\n${sensorSummary(next)}\n${timeLine(r?.ts)}`;
  }

  if (!previous?.arduinoConnected && next.arduinoConnected) {
    return `✅ <b>ARDUINO RECONNECTED</b>\nSensor data stream is active again.\n\n${sensorSummary(next)}\n${timeLine(r?.ts)}`;
  }

  if (previous?.arduinoConnected && !next.arduinoConnected) {
    return `🔌 <b>ARDUINO DISCONNECTED</b>\nNo fresh sensor readings received within ${ARDUINO_STALE_SECONDS}s.\n\n${timeLine(r?.ts)}`;
  }

  if (next.sensorFailure && previous?.sensorFailure !== next.sensorFailure) {
    return `🛠 <b>CRITICAL SENSOR FAILURE</b>\n${escapeHtml(next.sensorFailure)}\n\n${sensorSummary(next)}\n${timeLine(r?.ts)}`;
  }

  if (next.flameDetected && !previous?.flameDetected) {
    return `🚨 <b>FIRE ALERT</b>\nFlame detected by sensor.\n\n${sensorSummary(next)}\n${deviceSummary(devices)}\n${timeLine(r?.ts)}`;
  }

  if (next.smokeDetected && !previous?.smokeDetected) {
    return `💨 <b>SMOKE ALERT</b>\nSmoke detected above configured threshold.\n\n${sensorSummary(next)}\n${deviceSummary(devices)}\n${timeLine(r?.ts)}`;
  }

  if (
    next.fireProbability >= FIRE_PROBABILITY_THRESHOLD &&
    (previous?.fireProbability ?? 0) < FIRE_PROBABILITY_THRESHOLD
  ) {
    return `🤖 <b>AI FIRE-RISK ALERT</b>\nFire probability exceeded ${(FIRE_PROBABILITY_THRESHOLD * 100).toFixed(0)}%.\n\n${sensorSummary(next)}\n${deviceSummary(devices)}\n${timeLine(r?.ts)}`;
  }

  const deviceChanges = deviceChangeLines(previous?.devices ?? null, devices);
  if (deviceChanges.length) {
    return [
      "<b>DEVICE STATE CHANGED</b>",
      deviceChanges.join("\n"),
      "",
      deviceStateSensorSummary(next),
      timeLine(devices?.updated_at ?? r?.ts),
    ].join("\n");
  }

  if (changedState) {
    return `${stateEmoji(next.systemStateLabel)} <b>SYSTEM STATE CHANGED</b>\nState: <b>${escapeHtml(next.systemStateLabel)}</b>\nReason: ${escapeHtml(reason)}\n\n${sensorSummary(next)}\n${deviceSummary(devices)}\n${timeLine(r?.ts)}`;
  }

  return null;
}

function snapshotFingerprint(snapshot: Snapshot) {
  const d = snapshot.devices;
  return [
    snapshot.smokeDetected ? "smoke:on" : "smoke:off",
    snapshot.flameDetected ? "flame:on" : "flame:off",
    snapshot.fireProbability >= FIRE_PROBABILITY_THRESHOLD ? "risk:on" : "risk:off",
    `state:${snapshot.systemStateLabel}`,
    `arduino:${snapshot.arduinoConnected ? "on" : "off"}`,
    `failure:${snapshot.sensorFailure ?? "none"}`,
    `fan:${d?.fan ? "on" : "off"}`,
    `buzzer:${d?.buzzer ? "on" : "off"}`,
    `suppression:${d?.suppression ? "on" : "off"}`,
  ].join("|");
}

async function upsertSubscriber(chatId: string, username: string) {
  const { error } = await supabase.from("telegram_subscribers").upsert(
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
  const { error } = await supabase
    .from("telegram_subscribers")
    .update({ notifications_enabled: false })
    .eq("chat_id", chatId);
  if (error) throw error;
}

async function activeSubscribers() {
  const { data, error } = await supabase
    .from("telegram_subscribers")
    .select("chat_id")
    .eq("notifications_enabled", true);
  if (error) throw error;
  return (data ?? []) as { chat_id: string }[];
}

async function broadcast(message: string) {
  const subscribers = await activeSubscribers();
  await Promise.allSettled(
    subscribers.map((subscriber) => sendMessage(subscriber.chat_id, message, true)),
  );
}

async function sendMessage(chatId: string, text: string, disableOnForbidden = false) {
  try {
    await telegram("sendMessage", {
      chat_id: /^-?\d+$/.test(chatId) ? Number(chatId) : chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (disableOnForbidden && /forbidden|blocked|chat not found/i.test(message)) {
      await disableSubscriber(chatId).catch(() => undefined);
    }
    throw error;
  }
}

async function telegram<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${TELEGRAM_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  if (!response.ok || json.ok === false) {
    throw new Error(json.description ?? `Telegram ${method} failed with HTTP ${response.status}`);
  }
  return json as T;
}

async function monitorArduinoConnection() {
  while (!stopping) {
    await delay(Math.max(5000, ARDUINO_STALE_SECONDS * 500));
    await refreshAndAlert("arduino_stale_check").catch((error) => {
      console.error("[telegram-bot] stale check error", error);
    });
  }
}

function welcomeMessage(snapshot: Snapshot) {
  return `👋 <b>Smart Monitoring System</b>\nTelegram alerts are now enabled for this chat.\n\n${statusBlock(snapshot)}\n\nUse /help to view commands.`;
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

function statusMessage(snapshot: Snapshot) {
  return [
    "<b>CURRENT SYSTEM STATUS</b>",
    deviceStateSensorSummary(snapshot),
    "",
    deviceSummary(snapshot.devices),
    timeLine(snapshot.reading?.ts),
  ].join("\n");
}

function smokeMessage(snapshot: Snapshot) {
  const r = snapshot.reading;
  return [
    "<b>SMOKE SENSOR</b>",
    `Smoke Status: <b>${snapshot.smokeDetected ? "DETECTED" : "Clear"}</b>`,
    timeLine(r?.ts),
  ].join("\n");
}

function flameMessage(snapshot: Snapshot) {
  const r = snapshot.reading;
  return [
    "<b>FLAME SENSOR</b>",
    `Detection Status: <b>${snapshot.flameDetected ? "FLAME DETECTED" : "Clear"}</b>`,
    timeLine(r?.ts),
  ].join("\n");
}

function temperatureMessage(snapshot: Snapshot) {
  const r = snapshot.reading;
  const delta = r?.temp_out == null ? null : Number(r.temp) - Number(r.temp_out);
  return [
    "<b>TEMPERATURE SENSORS</b>",
    `Indoor Temperature: <b>${fmt(r?.temp, 1, "°C")}</b>`,
    `Outdoor Temperature: <b>${fmt(r?.temp_out, 1, "°C")}</b>`,
    `Delta T: <b>${fmt(delta, 1, "°C")}</b>`,
    timeLine(r?.ts),
  ].join("\n");
}

function statusBlock(snapshot: Snapshot) {
  const r = snapshot.reading;
  return [
    `Safety State: <b>${escapeHtml(snapshot.systemStateLabel)}</b>`,
    `System Status: <b>${escapeHtml(String(r?.status ?? "unknown").toUpperCase())}</b>`,
    `Smoke Status: <b>${snapshot.smokeDetected ? "Detected ⚠️" : "Clear ✅"}</b>`,
    `Flame Status: <b>${snapshot.flameDetected ? "Detected 🚨" : "Clear ✅"}</b>`,
    `Arduino: <b>${snapshot.arduinoConnected ? "Connected ✅" : "Disconnected 🔌"}</b>`,
    snapshot.sensorFailure
      ? `Sensor Health: <b>Failure ⚠️</b> ${escapeHtml(snapshot.sensorFailure)}`
      : "Sensor Health: <b>OK ✅</b>",
  ].join("\n");
}

function deviceStateSensorSummary(snapshot: Snapshot) {
  const r = snapshot.reading;
  const delta = r?.temp_out == null ? null : Number(r.temp) - Number(r.temp_out);
  return [
    `Indoor Temp : <b>${fmt(r?.temp, 1, "°C")}</b>`,
    `Outdoor Temp: <b>${fmt(r?.temp_out, 1, "°C")}</b>`,
    `Delta T (in-out): <b>${fmt(delta, 1, "°C")}</b>`,
    `Smoke: <b>${snapshot.smokeDetected ? "DETECTED" : "Clear"}</b>`,
    `Flame: <b>${snapshot.flameDetected ? "DETECTED" : "Clear"}</b>`,
    `Current: <b>${fmt(r?.current_amps, 3, " A")}</b>`,
    `System State: <b>${escapeHtml(snapshot.systemStateLabel)}</b>`,
  ].join("\n");
}

function sensorSummary(snapshot: Snapshot) {
  const r = snapshot.reading;
  return [
    `Smoke Level: <b>${fmt(smokePercentage(r), 1, "%")}</b>`,
    `Indoor Temperature: <b>${fmt(r?.temp, 1, "°C")}</b>`,
    `Flame: <b>${snapshot.flameDetected ? "DETECTED" : "Clear"}</b>`,
  ].join("\n");
}

function deviceSummary(devices: DeviceStateRow | null) {
  return [
    `Fan: <b>${devices?.fan ? "ON" : "OFF"}</b>`,
    `Buzzer: <b>${devices?.buzzer ? "ON" : "OFF"}</b>`,
    `Suppression Relay: <b>${devices?.suppression ? "ON" : "OFF"}</b>`,
  ].join("\n");
}

function deviceChangeLines(previous: DeviceStateRow | null, next: DeviceStateRow | null) {
  if (!previous || !next) return [];
  const lines: string[] = [];
  if (previous.buzzer !== next.buzzer)
    lines.push(`🔔 Buzzer: <b>${next.buzzer ? "ON" : "OFF"}</b>`);
  if (previous.fan !== next.fan) lines.push(`🌬 Cooling Fan: <b>${next.fan ? "ON" : "OFF"}</b>`);
  if (previous.suppression !== next.suppression)
    lines.push(`🧯 Suppression Relay: <b>${next.suppression ? "ON" : "OFF"}</b>`);
  return lines;
}

function estimateFireProbability(readings: SensorReadingRow[], thresholds: ThresholdRow) {
  if (!readings.length) return 0;
  const current = readings[readings.length - 1];
  const temps = readings.map((row) => Number(row.temp ?? 0));
  const currents = readings.map((row) => Number(row.current_amps ?? 0));
  const tempProx = Math.max(0, Number(current.temp ?? 0) / thresholds.temp);
  const currentAmps = current.current_amps == null ? 0 : Number(current.current_amps);
  const currentProx =
    (currentAmps / thresholds.rated_current) * (thresholds.current_warning_pct / 100);
  const smokeProx = smokePercentage(current) / 100;
  const z =
    -4 +
    2.5 * tempProx +
    2.0 * currentProx +
    3.0 * smokeProx +
    1.2 * Math.max(0, slopePerSample(temps)) +
    0.8 * Math.max(0, slopePerSample(currents) * 5);
  return 1 / (1 + Math.exp(-z));
}

function slopePerSample(values: number[]) {
  const n = values.length;
  if (n < 2) return 0;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < n; index += 1) {
    numerator += (index - meanX) * (values[index] - meanY);
    denominator += (index - meanX) ** 2;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

function smokePercentage(reading: SensorReadingRow | null | undefined) {
  if (!reading) return 0;
  if (isBinarySmokeReading(reading)) return Number(reading.smoke) === 1 ? 100 : 0;
  if (reading.smoke_percentage != null) return Number(reading.smoke_percentage);
  return Math.max(0, Math.min(100, Number(reading.smoke ?? 0) / 10));
}

function isSmokeDetected(reading: SensorReadingRow) {
  return Number(reading.smoke) === 1;
}

function isBinarySmokeReading(reading: SensorReadingRow) {
  return Number(reading.smoke) === 0 || Number(reading.smoke) === 1;
}

function deriveSystemState(
  reading: SensorReadingRow | null,
  thresholds: ThresholdRow,
  fireProbability: number,
  smokeDetected: boolean,
) {
  if (!reading) return 0;
  if (reading.flame === 1) return 5;
  if (smokeDetected && Number(reading.temp) >= thresholds.temp) return 4;
  if (smokeDetected) return 3;
  if (fireProbability >= FIRE_PROBABILITY_THRESHOLD) return 2;
  if (Number(reading.temp) >= thresholds.temp) return 1;
  return 0;
}

function detectSensorFailure(reading: SensorReadingRow | null) {
  if (!reading) return "No sensor readings are available.";
  const failures: string[] = [];
  if (
    !Number.isFinite(Number(reading.temp)) ||
    Number(reading.temp) < -40 ||
    Number(reading.temp) > 150
  )
    failures.push("indoor temperature out of range");
  if (
    reading.temp_out != null &&
    (!Number.isFinite(Number(reading.temp_out)) ||
      Number(reading.temp_out) < -40 ||
      Number(reading.temp_out) > 150)
  )
    failures.push("outdoor temperature out of range");
  if (!Number.isFinite(Number(reading.smoke)) || Number(reading.smoke) < 0)
    failures.push("smoke sensor value invalid");
  if (![0, 1].includes(Number(reading.flame))) failures.push("flame sensor value invalid");
  if (
    reading.flame_voltage != null &&
    (Number(reading.flame_voltage) < 0 || Number(reading.flame_voltage) > 5.5)
  )
    failures.push("flame voltage out of range");
  if (
    reading.smoke_voltage != null &&
    (Number(reading.smoke_voltage) < 0 || Number(reading.smoke_voltage) > 5.5)
  )
    failures.push("smoke voltage out of range");
  return failures.length ? failures.join(", ") : null;
}

function normalizeReading(row: SensorReadingRow): SensorReadingRow {
  return {
    ...row,
    temp: Number(row.temp),
    temp_out: nullableNumber(row.temp_out),
    smoke: Number(row.smoke),
    flame: Number(row.flame),
    smoke_voltage: nullableNumber(row.smoke_voltage),
    smoke_baseline: nullableNumber(row.smoke_baseline),
    smoke_percentage: nullableNumber(row.smoke_percentage),
    indoor_temp_voltage: nullableNumber(row.indoor_temp_voltage),
    outdoor_temp_voltage: nullableNumber(row.outdoor_temp_voltage),
    flame_voltage: nullableNumber(row.flame_voltage),
    current_amps: nullableNumber(row.current_amps),
    system_state: row.system_state == null ? null : Number(row.system_state),
  };
}

function latestCompleteReading(rows: SensorReadingRow[]) {
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

function normalizeDevices(row: DeviceStateRow): DeviceStateRow {
  return {
    buzzer: Boolean(row.buzzer),
    fan: Boolean(row.fan),
    suppression: Boolean(row.suppression),
    updated_at: row.updated_at,
  };
}

function normalizeThresholds(row: Partial<ThresholdRow>): ThresholdRow {
  return {
    temp: Number(row.temp ?? DEFAULT_THRESHOLDS.temp),
    smoke: Number(row.smoke ?? DEFAULT_THRESHOLDS.smoke),
    smoke_detection_threshold: Number(
      row.smoke_detection_threshold ?? DEFAULT_THRESHOLDS.smoke_detection_threshold,
    ),
    rated_current: Number(row.rated_current ?? DEFAULT_THRESHOLDS.rated_current),
    current_warning_pct: Number(row.current_warning_pct ?? DEFAULT_THRESHOLDS.current_warning_pct),
    current_critical_pct: Number(
      row.current_critical_pct ?? DEFAULT_THRESHOLDS.current_critical_pct,
    ),
    temp_delta_warning: Number(row.temp_delta_warning ?? DEFAULT_THRESHOLDS.temp_delta_warning),
  };
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

function stateEmoji(label: string) {
  if (/FIRE|CRITICAL/i.test(label)) return "🚨";
  if (/WARNING|SMOKE|RISK/i.test(label)) return "⚠️";
  return "✅";
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

function numberEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function requiredEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  throw new Error(`Missing required environment variable: ${names.join(" or ")}`);
}

function loadLocalEnv() {
  try {
    loadEnvFile(".env");
  } catch {
    // Production platforms usually provide environment variables directly.
  }
}

function stop() {
  stopping = true;
}
