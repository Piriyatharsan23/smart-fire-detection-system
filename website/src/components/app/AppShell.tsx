import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Bluetooth, History, LayoutDashboard, Sliders, Wifi, WifiOff, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useSystem } from "@/context/SystemContext";

const nav: { to: "/" | "/bluetooth" | "/control" | "/history"; label: string; icon: typeof LayoutDashboard; exact?: boolean }[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/bluetooth", label: "Bluetooth", icon: Bluetooth },
  { to: "/control", label: "Control Panel", icon: Sliders },
  { to: "/history", label: "History", icon: History },
];

export function AppShell() {
  const { connected } = useSystem();
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);
  const activeItem = nav.find((n) => n.exact ? pathname === n.to : pathname.startsWith(n.to)) ?? nav[0];

  return (
    <div className="min-h-screen flex flex-col relative overflow-x-hidden">
      <div className="pointer-events-none fixed inset-0 -z-10 app-surface" />
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/82 backdrop-blur-2xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
            className="md:hidden h-10 w-10 rounded-xl border border-border/70 bg-card/60 flex items-center justify-center text-foreground shrink-0"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Link to="/" className="flex items-center gap-2 group min-w-0">
            <div className="h-11 w-11 rounded-full overflow-hidden bg-background/70 ring-1 ring-border transition-transform group-hover:scale-105" style={{ boxShadow: "var(--shadow-glow)" }}>
              <img src="/smart-monitoring-logo.png" alt="Smart Monitoring" className="h-full w-full object-cover" />
            </div>
            <div className="leading-tight min-w-0">
              <div className="text-sm font-bold tracking-wide truncate">Smart Monitoring</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-widest truncate">{activeItem.label}</div>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-1 rounded-2xl border border-border/70 bg-card/55 p-1 shadow-[0_10px_35px_oklch(0_0_0_/_18%)]">
            {nav.map(({ to, label, icon: Icon, exact }) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact: !!exact }}
                className="px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent/80 flex items-center gap-2 transition-colors data-[status=active]:text-primary data-[status=active]:bg-accent"
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            ))}
          </nav>

          <div className={`flex items-center gap-2 px-2.5 sm:px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-medium border shadow-[0_8px_24px_oklch(0_0_0_/_14%)] shrink-0 ${connected ? "border-success/40 text-success bg-success/10" : "border-border text-muted-foreground bg-muted/40"}`}>
            {connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{connected ? "Bluetooth Connected" : "Disconnected"}</span>
            <span className="sm:hidden">{connected ? "On" : "Off"}</span>
          </div>
        </div>
      </header>

      {/* Mobile drawer */}
      <div className={`md:hidden fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
        <div
          className={`absolute inset-0 bg-background/70 backdrop-blur-sm transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`}
          onClick={() => setOpen(false)}
        />
        <aside
          className={`absolute top-0 left-0 h-full w-[78%] max-w-[320px] border-r border-border/70 bg-card/95 backdrop-blur-xl shadow-2xl transition-transform duration-250 ease-out ${open ? "translate-x-0" : "-translate-x-full"}`}
          role="dialog"
          aria-label="Navigation"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border/60">
            <div>
              <div className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">Menu</div>
              <div className="text-lg font-semibold tracking-tight">Sections</div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close navigation"
              className="h-9 w-9 rounded-lg border border-border/70 bg-background/60 flex items-center justify-center"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <nav className="p-3 flex flex-col gap-1">
            {nav.map(({ to, label, icon: Icon, exact }) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact: !!exact }}
                onClick={() => setOpen(false)}
                className="group flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent/60 data-[status=active]:text-primary data-[status=active]:bg-accent"
              >
                <span className="h-9 w-9 rounded-lg bg-muted/50 group-data-[status=active]:bg-primary/15 flex items-center justify-center">
                  <Icon className="h-4 w-4" />
                </span>
                {label}
              </Link>
            ))}
          </nav>
          <div className="mt-auto px-5 py-4 border-t border-border/60 text-[10px] uppercase tracking-widest text-muted-foreground">
            SFDS · Control Room
          </div>
        </aside>
      </div>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <Outlet />
      </main>

      <footer className="border-t border-border/70 bg-background/45 py-4 text-center text-xs text-muted-foreground">
        SFDS - Smart Fire Detection & Suppression for Electrical Distribution Boards
      </footer>
    </div>
  );
}
