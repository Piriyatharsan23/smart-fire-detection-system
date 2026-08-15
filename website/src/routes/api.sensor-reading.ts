import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

function createSensorReadingClient() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error("Missing Supabase URL or public key");
  }

  return createClient(url, key, { auth: { persistSession: false } });
}

type SensorReadingBody = {
  temperatureInside?: number;
  temp?: number;
  temperatureOutside?: number | null;
  tempOut?: number | null;
  smoke: boolean | number;
  flame: boolean | number;
  current?: number | null;
  dutyCount?: number | null;   // LabVIEW-friendly alias for raw 0-255 PWM duty count
  "Duty Count"?: number | null;
  fanSpeed?: number | null;   // 0-100 percent, OR 0-255 PWM duty count
  fanDuty?: number | null;    // alias for raw 0-255 PWM duty count
  buzzer?: boolean | number;
  Buzzer?: boolean | number;
  fireSuppression?: boolean | number;
  suppression?: boolean | number;
  "Suppression 2"?: boolean | number;
};

type ParsedReading = {
  temperatureInside: number;
  temperatureOutside: number | null;
  smoke: number;
  smokeDetected: boolean;
  flame: boolean;
  current: number | null;
  fanSpeedPct: number | null;  // normalized 0-100
  buzzer: boolean;
  fireSuppression: boolean;
};

export const Route = createFileRoute("/api/sensor-reading")({
  server: {
    handlers: {
      GET: async () => {
        const supabase = createSensorReadingClient();
        const { data, error } = await supabase
          .from("sensor_readings")
          .select("*")
          .order("ts", { ascending: false })
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        return Response.json({ ok: true, reading: data });
      },
      POST: async ({ request }) => handleSensorReadingWrite(request),
      PUT: async ({ request }) => handleSensorReadingWrite(request),
    },
  },
});

async function handleSensorReadingWrite(request: Request) {
  const supabase = createSensorReadingClient();
  let body: SensorReadingBody;
  try {
    body = await parseSensorReadingBody(request);
  } catch {
    return Response.json({
      ok: false,
      error: "Body must be JSON or LabVIEW key/value text (for example: temperatureInside=25.5, smoke=120, flame=0)",
    }, { status: 400 });
  }

  const parsed = parseReading(body);
  if (!parsed.ok) {
    return Response.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const suppressionActive = await isSuppressionActive();
  if (suppressionActive) {
    return Response.json({ ok: true, ignored: true, reason: "suppression active; waiting for reset" }, { status: 202 });
  }

  const reading = parsed.value;
  const status = computeStatus(reading.temperatureInside, reading.smokeDetected, reading.flame);
  const fan = (reading.fanSpeedPct ?? 0) > 1; // any non-zero duty = fan running

  // Do not send `ts`; Supabase fills it from sensor_readings.ts DEFAULT now().
  const { data, error } = await supabase
    .from("sensor_readings")
    .insert({
      temp: reading.temperatureInside,
      temp_out: reading.temperatureOutside,
      smoke: reading.smokeDetected ? 1 : 0,
      flame: reading.flame ? 1 : 0,
      status,
      current_amps: reading.current,
      fan_speed: reading.fanSpeedPct,
    } as any)
    .select()
    .single();

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  const { error: deviceError } = await supabase
    .from("device_state")
    .update({
      fan,
      buzzer: reading.buzzer,
      suppression: reading.fireSuppression,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  if (deviceError) {
    return Response.json({ ok: false, error: deviceError.message }, { status: 500 });
  }

  await supabase.from("connection_log").insert({
    level: "rx",
    message: `LabVIEW RX TEMP:${reading.temperatureInside},SMOKE:${reading.smokeDetected ? 1 : 0},FLAME:${reading.flame ? 1 : 0}`,
  });

  return Response.json({ ok: true, reading: data });
}

async function isSuppressionActive() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !key) return false;

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data } = await supabase
    .from("device_state")
    .select("suppression")
    .eq("id", 1)
    .maybeSingle();

  return Boolean(data?.suppression);
}

async function parseSensorReadingBody(request: Request): Promise<SensorReadingBody> {
  const raw = await request.text();
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("empty body");

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") return parsed as SensorReadingBody;
  } catch {
    // Fall through to LabVIEW-friendly text parsing.
  }

  const result: Record<string, string | number | boolean> = {};
  const segments = trimmed
    .replace(/[\r\n]+/g, ",")
    .split(/[,;]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (const segment of segments) {
    const match = /^(?<key>[^:=]+)\s*[:=]\s*(?<value>.+)$/.exec(segment);
    if (!match?.groups) continue;
    const key = normalizeLabViewKey(match.groups.key.trim());
    const value = match.groups.value.trim();
    const coerced = coerceValue(value);
    if (key) result[key] = coerced;
  }

  return result as SensorReadingBody;
}

