-- Integração Legacy Meet -> ExecScore
-- Projeto Supabase: legacy-plan (eddfdgefrwjxfafkkzls), onde vivem public.meetings
-- (Legacy Meet) e o schema execscore. Migration ADITIVA: não altera nem apaga
-- nada que já existe; o ExecScore atual continua funcionando igual.

-- 1) Vínculo avaliação <-> reunião do Meet (uma avaliação por reunião).
alter table execscore.executor_evaluations
  add column if not exists meeting_id uuid references public.meetings(id) on delete set null,
  add column if not exists meet_recording_ids text[];

create unique index if not exists executor_evaluations_meeting_id_uidx
  on execscore.executor_evaluations (meeting_id)
  where meeting_id is not null;

-- 2) Estado da integração por reunião: pilares desligados pelo executor,
--    gravações transcritas e o andamento do envio ao ExecScore.
create table if not exists execscore.meet_integracao (
  meeting_id uuid primary key references public.meetings(id) on delete cascade,
  executor_id uuid not null references execscore.executors(id) on delete cascade,
  -- null = o executor ainda não escolheu; '{}' = escolheu manter todos os pilares.
  pilares_desabilitados text[],
  pilares_escolhidos_em timestamptz,
  pilares_escolhidos_por uuid references auth.users(id) on delete set null,
  recording_ids text[] not null default '{}',
  transcricao_pronta_em timestamptz,
  status text not null default 'aguardando'
    check (status in ('aguardando', 'processando', 'enviada', 'erro')),
  evaluation_id uuid references execscore.executor_evaluations(id) on delete set null,
  tentativas integer not null default 0,
  ultimo_erro text,
  processando_desde timestamptz,
  enviada_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meet_integracao_pilares_validos check (
    pilares_desabilitados is null or (
      pilares_desabilitados <@ array[
        'score_estrategia','score_financeiro','score_execucao',
        'score_processos','score_marketing','score_lideranca'
      ]::text[]
      -- pelo menos um pilar precisa continuar ativo
      and coalesce(cardinality(pilares_desabilitados), 0) < 6
    )
  )
);

create index if not exists meet_integracao_fila_idx
  on execscore.meet_integracao (status, transcricao_pronta_em);
create index if not exists meet_integracao_executor_idx
  on execscore.meet_integracao (executor_id);

drop trigger if exists meet_integracao_updated_at on execscore.meet_integracao;
create trigger meet_integracao_updated_at
  before update on execscore.meet_integracao
  for each row execute function execscore.update_updated_at_column();

-- RLS: o Legacy Meet escreve com service_role (ignora RLS). Pelo app do
-- ExecScore, admin vê tudo e o executor vê só as próprias reuniões.
alter table execscore.meet_integracao enable row level security;

drop policy if exists "Admins gerenciam meet_integracao" on execscore.meet_integracao;
create policy "Admins gerenciam meet_integracao" on execscore.meet_integracao
  for all to authenticated
  using (execscore.has_role(auth.uid(), 'admin'::execscore.app_role))
  with check (execscore.has_role(auth.uid(), 'admin'::execscore.app_role));

drop policy if exists "Executor vê as próprias reuniões" on execscore.meet_integracao;
create policy "Executor vê as próprias reuniões" on execscore.meet_integracao
  for select to authenticated
  using (executor_id in (select e.id from execscore.executors e where e.user_id = auth.uid()));

grant select, insert, update, delete on execscore.meet_integracao to service_role;
grant select on execscore.meet_integracao to authenticated;

-- 3) Funções atômicas usadas pelo Legacy Meet (service_role). Cada uma é um
--    único comando, então duas chamadas ao mesmo tempo não se atropelam.

-- Transcrição de uma gravação ficou pronta. Se a reunião já tinha sido
-- enviada, volta para a fila: gravação reiniciada (parte nova) ou gravação
-- retranscrita pelo botão "Transcrever novamente" pedem reavaliação.
create or replace function execscore.meet_registrar_transcricao(
  p_meeting_id uuid, p_executor_id uuid, p_recording_id text
) returns execscore.meet_integracao
language sql as $$
  insert into execscore.meet_integracao as mi
    (meeting_id, executor_id, recording_ids, transcricao_pronta_em)
  values (p_meeting_id, p_executor_id, array[p_recording_id], now())
  on conflict (meeting_id) do update set
    recording_ids = case when p_recording_id = any(mi.recording_ids) then mi.recording_ids
                         else mi.recording_ids || p_recording_id end,
    transcricao_pronta_em = now(),
    status = case when mi.status in ('enviada', 'erro') then 'aguardando' else mi.status end,
    tentativas = case when mi.status in ('enviada', 'erro') then 0 else mi.tentativas end
  returning mi.*;
$$;

