import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { SystemProvider } from "@/context/SystemContext";
import { AppShell } from "@/components/app/AppShell";
import { Toaster } from "@/components/ui/sonner";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "SFDS — Smart Fire Detection & Suppression Dashboard" },
      { name: "description", content: "IoT dashboard for early fire detection and automatic suppression in electrical distribution boards." },
      { property: "og:title", content: "SFDS — Smart Fire Detection & Suppression Dashboard" },
      { property: "og:description", content: "IoT dashboard for early fire detection and automatic suppression in electrical distribution boards." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "SFDS — Smart Fire Detection & Suppression Dashboard" },
      { name: "twitter:description", content: "IoT dashboard for early fire detection and automatic suppression in electrical distribution boards." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/a799aa2e-d307-467d-9ec5-644e3911c517/id-preview-db55bf9f--8b961011-b570-4ed5-9d2b-00405277035a.lovable.app-1778087683093.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/a799aa2e-d307-467d-9ec5-644e3911c517/id-preview-db55bf9f--8b961011-b570-4ed5-9d2b-00405277035a.lovable.app-1778087683093.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        <SystemProvider>
          <AppShell />
          <Toaster richColors position="top-right" />
        </SystemProvider>
        <Scripts />
      </body>
    </html>
  );
}
