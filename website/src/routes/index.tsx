import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Thermometer, ThermometerSun, Wind, Flame, ShieldAlert, Activity, Power, Fan, Bell, Gauge, Zap, RefreshCcw, Plug, Cpu, Send } from "lucide-react";
import { toast } from "sonner";
import { useSystem, type Status } from "@/context/SystemContext";
import type { ConditionPrediction, ConditionClass } from "@/context/SystemContext";
import { SensorCard } from "@/components/app/SensorCard";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Live Dashboard — SFDS" },
      { name: "description", content: "Real-time sensor readings and system status for the smart fire detection panel." },
    ],
  }),
  component: Dashboard,
});

const statusMeta: Record<Status, { title: string; sub: string; cls: string; gradient: string }> = {
  normal:  { title: "All Systems Normal", sub: "No anomalies detected in the distribution board.", cls: "border-success/40 text-success", gradient: "linear-gradient(135deg, oklch(0.3 0.08 150 / 30%), transparent)" },
  warning: { title: "Warning · Elevated Temperature", sub: "Cooling fan auto-engaged. Monitor closely.", cls: "border-warning/50 text-warning", gradient: "linear-gradient(135deg, oklch(0.4 0.15 80 / 35%), transparent)" },
  danger:  { title: "🔥 Fire Danger Detected", sub: "Buzzer & suppression engaged. Evacuate area and verify board.", cls: "border-danger/60 text-danger animate-pulse-danger", gradient: "var(--gradient-danger)" },
};