-- Executor escolheu os pilares desligados. Trocar a escolha depois do envio
-- reabre a reunião para reavaliação.
create or replace function execscore.meet_registrar_pilares(
  p_meeting_id uuid, p_executor_id uuid, p_desabilitados text[], p_user_id uuid
) returns execscore.meet_integracao
language sql as $$
  insert into execscore.meet_integracao as mi
    (meeting_id, executor_id, pilares_desabilitados, pilares_escolhidos_em, pilares_escolhidos_por)
  values (p_meeting_id, p_executor_id, coalesce(p_desabilitados, '{}'), now(), p_user_id)
  on conflict (meeting_id) do update set
    pilares_desabilitados = coalesce(p_desabilitados, '{}'),
    pilares_escolhidos_em = now(),
    pilares_escolhidos_por = p_user_id,
    status = case when mi.status in ('enviada', 'erro') then 'aguardando' else mi.status end,
    tentativas = case when mi.status in ('enviada', 'erro') then 0 else mi.tentativas end
  returning mi.*;
$$;

-- Reivindica a reunião para envio. Só devolve linha se ela estiver pronta:
-- transcrição disponível E (pilares escolhidos OU prazo de espera vencido),
-- dentro do limite de tentativas, sem outro envio em andamento (um
-- "processando" parado há mais de 20 min é considerado travado).
create or replace function execscore.meet_reivindicar_envio(
  p_meeting_id uuid, p_espera interval, p_max_tentativas integer
) returns execscore.meet_integracao
language sql as $$
  update execscore.meet_integracao mi set
    status = 'processando',
    processando_desde = now(),
    tentativas = mi.tentativas + 1,
    ultimo_erro = null
  where mi.meeting_id = p_meeting_id
    and mi.transcricao_pronta_em is not null
    and cardinality(mi.recording_ids) > 0
    and mi.tentativas < p_max_tentativas
    and (mi.pilares_desabilitados is not null or mi.transcricao_pronta_em <= now() - p_espera)
    and (mi.status in ('aguardando', 'erro')
         or (mi.status = 'processando' and mi.processando_desde < now() - interval '20 minutes'))
  returning mi.*;
$$;

-- Fecha o envio. Se durante o processamento chegou gravação nova ou o
-- executor trocou os pilares, a reunião volta para 'aguardando' (reavaliar).
create or replace function execscore.meet_concluir_envio(
  p_meeting_id uuid, p_ok boolean, p_evaluation_id uuid, p_erro text,
  p_recording_ids text[], p_pilares_escolhidos_em timestamptz
) returns execscore.meet_integracao
language sql as $$
  update execscore.meet_integracao mi set
    status = case
      when not p_ok then 'erro'
      when not (mi.recording_ids <@ p_recording_ids)
        or mi.pilares_escolhidos_em is distinct from p_pilares_escolhidos_em then 'aguardando'
      else 'enviada' end,
    tentativas = case
      when p_ok and (not (mi.recording_ids <@ p_recording_ids)
        or mi.pilares_escolhidos_em is distinct from p_pilares_escolhidos_em) then 0
      else mi.tentativas end,
    evaluation_id = coalesce(p_evaluation_id, mi.evaluation_id),
    ultimo_erro = case when p_ok then null else left(p_erro, 2000) end,
    enviada_em = case when p_ok then now() else mi.enviada_em end,
    processando_desde = null
  where mi.meeting_id = p_meeting_id
  returning mi.*;
$$;

-- Reuniões que o "varredor" deve tentar enviar agora.
create or replace function execscore.meet_pendentes_envio(
  p_espera interval, p_max_tentativas integer, p_limite integer default 20
) returns setof uuid
language sql stable as $$
  select mi.meeting_id from execscore.meet_integracao mi
  where mi.transcricao_pronta_em is not null
    and cardinality(mi.recording_ids) > 0
    and mi.tentativas < p_max_tentativas
    and (mi.pilares_desabilitados is not null or mi.transcricao_pronta_em <= now() - p_espera)
    and (mi.status = 'aguardando'
         or (mi.status = 'erro' and mi.updated_at < now() - interval '15 minutes')
         or (mi.status = 'processando' and mi.processando_desde < now() - interval '20 minutes'))
  order by mi.transcricao_pronta_em
  limit p_limite;
$$;

revoke all on function execscore.meet_registrar_transcricao(uuid, uuid, text) from public, anon, authenticated;
revoke all on function execscore.meet_registrar_pilares(uuid, uuid, text[], uuid) from public, anon, authenticated;
revoke all on function execscore.meet_reivindicar_envio(uuid, interval, integer) from public, anon, authenticated;
revoke all on function execscore.meet_concluir_envio(uuid, boolean, uuid, text, text[], timestamptz) from public, anon, authenticated;
revoke all on function execscore.meet_pendentes_envio(interval, integer, integer) from public, anon, authenticated;
grant execute on function execscore.meet_registrar_transcricao(uuid, uuid, text) to service_role;
grant execute on function execscore.meet_registrar_pilares(uuid, uuid, text[], uuid) to service_role;
grant execute on function execscore.meet_reivindicar_envio(uuid, interval, integer) to service_role;
grant execute on function execscore.meet_concluir_envio(uuid, boolean, uuid, text, text[], timestamptz) to service_role;
grant execute on function execscore.meet_pendentes_envio(interval, integer, integer) to service_role;
