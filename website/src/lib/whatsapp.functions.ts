import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";

const InputSchema = z.object({
  to: z.string().trim().min(6).max(32).regex(/^\+?[0-9]{6,20}$/, "Invalid phone number"),
  from: z.string().trim().min(6).max(32).regex(/^\+?[0-9]{6,20}$/, "Invalid sender number"),
  body: z.string().trim().min(1).max(1000),
});

function waFormat(num: string) {
  const n = num.startsWith("+") ? num : `+${num}`;
  return `whatsapp:${n}`;
}

export const sendWhatsAppAlert = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
    const TWILIO_API_KEY = process.env.TWILIO_API_KEY;
    if (!TWILIO_API_KEY) throw new Error("TWILIO_API_KEY is not configured");

    const res = await fetch(`${GATEWAY_URL}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": TWILIO_API_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: waFormat(data.to),
        From: waFormat(data.from),
        Body: data.body,
      }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json?.message || `Twilio error ${res.status}`;
      throw new Error(msg);
    }
    return { sid: json.sid as string };
  });