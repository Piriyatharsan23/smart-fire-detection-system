import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sendWhatsAppAlert } from "@/lib/whatsapp.functions";
import { sendTelegramAlert, broadcastTelegramAlert } from "@/lib/telegram.functions";

export type Status = "normal" | "warning" | "danger";

export interface Reading {
  ts: number;
  temp: number;
  tempOut: number | null;
  smoke: number;
  flame: 0 | 1;
  status: Status;
  smokeVoltage?: number | null;
  smokeBaseline?: number | null;
  smokePercentage?: number | null;
  indoorTempVoltage?: number | null;
  outdoorTempVoltage?: number | null;
  flameVoltage?: number | null;
  current?: number | null;        // Amps from current sensor
  fanSpeed?: number | null;       // Cooling fan operating percentage 0-100
  systemState?: 0 | 1 | 2 | 3 | 4 | 5;
  fireProbability?: number;       // 0..1 AI estimate
}

export interface Thresholds { temp: number; smoke: number; }

export interface SensorSettings {
  smokeBaselineVoltage: number;
  smokeTolerance: number;        // ±V for "stable"
  smokeMaxDrop: number;          // V drop = 100%
  smokeDetectionThreshold: number; // %
  temperatureScaleFactor: number;  // V per °C (10mV/°C => 0.01)
  fanAutoMode: boolean;
  ratedCurrent: number;          // Amps
  currentWarningPct: number;     // % of rated → warning
  currentCriticalPct: number;    // % of rated → critical
  tempDeltaWarning: number;      // ΔT (indoor-outdoor) °C threshold
}

export interface AlertRow {
  id: number;
  ts: number;
  alertType: string;
  alertMessage: string;
  severity: "info" | "warning" | "danger";
  sensorValue: number | null;
  status: string;
}
export interface DeviceState { buzzer: boolean; fan: boolean; suppression: boolean; }

export interface DeviceFaultDetail {
  key: keyof DeviceState;
  label: string;
  expected: boolean;
  actual: boolean;
}

export interface DeviceFault {
  active: boolean;
  message: string;
  details: DeviceFaultDetail[];
  expected: DeviceState;
  actual: DeviceState;
}

export type AutomationMode = "manual" | "auto" | "ml";

export interface AlertSettings {
  whatsappTo: string;
  whatsappFrom: string;
  telegramChatId: string;
  enabled: boolean;
  cooldownSeconds: number;
}

export interface BrowserNotifySettings {
  enabled: boolean;
  sound: boolean;
  cooldownSeconds: number;
}

export interface Prediction {
  tempNext: number;
  smokeNext: number;
  tempOutNext: number | null;
  tempDelta: number;
  flameRisk: number; // 0..1
  fan: boolean;
  buzzer: boolean;
  suppression: boolean;
  confidence: number; // 0..1
  horizonSec: number;
}

export interface PredictionPoint {
  madeAt: number;     // when prediction was generated
  targetTs: number;   // madeAt + horizonSec*1000
  predTemp: number;
  predSmoke: number;
  horizonSec: number;
}

export interface FireRiskModel {
  version: 1;
  trainedAt: number;
  samples: number;
  positives: number;
  weights: number[];
  bias: number;
  loss: number;
  accuracy?: number;
  precision?: number;
  recall?: number;
}

export type ConditionClass =
  | "NORMAL"
  | "OVERHEATING_RISK"
  | "FAN_FAILURE"
  | "OVERLOAD"
  | "FIRE_RISK";

export interface ConditionPrediction {
  klass: ConditionClass;
  label: string;
  severity: Status;
  confidence: number; // 0..1
  reason: string;
  scores: Record<ConditionClass, number>;
  recommendation: string;
}

/**
 * Multi-class on-device classifier inspired by the prototype spec:
 * NORMAL / OVERHEATING_RISK / FAN_FAILURE / OVERLOAD / FIRE_RISK.
 * Uses short-window slopes of indoor temperature and current plus the trained
 * fire-risk logistic model to score each class, then picks the strongest.
 */
export function classifyCondition(
  current: Reading,
  history: Reading[],
  cfg: SensorSettings,
  thresholds: Thresholds,
  fanOn: boolean,
): ConditionPrediction {
  const window = [...history.slice(-8), current];
  const temps = window.map((r) => r.temp);
  const currents = window.map((r) => r.current ?? 0);
  const tempSlope = slopePerSample(temps);      // °C per sample
  const currentSlope = slopePerSample(currents); // A per sample

  const rated = cfg.ratedCurrent || 10;
  const amps = current.current ?? 0;
  const currentPct = (amps / rated) * 100;
  const tempHigh = current.temp >= thresholds.temp;
  const tempCritical = current.temp >= thresholds.temp + 10;
  const smokePct = current.smokePercentage ?? Math.max(0, Math.min(100, current.smoke / 10));
  const fireProb = current.fireProbability ?? 0;

  // Per-class scores in [0..1]
  const sFire = clamp01(
    Math.max(
      fireProb,
      current.flame ? 1 : 0,
      smokePct >= 40 && tempHigh ? 0.85 : 0,
    ),
  );

  const sOverload = clamp01(
    Math.max(
      currentPct >= cfg.currentCriticalPct ? 0.95 : 0,
      currentPct >= cfg.currentWarningPct ? 0.75 : 0,
      currentSlope > 0.15 && currentPct >= cfg.currentWarningPct * 0.7 ? 0.7 : 0,
    ),
  );

  // Temperature climbing while current is also climbing → overheating risk.
  const sOverheat = clamp01(
    (tempSlope > 0.15 ? 0.5 : 0) +
      (currentSlope > 0.05 ? 0.25 : 0) +
      (tempHigh ? 0.25 : 0) +
      (tempCritical ? 0.2 : 0),
  );

  // Fan should be cooling but temperature still rising with current ~steady.
  const sFanFail = clamp01(
    (fanOn && tempSlope > 0.2 && Math.abs(currentSlope) < 0.05 ? 0.7 : 0) +
      (fanOn && tempHigh && tempSlope > 0.1 ? 0.3 : 0) +
      (current.fanSpeed != null && current.fanSpeed >= 60 && tempSlope > 0.15 ? 0.2 : 0),
  );

  const sNormal = clamp01(
    1 - Math.max(sFire, sOverload, sOverheat, sFanFail) - (tempHigh ? 0.2 : 0),
  );

  const scores: Record<ConditionClass, number> = {
    NORMAL: sNormal,
    OVERHEATING_RISK: sOverheat,
    FAN_FAILURE: sFanFail,
    OVERLOAD: sOverload,
    FIRE_RISK: sFire,
  };

  // Priority order resolves ties — safety-critical first.
  const order: ConditionClass[] = ["FIRE_RISK", "OVERLOAD", "FAN_FAILURE", "OVERHEATING_RISK", "NORMAL"];
  let klass: ConditionClass = "NORMAL";
  let best = scores.NORMAL;
  for (const k of order) {
    if (scores[k] > best + 0.001) { best = scores[k]; klass = k; }
  }
  if (klass === "NORMAL" && Math.max(sFire, sOverload, sOverheat, sFanFail) >= 0.5) {
    // fallback: pick the strongest non-normal when normal narrowly wins
    for (const k of order) {
      if (k !== "NORMAL" && scores[k] >= 0.5) { klass = k; best = scores[k]; break; }
    }
  }

  const meta: Record<ConditionClass, { label: string; severity: Status; reason: string; recommendation: string }> = {
    NORMAL: {
      label: "NORMAL",
      severity: "normal",
      reason: "Sensor pattern is stable. Current near idle, temperature within range.",
      recommendation: "Continue normal operation.",
    },
    OVERHEATING_RISK: {
      label: "OVERHEATING RISK",
      severity: "warning",
      reason: `Indoor temperature rising (${tempSlope.toFixed(2)} °C/sample) with current trending up (${currentSlope.toFixed(2)} A/sample).`,
      recommendation: "Increase fan speed and reduce load before threshold is reached.",
    },
    FAN_FAILURE: {
      label: "FAN FAILURE",
      severity: "warning",
      reason: `Temperature still climbing (${tempSlope.toFixed(2)} °C/sample) while current stays flat — cooling appears ineffective.`,
      recommendation: "Inspect cooling fan / airflow path. Consider shedding load.",
    },
    OVERLOAD: {
      label: "ELECTRICAL OVERLOAD",
      severity: currentPct >= cfg.currentCriticalPct ? "danger" : "warning",
      reason: `Load current ${amps.toFixed(2)} A is ${currentPct.toFixed(0)}% of rated ${rated} A.`,
      recommendation: "Shed non-essential loads or trip the breaker.",
    },
    FIRE_RISK: {
      label: "FIRE RISK",
      severity: "danger",
      reason: current.flame
        ? "Flame sensor triggered."
        : `AI fire probability ${(fireProb * 100).toFixed(0)}% with smoke ${smokePct.toFixed(0)}%.`,
      recommendation: "Fan OFF, buzzer ON, evacuate area and verify board.",
    },
  };

  const m = meta[klass];
  return {
    klass,
    label: m.label,
    severity: m.severity,
    confidence: Number(best.toFixed(3)),
    reason: m.reason,
    scores,
    recommendation: m.recommendation,
  };
}

function clamp01(n: number) { return Math.max(0, Math.min(1, n)); }

interface SystemContextValue {
  connected: boolean;
  setConnected: (v: boolean) => void;
  mock: boolean;
  setMock: (v: boolean) => void;
  current: Reading;
  history: Reading[];
  thresholds: Thresholds;
  setThresholds: (t: Thresholds) => Promise<void>;
  devices: DeviceState;
  setDevices: (d: Partial<DeviceState>) => Promise<void>;
  deviceFault: DeviceFault | null;
  log: string[];
  appendLog: (line: string, level?: string) => Promise<void>;
  sendCommand: (cmd: string) => Promise<void>;
  ingest: (line: string, source?: "serial" | "manual" | "mock") => Promise<void>;
  resetSystem: () => Promise<void>;
  startMock: () => void;
  stopMock: () => void;
  loading: boolean;
  registerSerialWriter: (fn: ((data: string) => Promise<void>) | null) => void;
  automationMode: AutomationMode;
  setAutomationMode: (m: AutomationMode) => void;
  prediction: Prediction | null;
  fireRiskModel: FireRiskModel | null;
  retrainFireModel: () => Promise<FireRiskModel | null>;
  condition: ConditionPrediction;
  horizonSec: number;
  setHorizonSec: (s: number) => void;
  predictionLog: PredictionPoint[];
  alertSettings: AlertSettings;
  saveAlertSettings: (s: AlertSettings) => Promise<void>;
  testAlert: () => Promise<void>;
  notifySettings: BrowserNotifySettings;
  setNotifySettings: (s: BrowserNotifySettings) => void;
  notifyPermission: NotificationPermission | "unsupported";
  requestNotifyPermission: () => Promise<NotificationPermission | "unsupported">;
  testBrowserNotification: () => Promise<void>;
  sensorSettings: SensorSettings;
  saveSensorSettings: (s: Partial<SensorSettings>) => Promise<void>;
  calibrateSmokeBaseline: () => Promise<{ ok: boolean; voltage?: number; reason?: string }>;
  latestAlert: AlertRow | null;
  alerts: AlertRow[];
}

