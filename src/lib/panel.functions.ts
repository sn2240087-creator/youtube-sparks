import { createServerFn } from "@tanstack/react-start";

export const addChannel = createServerFn({ method: "POST" })
  .inputValidator((d: { input: string }) => {
    const input = String(d.input ?? "").trim();
    if (!input || input.length > 300) throw new Error("Geçerli bir kanal girin.");
    return { input };
  })
  .handler(async ({ data }) => {
    const { getDb } = await import("./db.server");
    const { normalizeChannel, getChannelInfo } = await import("./supadata.server");
    const id = normalizeChannel(data.input);
    const info = await getChannelInfo(id);
    const { error } = await getDb().from("channels").insert({ input: id, name: info.name ?? id });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const checkChannel = createServerFn({ method: "POST" })
  .inputValidator((d: { channelId: string; limit?: number }) => ({
    channelId: String(d.channelId),
    limit: Math.min(Math.max(Number(d.limit ?? 3), 1), 10),
  }))
  .handler(async ({ data }) => {
    const { getDb } = await import("./db.server");
    const sd = await import("./supadata.server");
    const db = getDb();
    const { data: ch, error } = await db.from("channels").select("*").eq("id", data.channelId).single();
    if (error || !ch) throw new Error("Kanal bulunamadı.");
    const ids = await sd.getLatestVideoIds(ch.input, data.limit);
    const { data: existing } = await db.from("videos").select("video_id").in("video_id", ids.length ? ids : ["-"]);
    const known = new Set((existing ?? []).map((v) => v.video_id));
    const fresh = ids.filter((id) => !known.has(id));
    for (const vid of fresh) {
      const info = await sd.getVideoInfo(vid);
      await db.from("videos").insert({
        channel_id: ch.id,
        video_id: vid,
        title: info.title ?? vid,
        published_at: info.uploadDate ?? null,
      });
    }
    return { added: fresh.length };
  });

type Step = "transcript" | "clean" | "summary" | "analysis" | "ideas";

const LANG_RULE =
  "Yanıtını videonun transkriptiyle AYNI dilde yaz (video İngilizce ise İngilizce, Türkçe ise Türkçe vb.).";

const PROMPTS: Record<Exclude<Step, "transcript">, string> = {
  clean: `Sen bir transkript editörüsün. Verilen YouTube transkriptini temizle: sponsor/reklam okumaları, "abone olun / beğenin" çağrıları, selamlaşma ve kapanış lafları, tekrarlar, dolgu sözcükler (ee, şey, um, like) ve konu dışı muhabbetleri çıkar. Anlatılan bilgilerin hepsini koru, anlamı değiştirme, özetleme. Okunabilir paragraflara böl. Sadece temiz metni döndür. ${LANG_RULE}`,
  summary: `Verilen temiz transkriptin özetini çıkar. Markdown kullan: kısa bir giriş paragrafı, ardından "Ana Noktalar" madde listesi ve "Sonuç" bölümü. ${LANG_RULE}`,
  analysis: `Sen titiz bir araştırmacı ve doğruluk denetçisisin. Transkriptte öne sürülen bilgi ve iddiaları analiz et. Markdown rapor yaz:
1. Genel Değerlendirme (güvenilirlik puanı 1-10 ve kısa gerekçe)
2. İddia Tablosu: her önemli iddia için | İddia | Durum (Doğru / Kısmen doğru / Yanlış / Doğrulanamadı) | Açıklama |
3. Eksik Bilgiler: anlatılmayan ama önemli olan noktalar
4. Güncellik: eskimiş olabilecek bilgiler ve bilinen güncel durum
5. Dikkat Edilmesi Gerekenler
Bilgi kesim tarihini aşan konularda emin olmadığını açıkça belirt, uydurma. ${LANG_RULE}`,
  ideas: `Videodaki bilgilerden ve analizden yola çıkarak izleyiciye uygulanabilir yeni fikirler ve proje önerileri sun. Markdown: 5-8 öneri; her biri için başlık, kısa açıklama, neden değerli olduğu, ilk 3 adım ve zorluk seviyesi (Kolay/Orta/Zor). ${LANG_RULE}`,
};

export const processStep = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; step: Step }) => {
    const steps: Step[] = ["transcript", "clean", "summary", "analysis", "ideas"];
    if (!steps.includes(d.step)) throw new Error("Geçersiz adım");
    return { id: String(d.id), step: d.step };
  })
  .handler(async ({ data }) => {
    const { getDb } = await import("./db.server");
    const db = getDb();
    const { data: v } = await db.from("videos").select("*").eq("id", data.id).single();
    if (!v) throw new Error("Video bulunamadı.");
    const set = async (patch: Record<string, unknown>) => {
      await db.from("videos").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", v.id);
    };
    try {
      await set({ status: data.step, error: null });
      if (data.step === "transcript") {
        const { getTranscript } = await import("./supadata.server");
        const t = await getTranscript(v.video_id);
        await set({ raw_transcript: t.content, lang: t.lang ?? null });
        return { ok: true };
      }
      const { runAi } = await import("./ai.server");
      const clip = (s: string | null) => (s ?? "").slice(0, 180_000);
      const header = `Video başlığı: ${v.title ?? ""}\n\n`;
      if (data.step === "clean") {
        if (!v.raw_transcript) throw new Error("Önce transkript alınmalı.");
        await set({ clean_transcript: await runAi(PROMPTS.clean, header + clip(v.raw_transcript)) });
      } else if (data.step === "summary") {
        await set({ summary: await runAi(PROMPTS.summary, header + clip(v.clean_transcript ?? v.raw_transcript)) });
      } else if (data.step === "analysis") {
        await set({ analysis: await runAi(PROMPTS.analysis, header + clip(v.clean_transcript ?? v.raw_transcript)) });
      } else if (data.step === "ideas") {
        const input = `${header}ÖZET:\n${v.summary ?? ""}\n\nANALİZ:\n${v.analysis ?? ""}\n\nTRANSKRİPT:\n${clip(v.clean_transcript).slice(0, 60_000)}`;
        await set({ ideas: await runAi(PROMPTS.ideas, input), status: "done" });
      }
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await set({ status: "error", error: msg });
      throw new Error(msg);
    }
  });
