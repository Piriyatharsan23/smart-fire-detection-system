import { createFileRoute } from "@tanstack/react-router";
import { Bell, BellOff, Fan, RotateCcw, ShieldAlert, Hand, Cpu, Brain, ThermometerSun, MessageCircle, Save, Send, BellRing, Volume2, Link2, Copy, CheckCircle2 } from "lucide-react";
import { useSystem } from "@/context/SystemContext";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/control")({
  head: () => ({
    meta: [
      { title: "Control Panel — SFDS" },
      { name: "description", content: "Manually control the buzzer, cooling fan and fire suppression actuators." },
    ],
  }),
  component: ControlPanel,
});

function ControlPanel() {
  const { devices, deviceFault, sendCommand, thresholds, setThresholds, resetSystem, automationMode, setAutomationMode, prediction, fireRiskModel, retrainFireModel, horizonSec, setHorizonSec, current, notifySettings, setNotifySettings, notifyPermission, requestNotifyPermission, testBrowserNotification } = useSystem();
  const tempOut = current.tempOut;
  const delta = tempOut == null ? null : current.temp - tempOut;

  const switchToManualForOverride = () => {
    if (automationMode !== "manual") {
      setAutomationMode("manual");
      toast.info("Switched to Manual mode for direct control");
    }
  };

  const fire = (cmd: string, msg: string) => {
    switchToManualForOverride();
    sendCommand(cmd);
    toast.success(msg);
  };
  const isManual = automationMode === "manual";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Control Panel</h1>
        <p className="text-sm text-muted-foreground mt-1">Send commands directly to the Arduino over Bluetooth.</p>
      </header>

      <section className="rounded-2xl border border-border bg-card/70 backdrop-blur p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-semibold">Operation Mode</h2>
            <p className="text-xs text-muted-foreground">Choose how actuators respond to sensor readings.</p>
          </div>
          <div className="inline-flex rounded-xl border border-border bg-background/40 p-1">
            {([
              { v: "manual", label: "Manual", Icon: Hand },
              { v: "auto",   label: "Auto (Rules)", Icon: Cpu },
              { v: "ml",     label: "ML Predict", Icon: Brain },
            ] as const).map(({ v, label, Icon }) => {
              const active = automationMode === v;
              return (
                <button key={v} onClick={() => { setAutomationMode(v); toast.success(`${label} mode enabled`); }}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  <Icon className="h-3.5 w-3.5" /> {label}
                </button>
              );
            })}
          </div>
        </div>

        {automationMode === "ml" && prediction && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-5 gap-3">
            <PredTile label={`Temp · +${prediction.horizonSec}s`} value={`${prediction.tempNext.toFixed(1)}°C`} hot={prediction.tempNext >= thresholds.temp} />
            <PredTile label={`Outdoor · +${prediction.horizonSec}s`} value={prediction.tempOutNext == null ? "—" : `${prediction.tempOutNext.toFixed(1)}°C`} />
            <PredTile label={`Smoke · +${prediction.horizonSec}s`} value={`${Math.round(prediction.smokeNext)} ppm`} hot={prediction.smokeNext >= thresholds.smoke} />
            <PredTile label="Flame risk" value={`${(prediction.flameRisk * 100).toFixed(0)}%`} hot={prediction.flameRisk > 0.5} danger={prediction.flameRisk > 0.75} />
            <PredTile label="Confidence" value={`${(prediction.confidence * 100).toFixed(0)}%`} />
          </div>
        )}

        {automationMode === "ml" && (
          <div className="mt-4 flex items-center justify-between flex-wrap gap-3 rounded-xl border border-border bg-background/40 p-3">
            <div>
              <div className="text-xs font-semibold">Trained Fire-Risk Model</div>
              <div className="text-[11px] text-muted-foreground">
                {fireRiskModel
                  ? `${fireRiskModel.samples} training samples - ${fireRiskModel.positives} risk labels - loss ${fireRiskModel.loss.toFixed(3)}`
                  : "No trained model yet. Train from Supabase history."}
              </div>
            </div>
            <button
              onClick={async () => {
                const model = await retrainFireModel();
                if (model) toast.success(`Model trained on ${model.samples} samples`);
                else toast.error("Not enough readings to train");
              }}
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold border border-border hover:bg-accent"
            >
              <Brain className="h-3.5 w-3.5" /> Train model
            </button>
          </div>
        )}

        {deviceFault && (
          <div className="mt-4 rounded-xl border border-danger/50 bg-danger/10 p-4 text-sm text-danger">
            <div className="font-semibold">Fault detected</div>
            <div className="mt-1 text-xs leading-5 text-danger/90">{deviceFault.message}</div>
            <div className="mt-3 grid gap-2 text-xs text-danger/90 sm:grid-cols-2">
              {deviceFault.details.map((item) => (
                <div key={item.key} className="rounded-lg border border-danger/20 bg-background/60 px-3 py-2">
                  <div className="font-semibold capitalize">{item.label}</div>
                  <div>Expected: {item.expected ? "ON" : "OFF"}</div>
                  <div>LabVIEW: {item.actual ? "ON" : "OFF"}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center gap-3 rounded-xl border border-border bg-background/40 p-3">
          <div className="h-9 w-9 rounded-lg flex items-center justify-center bg-muted/40 text-primary">
            <ThermometerSun className="h-4 w-4" />
          </div>
          <div className="text-xs">
            <div className="font-semibold">Indoor vs Outdoor</div>
            {tempOut == null ? (
              <div className="text-muted-foreground">No outdoor probe detected — fan logic falls back to indoor-only.</div>
            ) : (
              <div className="text-muted-foreground">
                Indoor <span className="font-mono text-foreground">{current.temp.toFixed(1)}°C</span> · Outdoor <span className="font-mono text-foreground">{tempOut.toFixed(1)}°C</span> · Δ <span className={`font-mono ${delta! > 0 ? "text-success" : "text-warning"}`}>{delta!.toFixed(1)}°C</span>
                {" — "}
                {delta! > 0 ? "fan can cool the panel." : "fan will stay off because outdoor is not cooler."}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between flex-wrap gap-3 rounded-xl border border-border bg-background/40 p-3">
          <div>
            <div className="text-xs font-semibold">Forecast Horizon</div>
            <div className="text-[11px] text-muted-foreground">How far ahead the ML predicts. Updates instantly.</div>
          </div>
          <div className="inline-flex rounded-lg border border-border bg-background/40 p-1">
            {[5, 10, 20, 30].map((s) => {
              const active = horizonSec === s;
              return (
                <button key={s} onClick={() => { setHorizonSec(s); toast.success(`Horizon: ${s}s`); }}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  {s}s
                </button>
              );
            })}
          </div>
        </div>

        {automationMode === "manual" && (
          <p className="mt-3 text-xs text-warning">Manual mode: actuators stay as-is until you press a button below.</p>
        )}
        {automationMode === "auto" && (
          <p className="mt-3 text-xs text-muted-foreground">Auto mode: classic threshold rules trigger fan / buzzer / suppression.</p>
        )}
        {automationMode === "ml" && (
          <p className="mt-3 text-xs text-muted-foreground">ML mode: trained logistic fire-risk model + trend forecast act <span className="text-primary">before</span> thresholds are crossed.</p>
        )}
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <ActuatorCard title="Buzzer Alarm" desc="Audible warning siren" active={devices.buzzer}
          onIcon={Bell} offIcon={BellOff}
          onLabel="Turn ON Buzzer" offLabel="Turn OFF Buzzer"
          onClick={() => fire(devices.buzzer ? "BUZZER_OFF" : "BUZZER_ON", `Sent BUZZER_${devices.buzzer ? "OFF" : "ON"}`)} />

        <ActuatorCard title="Cooling Fan" desc="Lowers internal panel temperature" active={devices.fan}
          onIcon={Fan} offIcon={Fan}
          onLabel="Turn ON Fan" offLabel="Turn OFF Fan"
          onClick={() => fire(devices.fan ? "FAN_OFF" : "FAN_ON", `Sent FAN_${devices.fan ? "OFF" : "ON"}`)} />

        <ActuatorCard title="Fire Suppression" desc="Discharges suppressant agent" active={devices.suppression} danger
          onIcon={ShieldAlert} offIcon={ShieldAlert}
          onLabel="ACTIVATE Suppression" offLabel="Suppression Active"
          disabled={devices.suppression}
          onClick={() => fire("SUPPRESS_ON", "Suppression activated")} />
      </section>

      <section className="rounded-2xl border border-border bg-card/70 backdrop-blur p-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-semibold">System Reset</h2>
          <p className="text-xs text-muted-foreground">Sends <code className="font-mono text-primary">RESET</code> to the Arduino and clears actuator state.</p>
        </div>
        <button onClick={async () => {
            switchToManualForOverride();
            resetSystem();
            try {
              await supabase.from("reset_state").upsert({ id: 1, state: "ON", last_reset_at: new Date().toISOString(), updated_at: new Date().toISOString() });
              setTimeout(() => {
                supabase.from("reset_state").upsert({ id: 1, state: "OFF", updated_at: new Date().toISOString() });
              }, 3000);
            } catch (e) { /* ignore */ }
            toast.success("System reset");
          }}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold border border-border hover:bg-accent">
          <RotateCcw className="h-4 w-4" /> Reset System
        </button>
      </section>

      <LabViewResetLink />

      <section className="rounded-2xl border border-border bg-card/70 backdrop-blur p-5">
        <h2 className="font-semibold mb-1">Decision Thresholds</h2>
        <p className="text-xs text-muted-foreground mb-5">Used by Auto and ML modes only. Manual mode ignores these values.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <ThresholdSlider label="Temperature trigger" unit="°C" min={30} max={90} step={1}
            value={thresholds.temp} onChange={(v) => setThresholds({ ...thresholds, temp: v })} />
          <ThresholdSlider label="Smoke trigger" unit="ppm" min={100} max={900} step={10}
            value={thresholds.smoke} onChange={(v) => setThresholds({ ...thresholds, smoke: v })} />
        </div>

        <div className="mt-6 rounded-xl border border-border bg-background/40 p-4 text-xs text-muted-foreground space-y-1">
          <div><span className="text-success font-semibold">●</span> If no smoke/flame alert: fan turns ON when indoor temp is higher than outdoor temp.</div>
          <div><span className="text-success font-semibold">●</span> If outdoor is not cooler: fan stays OFF.</div>
          <div><span className="text-warning font-semibold">●</span> Smoke ≥ {thresholds.smoke} ppm → Fan OFF, Buzzer ON, alert shown</div>
          <div><span className="text-danger font-semibold">●</span> Flame detected → Suppression + Buzzer ON, critical alert</div>
        </div>
      </section>

      <BrowserNotifyCard
        settings={notifySettings}
        setSettings={setNotifySettings}
        permission={notifyPermission}
        requestPermission={requestNotifyPermission}
        testNotification={testBrowserNotification}
      />
    </div>
  );
}

function LabViewResetLink() {
  const [state, setState] = useState<"ON" | "OFF" | "…">("…");
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined" ? `${window.location.origin}/api/public/reset-state` : "/api/public/reset-state";

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/public/reset-state", { cache: "no-store" });
        const text = (await res.text()).trim();
        if (!cancelled) setState(text === "ON" ? "ON" : "OFF");
      } catch { /* ignore */ }
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("URL copied");
      setTimeout(() => setCopied(false), 1500);
    } catch { toast.error("Copy failed"); }
  };

  const on = state === "ON";
  return (
    <section className="rounded-2xl border border-border bg-card/70 backdrop-blur p-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-primary/15 text-primary shrink-0">
            <Link2 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-semibold">LabVIEW Reset Endpoint</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Poll this URL from LabVIEW (HTTP GET) — response is plain text <code className="font-mono">ON</code> or <code className="font-mono">OFF</code>.</p>
          </div>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold tracking-widest px-2.5 py-1 rounded-full ${on ? "bg-success/20 text-success" : "bg-muted/50 text-muted-foreground"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-success animate-pulse" : "bg-muted-foreground"}`} />
          Current: {state}
        </span>
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-xl border border-border bg-background/60 p-2">
        <code className="flex-1 font-mono text-xs px-2 py-1.5 overflow-x-auto text-foreground/90 whitespace-nowrap">{url}</code>
        <button onClick={copy} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold border border-border hover:bg-accent shrink-0">
          {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        JSON variant: <code className="font-mono">{url}?format=json</code>
      </p>
    </section>
  );
}

function PredTile({ label, value, hot, danger }: { label: string; value: string; hot?: boolean; danger?: boolean }) {
  const cls = danger ? "border-danger/50 text-danger" : hot ? "border-warning/50 text-warning" : "border-border text-foreground";
  return (
    <div className={`rounded-xl border p-3 bg-background/40 ${cls}`}>
      <div className="text-[10px] uppercase tracking-widest opacity-70">{label}</div>
      <div className="text-lg font-mono mt-1">{value}</div>
    </div>
  );
}

function ActuatorCard({ title, desc, active, onIcon: OnIcon, offIcon: OffIcon, onLabel, offLabel, onClick, danger, disabled }: {
  title: string; desc: string; active: boolean;
  onIcon: typeof Bell; offIcon: typeof Bell;
  onLabel: string; offLabel: string;
  onClick: () => void; danger?: boolean; disabled?: boolean;
}) {
  const Icon = active ? OnIcon : OffIcon;
  const isFan = title === "Cooling Fan";
  return (
    <div className={`rounded-2xl border p-5 bg-card/70 backdrop-blur ${active ? (danger ? "border-danger/50" : "border-primary/40") : "border-border"}`}
         style={active && danger ? { boxShadow: "var(--shadow-danger)" } : active ? { boxShadow: "var(--shadow-glow)" } : undefined}>
      <div className="flex items-center justify-between">
        <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${active ? (danger ? "bg-danger/20 text-danger" : "bg-primary/20 text-primary") : "bg-muted/50 text-muted-foreground"}`}>
          <Icon className={`h-6 w-6 ${active && isFan ? "animate-spin" : ""}`} style={active && isFan ? { animationDuration: "2s" } : undefined} />
        </div>
        <span className={`text-[10px] font-bold tracking-widest px-2 py-0.5 rounded-full ${active ? (danger ? "bg-danger/20 text-danger" : "bg-success/20 text-success") : "bg-muted/50 text-muted-foreground"}`}>
          {active ? "ACTIVE" : "IDLE"}
        </span>
      </div>
      <h3 className="mt-4 font-semibold">{title}</h3>
      <p className="text-xs text-muted-foreground">{desc}</p>
      <button onClick={onClick} disabled={disabled}
        className={`mt-4 w-full rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed ${
          danger
            ? "text-danger-foreground hover:opacity-90"
            : active
              ? "border border-border hover:bg-accent"
              : "bg-primary text-primary-foreground hover:opacity-90"
        }`}
        style={danger ? { background: "var(--gradient-danger)" } : undefined}>
        {active ? offLabel : onLabel}
      </button>
    </div>
  );
}

function ThresholdSlider({ label, unit, min, max, step, value, onChange }: {
  label: string; unit: string; min: number; max: number; step: number;
  value: number; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium">{label}</label>
        <span className="text-sm font-mono text-primary">{value} {unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="w-full accent-[oklch(0.72_0.18_35)]" />
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
        <span>{min}{unit}</span><span>{max}{unit}</span>
      </div>
    </div>
  );
}

function WhatsAppAlertCard({ alertSettings, saveAlertSettings, testAlert }: {
  alertSettings: { whatsappTo: string; whatsappFrom: string; telegramChatId: string; enabled: boolean; cooldownSeconds: number };
  saveAlertSettings: (s: { whatsappTo: string; whatsappFrom: string; telegramChatId: string; enabled: boolean; cooldownSeconds: number }) => Promise<void>;
  testAlert: () => Promise<void>;
}) {
  const [to, setTo] = useState(alertSettings.whatsappTo);
  const [from, setFrom] = useState(alertSettings.whatsappFrom);
  const [telegramChatId, setTelegramChatId] = useState(alertSettings.telegramChatId);
  const [enabled, setEnabled] = useState(alertSettings.enabled);
  const [cooldown, setCooldown] = useState(alertSettings.cooldownSeconds);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTo(alertSettings.whatsappTo);
    setFrom(alertSettings.whatsappFrom);
    setTelegramChatId(alertSettings.telegramChatId);
    setEnabled(alertSettings.enabled);
    setCooldown(alertSettings.cooldownSeconds);
  }, [alertSettings]);

  const validate = (n: string) => /^\+?[0-9]{6,20}$/.test(n.trim());

  const onSave = async () => {
    if (to && !validate(to)) return toast.error("Recipient must be E.164 (e.g. +14155551234)");
    if (from && !validate(from)) return toast.error("Sender must be E.164 (e.g. +14155238886)");
    setBusy(true);
    try {
      await saveAlertSettings({ whatsappTo: to.trim(), whatsappFrom: from.trim(), telegramChatId: telegramChatId.trim(), enabled, cooldownSeconds: cooldown });
      toast.success("Alert settings saved");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    } finally { setBusy(false); }
  };

  const onTest = async () => {
    if (!telegramChatId && !(to && from)) return toast.error("Add a Telegram chat ID or WhatsApp numbers first");
    setBusy(true);
    try { await testAlert(); toast.success("Test message sent"); }
    catch (e: any) { toast.error(e?.message ?? "Failed to send"); }
    finally { setBusy(false); }
  };

  return (
    <section className="rounded-2xl border border-border bg-card/70 backdrop-blur p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-success/15 text-success shrink-0">
          <MessageCircle className="h-5 w-5" />
        </div>
        <div className="flex-1 max-w-4xl">
          <h2 className="font-semibold">Telegram & WhatsApp Alerts</h2>
          <p className="text-xs text-muted-foreground">
            Sends a Telegram message (and optionally WhatsApp) whenever the system enters <span className="text-warning">Warning</span> or <span className="text-danger">Danger</span> status. A cooldown prevents spam; a danger escalation always sends immediately.
          </p>
        </div>
        </div>
        <label className="inline-flex items-center gap-2 text-xs cursor-pointer shrink-0">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-primary h-4 w-4" />
          <span className="font-semibold">{enabled ? "Enabled" : "Disabled"}</span>
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className="text-xs font-semibold text-muted-foreground">Telegram Chat ID (recommended)</label>
          <input value={telegramChatId} onChange={(e) => setTelegramChatId(e.target.value)} placeholder="e.g. 123456789 or -1001234567890"
            className="mt-1 w-full rounded-lg border border-border bg-background/40 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40" />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Open Telegram, message <code className="font-mono">@userinfobot</code> to get your numeric chat ID. Then message the SFDS bot once so it can DM you. For group alerts use the group chat ID (starts with <code>-100</code>).
          </p>
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground">WhatsApp recipient (optional)</label>
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="+14155551234" inputMode="tel" maxLength={20}
            className="mt-1 w-full rounded-lg border border-border bg-background/40 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40" />
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground">Twilio sender (approved WhatsApp number)</label>
          <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="+14155238886" inputMode="tel" maxLength={20}
            className="mt-1 w-full rounded-lg border border-border bg-background/40 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40" />
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground">Cooldown ({cooldown}s)</label>
          <input type="range" min={30} max={600} step={30} value={cooldown} onChange={(e) => setCooldown(parseInt(e.target.value, 10))}
            className="w-full accent-[oklch(0.72_0.18_35)]" />
          <div className="flex justify-between text-[10px] text-muted-foreground"><span>30s</span><span>10m</span></div>
        </div>
        <div className="flex items-end gap-2">
          <button onClick={onSave} disabled={busy}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50">
            <Save className="h-4 w-4" /> Save
          </button>
          <button onClick={onTest} disabled={busy}
            className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold border border-border hover:bg-accent disabled:opacity-50">
            <Send className="h-4 w-4" /> Test
          </button>
        </div>
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        Use E.164 format with country code (e.g. <code className="font-mono">+14155551234</code>). The Twilio sender must be your account's approved WhatsApp-enabled number (the sandbox uses <code className="font-mono">+14155238886</code> — recipients must first send the join code to it).
      </p>
    </section>
  );
}

function BrowserNotifyCard({ settings, setSettings, permission, requestPermission, testNotification }: {
  settings: { enabled: boolean; sound: boolean; cooldownSeconds: number };
  setSettings: (s: { enabled: boolean; sound: boolean; cooldownSeconds: number }) => void;
  permission: NotificationPermission | "unsupported";
  requestPermission: () => Promise<NotificationPermission | "unsupported">;
  testNotification: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const unsupported = permission === "unsupported";
  const denied = permission === "denied";
  const granted = permission === "granted";

  const onEnable = async () => {
    setBusy(true);
    try {
      const p = await requestPermission();
      if (p === "granted") {
        setSettings({ ...settings, enabled: true });
        toast.success("Browser notifications enabled");
      } else if (p === "denied") {
        toast.error("Permission denied — enable in browser site settings");
      }
    } finally { setBusy(false); }
  };

  const onTest = async () => {
    setBusy(true);
    try { await testNotification(); toast.success("Test notification sent"); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
    finally { setBusy(false); }
  };

  return (
    <section className="rounded-2xl border border-border bg-card/70 backdrop-blur p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
        <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-primary/15 text-primary shrink-0">
          <BellRing className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h2 className="font-semibold">Browser Push Alerts</h2>
          <p className="text-xs text-muted-foreground">
            Pops a desktop notification (and plays a beep) on <span className="text-warning">Warning</span> or <span className="text-danger">Danger</span> readings — even when this tab is in the background. Permission is per-browser; grant it once.
          </p>
        </div>
        </div>
        <label className="inline-flex items-center gap-2 text-xs cursor-pointer shrink-0">
          <input type="checkbox" checked={settings.enabled} disabled={unsupported}
            onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })} className="accent-primary h-4 w-4" />
          <span className="font-semibold">{settings.enabled ? "Enabled" : "Disabled"}</span>
        </label>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
        <div className="rounded-xl border border-border bg-background/40 p-3 text-xs min-h-16">
          <div className="font-semibold mb-1">Permission</div>
          {unsupported && <div className="text-danger">Not supported in this browser.</div>}
          {!unsupported && granted && <div className="text-success">✓ Granted — alerts will appear.</div>}
          {!unsupported && denied && <div className="text-danger">Denied — re-enable in your browser's site settings, then reload.</div>}
          {!unsupported && !granted && !denied && (
            <button onClick={onEnable} disabled={busy}
              className="mt-1 inline-flex items-center gap-2 rounded-lg px-3 py-1.5 bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 disabled:opacity-50">
              <BellRing className="h-3.5 w-3.5" /> Allow notifications
            </button>
          )}
        </div>

        <label className="rounded-xl border border-border bg-background/40 p-3 text-xs flex items-center justify-between cursor-pointer min-h-16">
          <span className="inline-flex items-center gap-2 font-semibold"><Volume2 className="h-3.5 w-3.5" /> Sound beep</span>
          <input type="checkbox" checked={settings.sound}
            onChange={(e) => setSettings({ ...settings, sound: e.target.checked })} className="accent-primary h-4 w-4" />
        </label>

        <div className="rounded-xl border border-border bg-background/40 p-3">
          <label className="text-xs font-semibold text-muted-foreground">Cooldown ({settings.cooldownSeconds}s)</label>
          <input type="range" min={5} max={120} step={5} value={settings.cooldownSeconds}
            onChange={(e) => setSettings({ ...settings, cooldownSeconds: parseInt(e.target.value, 10) })}
            className="w-full accent-[oklch(0.72_0.18_35)]" />
          <div className="flex justify-between text-[10px] text-muted-foreground"><span>5s</span><span>2m</span></div>
        </div>
        <div className="lg:col-span-3 flex justify-end">
          <button onClick={onTest} disabled={busy || unsupported}
            className="w-full sm:w-auto min-w-64 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold border border-border hover:bg-accent disabled:opacity-50">
            <Send className="h-4 w-4" /> Send test notification
          </button>
        </div>
      </div>

    </section>
  );
}