const Ctx = createContext<SystemContextValue | null>(null);

function computeStatus(temp: number, smoke: number, flame: 0 | 1, t: Thresholds): Status {
  if (flame === 1) return "danger";
  if (smoke >= t.smoke) return "danger";
  if (temp >= t.temp) return "warning";
  return "normal";
}

/** Trend-based fire probability estimate (0..1) for State 2 (AI alert). */
function estimateFireProbability(
  recent: Reading[],
  current: { temp: number; current: number | null; smokePct: number; thresholds: Thresholds; cfg: SensorSettings },
  model?: FireRiskModel | null,
) {
  const temps = [...recent.map((r) => r.temp), current.temp];
  const currents = [...recent.map((r) => r.current ?? 0), current.current ?? 0];
  const tempSlope = slopePerSample(temps);
  const currentSlope = slopePerSample(currents);
  if (model) {
    return runFireRiskModel(model, [
      current.temp / Math.max(1, current.thresholds.temp),
      current.smokePct / 100,
      current.current == null ? 0 : current.current / Math.max(1, current.cfg.ratedCurrent),
      Math.max(0, tempSlope) / 5,
      Math.max(0, currentSlope) / 2,
      0,
      0,
    ]);
  }
  const tempProx = Math.max(0, current.temp / current.thresholds.temp);
  const currentProx = current.current == null ? 0 : (current.current / current.cfg.ratedCurrent) * (current.cfg.currentWarningPct / 100);
  const smokeProx = current.smokePct / 100;
  const z =
    -4 +
    2.5 * tempProx +
    2.0 * currentProx +
    3.0 * smokeProx +
    1.2 * Math.max(0, tempSlope) +
    0.8 * Math.max(0, currentSlope * 5);
  return 1 / (1 + Math.exp(-z));
}

function sigmoid(z: number) {
  return 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, z))));
}

function runFireRiskModel(model: FireRiskModel, features: number[]) {
  let z = model.bias;
  for (let i = 0; i < model.weights.length; i++) z += model.weights[i] * (features[i] ?? 0);
  return sigmoid(z);
}

function modelFeatures(readings: Reading[], index: number, thresholds: Thresholds, cfg: SensorSettings) {
  const r = readings[index];
  const start = Math.max(0, index - 5);
  const window = readings.slice(start, index + 1);
  const smokePct = r.smokePercentage ?? Math.max(0, Math.min(100, r.smoke / 10));
  const current = r.current ?? 0;
  const delta = r.tempOut == null ? 0 : r.temp - r.tempOut;
  return [
    r.temp / Math.max(1, thresholds.temp),
    smokePct / 100,
    current / Math.max(1, cfg.ratedCurrent),
    Math.max(0, slopePerSample(window.map((x) => x.temp))) / 5,
    Math.max(0, slopePerSample(window.map((x) => x.current ?? 0))) / 2,
    Math.max(0, delta) / Math.max(1, cfg.tempDeltaWarning),
    r.flame,
  ];
}

function labelReading(r: Reading) {
  if (r.flame === 1 || r.status === "danger" || (r.systemState ?? 0) >= 2) return 1;
  return 0;
}

function trainFireRiskModel(readings: Reading[], thresholds: Thresholds, cfg: SensorSettings): FireRiskModel | null {
  const ordered = readings
    .filter((r) => Number.isFinite(r.temp) && Number.isFinite(r.smoke))
    .sort((a, b) => a.ts - b.ts);

  const examples = ordered.map((_, i) => ({
    x: modelFeatures(ordered, i, thresholds, cfg),
    y: labelReading(ordered[i]),
  }));

  // ---------------- Synthetic training set ----------------
  // Features (must match modelFeatures order):
  // [tempNorm, smokeFrac, currentNorm, tempSlopeNorm, currentSlopeNorm, deltaNorm, flame]
  //
  // Goal: teach the model the user-described pattern — indoor temperature
  // creeping up while outdoor is stable (ΔT rising) AND current trending up
  // → high fire risk, even before smoke/flame fire.
  const synthetic: { x: number[]; y: 0 | 1 }[] = [];
  const rnd = mulberry32(0xC0FFEE);
  const jitter = (s: number) => (rnd() - 0.5) * 2 * s;

  // Negative class: stable / cool / idle / mild load
  for (let i = 0; i < 600; i++) {
    const tempNorm = 0.4 + rnd() * 0.45;            // 40–85% of threshold
    const smokeFrac = Math.max(0, rnd() * 0.15);    // <15%
    const currentNorm = rnd() * 0.55;               // <55% rated
    const tempSlope = Math.max(0, jitter(0.05));    // ~flat
    const currentSlope = Math.max(0, jitter(0.05));
    const deltaNorm = Math.max(0, rnd() * 0.35);    // small ΔT
    synthetic.push({ x: [tempNorm, smokeFrac, currentNorm, tempSlope, currentSlope, deltaNorm, 0], y: 0 });
  }

  // Negative: warm room but no upward trend (hot day, AC, etc.)
  for (let i = 0; i < 200; i++) {
    synthetic.push({
      x: [0.85 + rnd() * 0.15, rnd() * 0.1, 0.3 + rnd() * 0.3, Math.max(0, jitter(0.05)), Math.max(0, jitter(0.05)), rnd() * 0.4, 0],
      y: 0,
    });
  }

  // Positive class A — early fire signature (user's scenario):
  // indoor slowly increasing, ΔT growing, current trending up, smoke still low.
  for (let i = 0; i < 500; i++) {
    const tempNorm = 0.75 + rnd() * 0.35;           // 75–110%
    const smokeFrac = rnd() * 0.25;                 // smoke not yet
    const currentNorm = 0.55 + rnd() * 0.45;        // rising load
    const tempSlope = 0.25 + rnd() * 0.75;          // clearly upward
    const currentSlope = 0.25 + rnd() * 0.75;       // clearly upward
    const deltaNorm = 0.6 + rnd() * 0.6;            // ΔT > warning
    synthetic.push({ x: [tempNorm, smokeFrac, currentNorm, tempSlope, currentSlope, deltaNorm, 0], y: 1 });
  }

  // Positive class B — smoke / overheat
  for (let i = 0; i < 300; i++) {
    synthetic.push({
      x: [0.9 + rnd() * 0.3, 0.35 + rnd() * 0.6, 0.5 + rnd() * 0.5, rnd() * 0.4, rnd() * 0.4, 0.3 + rnd() * 0.7, 0],
      y: 1,
    });
  }

  // Positive class C — flame detected (must always be high risk)
  for (let i = 0; i < 200; i++) {
    synthetic.push({
      x: [0.6 + rnd() * 0.6, rnd() * 0.6, rnd() * 0.8, rnd() * 0.4, rnd() * 0.4, rnd() * 0.8, 1],
      y: 1,
    });
  }

  // Mix observed data (weighted heavier so real device drives the model)
  for (const e of examples) for (let k = 0; k < 3; k++) synthetic.push(e as { x: number[]; y: 0 | 1 });

  // Shuffle then split 80/20
  for (let i = synthetic.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [synthetic[i], synthetic[j]] = [synthetic[j], synthetic[i]];
  }
  const splitAt = Math.floor(synthetic.length * 0.8);
  const train = synthetic.slice(0, splitAt);
  const test = synthetic.slice(splitAt);

  const positives = synthetic.filter((e) => e.y === 1).length;
  const negatives = synthetic.length - positives;
  if (train.length < 20 || positives === 0 || negatives === 0) return null;

  // ---------------- Train (logistic regression + momentum) ----------------
  const dim = train[0].x.length;
  const weights = Array(dim).fill(0);
  const velocity = Array(dim).fill(0);
  let bias = 0;
  let biasVel = 0;
  const lr = 0.25;
  const momentum = 0.9;
  const lambda = 0.0015;
  let loss = 0;

  for (let epoch = 0; epoch < 1500; epoch++) {
    const grad = Array(dim).fill(0);
    let biasGrad = 0;
    loss = 0;
    for (const e of train) {
      let z = bias;
      for (let i = 0; i < dim; i++) z += weights[i] * e.x[i];
      const p = sigmoid(z);
      const err = p - e.y;
      biasGrad += err;
      for (let i = 0; i < dim; i++) grad[i] += err * e.x[i];
      loss += -(e.y * Math.log(p + 1e-9) + (1 - e.y) * Math.log(1 - p + 1e-9));
    }
    const n = train.length;
    biasVel = momentum * biasVel - lr * (biasGrad / n);
    bias += biasVel;
    for (let i = 0; i < dim; i++) {
      velocity[i] = momentum * velocity[i] - lr * (grad[i] / n + lambda * weights[i]);
      weights[i] += velocity[i];
    }
  }

  // ---------------- Evaluate ----------------
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const e of test) {
    let z = bias;
    for (let i = 0; i < dim; i++) z += weights[i] * e.x[i];
    const pred = sigmoid(z) >= 0.5 ? 1 : 0;
    if (pred === 1 && e.y === 1) tp++;
    else if (pred === 1 && e.y === 0) fp++;
    else if (pred === 0 && e.y === 0) tn++;
    else fn++;
  }
  const accuracy = test.length ? (tp + tn) / test.length : 0;
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;

  return {
    version: 1,
    trainedAt: Date.now(),
    samples: synthetic.length,
    positives,
    weights: weights.map((w) => Number(w.toFixed(6))),
    bias: Number(bias.toFixed(6)),
    loss: Number((loss / train.length).toFixed(6)),
    accuracy: Number(accuracy.toFixed(4)),
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
  };
}

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function slopePerSample(ys: number[]) {
  const n = ys.length;
  if (n < 2) return 0;
  const xs = ys.map((_, i) => i);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den === 0 ? 0 : num / den;
}

