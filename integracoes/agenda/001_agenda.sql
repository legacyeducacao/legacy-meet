-- Nova agenda do Legacy Meet (fases 3 a 5). Projeto legacy-plan (eddfdgefrwjxfafkkzls).
-- ADITIVA: não altera public.meetings (compartilhada com o CRM). Cada encontro
-- continua sendo uma linha em meetings (room_name -> gravação/transcrição);
-- estas tabelas guardam regra, série, grupo, jornada, disponibilidade e KPIs.
-- RLS ligado sem policies: só o servidor (service_role) lê e escreve, como
-- meet_meeting_hosts. A leitura pelo Plan (cliente) vem depois por view.

-- Flag da agenda nova por usuário (admin sempre vê).
alter table public.meet_user_profile
  add column if not exists agenda_nova boolean not null default false;

-- Padrões da empresa (só admin altera): expediente, regras, níveis, horizonte...
create table if not exists public.agenda_config (
  chave text primary key,
  valor jsonb not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users(id) on delete set null
);

create table if not exists public.agenda_templates (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  produto text not null check (produto in ('impulsao', 'legado', 'personalizado')),
  duracao_min int not null default 60 check (duracao_min > 0),
  rrule_padrao text,
  hora_padrao text check (hora_padrao is null or hora_padrao ~ '^\d{2}:\d{2}$'),
  sequencia text[] not null default '{}',
  defasagem_padrao int not null default 0,
  entradas_permitidas text[] not null default '{}',
  politica_feriado text not null default 'manter'
    check (politica_feriado in ('pausa', 'segue', 'pular', 'manter', 'cancelar')),
  encontros_total int check (encontros_total is null or encontros_total > 0),
  limite_remarcacoes int,
  preparo_min int not null default 0,
  -- campos que o executor pode ajustar ao usar o template (o resto só admin)
  campos_editaveis text[] not null default '{}',
  ativo boolean not null default true,
  criado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.agenda_grupos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  template_id uuid references public.agenda_templates(id) on delete set null,
  executor_id uuid not null references public.users(id),
  substituto_id uuid references public.users(id),
  tenant_id uuid references public.client_tenants(id) on delete set null,
  dia_semana smallint not null check (dia_semana between 1 and 7),
  hora text not null check (hora ~ '^\d{2}:\d{2}$'),
  duracao_min int not null check (duracao_min > 0),
  fuso text not null default 'America/Sao_Paulo',
  sequencia text[] not null default '{}',
  defasagem int not null default 0,
  ancora date not null,
  politica_feriado text not null default 'pausa' check (politica_feriado in ('pausa', 'segue')),
  entradas_permitidas text[] not null default '{}',
  inicio date,
  fim date,
  ativo boolean not null default true,
  criado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.agenda_series (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references public.agenda_templates(id) on delete set null,
  grupo_id uuid references public.agenda_grupos(id) on delete set null,
  executor_id uuid not null references public.users(id),
  titulo text not null,
  setor text not null default 'executoria' check (setor in ('executoria', 'comercial')),
  tenant_id uuid references public.client_tenants(id) on delete set null,
  rrule text not null,
  inicio_local text not null check (inicio_local ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$'),
  fuso text not null default 'America/Sao_Paulo',
  duracao_min int not null check (duracao_min > 0),
  sequencia text[] not null default '{}',
  defasagem int not null default 0,
  politica_feriado text not null default 'manter'
    check (politica_feriado in ('pausa', 'segue', 'pular', 'manter', 'cancelar')),
  horizonte_meses int not null default 6,
  gravar boolean not null default true,
  transcrever boolean not null default true,
  onboarding boolean not null default false,
  -- "este e os seguintes" encerra esta série e cria outra apontando para cá
  serie_anterior_id uuid references public.agenda_series(id) on delete set null,
  -- id da 1ª reunião (public.meetings.recurrence_parent_id das ocorrências)
  recurrence_parent_id uuid,
  encerrada_em timestamptz,
  criado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.agenda_ocorrencias (
  id uuid primary key default gen_random_uuid(),
  serie_id uuid not null references public.agenda_series(id) on delete cascade,
  inicio_original timestamptz not null,
  ordem int,
  rotulo text,
  status text not null default 'agendada'
    check (status in ('agendada', 'movida', 'cancelada', 'pulada_feriado', 'realizada', 'no_show')),
  excecao boolean not null default false,
  motivo_excecao text,
  executor_substituto_id uuid references public.users(id),
  meeting_id uuid unique references public.meetings(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (serie_id, inicio_original)
);

create table if not exists public.agenda_jornadas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.client_tenants(id) on delete cascade,
  produto text not null check (produto in ('impulsao', 'legado')),
  grupo_id uuid references public.agenda_grupos(id) on delete set null,
  serie_id uuid references public.agenda_series(id) on delete set null,
  executor_id uuid references public.users(id),
  inicio date not null,
  fim_previsto date,
  encontros_previstos int not null check (encontros_previstos > 0),
  status text not null default 'ativa' check (status in ('ativa', 'concluida', 'pausada', 'cancelada')),
  criado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.agenda_jornada_encontros (
  jornada_id uuid not null references public.agenda_jornadas(id) on delete cascade,
  numero int not null check (numero > 0),
  rotulo text,
  data date,
  grupo_id uuid references public.agenda_grupos(id) on delete set null,
  meeting_id uuid references public.meetings(id) on delete set null,
  recuperacao boolean not null default false,
  presenca text not null default 'pendente' check (presenca in ('pendente', 'presente', 'faltou')),
  primary key (jornada_id, numero)
);

create table if not exists public.agenda_expediente (
  executor_id uuid not null references public.users(id) on delete cascade,
  dia_semana smallint not null check (dia_semana between 1 and 7),
  inicio text not null check (inicio ~ '^\d{2}:\d{2}$'),
  fim text not null check (fim ~ '^\d{2}:\d{2}$'),
  primary key (executor_id, dia_semana, inicio),
  check (inicio < fim)
);

create table if not exists public.agenda_bloqueios (
  id uuid primary key default gen_random_uuid(),
  executor_id uuid not null references public.users(id) on delete cascade,
  inicio timestamptz not null,
  fim timestamptz not null,
  dia_inteiro boolean not null default false,
  rrule text,
  fuso text not null default 'America/Sao_Paulo',
  -- privado: só o dono e admin veem; os outros veem "Indisponível"
  motivo text,
  criado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  check (fim > inicio)
);

create table if not exists public.agenda_regras_executor (
  executor_id uuid primary key references public.users(id) on delete cascade,
  buffer_min int,
  max_reunioes_dia int,
  max_horas_dia numeric,
  max_horas_semana numeric,
  uf text,
  municipio text,
  atualizado_por uuid references auth.users(id) on delete set null,
  atualizado_em timestamptz not null default now()
);

create table if not exists public.agenda_feriados (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  nome text not null,
  escopo text not null check (escopo in ('nacional', 'estadual', 'municipal', 'legacy')),
  uf text,
  municipio text,
  criado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now()
);
create unique index if not exists agenda_feriados_uidx
  on public.agenda_feriados (data, escopo, coalesce(uf, ''), coalesce(municipio, ''));

create table if not exists public.agenda_overrides_log (
  id uuid primary key default gen_random_uuid(),
  regra text not null,
  nivel text not null check (nivel in ('bloqueante', 'aviso')),
  meeting_id uuid references public.meetings(id) on delete set null,
  serie_id uuid references public.agenda_series(id) on delete set null,
  usuario_id uuid references auth.users(id) on delete set null,
  justificativa text not null,
  detalhes jsonb,
  criado_em timestamptz not null default now()
);

create table if not exists public.agenda_cancelamentos (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  origem text not null check (origem in ('cliente', 'executor', 'legacy')),
  usuario_id uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now()
);

create table if not exists public.agenda_remarcacoes (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  origem text check (origem in ('cliente', 'executor', 'legacy')),
  de_inicio timestamptz not null,
  para_inicio timestamptz not null,
  usuario_id uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now()
);

-- Duração real de cada gravação (fonte das "horas realizadas" do painel).
create table if not exists public.agenda_gravacoes_duracao (
  recording_id text primary key,
  meeting_id uuid references public.meetings(id) on delete set null,
  room_name text not null,
  inicio timestamptz,
  duracao_seg int not null check (duracao_seg >= 0),
  criado_em timestamptz not null default now()
);

create index if not exists agenda_series_executor_idx on public.agenda_series (executor_id);
create index if not exists agenda_series_parent_idx on public.agenda_series (recurrence_parent_id);
create index if not exists agenda_ocorrencias_serie_idx on public.agenda_ocorrencias (serie_id);
create index if not exists agenda_grupos_executor_idx on public.agenda_grupos (executor_id);
create index if not exists agenda_jornadas_tenant_idx on public.agenda_jornadas (tenant_id);
create index if not exists agenda_bloqueios_exec_idx on public.agenda_bloqueios (executor_id, inicio);
create index if not exists agenda_cancelamentos_meeting_idx on public.agenda_cancelamentos (meeting_id);
create index if not exists agenda_remarcacoes_meeting_idx on public.agenda_remarcacoes (meeting_id);
create index if not exists agenda_gravacoes_meeting_idx on public.agenda_gravacoes_duracao (meeting_id);
create index if not exists agenda_gravacoes_room_idx on public.agenda_gravacoes_duracao (room_name);

do $$
declare t text;
begin
  foreach t in array array[
    'agenda_config','agenda_templates','agenda_grupos','agenda_series','agenda_ocorrencias',
    'agenda_jornadas','agenda_jornada_encontros','agenda_expediente','agenda_bloqueios',
    'agenda_regras_executor','agenda_feriados','agenda_overrides_log','agenda_cancelamentos',
    'agenda_remarcacoes','agenda_gravacoes_duracao'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
