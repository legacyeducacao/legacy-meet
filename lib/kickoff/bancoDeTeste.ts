// Só para testes: o mínimo das tabelas do Plan que as migrations da agenda
// (integracoes/agenda/001 e 003) e do kickoff referenciam, para rodar as
// migrations reais num Postgres em memória (PGlite). Não é usado pelo app.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const raiz = path.resolve(__dirname, '../..');

/** Conteúdo de um arquivo SQL do repositório. */
export const sqlDoRepo = (arquivo: string) => readFileSync(path.join(raiz, arquivo), 'utf8');

export const BASE_DO_PLAN = `
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  end $$;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;

  create type public.meeting_status as enum ('scheduled', 'live', 'ended', 'canceled', 'no_show');
  create table public.client_tenants (id uuid primary key, name text not null, produto text);
  create table public.users (id uuid primary key, name text not null, role text not null, tenant_id uuid references public.client_tenants(id));
  create table public.meetings (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.client_tenants(id) on delete cascade,
    host_id uuid references public.users(id),
    title text not null,
    scheduled_start_at timestamptz not null,
    scheduled_end_at timestamptz not null,
    status public.meeting_status not null default 'scheduled',
    room_name text not null unique
  );
  create table public.meet_meeting_sector (
    meeting_id uuid primary key references public.meetings(id) on delete cascade,
    sector text not null check (sector in ('comercial', 'executoria')),
    onboarding boolean not null default false
  );
  create table public.meet_user_profile (
    user_id uuid primary key,
    is_admin boolean not null default false,
    sector text not null default 'ambos'
  );
`;
