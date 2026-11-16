-- Kickoff Impulsão, etapa M1: sessões de kickoff como eventos da agenda do Meet.
-- Projeto legacy-plan (eddfdgefrwjxfafkkzls). ADITIVA e idempotente.
--
-- STATUS: NÃO APLICADA. Aplicar só com autorização. Enquanto não for aplicada,
-- o app continua funcionando: o kickoff fica "estrutura pendente" e a criação
-- de sessões de kickoff é recusada (ver docs/kickoff/README.md).
--
-- O que entra:
--   1. meet_user_profile.capacidades: permissões funcionais por usuário do
--      Meet, no perfil que já existe (sem tabela nova de usuários). Hoje só
--      'kickoff_impulsao.manage'. Admin do Meet concede e revoga na tela Usuários.
--   2. agenda_kickoff_sessoes: marca uma reunião da agenda (public.meetings)
--      como sessão de kickoff (1 para 1). Data, hora, recorrência, anfitrião e
--      conflitos continuam na agenda; aqui fica só o que é do kickoff.
--   3. agenda_do_cliente(): passa a ignorar sessões de kickoff. As sessões
--      ficam na empresa organizadora interna, e os logins dela não devem ver
--      as sessões nem o link da sala do Meet (que o kickoff não usa).
--
-- Não entra (etapas seguintes): reservas, convites, Zoom, presença.
-- Não cria a empresa organizadora: ela vem de MEET_KICKOFF_TENANT_ID.

-- ---------------------------------------------------------------------------
-- 1. Permissões funcionais no perfil do Meet
-- ---------------------------------------------------------------------------
alter table public.meet_user_profile
  add column if not exists capacidades text[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'meet_user_profile_capacidades_ck') then
    alter table public.meet_user_profile
      add constraint meet_user_profile_capacidades_ck
      check (capacidades <@ array['kickoff_impulsao.manage']::text[]);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Sessão de kickoff: extensão 1:1 de uma reunião da agenda
-- ---------------------------------------------------------------------------
create table if not exists public.agenda_kickoff_sessoes (
  meeting_id uuid primary key references public.meetings(id) on delete cascade,
  tipo text not null default 'kickoff_impulsao' check (tipo = 'kickoff_impulsao'),
  -- Empresas por sessão (as reservas entram na M3).
  capacidade int not null default 5 check (capacidade between 1 and 50),
  -- false = a sessão acontece, mas não recebe novas reservas (M3).
  aceita_reservas boolean not null default true,
  criado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.agenda_kickoff_sessoes enable row level security;
revoke all on public.agenda_kickoff_sessoes from anon, authenticated;
grant all on public.agenda_kickoff_sessoes to service_role;

-- ---------------------------------------------------------------------------
-- 3. Agenda do cliente (Plan) sem sessões de kickoff
-- Mesma função de integracoes/agenda/003_agenda_cliente.sql; só muda o where.
-- create or replace mantém os grants que já existem.
-- ---------------------------------------------------------------------------
create or replace function public.agenda_do_cliente(
  p_de date default (current_date - 30),
  p_ate date default (current_date + 120)
)
returns table (
  reuniao_id uuid,
  titulo text,
  inicio timestamptz,
  fim timestamptz,
  status text,
  produto text,
  rotulo text,
  executor text,
  em_grupo boolean,
  link_sala text,
  tem_gravacao boolean
)
language sql stable security definer set search_path = public as $$
  with t as (select public.agenda_tenant_do_usuario() as tenant_id),
  -- reuniões da empresa + encontros em grupo (Impulsão) em que ela está matriculada
  ids as (
    select m.id, false as em_grupo from public.meetings m, t where m.tenant_id = t.tenant_id
    union
    select e.meeting_id, true from public.agenda_jornada_encontros e
      join public.agenda_jornadas j on j.id = e.jornada_id, t
      where j.tenant_id = t.tenant_id and e.meeting_id is not null and j.produto = 'impulsao'
  )
  select
    m.id,
    coalesce(nullif(trim(m.title), ''), 'Reunião'),
    m.scheduled_start_at,
    coalesce(m.scheduled_end_at, m.scheduled_start_at + interval '1 hour'),
    m.status::text,
    case
      when bool_or(ids.em_grupo) then 'impulsao'
      when ct.produto = 'impulsao_empresarial' then 'impulsao'
      when ct.produto like 'legado%' then 'legado'
      else 'outro'
    end,
    max(o.rotulo),
    max(u.name),
    bool_or(ids.em_grupo),
    case when m.status in ('scheduled', 'live') then 'https://meet.legacyexecutoria.com.br/rooms/' || m.room_name end,
    exists (select 1 from public.agenda_gravacoes_duracao g where g.meeting_id = m.id)
  from ids
  join public.meetings m on m.id = ids.id
  join public.meet_meeting_sector s on s.meeting_id = m.id and s.sector = 'executoria'
  left join public.client_tenants ct on ct.id = m.tenant_id
  left join public.users u on u.id = m.host_id
  left join public.agenda_ocorrencias o on o.meeting_id = m.id
  where m.status <> 'canceled'
    and m.scheduled_start_at >= p_de::timestamptz - interval '1 day'
    and m.scheduled_start_at < (p_ate + 1)::timestamptz + interval '1 day'
    -- Kickoff Impulsão (M1): sessão da empresa organizadora não aparece para os logins dela.
    and not exists (select 1 from public.agenda_kickoff_sessoes k where k.meeting_id = m.id)
  group by m.id, ct.produto
  order by m.scheduled_start_at
$$;