function normalizeLabViewKey(key: string): string {
  const compact = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  switch (compact) {
    case "temp":
    case "temperatureinside":
    case "indoortemp":
      return "temperatureInside";
    case "tempout":
    case "temperatureoutside":
    case "outdoortemp":
    case "tout":
    case "out":
      return "temperatureOutside";
    case "smoke":
      return "smoke";
    case "flame":
    case "flamev":
      return "flame";
    case "current":
    case "currentamps":
    case "currentamp":
    case "currentsensor":
    case "loadcurrent":
    case "amps":
    case "amp":
    case "cv":
    case "i":
      return "current";
    case "dutycount":
    case "duty":
      return "dutyCount";
    case "fanduty":
      return "fanDuty";
    case "fanspeed":
    case "fan":
      return "fanSpeed";
    case "buzzer":
      return "buzzer";
    case "suppression":
    case "suppression2":
    case "firesuppression":
      return "fireSuppression";
    default:
      return key;
  }
}

function coerceValue(value: string): string | number | boolean {
  if (/^(true|false)$/i.test(value)) return /^true$/i.test(value);
  if (/^(on|off)$/i.test(value)) return /^on$/i.test(value);
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

function parseReading(body: SensorReadingBody): { ok: true; value: ParsedReading } | { ok: false; error: string } {
  const temperatureInside = finiteNumber(readField(body, "temperatureInside", "temp"), "temperatureInside");
  if (!temperatureInside.ok) return temperatureInside;

  const temperatureOutsideValue = readField(body, "temperatureOutside", "tempOut");
  const temperatureOutside =
    temperatureOutsideValue == null
      ? { ok: true as const, value: null }
      : finiteNumber(temperatureOutsideValue, "temperatureOutside");
  if (!temperatureOutside.ok) return temperatureOutside;

  const smoke = smokeFlag(readField(body, "smoke"));
  if (!smoke.ok) return smoke;

  const currentValue = readField(body, "current");
  const current =
    currentValue == null ? { ok: true as const, value: null } : finiteNumber(currentValue, "current");
  if (!current.ok) return current;

  // Accept either fanSpeed (assumed percent if <=100, else treated as 0-255 duty)
  // or fanDuty (always 0-255 duty count). Normalize to 0-100 percent.
  let fanSpeedPct: number | null = null;
  const rawDutyCount = readField(body, "Duty Count", "dutyCount", "fanDuty");
  if (rawDutyCount != null) {
    const d = finiteNumber(rawDutyCount, "Duty Count");
    if (!d.ok) return d;
    fanSpeedPct = Math.max(0, Math.min(100, (d.value / 255) * 100));
  } else {
    const fanSpeedValue = readField(body, "fanSpeed");
    if (fanSpeedValue != null) {
      const d = finiteNumber(fanSpeedValue, "fanSpeed");
      if (!d.ok) return d;
      fanSpeedPct = d.value > 100
        ? Math.max(0, Math.min(100, (d.value / 255) * 100))
        : Math.max(0, Math.min(100, d.value));
    }
  }

  return {
    ok: true,
    value: {
      temperatureInside: temperatureInside.value,
      temperatureOutside: temperatureOutside.value,
      smoke: smoke.value ? 1 : 0,
      smokeDetected: smoke.value,
      flame: truthyFlag(readField(body, "flame")),
      current: current.value,
      fanSpeedPct,
      buzzer: truthyFlag(readField(body, "buzzer", "Buzzer")),
      fireSuppression: truthyFlag(readField(body, "fireSuppression", "suppression", "Suppression 2")),
    },
  };
}

function readField(body: SensorReadingBody, ...keys: string[]): unknown {
  const record = body as Record<string, unknown>;
  for (const key of keys) {
    if (record[key] != null) return record[key];
  }

  const normalizedKeys = new Set(keys.map((key) => normalizeLabViewKey(key.trim())));
  for (const [key, value] of Object.entries(record)) {
    if (value != null && normalizedKeys.has(normalizeLabViewKey(key.trim()))) return value;
  }

  return undefined;
}

function finiteNumber(value: unknown, name: string): { ok: true; value: number } | { ok: false; error: string } {
  const n = Number(value);
  if (!Number.isFinite(n)) return { ok: false, error: `${name} must be a finite number` };
  return { ok: true, value: n };
}

function smokeFlag(value: unknown): { ok: true; value: boolean } | { ok: false; error: string } {
  if (typeof value === "boolean") return { ok: true, value };
  if (typeof value === "number" && Number.isFinite(value)) return { ok: true, value: value !== 0 };
  if (value === 1 || value === "1" || value === "true" || value === "ON" || value === "on") {
    return { ok: true, value: true };
  }
  if (value === 0 || value === "0" || value === "false" || value === "OFF" || value === "off") {
    return { ok: true, value: false };
  }
  return { ok: false, error: "smoke must be a boolean value" };
}

function truthyFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true" || value === "ON";
}

function computeStatus(temp: number, smokeDetected: boolean, flame: boolean) {
  if (flame || smokeDetected) return "danger";
  if (temp >= 50) return "warning";
  return "normal";
}