function SectionHeader({ eyebrow, title, hint }: { eyebrow: string; title: string; hint?: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">{eyebrow}</div>
        <h2 className="mt-0.5 text-base sm:text-lg font-semibold tracking-tight text-foreground">{title}</h2>
      </div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Dashboard() {
  const { current, devices, history, sensorSettings, calibrateSmokeBaseline, latestAlert, connected, fireRiskModel, condition } = useSystem();
  const meta = statusMeta[current.status];
  const tempStatus: Status = current.temp >= 60 ? "danger" : current.temp >= 50 ? "warning" : "normal";
  const smokeDetected = current.smoke === 1;
  const smokeStatus: Status = smokeDetected ? "danger" : "normal";
  const flameStatus: Status = current.flame ? "danger" : "normal";
  const tempOut = current.tempOut;
  const delta = tempOut == null ? null : current.temp - tempOut;
  const outStatus: Status = tempOut == null ? "normal" : delta! < 2 ? "warning" : "normal";
  const outHint = tempOut == null
    ? "No outdoor probe"
    : delta! >= 2 ? `${delta!.toFixed(1)}°C cooler outside — fan helps`
    : delta! <= -2 ? `${Math.abs(delta!).toFixed(1)}°C hotter outside — fan won't help`
    : "Outdoor ≈ indoor — fan won't help";

  const rated = sensorSettings.ratedCurrent || 10;
  const yCurrent = current.current ?? [...history].reverse().find((row) => row.current != null)?.current ?? null;
  const xVoltage = yCurrent == null ? null : (yCurrent - 0.0235) / 2.1805;
  const currentPct = yCurrent == null ? 0 : (yCurrent / rated) * 100;
  const currentStatus: Status =
    yCurrent == null ? "normal" :
    currentPct >= sensorSettings.currentCriticalPct ? "danger" :
    currentPct >= sensorSettings.currentWarningPct ? "warning" : "normal";
  const stateLabels: Record<number, string> = {
    0: "STATE 0 · Normal",
    1: "STATE 1 · Early Warning",
    2: "STATE 2 · AI Predict Alert",
    3: "STATE 3 · Smoke Detected",
    4: "STATE 4 · Fire Risk Confirmed",
    5: "STATE 5 · Fire Confirmed",
  };
  const sysState = current.systemState ?? 0;

  const fireProbPct = Math.max(0, Math.min(100, (current.fireProbability ?? 0) * 100));
  const riskTone: Status =
    fireProbPct >= 60 ? "danger" : fireProbPct >= 30 ? "warning" : "normal";
  const riskLabel = riskTone === "danger" ? "High Risk" : riskTone === "warning" ? "Elevated Risk" : "Low Risk";
  const riskRing = riskTone === "danger" ? "text-danger" : riskTone === "warning" ? "text-warning" : "text-primary";

  return (
    <div className="space-y-8 sm:space-y-10">
      {/* Header: title + global status pills */}
      <section className={`relative overflow-hidden rounded-3xl border ${statusMeta[current.status].cls} bg-card/60 backdrop-blur px-5 sm:px-7 py-6`}>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{ background: statusMeta[current.status].gradient }}
        />
        <div className="relative flex flex-col gap-4">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">Smart Fire Monitoring · Control Room</div>
            <h1 className="mt-1.5 text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight leading-snug">
              {meta.title}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground max-w-2xl leading-relaxed">{meta.sub}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[10px] sm:text-xs font-medium uppercase tracking-[0.18em]">
            <StatusPill
              icon={Send}
              label="Telegram"
              state={connected ? "active" : "idle"}
              value={connected ? "Linked" : "Offline"}
            />
            <StatusPill
              icon={Cpu}
              label="AI Engine"
              state="active"
              value={fireRiskModel?.accuracy != null ? `${(fireRiskModel.accuracy * 100).toFixed(0)}% Acc` : "Online"}
            />
          </div>
        </div>
      </section>

      {/* Main grid: sensors + AI risk */}
      <section>
        <SectionHeader eyebrow="Live Telemetry" title="Environmental Sensors & AI Risk" hint={`${history.length} readings logged`} />
        <div className="grid grid-cols-12 gap-4 sm:gap-5">
        <div className="col-span-12 xl:col-span-8 grid grid-cols-2 md:grid-cols-4 gap-4">
        <SensorCard icon={Thermometer} label="Indoor Temp" value={current.temp.toFixed(1)} unit="°C" status={tempStatus} hint="Probe @ Bus Bar" />
        <SensorCard icon={ThermometerSun} label="Outdoor Temp" value={tempOut == null ? "—" : tempOut.toFixed(1)} unit={tempOut == null ? undefined : "°C"} status={outStatus} hint={outHint} />
        <SensorCard icon={Wind} label="Smoke" value={smokeDetected ? "Smoke Detected" : "Clear"} status={smokeStatus} hint="MQ-2 sensor" />
        <SensorCard icon={Flame} label="Flame" value={current.flame ? "DETECTED" : "Clear"} status={flameStatus} hint="IR flame sensor" />
        </div>

        {/* AI Risk panel */}
        <div className={`col-span-12 xl:col-span-4 rounded-2xl border bg-card/70 backdrop-blur p-5 flex flex-col justify-between gap-4 min-h-[172px] ${riskTone === "danger" ? "border-danger/40" : riskTone === "warning" ? "border-warning/40" : "border-border"}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">AI Fire Risk Probability</div>
              <div className="text-xs text-muted-foreground mt-1">Neural inference · sensor fusion</div>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold tracking-widest shrink-0">
              REAL-TIME
            </span>
          </div>
          <div className="flex items-center gap-5">
            <RiskGauge pct={fireProbPct} ringClass={riskRing} />
            <div className="min-w-0">
              <div className={`text-xl font-bold ${riskTone === "danger" ? "text-danger" : riskTone === "warning" ? "text-warning" : "text-foreground"}`}>{riskLabel}</div>
              <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                {riskTone === "normal"
                  ? "No immediate threats detected by neural engine."
                  : riskTone === "warning"
                  ? "Elevated readings — monitor closely."
                  : "Critical pattern detected. Verify board immediately."}
              </div>
            </div>
          </div>
        </div>
        </div>
      </section>

      {/* Electrical + Safety state */}
      <section>
        <SectionHeader eyebrow="Electrical & Safety" title="Load, Voltage & State Machine" />
        <div className="grid grid-cols-12 gap-4 sm:gap-5">
        <div className="col-span-12 lg:col-span-5 xl:col-span-4 grid grid-cols-2 gap-4">
          <MetricCard
            icon={Plug}
            label="Load Current"
            value={yCurrent == null ? "—" : yCurrent.toFixed(3)}
            unit={yCurrent == null ? undefined : "A"}
            tone={currentStatus}
            hint={yCurrent == null ? "Awaiting Arduino feed" : `y = ${yCurrent.toFixed(3)} A · x = ${xVoltage?.toFixed(3) ?? "—"} V`}
          />
          <MetricCard
            icon={Zap}
            label="Current Sensor Voltage"
            value={xVoltage == null ? "—" : xVoltage.toFixed(3)}
            unit={xVoltage == null ? undefined : "V"}
            tone="normal"
            hint="Voltage across the burden resistor"
          />
        </div>

        <div className={`col-span-12 lg:col-span-7 xl:col-span-8 rounded-2xl border p-5 flex flex-wrap items-center justify-between gap-3 bg-card/70 backdrop-blur ${statusMeta[current.status].cls}`}>
        <div className="flex items-center gap-3">
          <ShieldAlert className="h-5 w-5" />
          <div>
            <div className="text-[10px] uppercase tracking-widest opacity-80">Safety State Machine</div>
            <div className="text-base sm:text-lg font-semibold">{stateLabels[sysState]}</div>
          </div>
        </div>
          <div className="text-xs opacity-90">
            Fire probability: <span className="font-bold tabular-nums">{fireProbPct.toFixed(0)}%</span>
            <span className="mx-2 opacity-50">·</span>
            {history.length} readings logged
          </div>
        </div>
        </div>
      </section>

      {/* AI Condition Prediction (multi-class) */}
      <section>
        <SectionHeader eyebrow="Predictive AI" title="Multi-class Condition Diagnosis" />
        <ConditionPanel condition={condition} />
      </section>

      {/* Devices status */}
      <section>
        <SectionHeader eyebrow="Actuators" title="Connected Devices" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <DeviceTile icon={Bell}  label="Buzzer Alarm"      on={devices.buzzer} />
        <DeviceTile
          icon={Fan}
          label="Cooling Fan"
          on={devices.fan || (current.fanSpeed ?? 0) > 0}
          detail={
            current.fanSpeed == null
              ? undefined
              : `${Math.round(current.fanSpeed)}% duty`
          }
        />
        <DeviceTile icon={Power} label="Suppression Relay" on={devices.suppression} danger />
        </div>
      </section>

      {/* Voltage pipeline (new) */}
      <section>
        <SectionHeader eyebrow="Diagnostics" title="Analog Voltage Pipeline" />
        <VoltagePanel
          current={current}
          baseline={sensorSettings.smokeBaselineVoltage}
          threshold={sensorSettings.smokeDetectionThreshold}
          onCalibrate={calibrateSmokeBaseline}
          latestAlert={latestAlert}
        />
      </section>
    </div>
  );
}

function StatusPill({
  icon: Icon, label, value, state,
}: { icon: typeof Bell; label: string; value: string; state: "active" | "idle" }) {
  const cls = state === "active"
    ? "border-success/40 text-success bg-success/10"
    : "border-border text-muted-foreground bg-muted/40";
  const dot = state === "active" ? "bg-success shadow-[0_0_8px_currentColor]" : "bg-muted-foreground/50";
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      <Icon className="h-3.5 w-3.5" />
      <span className="opacity-80">{label}:</span>
      <span className="font-bold tracking-wider">{value}</span>
    </div>
  );
}

function RiskGauge({ pct, ringClass }: { pct: number; ringClass: string }) {
  const r = 36;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg viewBox="0 0 88 88" className="h-full w-full -rotate-90">
        <circle cx="44" cy="44" r={r} stroke="currentColor" strokeWidth="6" fill="transparent" className="text-muted/40" />
        <circle
          cx="44" cy="44" r={r} stroke="currentColor" strokeWidth="6" fill="transparent"
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          className={`${ringClass} transition-[stroke-dashoffset] duration-700`}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xl font-bold tabular-nums">{pct.toFixed(0)}%</span>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon, label, value, unit, tone = "normal", hint,
}: { icon: typeof Bell; label: string; value: string; unit?: string; tone?: Status; hint?: string }) {
  const tones: Record<Status, string> = {
    normal: "border-border text-foreground",
    warning: "border-warning/40 text-warning",
    danger: "border-danger/50 text-danger",
  };
  return (
    <div className={`rounded-2xl border bg-card/70 backdrop-blur p-4 flex flex-col justify-between min-h-[7.5rem] ${tones[tone]}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      </div>
      <div>
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold tabular-nums">{value}</span>
          {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
        </div>
        {hint && <div className="mt-1 text-[11px] text-muted-foreground line-clamp-1">{hint}</div>}
      </div>
    </div>
  );
}

function ConditionPanel({ condition }: { condition: ConditionPrediction }) {
  const toneCls: Record<Status, string> = {
    normal: "border-success/40 text-success",
    warning: "border-warning/50 text-warning",
    danger: "border-danger/60 text-danger animate-pulse-danger",
  };
  const classOrder: ConditionClass[] = ["NORMAL", "OVERHEATING_RISK", "FAN_FAILURE", "OVERLOAD", "FIRE_RISK"];
  const classLabel: Record<ConditionClass, string> = {
    NORMAL: "Normal",
    OVERHEATING_RISK: "Overheating",
    FAN_FAILURE: "Fan Failure",
    OVERLOAD: "Overload",
    FIRE_RISK: "Fire Risk",
  };
  return (
    <section className={`rounded-2xl border bg-card/70 backdrop-blur p-5 ${toneCls[condition.severity]}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">AI Condition Prediction</div>
          <div className="mt-1 text-xl sm:text-2xl font-bold tracking-tight">{condition.label}</div>
          <div className="mt-1 text-xs text-muted-foreground max-w-2xl">{condition.reason}</div>
          <div className="mt-2 text-[11px] uppercase tracking-widest text-muted-foreground">
            Action: <span className="text-foreground font-medium normal-case tracking-normal">{condition.recommendation}</span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Confidence</div>
          <div className="text-2xl font-bold tabular-nums">{(condition.confidence * 100).toFixed(0)}%</div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-5 gap-2">
        {classOrder.map((k) => {
          const v = condition.scores[k];
          const active = k === condition.klass;
          const bar = k === "FIRE_RISK"
            ? "bg-danger"
            : k === "OVERLOAD"
            ? "bg-danger/70"
            : k === "FAN_FAILURE" || k === "OVERHEATING_RISK"
            ? "bg-warning"
            : "bg-success";
          return (
            <div key={k} className={`rounded-lg border bg-background/50 p-2 ${active ? "border-foreground/40" : "border-border/60"}`}>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{classLabel[k]}</div>
              <div className="mt-1 text-sm font-bold tabular-nums">{(v * 100).toFixed(0)}%</div>
              <div className="mt-1 h-1 w-full rounded-full bg-muted/40 overflow-hidden">
                <div className={`h-full ${bar} transition-[width] duration-500`} style={{ width: `${Math.max(2, v * 100)}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function LiveTimestamp({ ts }: { ts: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <span className="opacity-50">…</span>;
  const d = new Date(ts);
  return (
    <span>
      {d.toLocaleTimeString()} <span className="text-muted-foreground/70">· {d.toLocaleDateString()}</span>
    </span>
  );
}

function VoltagePanel({
  current, baseline, threshold, onCalibrate, latestAlert,
}: {
  current: ReturnType<typeof useSystem>["current"];
  baseline: number;
  threshold: number;
  onCalibrate: () => Promise<{ ok: boolean; voltage?: number; reason?: string }>;
  latestAlert: ReturnType<typeof useSystem>["latestAlert"];
}) {
  const [busy, setBusy] = useState(false);
  const sv = current.smokeVoltage;
  const fv = current.flameVoltage;
  const pct = current.smokePercentage;
  const detected = pct != null && pct > threshold;
  const flameState = fv == null ? "—" : fv <= 1 ? "Flame Detected" : fv >= 4 ? "No Flame" : "Uncertain";
  const flameTone: Status = fv == null ? "normal" : fv <= 1 ? "danger" : fv >= 4 ? "normal" : "warning";

  const handleCal = async () => {
    setBusy(true);
    try {
      const res = await onCalibrate();
      if (res.ok) toast.success(`Baseline saved: ${res.voltage?.toFixed(3)} V`);
      else toast.error(res.reason ?? "Calibration failed");
    } finally { setBusy(false); }
  };

  return (
      <section className="rounded-2xl border border-border bg-card/70 backdrop-blur p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
            <Gauge className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Voltage Pipeline</h2>
            <p className="text-xs text-muted-foreground">Raw analog readings from A0–A3, smoke baseline & calibration</p>
          </div>
        </div>
        <Button onClick={handleCal} disabled={busy} variant="outline" size="sm">
          <RefreshCcw className="h-4 w-4" />
          {busy ? "Calibrating…" : "Calibrate Smoke Baseline"}
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Smoke Voltage (A0)" value={sv == null ? "—" : `${sv.toFixed(3)} V`} icon={Zap} />
        <Stat label="Smoke Baseline" value={`${baseline.toFixed(3)} V`} icon={Gauge} hint="0% smoke reference" />
        <Stat
          label="Smoke %"
          value={pct == null ? "—" : `${pct.toFixed(1)}%`}
          tone={pct == null ? "normal" : pct >= 50 ? "danger" : detected ? "warning" : "normal"}
          hint={pct == null ? "Waiting for voltage stream" : detected ? "Smoke Detected" : "No Smoke"}
        />
        <Stat
          label="Flame Voltage (A3)"
          value={fv == null ? "—" : `${fv.toFixed(2)} V`}
          tone={flameTone}
          hint={flameState}
        />
        <Stat label="Indoor Temp Voltage (A1)" value={current.indoorTempVoltage == null ? "—" : `${current.indoorTempVoltage.toFixed(3)} V`} />
        <Stat label="Outdoor Temp Voltage (A2)" value={current.outdoorTempVoltage == null ? "—" : `${current.outdoorTempVoltage.toFixed(3)} V`} />
        <StatLive label="Last Updated" ts={current.ts} />
        <Stat
          label="Latest Alert"
          value={latestAlert ? latestAlert.alertType.toUpperCase() : "None"}
          tone={latestAlert ? (latestAlert.severity === "danger" ? "danger" : latestAlert.severity === "warning" ? "warning" : "normal") : "normal"}
          hint={latestAlert ? latestAlert.alertMessage : "No alerts logged yet"}
        />
      </div>
    </section>
  );
}

function StatLive({ label, ts }: { label: string; ts: number }) {
  return (
    <div className="rounded-xl border border-border text-foreground bg-background/40 p-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums">
        <LiveTimestamp ts={ts} />
      </div>
    </div>
  );
}

function Stat({
  label, value, hint, tone = "normal", icon: Icon,
}: {
  label: string; value: string; hint?: string; tone?: Status; icon?: typeof Bell;
}) {
  const tones: Record<Status, string> = {
    normal: "border-border text-foreground",
    warning: "border-warning/40 text-warning",
    danger: "border-danger/50 text-danger",
  };
  return (
    <div className={`rounded-xl border ${tones[tone]} bg-background/40 p-3`}>
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2">{hint}</div>}
    </div>
  );
}

function DeviceTile({ icon: Icon, label, on, danger, detail }: { icon: typeof Bell; label: string; on: boolean; danger?: boolean; detail?: string }) {
  return (
    <div className={`rounded-2xl border p-5 flex items-center justify-between bg-card/70 backdrop-blur ${on ? (danger ? "border-danger/50" : "border-primary/40") : "border-border"}`}>
      <div className="flex items-center gap-3">
        <div className={`h-11 w-11 rounded-xl flex items-center justify-center ${on ? (danger ? "bg-danger/20 text-danger" : "bg-primary/20 text-primary") : "bg-muted/50 text-muted-foreground"}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="font-semibold">{label}</div>
          <div className="text-xs text-muted-foreground">{detail ?? (on ? "Currently active" : "Idle")}</div>
        </div>
      </div>
      <span className={`text-xs font-bold tracking-widest px-2.5 py-1 rounded-full ${on ? (danger ? "bg-danger/20 text-danger" : "bg-success/20 text-success") : "bg-muted/50 text-muted-foreground"}`}>
        {detail && on ? detail : (on ? "ON" : "OFF")}
      </span>
    </div>
  );
}
