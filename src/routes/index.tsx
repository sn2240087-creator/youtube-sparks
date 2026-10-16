import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { supabase } from "@/integrations/supabase/client";
import { addChannel, checkChannel, processStep } from "@/lib/panel.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Kanal Analiz Masası — YouTube transkript ve doğruluk raporu" },
      { name: "description", content: "YouTube kanallarının son videolarını temizlenmiş transkript, özet, doğruluk analizi ve proje fikirlerine dönüştürün." },
      { property: "og:title", content: "Kanal Analiz Masası" },
      { property: "og:description", content: "Son videolar → transkript, özet, doğruluk raporu ve yeni fikirler." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Panel,
});

const STEPS = ["transcript", "clean", "summary", "analysis", "ideas"] as const;
const STEP_LABEL: Record<string, string> = {
  pending: "Bekliyor",
  transcript: "Transkript alınıyor",
  clean: "Temizleniyor",
  summary: "Özetleniyor",
  analysis: "Analiz ediliyor",
  ideas: "Fikir üretiliyor",
  done: "Tamamlandı",
  error: "Hata",
};
const TABS = [
  ["summary", "Özet"],
  ["analysis", "Doğruluk Raporu"],
  ["ideas", "Fikirler & Projeler"],
  ["clean_transcript", "Temiz Transkript"],
  ["raw_transcript", "Ham Transkript"],
] as const;

