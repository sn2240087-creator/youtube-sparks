const BASE = "https://api.supadata.ai/v1";

async function call(path: string, params: Record<string, string>) {
  const key = process.env["SUPADATA_API_KEY"];
  if (!key) throw new Error("Altyazı servisi anahtarı (SUPADATA_API_KEY) eklenmemiş.");
  const url = `${BASE}${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { "x-api-key": key } });
  const body = await res.text();
  if (!res.ok) {
    let msg = body;
    try {
      const j = JSON.parse(body);
      msg = j.message ?? j.error ?? body;
    } catch {}
    throw new Error(`Altyazı servisi hatası [${res.status}]: ${msg}`);
  }
  return JSON.parse(body);
}

export function normalizeChannel(input: string) {
  const s = input.trim();
  if (/^https?:\/\//.test(s)) return s;
  if (s.startsWith("@") || s.startsWith("UC")) return s;
  return `@${s}`;
}

export async function getChannelInfo(id: string): Promise<{ name?: string }> {
  try {
    const j = await call("/youtube/channel", { id });
    return { name: j.name ?? j.title };
  } catch {
    return {};
  }
}

export async function getLatestVideoIds(id: string, limit: number): Promise<string[]> {
  const j = await call("/youtube/channel/videos", { id, limit: String(limit), type: "video" });
  return (j.videoIds ?? []) as string[];
}

export async function getVideoInfo(videoId: string): Promise<{ title?: string; uploadDate?: string }> {
  try {
    const j = await call("/youtube/video", { id: videoId });
    return { title: j.title, uploadDate: j.uploadDate };
  } catch {
    return {};
  }
}

export async function getTranscript(videoId: string): Promise<{ content: string; lang?: string }> {
  const j = await call("/youtube/transcript", { videoId, text: "true" });
  const content =
    typeof j.content === "string"
      ? j.content
      : Array.isArray(j.content)
        ? j.content.map((c: any) => c.text).join(" ")
        : "";
  if (!content.trim()) throw new Error("Bu video için transkript bulunamadı.");
  return { content, lang: j.lang };
}
