import { type LucideIcon } from "lucide-react";
import { type Status } from "@/context/SystemContext";

const statusStyles: Record<Status, { ring: string; text: string; dot: string; label: string }> = {
  normal:  { ring: "border-success/30",  text: "text-success",  dot: "bg-success",  label: "Normal" },
  warning: { ring: "border-warning/40",  text: "text-warning",  dot: "bg-warning",  label: "Warning" },
  danger:  { ring: "border-danger/50",   text: "text-danger",   dot: "bg-danger",   label: "Critical" },
};

export function SensorCard({
  icon: Icon, label, value, unit, status, hint,
}: {
  icon: LucideIcon; label: string; value: string | number; unit?: string;
  status: Status; hint?: string;
}) {
  const s = statusStyles[status];
  const valueClass = typeof value === "string" && value.length > 10 ? "text-2xl xl:text-3xl leading-tight" : "text-3xl xl:text-4xl";
  return (
    <div className={`relative min-h-[172px] rounded-2xl border ${s.ring} bg-card/80 backdrop-blur p-5 overflow-hidden`}>
      <div className="flex h-full flex-col justify-between gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className={`${valueClass} font-bold tabular-nums ${s.text}`}>{value}</span>
            {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
          </div>
          {hint && <div className="mt-1 text-xs text-muted-foreground line-clamp-2">{hint}</div>}
        </div>
          <div className={`h-10 w-10 rounded-xl flex items-center justify-center bg-muted/40 ${s.text} shrink-0`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
        <div className="flex items-center gap-2 text-xs">
        <span className={`h-2 w-2 rounded-full ${s.dot} ${status === "danger" ? "animate-pulse" : ""}`} />
        <span className="text-muted-foreground">{s.label}</span>
        </div>
      </div>
    </div>
  );
}