function Panel() {
  const qc = useQueryClient();
  const add = useServerFn(addChannel);
  const check = useServerFn(checkChannel);
  const step = useServerFn(processStep);
  const [input, setInput] = useState("");
  const [limit, setLimit] = useState(3);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("summary");
  const [filter, setFilter] = useState<string | null>(null);

  const channels = useQuery({
    queryKey: ["channels"],
    queryFn: async () => (await supabase.from("channels").select("*").order("created_at")).data ?? [],
  });
  const videos = useQuery({
    queryKey: ["videos"],
    queryFn: async () =>
      (await supabase.from("videos").select("*").order("published_at", { ascending: false, nullsFirst: false })).data ?? [],
    refetchInterval: busy ? 3000 : false,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["channels"] });
    qc.invalidateQueries({ queryKey: ["videos"] });
  };

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      refresh();
    }
  }

  async function processVideo(v: { id: string; raw_transcript: string | null; clean_transcript: string | null; summary: string | null; analysis: string | null; ideas: string | null }) {
    const have: Record<string, unknown> = {
      transcript: v.raw_transcript,
      clean: v.clean_transcript,
      summary: v.summary,
      analysis: v.analysis,
      ideas: v.ideas,
    };
    for (const s of STEPS) {
      if (have[s]) continue;
      await step({ data: { id: v.id, step: s } });
      refresh();
    }
  }

  async function checkAll(channelIds: string[]) {
    for (const id of channelIds) await check({ data: { channelId: id, limit } });
    const { data } = await supabase.from("videos").select("*").in("channel_id", channelIds).neq("status", "done");
    for (const v of data ?? []) {
      try {
        await processVideo(v);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        if (/kredi|402|403/i.test(String(e))) break;
      }
    }
  }

  const list = (videos.data ?? []).filter((v) => !filter || v.channel_id === filter);
  const current = (videos.data ?? []).find((v) => v.id === selected);
  const chName = (id: string) => channels.data?.find((c) => c.id === id)?.name ?? "";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-6 py-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Araştırma masası</p>
          <h1 className="text-3xl font-bold">Kanal Analiz Masası</h1>
        </div>
        <div className="flex items-center gap-3">
          <label className="font-mono text-xs text-muted-foreground">
            Kanal başına video
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="ml-2 rounded border border-input bg-card px-2 py-1 text-foreground"
            >
              {[1, 2, 3, 5, 10].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <button
            disabled={!!busy || !channels.data?.length}
            onClick={() => run("all", () => checkAll((channels.data ?? []).map((c) => c.id)))}
            className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground shadow-glow transition hover:brightness-110 disabled:opacity-40"
          >
            {busy === "all" ? "İşleniyor…" : "Tüm kanalları kontrol et"}
          </button>
        </div>
      </header>

      {err && (
        <div className="mx-6 mt-4 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {err}
        </div>
      )}

      <div className="grid gap-6 p-6 lg:grid-cols-[280px_340px_1fr]">
        {/* Channels */}
        <aside className="space-y-4">
          <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Kanallar</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!input.trim()) return;
              run("add", async () => {
                await add({ data: { input } });
                setInput("");
              });
            }}
            className="flex gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="@kanaladi veya link"
              className="min-w-0 flex-1 rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <button disabled={!!busy} className="rounded-md border border-primary px-3 text-sm text-primary hover:bg-primary hover:text-primary-foreground disabled:opacity-40">
              Ekle
            </button>
          </form>
          <ul className="space-y-1">
            <li>
              <button onClick={() => setFilter(null)} className={`w-full rounded px-3 py-2 text-left text-sm ${!filter ? "bg-accent" : "hover:bg-muted"}`}>
                Tümü
              </button>
            </li>
            {channels.data?.map((c) => (
              <li key={c.id} className={`group flex items-center gap-1 rounded ${filter === c.id ? "bg-accent" : "hover:bg-muted"}`}>
                <button onClick={() => setFilter(c.id)} className="flex-1 truncate px-3 py-2 text-left text-sm">
                  {c.name}
                </button>
                <button
                  title="Bu kanalı kontrol et"
                  disabled={!!busy}
                  onClick={() => run(c.id, () => checkAll([c.id]))}
                  className="px-2 font-mono text-xs text-primary disabled:opacity-40"
                >
                  {busy === c.id ? "…" : "↻"}
                </button>
                <button
                  title="Sil"
                  onClick={() => run("del", async () => { await supabase.from("channels").delete().eq("id", c.id); })}
                  className="px-2 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          {!channels.data?.length && <p className="text-sm text-muted-foreground">Başlamak için bir YouTube kanalı ekleyin.</p>}
        </aside>

        {/* Videos */}
        <section className="space-y-2">
          <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Videolar</h2>
          {list.map((v) => (
            <button
              key={v.id}
              onClick={() => setSelected(v.id)}
              className={`block w-full rounded-md border p-3 text-left transition ${selected === v.id ? "border-primary bg-card shadow-glow" : "border-border bg-card/50 hover:bg-card"}`}
            >
              <div className="line-clamp-2 text-sm font-medium">{v.title}</div>
              <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-muted-foreground">
                <span className="truncate">{chName(v.channel_id)}</span>
                <span className={v.status === "done" ? "text-success" : v.status === "error" ? "text-destructive" : "text-primary"}>
                  {STEP_LABEL[v.status] ?? v.status}
                </span>
              </div>
            </button>
          ))}
          {!list.length && <p className="text-sm text-muted-foreground">Henüz video yok. "Kontrol et" ile son videoları çekin.</p>}
        </section>

        {/* Detail */}
        <main className="min-w-0 rounded-lg border border-border bg-card p-6">
          {!current ? (
            <p className="text-muted-foreground">Detayları görmek için bir video seçin.</p>
          ) : (
            <div>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-bold leading-tight">{current.title}</h2>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {chName(current.channel_id)}
                    {current.published_at && ` · ${new Date(current.published_at).toLocaleDateString("tr-TR")}`}
                    {current.lang && ` · ${current.lang.toUpperCase()}`}
                  </p>
                </div>
                <div className="flex gap-2">
                  <a href={`https://www.youtube.com/watch?v=${current.video_id}`} target="_blank" rel="noreferrer" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
                    YouTube'da aç
                  </a>
                  {current.status !== "done" && (
                    <button
                      disabled={!!busy}
                      onClick={() => run("one", () => processVideo(current))}
                      className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-40"
                    >
                      {busy === "one" ? "İşleniyor…" : current.status === "error" ? "Tekrar dene" : "İşle"}
                    </button>
                  )}
                </div>
              </div>
              {current.error && <p className="mt-3 text-sm text-destructive">{current.error}</p>}
              <nav className="mt-5 flex flex-wrap gap-1 border-b border-border">
                {TABS.map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setTab(k)}
                    className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                  >
                    {label}
                  </button>
                ))}
              </nav>
              <div className="prose-panel mt-4 max-w-none text-sm text-foreground/90">
                {current[tab] ? (
                  tab.includes("transcript") ? (
                    <div className="whitespace-pre-wrap leading-relaxed">{current[tab]}</div>
                  ) : (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{current[tab]!}</ReactMarkdown>
                  )
                ) : (
                  <p className="text-muted-foreground">Bu bölüm henüz hazır değil.</p>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
