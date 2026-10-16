// Server-only: streams a Lovable AI Gateway Responses call and returns final text.
const GATEWAY = "https://ai.gateway.lovable.dev/v1/responses";
export const AI_MODEL = "openai/gpt-6-astra";

export class AiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function runAi(instructions: string, userText: string): Promise<string> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new AiError(401, "AI anahtarı yapılandırılmamış.");

  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      input: [
        { role: "system", content: instructions },
        { role: "user", content: userText },
      ],
      stream: true,
      store: false,
      reasoning: { effort: "low", summary: "auto" },
      include: ["reasoning.encrypted_content"],
    }),
  });

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    let msg = body;
    try {
      const j = JSON.parse(body);
      msg = j?.error?.message ?? j?.message ?? body;
    } catch {}
    if (res.status === 402) msg = `AI kredisi yetersiz. ${msg}`;
    if (res.status === 429) msg = `Çok fazla istek, biraz sonra tekrar deneyin. ${msg}`;
    throw new AiError(res.status, msg || `AI isteği başarısız (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let ev: any;
        try {
          ev = JSON.parse(data);
        } catch {
          continue;
        }
        if (ev.type === "response.output_text.delta") text += ev.delta ?? "";
        else if (ev.type === "response.failed" || ev.type === "error") {
          const m = ev.response?.error?.message ?? ev.error?.message ?? ev.message ?? "AI hatası";
          throw new AiError(500, m);
        }
      }
    }
  }
  if (!text.trim()) throw new AiError(500, "AI boş yanıt döndürdü (içerik reddedilmiş olabilir).");
  return text.trim();
}