/** Build a beautifully formatted multi-line message describing all sensors. */
function formatSensorReport(title: string, r: Reading | null): string {
  const fmtNum = (n: number | null | undefined, digits = 1, suffix = "") =>
    n == null || Number.isNaN(n) ? "—" : `${n.toFixed(digits)}${suffix}`;
  if (!r) return `${title}\n(no sensor data yet)`;
  const delta = r.tempOut == null ? null : r.temp - r.tempOut;
  const smokeDetected = r.smokePercentage == null && (r.smoke === 0 || r.smoke === 1)
    ? r.smoke === 1
    : (r.smokePercentage ?? r.smoke / 10) >= 10;
  const smokeLabel = smokeDetected ? "DETECTED" : "clear";
  const lines = [
    title,
    "━━━━━━━━━━━━━━━━━━━━",
    `🌡 Indoor Temp : ${fmtNum(r.temp, 1, "°C")}`,
    `🌤 Outdoor Temp: ${fmtNum(r.tempOut, 1, "°C")}`,
    `📏 ΔT (in-out) : ${fmtNum(delta, 1, "°C")}`,
    `Smoke       : ${smokeLabel}`,
    `🔥 Flame       : ${r.flame ? "DETECTED ⚠️" : "clear"}${r.flameVoltage == null ? "" : ` (${fmtNum(r.flameVoltage, 2, " V")})`}`,
    `⚡ Current     : ${fmtNum(r.current, 2, " A")}`,
    `🤖 AI Fire Risk: ${fmtNum((r.fireProbability ?? 0) * 100, 0, "%")}`,
    `🛡 System State: ${r.systemState ?? "—"} (${r.status.toUpperCase()})`,
    `🕒 ${new Date(r.ts).toLocaleString()}`,
  ];
  return lines.join("\n");
}

/**
 * Map sensor inputs onto the 6-state safety machine (State 0..5).
 * Returns the state index, recommended device outputs, status colour and a label.
 */
function decideSafetyState(opts: {
  flame: 0 | 1;
  smokeDetected: boolean;
  smokePercentage: number;
  indoorTemp: number;
  outdoorTemp: number | null;
  currentAmps: number | null;
  fireProbability: number;
  cfg: SensorSettings;
  thresholds: Thresholds;
}): { state: 0 | 1 | 2 | 3 | 4 | 5; devices: DeviceState; status: Status; label: string } {
  const { flame, smokeDetected, smokePercentage, indoorTemp, outdoorTemp, currentAmps, fireProbability, cfg, thresholds } = opts;
  const rated = cfg.ratedCurrent || 10;
  const currentPct = currentAmps == null ? 0 : (currentAmps / rated) * 100;
  const currentHigh = currentPct >= cfg.currentWarningPct;
  const currentCritical = currentPct >= cfg.currentCriticalPct;
  const tempHigh = indoorTemp >= thresholds.temp;
  const tempCritical = indoorTemp >= thresholds.temp + 15;
  const deltaHigh = outdoorTemp != null && (indoorTemp - outdoorTemp) > cfg.tempDeltaWarning;

  // STATE 5 — Fire confirmed
  if (flame === 1 || (smokeDetected && tempCritical && currentCritical)) {
    return { state: 5, devices: { buzzer: true, fan: false, suppression: true }, status: "danger", label: "FIRE CONFIRMED" };
  }
  // STATE 4 — Fire risk confirmed
  if (smokeDetected && (tempHigh || currentHigh)) {
    return { state: 4, devices: { buzzer: true, fan: false, suppression: false }, status: "danger", label: "HIGH FIRE RISK — Suppression armed" };
  }
  // STATE 3 — Smoke only
  if (smokeDetected) {
    return { state: 3, devices: { buzzer: true, fan: false, suppression: false }, status: "danger", label: "SMOKE DETECTED" };
  }
  // STATE 2 — AI prediction alert
  if (fireProbability >= 0.75) {
    return { state: 2, devices: { buzzer: true, fan: true, suppression: false }, status: "warning", label: `AI ALERT — Fire risk ${(fireProbability * 100).toFixed(0)}%` };
  }
  // STATE 1 — Early warning
  if (tempHigh || currentHigh || deltaHigh) {
    return { state: 1, devices: { buzzer: false, fan: true, suppression: false }, status: "warning", label: "WARNING — Elevated conditions" };
  }
  // STATE 0 — Normal
  return { state: 0, devices: { buzzer: false, fan: false, suppression: false }, status: "normal", label: "NORMAL" };
}

function compareDeviceState(expected: DeviceState, actual: DeviceState): DeviceFault {
  const details: DeviceFaultDetail[] = ([
    { key: "fan", label: "fan", expected: expected.fan, actual: actual.fan },
    { key: "buzzer", label: "buzzer", expected: expected.buzzer, actual: actual.buzzer },
    { key: "suppression", label: "fire suppression", expected: expected.suppression, actual: actual.suppression },
  ] as DeviceFaultDetail[]).filter((item) => item.expected !== item.actual);

  return {
    active: details.length > 0,
    message: details.length
      ? `LabVIEW actuator state differs from auto logic: ${details.map((d) => `${d.label} expected ${d.expected ? "ON" : "OFF"} but was ${d.actual ? "ON" : "OFF"}`).join(", ")}`
      : "",
    details,
    expected,
    actual,
  };
}

