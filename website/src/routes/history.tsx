import { createFileRoute } from "@tanstack/react-router";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { Trash2, Database } from "lucide-react";
import { useSystem } from "@/context/SystemContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "History — SFDS" },
      { name: "description", content: "Historical sensor readings and event log persisted to the cloud database." },
    ],
  }),
  component: HistoryPage,
});

function HistoryPage() {
  const { history, log, loading, predictionLog, horizonSec } = useSystem();

  const data = history.slice(-60).map((r) => ({
    time: new Date(r.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    temp: r.temp,
    smoke: r.smoke,
    flame: r.flame * 100,
  }));

  // Build predicted-vs-actual chart data: for each prediction whose targetTs has
  // already passed, find the actual reading closest in time and align them.
  const now = Date.now();
  const recentHistory = history.slice(-200);
  const findActualAt = (targetTs: number) => {
    let best: typeof recentHistory[number] | null = null;
    let bestDiff = Infinity;
    for (const r of recentHistory) {
      const d = Math.abs(r.ts - targetTs);
      if (d < bestDiff) { bestDiff = d; best = r; }
    }
    // Only count as "actual available" if within 1 horizon window
    return bestDiff <= horizonSec * 1000 ? best : null;
  };
  const predData = predictionLog.slice(-40).map((p) => {
    const actual = p.targetTs <= now ? findActualAt(p.targetTs) : null;
    return {
      time: new Date(p.targetTs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      predTemp: Number(p.predTemp.toFixed(2)),
      predSmoke: Math.round(p.predSmoke),
      actualTemp: actual ? Number(actual.temp.toFixed(2)) : null,
      actualSmoke: actual ? actual.smoke : null,
    };
  });

  async function clearAll() {
    if (!confirm("Delete all readings and logs from database?")) return;
    await Promise.all([
      supabase.from("sensor_readings").delete().gte("id", 0),
      supabase.from("connection_log").delete().gte("id", 0),
    ]);
    toast.success("History cleared");
  }

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Database className="h-6 w-6 text-primary" /> History</h1>
          <p className="text-sm text-muted-foreground mt-1">All readings stored in the cloud database · {history.length} records</p>
        </div>
        <button onClick={clearAll} className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium border border-danger/40 text-danger hover:bg-danger/10">
          <Trash2 className="h-4 w-4" /> Clear DB History
        </button>
      </header>

      <section className="rounded-2xl border border-border bg-card/70 backdrop-blur p-5">
        <h2 className="font-semibold mb-3">Sensor Trends (latest 60)</h2>
        <div className="h-72">
          {data.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              {loading ? "Loading..." : "No readings yet — connect Arduino or start demo stream."}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0.02 250)" />
                <XAxis dataKey="time" stroke="oklch(0.6 0.02 250)" tick={{ fontSize: 10 }} />
                <YAxis stroke="oklch(0.6 0.02 250)" tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ background: "oklch(0.18 0.02 250)", border: "1px solid oklch(0.3 0.02 250)", borderRadius: 8 }} />
                <Legend />
                <Line type="monotone" dataKey="temp" name="Temp °C" stroke="oklch(0.72 0.18 35)" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="smoke" name="Smoke ppm" stroke="oklch(0.7 0.15 80)" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="flame" name="Flame x100" stroke="oklch(0.65 0.25 25)" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card/70 backdrop-blur p-5">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div>
            <h2 className="font-semibold">Predicted vs Actual · +{horizonSec}s horizon</h2>
            <p className="text-xs text-muted-foreground">ML forecast lines compared with real readings recorded at the predicted time.</p>
          </div>
          <span className="text-[10px] font-mono text-muted-foreground">{predData.length} forecasts</span>
        </div>
        <div className="h-72">
          {predData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              No forecasts yet — connect or start the demo stream.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={predData}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0.02 250)" />
                <XAxis dataKey="time" stroke="oklch(0.6 0.02 250)" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="left" stroke="oklch(0.6 0.02 250)" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="right" orientation="right" stroke="oklch(0.6 0.02 250)" tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ background: "oklch(0.18 0.02 250)", border: "1px solid oklch(0.3 0.02 250)", borderRadius: 8 }} />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="predTemp" name="Pred Temp °C" stroke="oklch(0.72 0.18 35)" strokeDasharray="5 4" dot={false} strokeWidth={2} connectNulls />
                <Line yAxisId="left" type="monotone" dataKey="actualTemp" name="Actual Temp °C" stroke="oklch(0.72 0.18 35)" dot={{ r: 2 }} strokeWidth={2} connectNulls />
                <Line yAxisId="right" type="monotone" dataKey="predSmoke" name="Pred Smoke ppm" stroke="oklch(0.7 0.15 80)" strokeDasharray="5 4" dot={false} strokeWidth={2} connectNulls />
                <Line yAxisId="right" type="monotone" dataKey="actualSmoke" name="Actual Smoke ppm" stroke="oklch(0.7 0.15 80)" dot={{ r: 2 }} strokeWidth={2} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <section className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-border bg-card/70 backdrop-blur p-5">
          <h2 className="font-semibold mb-3">Recent Readings</h2>
          <div className="overflow-auto max-h-96">
            <table className="w-full text-xs font-mono">
              <thead className="text-muted-foreground border-b border-border">
                <tr><th className="text-left py-2">Time</th><th>Temp</th><th>Smoke</th><th>Flame</th><th>Status</th></tr>
              </thead>
              <tbody>
                {[...history].reverse().slice(0, 100).map((r, i) => (
                  <tr key={i} className="border-b border-border/40">
                    <td className="py-1.5">{new Date(r.ts).toLocaleTimeString()}</td>
                    <td className="text-center">{r.temp.toFixed(1)}</td>
                    <td className="text-center">{r.smoke}</td>
                    <td className="text-center">{r.flame}</td>
                    <td className={`text-center font-semibold ${r.status === "danger" ? "text-danger" : r.status === "warning" ? "text-warning" : "text-success"}`}>{r.status}</td>
                  </tr>
                ))}
                {history.length === 0 && <tr><td colSpan={5} className="text-center py-6 text-muted-foreground">No data</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card/70 backdrop-blur p-5">
          <h2 className="font-semibold mb-3">Event Log</h2>
          <div className="overflow-auto max-h-96 font-mono text-xs space-y-1">
            {log.length === 0 && <div className="text-muted-foreground">No events.</div>}
            {log.map((l, i) => (
              <div key={i} className={l.includes("RX") ? "text-success" : l.includes("TX") ? "text-primary" : "text-muted-foreground"}>{l}</div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
