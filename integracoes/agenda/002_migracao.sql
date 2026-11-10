-- Fase 6: migração das séries existentes para o modelo da agenda nova.
-- Reversível: cada lote fica em agenda_migracoes e as linhas criadas levam
-- migracao_id; reverter = apagar as linhas do lote (meetings não mudam).
create table if not exists public.agenda_migracoes (
  id uuid primary key default gen_random_uuid(),
  executada_por uuid references auth.users(id) on delete set null,
  executada_em timestamptz not null default now(),
  revertida_em timestamptz,
  relatorio jsonb not null default '{}'::jsonb
);
alter table public.agenda_series add column if not exists migracao_id uuid references public.agenda_migracoes(id) on delete set null;
alter table public.agenda_jornadas add column if not exists migracao_id uuid references public.agenda_migracoes(id) on delete set null;
create index if not exists agenda_series_migracao_idx on public.agenda_series (migracao_id);
create index if not exists agenda_jornadas_migracao_idx on public.agenda_jornadas (migracao_id);
alter table public.agenda_migracoes enable row level security;
revoke all on public.agenda_migracoes from anon, authenticated;
grant all on public.agenda_migracoes to service_role;
