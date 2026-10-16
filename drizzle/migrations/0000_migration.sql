CREATE TABLE public.channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  input text NOT NULL,
  name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  video_id text NOT NULL UNIQUE,
  title text,
  published_at timestamptz,
  lang text,
  status text NOT NULL DEFAULT 'pending',
  error text,
  raw_transcript text,
  clean_transcript text,
  summary text,
  analysis text,
  ideas text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.channels TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.videos TO anon, authenticated;
GRANT ALL ON public.channels TO service_role;
GRANT ALL ON public.videos TO service_role;
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open panel channels" ON public.channels FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open panel videos" ON public.videos FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);