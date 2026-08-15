import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

type ResetStateBody = {
  state?: "ON" | "OFF" | string;
};

export const Route = createFileRoute("/api/public/reset-state")({
  server: {
    handlers: {
      GET: async ({ request }) => readResetState(request),
      PUT: async () => new Response("Method Not Allowed", { status: 405, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } }),
    },
  },
});

function createResetStateClient(preferServiceRole = false) {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = preferServiceRole
    ? process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
    : process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function readResetState(request: Request) {
  const supabase = createResetStateClient();
  if (!supabase) {
    return new Response("OFF", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const { data } = await supabase
    .from("reset_state")
    .select("state,last_reset_at")
    .eq("id", 1)
    .maybeSingle();

  const state = (data?.state ?? "OFF") as "ON" | "OFF";
  const format = new URL(request.url).searchParams.get("format");

  if (format === "json") {
    return Response.json(
      { state, last_reset_at: data?.last_reset_at ?? null },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(state, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

