import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Bluetooth, AlertTriangle, Usb, Plug, PlugZap } from "lucide-react";
import { useSystem } from "@/context/SystemContext";
import { toast } from "sonner";

export const Route = createFileRoute("/bluetooth")({
  head: () => ({
    meta: [
      { title: "Bluetooth — SFDS" },
      { name: "description", content: "Connect to your Arduino UNO + HC-05 module and stream live sensor data." },
    ],
  }),
  component: BluetoothPage,
});

function BluetoothPage() {
  const { connected, setConnected, mock, log, ingest, appendLog, registerSerialWriter } = useSystem();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const supportsSerial = mounted && typeof navigator !== "undefined" && "serial" in navigator;
  const [serialBusy, setSerialBusy] = useState(false);
  const portRef = useRef<any>(null);
  const readerRef = useRef<any>(null);
  const writerRef = useRef<any>(null);
  const keepReadingRef = useRef(false);
  const inIframe = mounted && typeof window !== "undefined" && window.self !== window.top;
  const topUrl = mounted && typeof window !== "undefined" ? window.location.href : "";

  async function tryConnectBLE() {
    try {
      // @ts-expect-error Web Bluetooth typing is experimental
      const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: ["battery_service"] });
      toast.success(`Selected device: ${device.name ?? "Unknown"}`);
      toast.info("HC-05 uses Bluetooth Classic SPP — Web Bluetooth (BLE) cannot read it directly.", { duration: 6000 });
    } catch (e) {
      toast.error("Bluetooth selection cancelled or unavailable.");
    }
  }

  async function connectSerial() {
    if (!supportsSerial) {
      toast.error("Web Serial not supported. Use Chrome / Edge on desktop.");
      return;
    }
    if (inIframe) {
      toast.error("Open this page in a new tab — Web Serial is blocked inside the editor preview iframe.", { duration: 7000 });
      return;
    }
    try {
      setSerialBusy(true);
      // @ts-expect-error Web Serial typing
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 9600 });
      portRef.current = port;
      setConnected(true);
      appendLog("Serial port opened @ 9600 baud (Arduino UNO / HC-05 COM)");
      toast.success("Connected to Arduino serial port");

      // Writer: lets the website send commands TO the Arduino
      try {
        const encoder = new TextEncoderStream();
        const encoderClosed = encoder.readable.pipeTo(port.writable).catch(() => {});
        const writer = encoder.writable.getWriter();
        writerRef.current = { writer, encoderClosed };
        registerSerialWriter(async (data: string) => { await writer.write(data); });
      } catch (e: any) {
        appendLog(`Writer init error: ${e?.message ?? e}`);
      }

      keepReadingRef.current = true;
      const decoder = new TextDecoderStream();
      const closedPromise = port.readable.pipeTo(decoder.writable).catch(() => {});
      const reader = decoder.readable.getReader();
      readerRef.current = { reader, closedPromise };

      let buffer = "";
      (async () => {
        try {
          while (keepReadingRef.current) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) {
              buffer += value;
              let idx;
              while ((idx = buffer.indexOf("\n")) >= 0) {
                const line = buffer.slice(0, idx).trim();
                buffer = buffer.slice(idx + 1);
                if (line) ingest(line, "serial");
              }
            }
          }
        } catch (err: any) {
          appendLog(`Serial read error: ${err?.message ?? err}`);
        }
      })();
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (msg.includes("permissions policy")) {
        toast.error("Browser blocked Serial access. Open the site in a new tab (not the editor iframe).", { duration: 7000 });
      } else {
        toast.error(msg || "Serial connection cancelled");
      }
    } finally {
      setSerialBusy(false);
    }
  }

  async function disconnectSerial() {
    keepReadingRef.current = false;
    registerSerialWriter(null);
    try {
      if (writerRef.current?.writer) {
        try { await writerRef.current.writer.close(); } catch {}
        try { writerRef.current.writer.releaseLock(); } catch {}
      }
      if (readerRef.current?.reader) {
        try { await readerRef.current.reader.cancel(); } catch {}
        try { readerRef.current.reader.releaseLock(); } catch {}
      }
      if (portRef.current) {
        try { await portRef.current.close(); } catch {}
      }
    } finally {
      portRef.current = null;
      readerRef.current = null;
      writerRef.current = null;
      setConnected(false);
      appendLog("Serial port closed");
      toast.info("Disconnected");
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Bluetooth Bridge</h1>
          <p className="text-sm text-muted-foreground mt-1">Receive packets from the HC-05 module attached to your Arduino UNO.</p>
        </div>
        <span className={`self-start sm:self-auto px-3 py-1.5 rounded-full text-xs font-semibold border ${connected ? "border-success/40 text-success bg-success/10" : "border-border text-muted-foreground"}`}>
          {connected ? (mock ? "Connected · Demo Stream" : "Connected") : "Disconnected"}
        </span>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-4 items-start">
        <section className="rounded-2xl border border-border bg-card/70 backdrop-blur p-5">
          {inIframe && (
            <div className="mb-4 rounded-xl border border-danger/40 bg-danger/10 text-danger p-3 text-xs flex items-start justify-between gap-3">
              <div className="flex gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <p>
                  You're viewing this inside the editor iframe. Browsers block <strong>Web Serial</strong> here, so HC-05 will pair then drop after a few seconds. Open the app in its own tab to connect.
                </p>
              </div>
              <a href={topUrl} target="_blank" rel="noreferrer" className="shrink-0 inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold bg-danger text-danger-foreground hover:opacity-90">
                Open in new tab
              </a>
            </div>
          )}
          <div className="flex items-center gap-2 mb-3">
            <Bluetooth className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">Connect to Arduino UNO + HC-05</h2>
          </div>

          <div className="grid gap-3">
            {/* Recommended: Web Serial (HC-05 paired COM port or direct USB) */}
            <div className="rounded-xl border border-primary/40 bg-primary/5 p-5 flex flex-col min-h-56">
              <div className="flex items-center gap-2 text-primary text-xs font-semibold uppercase tracking-widest">
                <Usb className="h-4 w-4" /> Recommended
              </div>
              <h3 className="mt-1 font-semibold">Arduino UNO · HC-05 (Serial)</h3>
              <p className="text-xs text-muted-foreground mt-1 flex-1">
                Pair HC-05 with your PC (PIN 1234 / 0000) — it appears as a COM port — or plug the UNO via USB. Works on Chrome / Edge desktop @ 9600 baud.
              </p>
              {!connected || mock ? (
                <button disabled={serialBusy || !supportsSerial} onClick={connectSerial} className="mt-3 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50" style={{ boxShadow: "var(--shadow-glow)" }}>
                  <PlugZap className="h-4 w-4" /> {serialBusy ? "Connecting…" : "Connect HC-05 / UNO"}
                </button>
              ) : (
                <button onClick={disconnectSerial} className="mt-3 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold border border-danger/40 text-danger hover:bg-danger/10">
                  <Plug className="h-4 w-4" /> Disconnect
                </button>
              )}
              {!supportsSerial && (
                <p className="mt-2 text-[11px] text-warning">Web Serial unavailable in this browser.</p>
              )}
            </div>


          </div>

        </section>

        <section className="rounded-2xl border border-border bg-card/70 backdrop-blur p-5 flex flex-col">
          <h2 className="font-semibold mb-3">Connection Log</h2>
          <div className="flex-1 min-h-70 max-h-105 overflow-auto rounded-xl bg-background/60 border border-border p-3 font-mono text-xs space-y-1">
            {log.length === 0 && <div className="text-muted-foreground">No activity yet.</div>}
            {log.map((l, i) => (
              <div key={i} className={l.includes("RX") ? "text-success" : l.includes("TX") ? "text-primary" : "text-muted-foreground"}>{l}</div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

