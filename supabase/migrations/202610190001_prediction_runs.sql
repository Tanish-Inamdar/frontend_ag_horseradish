-- Fieldwise saved prediction runs.
-- Run once in the Supabase SQL Editor. RLS keeps each user's runs private.

create table if not exists public.prediction_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  source_filename text not null,
  model_name text,
  device text,
  image_width integer,
  image_height integer,
  tile_count integer not null default 1,
  confidence_cutoff integer not null default 70
    check (confidence_cutoff between 0 and 100),
  detection_count integer not null default 0,
  detections jsonb not null default '[]'::jsonb
    check (jsonb_typeof(detections) = 'array'),
  image_path text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists prediction_runs_user_created_idx
  on public.prediction_runs (user_id, created_at desc);

alter table public.prediction_runs enable row level security;
grant select, insert, update, delete on public.prediction_runs to authenticated;

drop policy if exists "Read own prediction runs" on public.prediction_runs;
create policy "Read own prediction runs"
  on public.prediction_runs for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Insert own prediction runs" on public.prediction_runs;
create policy "Insert own prediction runs"
  on public.prediction_runs for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Update own prediction runs" on public.prediction_runs;
create policy "Update own prediction runs"
  on public.prediction_runs for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Delete own prediction runs" on public.prediction_runs;
create policy "Delete own prediction runs"
  on public.prediction_runs for delete to authenticated
  using (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'fieldwise-run-images',
  'fieldwise-run-images',
  false,
  52428800,
  array['image/jpeg', 'image/png', 'image/tiff']
)
on conflict (id) do nothing;

drop policy if exists "Read own run images" on storage.objects;
create policy "Read own run images"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'fieldwise-run-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Upload own run images" on storage.objects;
create policy "Upload own run images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'fieldwise-run-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Delete own run images" on storage.objects;
create policy "Delete own run images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'fieldwise-run-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