export function SystemProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [mock, setMock] = useState(false);
  const [thresholds, setThresholdsState] = useState<Thresholds>({ temp: 50, smoke: 400 });
  const [current, setCurrent] = useState<Reading>({ ts: Date.now(), temp: 0, tempOut: null, smoke: 0, flame: 0, status: "normal" });
  const [history, setHistory] = useState<Reading[]>([]);
  const [devices, setDevicesState] = useState<DeviceState>({ buzzer: false, fan: false, suppression: false });
  const [log, setLog] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [automationMode, setAutomationModeState] = useState<AutomationMode>("auto");
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [fireRiskModel, setFireRiskModel] = useState<FireRiskModel | null>(null);
  const [horizonSec, setHorizonSecState] = useState<number>(10);
  const [predictionLog, setPredictionLog] = useState<PredictionPoint[]>([]);
  const [alertSettings, setAlertSettings] = useState<AlertSettings>({
    whatsappTo: "", whatsappFrom: "", telegramChatId: "", enabled: true, cooldownSeconds: 120,
  });
  const [sensorSettings, setSensorSettings] = useState<SensorSettings>({
    smokeBaselineVoltage: 4.8,
    smokeTolerance: 0.05,
    smokeMaxDrop: 0.5,
    smokeDetectionThreshold: 10,
    temperatureScaleFactor: 0.01,
    fanAutoMode: true,
    ratedCurrent: 10,
    currentWarningPct: 80,
    currentCriticalPct: 100,
    tempDeltaWarning: 15,
  });
  const sensorSettingsRef = useRef(sensorSettings);
  useEffect(() => { sensorSettingsRef.current = sensorSettings; }, [sensorSettings]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const latestAlert = alerts[0] ?? null;
  // Rolling buffer of recent smoke voltages used for auto-baseline + calibration
  const smokeVoltBufRef = useRef<number[]>([]);
  const lastBaselineSaveRef = useRef<number>(0);
  const alertSettingsRef = useRef(alertSettings);
  useEffect(() => { alertSettingsRef.current = alertSettings; }, [alertSettings]);
  const lastAlertAtRef = useRef<number>(0);
  const lastAlertStatusRef = useRef<Status>("normal");
  const [notifySettings, setNotifySettingsState] = useState<BrowserNotifySettings>({
    enabled: true, sound: true, cooldownSeconds: 20,
  });
  const notifySettingsRef = useRef(notifySettings);
  useEffect(() => { notifySettingsRef.current = notifySettings; }, [notifySettings]);
  const lastNotifyAtRef = useRef<number>(0);
  const lastNotifyStatusRef = useRef<Status>("normal");
  const [notifyPermission, setNotifyPermission] = useState<NotificationPermission | "unsupported">("default");
  const deviceFault = useMemo<DeviceFault | null>(() => {
    if (automationMode === "manual") return null;

    const decision = decideSafetyState({
      flame: current.flame,
      smokeDetected: current.smoke >= thresholds.smoke,
      smokePercentage: current.smokePercentage ?? Math.min(100, current.smoke / 10),
      indoorTemp: current.temp,
      outdoorTemp: current.tempOut,
      currentAmps: current.current ?? null,
      fireProbability: current.fireProbability ?? 0,
      cfg: sensorSettings,
      thresholds,
    });

    const expected: DeviceState = {
      ...decision.devices,
      fan: decision.devices.fan && (current.tempOut == null ? true : current.temp > current.tempOut),
    };

    const fault = compareDeviceState(expected, devices);
    return fault.active ? fault : null;
  }, [automationMode, current, thresholds, sensorSettings, devices]);
  const mockTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevDevicesRef = useRef<DeviceState | null>(null);
  const currentRef = useRef<Reading | null>(null);
  const lastGoodReadingRef = useRef<Reading | null>(null);
  const prevSystemStateRef = useRef<number | null>(null);
  const lastAiTelegramAtRef = useRef<number>(0);
  const sendTelegramNoticeRef = useRef<(title: string, reading: Reading | null) => Promise<void>>(
    async () => {},
  );
  const sendTelegramNotice = useCallback(
    (title: string, reading: Reading | null) => sendTelegramNoticeRef.current(title, reading),
    [],
  );
  const speak = useCallback((text: string) => {
    try {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1; u.pitch = 1; u.volume = 1; u.lang = "en-US";
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    const prev = prevDevicesRef.current;
    if (prev) {
      const phrases: string[] = [];
      const changes: string[] = [];
      if (devices.fan !== prev.fan) {
        phrases.push(`Cooling fan is ${devices.fan ? "on now" : "off"}`);
        changes.push(`🌀 Cooling Fan: ${devices.fan ? "ON" : "OFF"}`);
      }
      if (devices.buzzer !== prev.buzzer) {
        phrases.push(`Buzzer is ${devices.buzzer ? "on now" : "off"}`);
        changes.push(`🔔 Buzzer: ${devices.buzzer ? "ON" : "OFF"}`);
      }
      if (devices.suppression !== prev.suppression) {
        phrases.push(`Suppression is ${devices.suppression ? "on now" : "off"}`);
        changes.push(`🧯 Fire Suppression: ${devices.suppression ? "ON" : "OFF"}`);
      }
      if (phrases.length) speak(phrases.join(". "));
      if (changes.length) {
        const title = `⚙️ Device State Changed\n${changes.join("\n")}`;
        sendTelegramNotice(title, currentRef.current).catch(() => {});
      }
    }
    prevDevicesRef.current = devices;
  }, [devices, speak]);
  const thresholdsRef = useRef(thresholds);
  useEffect(() => { thresholdsRef.current = thresholds; }, [thresholds]);
  const devicesRef = useRef(devices);
  useEffect(() => { devicesRef.current = devices; }, [devices]);
  const historyRef = useRef<Reading[]>([]);
  useEffect(() => { historyRef.current = history; }, [history]);
  const modeRef = useRef(automationMode);
  useEffect(() => { modeRef.current = automationMode; }, [automationMode]);
  const horizonRef = useRef(horizonSec);
  useEffect(() => { horizonRef.current = horizonSec; }, [horizonSec]);
  const fireRiskModelRef = useRef<FireRiskModel | null>(null);
  useEffect(() => { fireRiskModelRef.current = fireRiskModel; }, [fireRiskModel]);

  // Load persisted mode
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem("sfds_mode");
    if (saved === "manual" || saved === "auto" || saved === "ml") setAutomationModeState(saved);
    const h = window.localStorage.getItem("sfds_horizon");
    if (h) {
      const n = parseInt(h, 10);
      if ([5, 10, 20, 30].includes(n)) setHorizonSecState(n);
    }
    const ns = window.localStorage.getItem("sfds_notify");
    if (ns) { try { setNotifySettingsState({ ...notifySettingsRef.current, ...JSON.parse(ns) }); } catch {} }
    const savedModel = window.localStorage.getItem("sfds_fire_risk_model");
    if (savedModel) {
      try {
        const parsed = JSON.parse(savedModel) as FireRiskModel;
        if (parsed.version === 1 && Array.isArray(parsed.weights)) setFireRiskModel(parsed);
      } catch {}
    }
    if (typeof Notification !== "undefined") setNotifyPermission(Notification.permission);
    else setNotifyPermission("unsupported");
  }, []);

  const setNotifySettings = useCallback((s: BrowserNotifySettings) => {
    setNotifySettingsState(s);
    if (typeof window !== "undefined") window.localStorage.setItem("sfds_notify", JSON.stringify(s));
  }, []);

  const requestNotifyPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return "unsupported" as const;
    const p = await Notification.requestPermission();
    setNotifyPermission(p);
    return p;
  }, []);

  const playBeep = useCallback((danger: boolean) => {
    try {
      const Ctor: typeof AudioContext | undefined =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      const beepAt = (when: number, freq: number, dur: number) => {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.type = "square"; o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, ctx.currentTime + when);
        g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + when + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + when + dur);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + when); o.stop(ctx.currentTime + when + dur + 0.02);
      };
      if (danger) { beepAt(0, 1100, 0.18); beepAt(0.22, 1100, 0.18); beepAt(0.44, 1100, 0.18); }
      else { beepAt(0, 760, 0.22); }
      setTimeout(() => ctx.close().catch(() => {}), 1200);
    } catch { /* ignore */ }
  }, []);

  const fireBrowserNotificationIfNeeded = useCallback((reading: Reading) => {
    if (typeof window === "undefined") return;
    const s = notifySettingsRef.current;
    if (!s.enabled) return;
    if (reading.status === "normal") { lastNotifyStatusRef.current = "normal"; return; }
    const now = Date.now();
    const escalated = reading.status === "danger" && lastNotifyStatusRef.current !== "danger";
    if (!escalated && now - lastNotifyAtRef.current < s.cooldownSeconds * 1000) return;
    lastNotifyAtRef.current = now;
    lastNotifyStatusRef.current = reading.status;

    const title = reading.status === "danger" ? "🔥 SFDS — FIRE DANGER" : "⚠️ SFDS — Warning";
    const body =
      `Indoor ${reading.temp.toFixed(1)}°C` +
      (reading.tempOut == null ? "" : ` · Outdoor ${reading.tempOut.toFixed(1)}°C`) +
      ` · Smoke ${reading.smoke}ppm` +
      (reading.flame ? " · FLAME" : "");

    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        const n = new Notification(title, { body, tag: "sfds-alert", renotify: true } as NotificationOptions);
        n.onclick = () => { window.focus(); n.close(); };
      } catch { /* ignore */ }
    }
    if (s.sound) playBeep(reading.status === "danger");
  }, [playBeep]);
  const setAutomationMode = useCallback((m: AutomationMode) => {
    setAutomationModeState(m);
    if (typeof window !== "undefined") window.localStorage.setItem("sfds_mode", m);
  }, []);
  const setHorizonSec = useCallback((s: number) => {
    setHorizonSecState(s);
    if (typeof window !== "undefined") window.localStorage.setItem("sfds_horizon", String(s));
  }, []);
  const serialWriterRef = useRef<((data: string) => Promise<void>) | null>(null);
  const registerSerialWriter = useCallback((fn: ((data: string) => Promise<void>) | null) => {
    serialWriterRef.current = fn;
  }, []);
  const suppressionLockedRef = useRef(false);

  const setSuppressionLocked = useCallback((locked: boolean) => {
    suppressionLockedRef.current = locked;
  }, []);

  const ingestReading = useCallback((reading: Reading, source: "initial" | "realtime") => {
    if (suppressionLockedRef.current) return;
    setCurrent(reading);
    if (source === "realtime") {
      setHistory((h) => [...h, reading].slice(-500));
    }
  }, []);

  // Initial load + realtime subscriptions
  useEffect(() => {
    let mounted = true;
    (async () => {
      const [tRes, dRes, rRes, lRes] = await Promise.all([
        supabase.from("thresholds").select("*").eq("id", 1).maybeSingle(),
        supabase.from("device_state").select("*").eq("id", 1).maybeSingle(),
        supabase
          .from("sensor_readings")
          .select("*")
          .order("ts", { ascending: false })
          .order("id", { ascending: false })
          .limit(200),
        supabase.from("connection_log").select("*").order("ts", { ascending: false }).limit(100),
      ]);
      if (!mounted) return;
      if (tRes.data) setThresholdsState({ temp: tRes.data.temp, smoke: tRes.data.smoke });
      if (tRes.data) {
        const t: any = tRes.data;
        setSensorSettings({
          smokeBaselineVoltage: Number(t.smoke_baseline_voltage ?? 4.8),
          smokeTolerance: Number(t.smoke_tolerance ?? 0.05),
          smokeMaxDrop: Number(t.smoke_max_drop ?? 0.5),
          smokeDetectionThreshold: Number(t.smoke_detection_threshold ?? 10),
          temperatureScaleFactor: Number(t.temperature_scale_factor ?? 0.01),
          fanAutoMode: t.fan_auto_mode ?? true,
          ratedCurrent: Number(t.rated_current ?? 10),
          currentWarningPct: Number(t.current_warning_pct ?? 80),
          currentCriticalPct: Number(t.current_critical_pct ?? 100),
          tempDeltaWarning: Number(t.temp_delta_warning ?? 15),
        });
      }
      const suppressionActive = Boolean(dRes.data?.suppression);
      if (dRes.data) setDevicesState({ buzzer: dRes.data.buzzer, fan: dRes.data.fan, suppression: dRes.data.suppression });
      setSuppressionLocked(suppressionActive);
      if (rRes.data) {
        const rows = rRes.data.map((r: any) => ({
          ts: new Date(r.ts).getTime(),
          temp: Number(r.temp),
          tempOut: r.temp_out == null ? null : Number(r.temp_out),
          smoke: r.smoke, flame: (r.flame ? 1 : 0) as 0 | 1,
          status: r.status as Status,
          smokeVoltage: r.smoke_voltage == null ? null : Number(r.smoke_voltage),
          smokeBaseline: r.smoke_baseline == null ? null : Number(r.smoke_baseline),
          smokePercentage: r.smoke_percentage == null ? null : Number(r.smoke_percentage),
          indoorTempVoltage: r.indoor_temp_voltage == null ? null : Number(r.indoor_temp_voltage),
          outdoorTempVoltage: r.outdoor_temp_voltage == null ? null : Number(r.outdoor_temp_voltage),
          flameVoltage: r.flame_voltage == null ? null : Number(r.flame_voltage),
          fanSpeed: r.fan_speed == null ? null : Number(r.fan_speed),
          current: r.current_amps == null ? null : Number(r.current_amps),
          systemState: r.system_state == null ? undefined : (Number(r.system_state) as 0 | 1 | 2 | 3 | 4 | 5),
        })).reverse();
        if (!suppressionActive) {
          setHistory(rows);
          if (rows.length) setCurrent(rows[rows.length - 1]);
        }
      }
      if (lRes.data) setLog(lRes.data.map((l: any) => `[${new Date(l.ts).toLocaleTimeString()}] ${l.message}`));
      const alertsRes = await supabase.from("alerts" as any).select("*").order("ts", { ascending: false }).limit(50);
      if (alertsRes.data) {
        setAlerts((alertsRes.data as any[]).map((r) => ({
          id: r.id, ts: new Date(r.ts).getTime(),
          alertType: r.alert_type, alertMessage: r.alert_message,
          severity: r.severity, sensorValue: r.sensor_value, status: r.status,
        })));
      }
      const aRes = await supabase.from("alert_settings" as any).select("*").eq("id", 1).maybeSingle();
      if (aRes.data) {
        const r: any = aRes.data;
        setAlertSettings({
          whatsappTo: r.whatsapp_to ?? "",
          whatsappFrom: r.whatsapp_from ?? "",
          telegramChatId: r.telegram_chat_id ?? "",
          enabled: !!r.enabled,
          cooldownSeconds: r.cooldown_seconds ?? 120,
        });
        if (r.last_alert_at) lastAlertAtRef.current = new Date(r.last_alert_at).getTime();
        if (r.last_alert_status) lastAlertStatusRef.current = r.last_alert_status as Status;
      }
      setLoading(false);
    })();

    const ch = supabase
      .channel("sfds-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "sensor_readings" }, (p) => {
        const r: any = p.new;
        const reading: Reading = {
          ts: new Date(r.ts).getTime(),
          temp: Number(r.temp),
          tempOut: r.temp_out == null ? null : Number(r.temp_out),
          smoke: r.smoke, flame: (r.flame ? 1 : 0) as 0 | 1,
          status: r.status as Status,
          smokeVoltage: r.smoke_voltage == null ? null : Number(r.smoke_voltage),
          smokeBaseline: r.smoke_baseline == null ? null : Number(r.smoke_baseline),
          smokePercentage: r.smoke_percentage == null ? null : Number(r.smoke_percentage),
          indoorTempVoltage: r.indoor_temp_voltage == null ? null : Number(r.indoor_temp_voltage),
          outdoorTempVoltage: r.outdoor_temp_voltage == null ? null : Number(r.outdoor_temp_voltage),
          flameVoltage: r.flame_voltage == null ? null : Number(r.flame_voltage),
          current: r.current_amps == null ? null : Number(r.current_amps),
          fanSpeed: r.fan_speed == null ? null : Number(r.fan_speed),
          systemState: r.system_state == null ? undefined : (Number(r.system_state) as 0 | 1 | 2 | 3 | 4 | 5),
        };
        ingestReading(reading, "realtime");
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "device_state" }, (p) => {
        const r: any = p.new;
        setDevicesState({ buzzer: r.buzzer, fan: r.fan, suppression: r.suppression });
        setSuppressionLocked(Boolean(r.suppression));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "thresholds" }, (p) => {
        const r: any = p.new;
        setThresholdsState({ temp: r.temp, smoke: r.smoke });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "connection_log" }, (p) => {
        const r: any = p.new;
        setLog((l) => [`[${new Date(r.ts).toLocaleTimeString()}] ${r.message}`, ...l].slice(0, 200));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "alerts" }, (p) => {
        const r: any = p.new;
        setAlerts((a) => [{
          id: r.id, ts: new Date(r.ts).getTime(),
          alertType: r.alert_type, alertMessage: r.alert_message,
          severity: r.severity, sensorValue: r.sensor_value, status: r.status,
        }, ...a].slice(0, 50));
      })
      .subscribe();

    return () => { mounted = false; supabase.removeChannel(ch); };
  }, []);

  const appendLog = useCallback(async (line: string, level = "info") => {
    await supabase.from("connection_log").insert({ message: line, level });
  }, []);

  const retrainFireModel = useCallback(async () => {
    const model = trainFireRiskModel(historyRef.current, thresholdsRef.current, sensorSettingsRef.current);
    if (!model) {
      await appendLog("ML training skipped: not enough usable sensor history", "error");
      return null;
    }
    setFireRiskModel(model);
    fireRiskModelRef.current = model;
    if (typeof window !== "undefined") {
      window.localStorage.setItem("sfds_fire_risk_model", JSON.stringify(model));
    }
    await appendLog(`ML fire-risk model trained on ${model.samples} samples (${model.positives} risk)`, "info");
    return model;
  }, [appendLog]);

  useEffect(() => {
    if (history.length < 5) return;
    const model = trainFireRiskModel(history, thresholds, sensorSettings);
    if (!model) return;
    setFireRiskModel(model);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("sfds_fire_risk_model", JSON.stringify(model));
    }
  }, [history, thresholds, sensorSettings]);

  // Track latest reading + send AI-prediction Telegram notice on transition into State 2.
  useEffect(() => {
    currentRef.current = current;
    // Merge latest reading into last-known-good so Telegram notices always
    // show the most recent non-null value for each sensor field, even if the
    // triggering reading is missing something.
    const prevGood = lastGoodReadingRef.current;
    const mergeField = <K extends keyof Reading>(key: K): Reading[K] => {
      const v = current[key];
      if (v === null || v === undefined || (typeof v === "number" && Number.isNaN(v))) {
        return (prevGood ? prevGood[key] : v) as Reading[K];
      }
      return v;
    };
    lastGoodReadingRef.current = {
      ...(prevGood ?? current),
      ...current,
      ts: current.ts,
      temp: mergeField("temp") as number,
      tempOut: mergeField("tempOut") as number | null,
      smoke: mergeField("smoke") as number,
      flame: mergeField("flame") as 0 | 1,
      smokeVoltage: mergeField("smokeVoltage"),
      smokeBaseline: mergeField("smokeBaseline"),
      smokePercentage: mergeField("smokePercentage"),
      indoorTempVoltage: mergeField("indoorTempVoltage"),
      outdoorTempVoltage: mergeField("outdoorTempVoltage"),
      flameVoltage: mergeField("flameVoltage"),
      current: mergeField("current"),
      fanSpeed: mergeField("fanSpeed"),
      systemState: mergeField("systemState"),
      fireProbability: mergeField("fireProbability"),
    };
    const prevState = prevSystemStateRef.current;
    const newState = current.systemState;
    if (newState != null && newState !== prevState) {
      const now = Date.now();
      if (newState === 2 && now - lastAiTelegramAtRef.current > 60_000) {
        lastAiTelegramAtRef.current = now;
        const risk = ((current.fireProbability ?? 0) * 100).toFixed(0);
        sendTelegramNotice(`🤖 AI FIRE-RISK ALERT — ${risk}%`, current).catch(() => {});
      }
      prevSystemStateRef.current = newState;
    }
  }, [current, sendTelegramNotice]);

  // Bind the Telegram notice helper now that appendLog exists.
  useEffect(() => {
    sendTelegramNoticeRef.current = async (title: string, reading: Reading | null) => {
      const s = alertSettingsRef.current;
      if (!s.enabled) return;
      // Fill any missing fields on the triggering reading with the last known
      // good sensor values so notices never show "—" for stale sensors.
      const good = lastGoodReadingRef.current;
      const merged: Reading | null = reading
        ? {
            ...(good ?? reading),
            ...Object.fromEntries(
              Object.entries(reading).filter(([, v]) => v !== null && v !== undefined),
            ),
          } as Reading
        : good;
      const body = formatSensorReport(title, merged);
      try {
        const res = await broadcastTelegramAlert({ data: { body } });
        await appendLog(`Telegram notice broadcast to ${res.sent}/${res.total}: ${title.split("\n")[0]}`, "info");
        if (s.telegramChatId && res.total === 0) {
          await sendTelegramAlert({ data: { chatId: s.telegramChatId, body } });
        }
      } catch (e: any) {
        await appendLog(`Telegram notice failed: ${e?.message ?? e}`, "error");
      }
    };
  }, [appendLog]);

  const saveAlertSettings = useCallback(async (s: AlertSettings) => {
    setAlertSettings(s);
    await supabase.from("alert_settings" as any).update({
      whatsapp_to: s.whatsappTo || null,
      whatsapp_from: s.whatsappFrom || null,
      telegram_chat_id: s.telegramChatId || null,
      enabled: s.enabled,
      cooldown_seconds: s.cooldownSeconds,
      updated_at: new Date().toISOString(),
    }).eq("id", 1);
  }, []);

  const fireWhatsAppIfNeeded = useCallback(async (reading: Reading) => {
    const s = alertSettingsRef.current;
    if (!s.enabled) return;
    const hasTelegram = !!s.telegramChatId;
    const hasWhatsApp = !!(s.whatsappTo && s.whatsappFrom);
    if (!hasTelegram && !hasWhatsApp) return;
    if (reading.status === "normal") { lastAlertStatusRef.current = "normal"; return; }
    const now = Date.now();
    const cooldownMs = s.cooldownSeconds * 1000;
    const escalated = reading.status === "danger" && lastAlertStatusRef.current !== "danger";
    if (!escalated && now - lastAlertAtRef.current < cooldownMs) return;

    const tag = reading.status === "danger" ? "🔥 FIRE DANGER" : "⚠️ Warning";
    const body =
      `${tag} — SFDS Alert\n` +
      `Indoor: ${reading.temp.toFixed(1)}°C` +
      (reading.tempOut == null ? "" : ` · Outdoor: ${reading.tempOut.toFixed(1)}°C`) + "\n" +
      `Smoke: ${reading.smoke} ppm · Flame: ${reading.flame ? "DETECTED" : "clear"}\n` +
      `Time: ${new Date(reading.ts).toLocaleString()}`;

    lastAlertAtRef.current = now;
    lastAlertStatusRef.current = reading.status;
    let anySent = false;
    try {
      const res = await broadcastTelegramAlert({ data: { body } });
      if (res.sent > 0) {
        await appendLog(`Telegram alert broadcast to ${res.sent}/${res.total} (${reading.status})`, "info");
        anySent = true;
      } else if (hasTelegram) {
        await sendTelegramAlert({ data: { chatId: s.telegramChatId, body } });
        await appendLog(`Telegram alert sent (${reading.status})`, "info");
        anySent = true;
      }
    } catch (e: any) {
      await appendLog(`Telegram alert failed: ${e?.message ?? e}`, "error");
    }
    if (hasWhatsApp) {
      try {
        await sendWhatsAppAlert({ data: { to: s.whatsappTo, from: s.whatsappFrom, body } });
        await appendLog(`WhatsApp alert sent (${reading.status})`, "info");
        anySent = true;
      } catch (e: any) {
        await appendLog(`WhatsApp alert failed: ${e?.message ?? e}`, "error");
      }
    }
    if (anySent) {
      await supabase.from("alert_settings" as any).update({
        last_alert_at: new Date(now).toISOString(),
        last_alert_status: reading.status,
      }).eq("id", 1);
    }
  }, [appendLog]);

  const setThresholds = useCallback(async (t: Thresholds) => {
    setThresholdsState(t);
    await supabase.from("thresholds").update({ temp: t.temp, smoke: t.smoke, updated_at: new Date().toISOString() }).eq("id", 1);
  }, []);

  const setDevices = useCallback(async (patch: Partial<DeviceState>) => {
    setDevicesState((d) => ({ ...d, ...patch }));
    await supabase.from("device_state").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", 1);
  }, []);

  const resetDevicesFromArduino = useCallback(async () => {
    const cleared: DeviceState = { buzzer: false, fan: false, suppression: false };
    devicesRef.current = cleared;
    setDevicesState(cleared);
    await supabase.from("device_state").update({ ...cleared, updated_at: new Date().toISOString() }).eq("id", 1);
    await appendLog("RX RESET (AUTO)", "rx");
    await appendLog("System reset from Arduino", "info");
  }, [appendLog]);

  const ingest = useCallback(async (line: string, source: "serial" | "manual" | "mock" = "manual") => {
    await appendLog(`RX ${line}`, "rx");
    if (/^RESET$/i.test(line.trim())) {
      if (source === "serial") {
        await resetDevicesFromArduino();
      }
      return;
    }

    // ---- New voltage-based format ----
    // SV:4.85,IV:0.32,OV:0.30,FV:5.00   (smoke / indoor / outdoor / flame voltages)
    const sv = /SV:\s*(-?\d+(?:\.\d+)?)/i.exec(line);
    const iv = /IV:\s*(-?\d+(?:\.\d+)?)/i.exec(line);
    const ov = /OV:\s*(-?\d+(?:\.\d+)?)/i.exec(line);
    const fv = /FV:\s*(-?\d+(?:\.\d+)?)/i.exec(line);
    const cv = /(?:CV|CURRENT|AMP[S]?|I):\s*(-?\d+(?:\.\d+)?)/i.exec(line);
    // Cooling fan PWM duty count from Arduino. Accepts:
    //   Duty:NNN  (0-255 raw)   FanDuty:NNN  (0-255)   Fan:NN%  (already percent)   FanSpeed:NN
    const dutyRaw = /(?:DUTY|FAN\s*DUTY|FANDUTY)\s*:\s*(\d+(?:\.\d+)?)/i.exec(line);
    const fanPctM = /(?:FAN\s*SPEED|FANSPEED|FAN)\s*:\s*(\d+(?:\.\d+)?)\s*%?/i.exec(line);
    let fanSpeedPct: number | null = null;
    if (dutyRaw) {
      fanSpeedPct = Math.max(0, Math.min(100, (parseFloat(dutyRaw[1]) / 255) * 100));
    } else if (fanPctM) {
      const v = parseFloat(fanPctM[1]);
      fanSpeedPct = v > 100 ? Math.max(0, Math.min(100, (v / 255) * 100)) : Math.max(0, Math.min(100, v));
    }

    // ---- Friendly format from Arduino sketch ----
    // "Smoke: 7.5% | Indoor: 28.3C | Outdoor: 67.9C | Flame V: 0.87 | Current: 0.42A"
    // Smoke value is already a percentage, Indoor/Outdoor are already °C, Flame is volts.
    if (!sv) {
      const smokePctM = /Smoke\s*:\s*(-?\d+(?:\.\d+)?)\s*%/i.exec(line);
      const indoorCM  = /Indoor\s*:\s*(-?\d+(?:\.\d+)?)\s*C/i.exec(line);
      const outdoorCM = /Outdoor\s*:\s*(-?\d+(?:\.\d+)?)\s*C/i.exec(line);
      const flameVM   = /Flame(?:\s*V)?\s*:\s*(-?\d+(?:\.\d+)?)/i.exec(line);
      const currentM  = /Current\s*:\s*(-?\d+(?:\.\d+)?)\s*A?/i.exec(line);
      if (smokePctM && indoorCM) {
        if (source === "serial" && modeRef.current !== "auto") {
          setAutomationMode("auto"); modeRef.current = "auto";
          await appendLog("Mode switched to AUTO from Arduino serial input", "info");
        }
        const cfg = sensorSettingsRef.current;
        const t = thresholdsRef.current;
        const smokePercentage = Math.max(0, Math.min(100, parseFloat(smokePctM[1])));
        const indoorTemperature = parseFloat(indoorCM[1]);
        const outdoorTemperature = outdoorCM ? parseFloat(outdoorCM[1]) : null;
        const flameVoltage = flameVM ? parseFloat(flameVM[1]) : null;
        const currentAmps = currentM ? parseFloat(currentM[1]) : null;
        // Derive smoke voltage back from % so the voltage panel still updates
        const smokeVoltage = cfg.smokeBaselineVoltage - (smokePercentage / 100) * cfg.smokeMaxDrop;
        const indoorTempVoltage = indoorTemperature * cfg.temperatureScaleFactor;
        const outdoorTempVoltage = outdoorTemperature == null ? null : outdoorTemperature * cfg.temperatureScaleFactor;
        const smokeDetected = smokePercentage > cfg.smokeDetectionThreshold;
        const flame: 0 | 1 = (flameVoltage != null && flameVoltage <= 1) ? 1 : 0;
        const smokeForStatus = Math.round(smokePercentage * 10);
        const recent = historyRef.current.slice(-9);
        const fireProbability = estimateFireProbability(recent, {
          temp: indoorTemperature, current: currentAmps, smokePct: smokePercentage, thresholds: t, cfg,
        }, fireRiskModelRef.current);
        const decision = decideSafetyState({
          flame, smokeDetected, smokePercentage,
          indoorTemp: indoorTemperature, outdoorTemp: outdoorTemperature,
          currentAmps, fireProbability, cfg, thresholds: t,
        });
        const status: Status = decision.status;

        await supabase.from("sensor_readings").insert({
          temp: indoorTemperature, smoke: smokeForStatus, flame, status,
          temp_out: outdoorTemperature,
          smoke_voltage: smokeVoltage,
          smoke_baseline: cfg.smokeBaselineVoltage,
          smoke_percentage: smokePercentage,
          indoor_temp_voltage: indoorTempVoltage,
          outdoor_temp_voltage: outdoorTempVoltage,
          flame_voltage: flameVoltage,
          current_amps: currentAmps,
          fan_speed: fanSpeedPct,
          system_state: decision.state,
        } as any);

        const newReading: Reading = {
          ts: Date.now(), temp: indoorTemperature, tempOut: outdoorTemperature,
          smoke: smokeForStatus, flame, status,
          smokeVoltage, smokeBaseline: cfg.smokeBaselineVoltage, smokePercentage,
          indoorTempVoltage, outdoorTempVoltage, flameVoltage,
          current: currentAmps, fanSpeed: fanSpeedPct, systemState: decision.state, fireProbability,
        };
        setCurrent(newReading);
        fireWhatsAppIfNeeded(newReading);
        fireBrowserNotificationIfNeeded(newReading);

        // Actuator decision
        const prev = devicesRef.current;
        const next: DeviceState = {
          ...decision.devices,
          suppression: decision.devices.suppression || prev.suppression,
        };
        const patch: Partial<DeviceState> = {};
        const commands: string[] = [];
        if (next.buzzer !== prev.buzzer) { patch.buzzer = next.buzzer; commands.push(next.buzzer ? "BUZZER_ON" : "BUZZER_OFF"); }
        if (next.fan !== prev.fan) { patch.fan = next.fan; commands.push(next.fan ? "FAN_ON" : "FAN_OFF"); }
        if (next.suppression !== prev.suppression) { patch.suppression = next.suppression; commands.push(next.suppression ? "SUPPRESS_ON" : "SUPPRESS_OFF"); }
        if (commands.length) {
          for (const cmd of commands) {
            await appendLog(`TX ${cmd} (AUTO)`, "tx");
            if (serialWriterRef.current) {
              try { await serialWriterRef.current(cmd + "\n"); }
              catch (e: any) { await appendLog(`TX error: ${e?.message ?? e}`, "error"); }
            }
          }
          devicesRef.current = { ...prev, ...patch };
          await supabase.from("device_state").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", 1);
        }
        return;
      }
    }

    if (sv && iv) {
      if (source === "serial" && modeRef.current !== "auto") {
        setAutomationMode("auto"); modeRef.current = "auto";
        await appendLog("Mode switched to AUTO from Arduino serial input", "info");
      }
      const cfg = sensorSettingsRef.current;
      const t = thresholdsRef.current;
      const smokeVoltage = parseFloat(sv[1]);
      const indoorTempVoltage = parseFloat(iv[1]);
      const outdoorTempVoltage = ov ? parseFloat(ov[1]) : null;
      const flameVoltage = fv ? parseFloat(fv[1]) : null;

      const indoorTemperature = indoorTempVoltage / cfg.temperatureScaleFactor;
      const outdoorTemperature = outdoorTempVoltage == null ? null : outdoorTempVoltage / cfg.temperatureScaleFactor;

      // smoke %
      let smokePercentage = ((cfg.smokeBaselineVoltage - smokeVoltage) / cfg.smokeMaxDrop) * 100;
      smokePercentage = Math.max(0, Math.min(100, smokePercentage));
      const smokeDetected = smokePercentage > cfg.smokeDetectionThreshold;

      // flame
      const flame: 0 | 1 = (flameVoltage != null && flameVoltage <= 1) ? 1 : 0;
      const flameUncertain = flameVoltage != null && flameVoltage > 1 && flameVoltage < 4;
      const currentAmps = cv ? parseFloat(cv[1]) : null;

      // Auto-baseline: collect rolling window of smoke voltages when nothing alarming
      const buf = smokeVoltBufRef.current;
      buf.push(smokeVoltage);
      if (buf.length > 20) buf.shift();
      if (buf.length >= 10 && !smokeDetected && flame === 0) {
        const mn = Math.min(...buf), mx = Math.max(...buf);
        if (mx - mn <= cfg.smokeTolerance) {
          const mean = buf.reduce((a, b) => a + b, 0) / buf.length;
          // only re-save if drifted noticeably and we haven't saved in 60s
          if (Math.abs(mean - cfg.smokeBaselineVoltage) > cfg.smokeTolerance && Date.now() - lastBaselineSaveRef.current > 60_000) {
            lastBaselineSaveRef.current = Date.now();
            cfg.smokeBaselineVoltage = mean;
            setSensorSettings((s) => ({ ...s, smokeBaselineVoltage: mean }));
            await supabase.from("thresholds").update({ smoke_baseline_voltage: mean, updated_at: new Date().toISOString() } as any).eq("id", 1);
            await appendLog(`Auto-calibrated smoke baseline → ${mean.toFixed(3)} V`, "info");
          }
        }
      }

      // Map smoke % to legacy ppm-ish scale for back-compat
      const smokeForStatus = Math.round(smokePercentage * 10); // 0..1000 scale

      // ---- AI / trend-based fire probability ----
      const recent = historyRef.current.slice(-9);
      const fireProbability = estimateFireProbability(recent, {
        temp: indoorTemperature,
        current: currentAmps,
        smokePct: smokePercentage,
        thresholds: t,
        cfg,
      }, fireRiskModelRef.current);

      // ---- 6-state safety machine ----
      const decision = decideSafetyState({
        flame, smokeDetected, smokePercentage,
        indoorTemp: indoorTemperature, outdoorTemp: outdoorTemperature,
        currentAmps, fireProbability, cfg, thresholds: t,
      });
      const status: Status = decision.status;

      await supabase.from("sensor_readings").insert({
        temp: indoorTemperature, smoke: smokeForStatus, flame, status,
        temp_out: outdoorTemperature,
        smoke_voltage: smokeVoltage,
        smoke_baseline: cfg.smokeBaselineVoltage,
        smoke_percentage: smokePercentage,
        indoor_temp_voltage: indoorTempVoltage,
        outdoor_temp_voltage: outdoorTempVoltage,
        flame_voltage: flameVoltage,
        current_amps: currentAmps,
        fan_speed: fanSpeedPct,
        system_state: decision.state,
      } as any);

      const newReading: Reading = {
        ts: Date.now(), temp: indoorTemperature, tempOut: outdoorTemperature,
        smoke: smokeForStatus, flame, status,
        smokeVoltage, smokeBaseline: cfg.smokeBaselineVoltage, smokePercentage,
        indoorTempVoltage, outdoorTempVoltage, flameVoltage,
        current: currentAmps, fanSpeed: fanSpeedPct, systemState: decision.state, fireProbability,
      };
      setCurrent(newReading);
      fireWhatsAppIfNeeded(newReading);
      fireBrowserNotificationIfNeeded(newReading);

      // Log alerts to alerts table on escalation
      if (flame === 1) {
        await supabase.from("alerts" as any).insert({
          alert_type: "flame", severity: "danger",
          alert_message: "Danger: Flame detected!",
          sensor_value: flameVoltage, status: "active",
        });
      } else if (flameUncertain) {
        await supabase.from("alerts" as any).insert({
          alert_type: "flame", severity: "warning",
          alert_message: `Flame sensor uncertain (${flameVoltage?.toFixed(2)} V) — check sensor`,
          sensor_value: flameVoltage, status: "active",
        });
      }
      if (decision.state >= 2 && decision.state !== 3) {
        await supabase.from("alerts" as any).insert({
          alert_type: `state_${decision.state}`,
          severity: decision.status === "danger" ? "danger" : "warning",
          alert_message: decision.label,
          sensor_value: fireProbability * 100, status: "active",
        });
      }
      if (smokeDetected) {
        await supabase.from("alerts" as any).insert({
          alert_type: "smoke",
          severity: smokePercentage >= 50 ? "danger" : "warning",
          alert_message: `Warning: Smoke detected (${smokePercentage.toFixed(1)}%) — buzzer ON, fan OFF.`,
          sensor_value: smokePercentage, status: "active",
        });
      }

      // Actuator decision driven by safety state machine
      const prev = devicesRef.current;
      // Latch suppression ON until explicit RESET
      const next: DeviceState = {
        ...decision.devices,
        suppression: decision.devices.suppression || prev.suppression,
      };

      const patch: Partial<DeviceState> = {};
      const commands: string[] = [];
      if (next.buzzer !== prev.buzzer) { patch.buzzer = next.buzzer; commands.push(next.buzzer ? "BUZZER_ON" : "BUZZER_OFF"); }
      if (next.fan !== prev.fan) { patch.fan = next.fan; commands.push(next.fan ? "FAN_ON" : "FAN_OFF"); }
      if (next.suppression !== prev.suppression) { patch.suppression = next.suppression; commands.push(next.suppression ? "SUPPRESS_ON" : "SUPPRESS_OFF"); }
      if (commands.length) {
        for (const cmd of commands) {
          await appendLog(`TX ${cmd} (AUTO)`, "tx");
          if (serialWriterRef.current) {
            try { await serialWriterRef.current(cmd + "\n"); }
            catch (e: any) { await appendLog(`TX error: ${e?.message ?? e}`, "error"); }
          }
        }
        devicesRef.current = { ...prev, ...patch };
        await supabase.from("device_state").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", 1);
      }
      return;
    }

    // ---- Legacy TEMP:..,SMOKE:..,FLAME:.. format (unchanged) ----
    const m = /TEMP:(-?\d+(?:\.\d+)?),\s*SMOKE:(\d+),\s*FLAME:([01])/i.exec(line);
    if (!m) return;

    if (source === "serial" && modeRef.current !== "auto") {
      setAutomationMode("auto");
      modeRef.current = "auto";
      await appendLog("Mode switched to AUTO from Arduino serial input", "info");
    }

    const temp = parseFloat(m[1]);
    const smoke = parseInt(m[2], 10);
    const flame = (m[3] === "1" ? 1 : 0) as 0 | 1;
    const om = /(?:TOUT|TEMP_?OUT|OUT):\s*(-?\d+(?:\.\d+)?)/i.exec(line);
    const tempOut = om ? parseFloat(om[1]) : null;
    const ampMatch = /(?:CURRENT|CV|AMP[S]?):\s*(-?\d+(?:\.\d+)?)/i.exec(line);
    const currentAmps = ampMatch ? parseFloat(ampMatch[1]) : null;
    const t = thresholdsRef.current;
    const cfgL = sensorSettingsRef.current;
    const smokePctLegacy = Math.min(100, Math.max(0, (smoke / Math.max(1, t.smoke)) * 50));
    const smokeDetectedLegacy = smoke >= t.smoke;
    const recentLegacy = historyRef.current.slice(-9);
    const fireProbability = estimateFireProbability(recentLegacy, {
      temp, current: currentAmps, smokePct: smokePctLegacy, thresholds: t, cfg: cfgL,
    }, fireRiskModelRef.current);
    const decision = decideSafetyState({
      flame, smokeDetected: smokeDetectedLegacy, smokePercentage: smokePctLegacy,
      indoorTemp: temp, outdoorTemp: tempOut, currentAmps, fireProbability, cfg: cfgL, thresholds: t,
    });
    const status: Status = decision.status;
    await supabase.from("sensor_readings").insert({
      temp, smoke, flame, status, temp_out: tempOut,
      current_amps: currentAmps, system_state: decision.state,
    } as any);
    const newReading: Reading = {
      ts: Date.now(), temp, tempOut, smoke, flame, status,
      current: currentAmps, systemState: decision.state, fireProbability,
    };
    fireWhatsAppIfNeeded(newReading);
    fireBrowserNotificationIfNeeded(newReading);

    // Build prediction from recent readings (linear regression, ~10s horizon)
    const recent = [...historyRef.current.slice(-9), { ts: Date.now(), temp, tempOut, smoke, flame, status }];
    const pred = predict(recent, t, horizonRef.current, sensorSettingsRef.current, fireRiskModelRef.current);
    setPrediction(pred);
    const now = Date.now();
    setPredictionLog((log) => {
      const cutoff = now - 5 * 60 * 1000;
      return [...log.filter((p) => p.targetTs >= cutoff), {
        madeAt: now, targetTs: now + pred.horizonSec * 1000,
        predTemp: pred.tempNext, predSmoke: pred.smokeNext, horizonSec: pred.horizonSec,
      }].slice(-300);
    });

    // Decide actuators based on mode
    const mode = modeRef.current;
    let next: DeviceState | null = null;
    const prev = devicesRef.current;
    // Simple rule: fan only helps when indoor is hotter than outdoor.
    const fanUseful = tempOut == null ? true : temp > tempOut;
    if (mode === "auto") {
      // Use the unified safety state machine decision
      next = { ...decision.devices, suppression: decision.devices.suppression || prev.suppression };
      if (next.fan && !fanUseful) next.fan = false;
    } else if (mode === "ml") {
      // Keep suppression latched once active; only manual RESET should clear it.
      if (pred.suppression) next = { buzzer: true, fan: false, suppression: true };
      else if (pred.buzzer) next = { buzzer: true, fan: false, suppression: false };
      else if (pred.fan) next = fanUseful ? { buzzer: false, fan: true, suppression: false } : { buzzer: true, fan: false, suppression: false };
      else next = { buzzer: false, fan: false, suppression: false };
    }

    if (next) {
      const patch: Partial<DeviceState> = {};
      const commands: string[] = [];

      if (next.buzzer !== prev.buzzer) {
        patch.buzzer = next.buzzer;
        commands.push(next.buzzer ? "BUZZER_ON" : "BUZZER_OFF");
      }
      if (next.fan !== prev.fan) {
        patch.fan = next.fan;
        commands.push(next.fan ? "FAN_ON" : "FAN_OFF");
      }
      if (next.suppression !== prev.suppression && next.suppression) {
        patch.suppression = true;
        commands.push("SUPPRESS_ON");
      }
      if (next.suppression !== prev.suppression && !next.suppression) {
        patch.suppression = false;
        commands.push("SUPPRESS_OFF");
      }

      if (commands.length > 0) {
        for (const cmd of commands) {
          await appendLog(`TX ${cmd} (AUTO)`, "tx");
          if (serialWriterRef.current) {
            try { await serialWriterRef.current(cmd + "\n"); }
            catch (e: any) { await appendLog(`TX error: ${e?.message ?? e}`, "error"); }
          }
        }
        devicesRef.current = { ...prev, ...patch };
        await supabase.from("device_state").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", 1);
      }
    }
  }, [appendLog, setAutomationMode, resetDevicesFromArduino]);

  // Recompute current forecast instantly when horizon changes (without waiting for next sample)
  useEffect(() => {
    const recent = historyRef.current.slice(-10);
    if (recent.length < 2) return;
    setPrediction(predict(recent, thresholdsRef.current, horizonSec, sensorSettingsRef.current, fireRiskModelRef.current));
  }, [horizonSec]);

  const sendCommand = useCallback(async (cmd: string) => {
    // Fire suppression must only be activated by the automated safety state machine.
    if (cmd === "SUPPRESS_ON") {
      await appendLog("Blocked: Fire suppression cannot be turned ON manually — only the automated safety system can activate it.", "error");
      try {
        const { toast } = await import("sonner");
        toast.error("Suppression can't be turned on manually", {
          description: "Fire suppression only activates automatically when fire is confirmed.",
        });
      } catch {}
      return;
    }
    await appendLog(`TX ${cmd}`, "tx");
    if (serialWriterRef.current) {
      try { await serialWriterRef.current(cmd + "\n"); }
      catch (e: any) { await appendLog(`TX error: ${e?.message ?? e}`, "error"); }
    }
    let patch: Partial<DeviceState> | null = null;
    switch (cmd) {
      case "BUZZER_ON": patch = { buzzer: true }; break;
      case "BUZZER_OFF": patch = { buzzer: false }; break;
      case "FAN_ON": patch = { fan: true }; break;
      case "FAN_OFF": patch = { fan: false }; break;
      case "SUPPRESS_ON": patch = { suppression: true }; break;
      case "SUPPRESS_OFF": patch = { suppression: false }; break;
      case "RESET": patch = { buzzer: false, fan: false, suppression: false }; break;
    }
    if (patch) await setDevices(patch);
  }, [appendLog, setDevices]);

  const resetSystem = useCallback(() => sendCommand("RESET"), [sendCommand]);

  const saveSensorSettings = useCallback(async (patch: Partial<SensorSettings>) => {
    setSensorSettings((s) => ({ ...s, ...patch }));
    const dbPatch: any = { updated_at: new Date().toISOString() };
    if (patch.smokeBaselineVoltage != null) dbPatch.smoke_baseline_voltage = patch.smokeBaselineVoltage;
    if (patch.smokeTolerance != null) dbPatch.smoke_tolerance = patch.smokeTolerance;
    if (patch.smokeMaxDrop != null) dbPatch.smoke_max_drop = patch.smokeMaxDrop;
    if (patch.smokeDetectionThreshold != null) dbPatch.smoke_detection_threshold = patch.smokeDetectionThreshold;
    if (patch.temperatureScaleFactor != null) dbPatch.temperature_scale_factor = patch.temperatureScaleFactor;
    if (patch.fanAutoMode != null) dbPatch.fan_auto_mode = patch.fanAutoMode;
    await supabase.from("thresholds").update(dbPatch).eq("id", 1);
  }, []);

  const calibrateSmokeBaseline = useCallback(async () => {
    const cfg = sensorSettingsRef.current;
    const buf = smokeVoltBufRef.current;
    if (buf.length < 5) return { ok: false, reason: "Not enough samples yet — wait for the sensor to stream a few readings." };
    const mn = Math.min(...buf), mx = Math.max(...buf);
    if (mx - mn > cfg.smokeTolerance * 2) return { ok: false, reason: `Readings not stable enough (±${((mx - mn) / 2).toFixed(3)} V).` };
    const mean = buf.reduce((a, b) => a + b, 0) / buf.length;
    lastBaselineSaveRef.current = Date.now();
    setSensorSettings((s) => ({ ...s, smokeBaselineVoltage: mean }));
    await supabase.from("thresholds").update({ smoke_baseline_voltage: mean, updated_at: new Date().toISOString() } as any).eq("id", 1);
    await appendLog(`Smoke baseline calibrated to ${mean.toFixed(3)} V`, "info");
    return { ok: true, voltage: mean };
  }, [appendLog]);

  const startMock = useCallback(() => {
    if (mockTimer.current) return;
    setMock(true); setConnected(true);
    appendLog("Mock Bluetooth stream started");
    mockTimer.current = setInterval(() => {
      const r = Math.random();
      let temp = 25 + Math.random() * 8;
      let smoke = 100 + Math.floor(Math.random() * 80);
      let flame: 0 | 1 = 0;
      if (r > 0.95) { temp = 70 + Math.random() * 10; smoke = 600; flame = 1; }
      else if (r > 0.85) { smoke = 500 + Math.floor(Math.random() * 200); temp = 45; }
      else if (r > 0.7) { temp = 55 + Math.random() * 8; }
      const tempOut = 22 + Math.random() * 10;
      const amps = (flame ? 11 : smoke > 500 ? 9 : 2 + Math.random() * 4).toFixed(2);
      ingest(`TEMP:${temp.toFixed(1)},SMOKE:${smoke},FLAME:${flame},TOUT:${tempOut.toFixed(1)},CURRENT:${amps}`, "mock");
    }, 2500);
  }, [appendLog, ingest]);

  const stopMock = useCallback(() => {
    if (mockTimer.current) { clearInterval(mockTimer.current); mockTimer.current = null; }
    setMock(false); setConnected(false);
    appendLog("Mock Bluetooth stream stopped");
  }, [appendLog]);

  useEffect(() => () => { if (mockTimer.current) clearInterval(mockTimer.current); }, []);

  const value = useMemo<SystemContextValue>(() => ({
    connected, setConnected, mock, setMock,
    current, history, thresholds, setThresholds,
    devices, setDevices, log, appendLog, sendCommand, ingest, resetSystem,
    startMock, stopMock, loading, registerSerialWriter,
    automationMode, setAutomationMode, prediction, fireRiskModel, retrainFireModel,
    horizonSec, setHorizonSec, predictionLog,
    alertSettings, saveAlertSettings,
    testAlert: async () => {
      const s = alertSettingsRef.current;
      const body = `✅ SFDS test alert at ${new Date().toLocaleString()}`;
      const hasTelegram = !!s.telegramChatId;
      const hasWhatsApp = !!(s.whatsappTo && s.whatsappFrom);
      if (!hasTelegram && !hasWhatsApp) throw new Error("Set a Telegram chat ID (or WhatsApp numbers) first");
      if (hasTelegram) {
        await sendTelegramAlert({ data: { chatId: s.telegramChatId, body } });
        await appendLog("Telegram test alert sent", "info");
      }
      if (hasWhatsApp) {
        await sendWhatsAppAlert({ data: { to: s.whatsappTo, from: s.whatsappFrom, body } });
        await appendLog("WhatsApp test alert sent", "info");
      }
    },
    notifySettings, setNotifySettings, notifyPermission, requestNotifyPermission,
    testBrowserNotification: async () => {
      if (typeof Notification === "undefined") throw new Error("Browser notifications not supported");
      if (Notification.permission !== "granted") {
        const p = await Notification.requestPermission();
        setNotifyPermission(p);
        if (p !== "granted") throw new Error("Permission denied");
      }
      const n = new Notification("✅ SFDS test notification", { body: "Browser alerts are working." });
      n.onclick = () => { window.focus(); n.close(); };
      if (notifySettingsRef.current.sound) playBeep(false);
    },
    sensorSettings, saveSensorSettings, calibrateSmokeBaseline,
    deviceFault,
    latestAlert, alerts,
    condition: classifyCondition(current, history, sensorSettings, thresholds, devices.fan),
  }), [connected, mock, current, history, thresholds, devices, log, appendLog, sendCommand, ingest, resetSystem, startMock, stopMock, setThresholds, setDevices, loading, registerSerialWriter, automationMode, setAutomationMode, prediction, fireRiskModel, retrainFireModel, horizonSec, setHorizonSec, predictionLog, alertSettings, saveAlertSettings, notifySettings, setNotifySettings, notifyPermission, requestNotifyPermission, playBeep, sensorSettings, saveSensorSettings, calibrateSmokeBaseline, deviceFault, latestAlert, alerts]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Lightweight on-device "ML": linear regression on recent samples to forecast
// the next value, plus a logistic-style risk score for the flame/suppression call.
function linreg(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0, r2: 0 };
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0, ssTot = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; ssTot += (ys[i] - my) ** 2; }
  const slope = den === 0 ? 0 : num / den;
  const intercept = my - slope * mx;
  let ssRes = 0;
  for (let i = 0; i < n; i++) { const p = slope * xs[i] + intercept; ssRes += (ys[i] - p) ** 2; }
  const r2 = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);
  return { slope, intercept, r2 };
}

function predict(readings: Reading[], t: Thresholds, horizonSec = 10, cfg?: SensorSettings, model?: FireRiskModel | null): Prediction {
  const t0 = readings[0]?.ts ?? Date.now();
  const xs = readings.map((r) => (r.ts - t0) / 1000);
  const temps = readings.map((r) => r.temp);
  const smokes = readings.map((r) => r.smoke);
  const last = readings[readings.length - 1];
  const lastX = xs[xs.length - 1] ?? 0;

  const tReg = linreg(xs, temps);
  const sReg = linreg(xs, smokes);
  const tempNext = Math.max(0, tReg.slope * (lastX + horizonSec) + tReg.intercept);
  const smokeNext = Math.max(0, sReg.slope * (lastX + horizonSec) + sReg.intercept);

  const outPairs = readings.map((r, i) => [xs[i], r.tempOut] as const).filter(([, v]) => v != null) as [number, number][];
  let tempOutNext: number | null = null;
  if (outPairs.length >= 2) {
    const oReg = linreg(outPairs.map(([x]) => x), outPairs.map(([, y]) => y));
    tempOutNext = Math.max(0, oReg.slope * (lastX + horizonSec) + oReg.intercept);
  } else if (outPairs.length === 1) {
    tempOutNext = outPairs[0][1];
  }
  const tempDelta = tempOutNext == null ? 0 : tempNext - tempOutNext;
  const fanUsefulPred = tempOutNext == null ? true : tempNext > tempOutNext;

  // Flame risk via logistic of weighted features (forecast + slopes + flame flag)
  const flameRecent = readings.slice(-5).reduce((a, r) => a + r.flame, 0) / Math.max(1, Math.min(5, readings.length));
  let flameRisk: number;
  if (cfg && model) {
    flameRisk = runFireRiskModel(model, [
      tempNext / Math.max(1, t.temp),
      Math.max(0, Math.min(100, smokeNext / 10)) / 100,
      (last?.current ?? 0) / Math.max(1, cfg.ratedCurrent),
      Math.max(0, tReg.slope) / 5,
      0,
      Math.max(0, tempDelta) / Math.max(1, cfg.tempDeltaWarning),
      last?.flame ? 1 : flameRecent,
    ]);
  } else {
    const z =
      -6 +
      0.08 * (tempNext - t.temp) +
      0.012 * (smokeNext - t.smoke) +
      0.6 * Math.max(0, tReg.slope) +
      0.05 * Math.max(0, sReg.slope) +
      4 * flameRecent +
      (last?.flame ? 3 : 0);
    flameRisk = 1 / (1 + Math.exp(-z));
  }

  const buzzer = flameRisk > 0.5 || smokeNext >= t.smoke;
  const fan = !buzzer && fanUsefulPred;
  const suppression = flameRisk > 0.75 || (last?.flame === 1);

  const confidence = Math.min(1, 0.5 * tReg.r2 + 0.5 * sReg.r2);
  return { tempNext, smokeNext, tempOutNext, tempDelta, flameRisk, fan, buzzer, suppression, confidence, horizonSec };
}

export function useSystem() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSystem must be inside SystemProvider");
  return v;
}

export function statusColor(s: Status): string {
  return s === "danger" ? "text-danger" : s === "warning" ? "text-warning" : "text-success";
}

