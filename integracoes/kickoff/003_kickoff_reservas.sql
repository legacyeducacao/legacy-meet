-- Kickoff Impulsão, etapa M2: reservas empresariais nas sessões de kickoff.
-- Projeto legacy-plan (eddfdgefrwjxfafkkzls). ADITIVA: só objetos novos do kickoff,
-- mais uma coluna em agenda_kickoff_sessoes (tabela do kickoff, criada na 001).
--
-- STATUS: NÃO APLICADA. Aplicar só com autorização (docs/kickoff/README.md,
-- "Reservas (M2)"). Depende de 001_kickoff_m1.sql (aplicada em 12/11/2026).
--
-- Origem: regras do Legacy CS (docs/kickoff/referencia-cs/kickoff-cs-guia-tecnico.md,
-- seções 2 e 3), adaptadas à agenda do Meet:
--   - a sessão é a reunião da agenda (public.meetings + agenda_kickoff_sessoes);
--     data, hora, anfitrião e estado vêm da reunião e não são copiados aqui;
--   - a empresa é client_tenants.id (no CS era clients.id + cópia do Plan);
--   - e-mail do participante obrigatório e validado no banco (no CS era opcional
--     e validado só dentro das funções);
--   - as regras críticas ficam em gatilhos, checks e índices: valem para qualquer
--     escrita, não só para as funções.
--
-- REGRA CENTRAL: o kickoff acontece UMA VEZ por empresa. Três coisas diferentes:
--   1. reserva da vaga ............ status 'ativa';
--   2. comparecimento (check-in) .. presenca 'presente' ou 'ausente', registrado por
--                                   quem gerencia (no futuro, também pelo Zoom);
--   3. conclusão do kickoff ....... status 'concluida', ato EXPLÍCITO de quem
--                                   gerencia, só depois de presença 'presente'.
--   Nada disso é presumido pelo horário: sessão que já passou continua com a
--   reserva 'ativa' até alguém registrar o que aconteceu.
--   Empresa 'concluida' nunca mais reserva (índice único), e a reserva concluída
--   não é cancelada, remanejada nem reaberta (gatilho), nem por quem é admin.
--   Empresa 'ausente' pode ser reagendada (nova reserva, ligada à ausência).
--   Empresa que compareceu e NÃO concluiu (interrupção, problema técnico) não tem
--   a reserva cancelada: registra-se 'interrompida', com motivo obrigatório, e só
--   então ela pode ser reagendada. Depois de presença registrada, cancelar é recusado.
--   Presença ou ausência registrada por engano se corrige pela função de correção
--   (motivo obrigatório, antes/depois no histórico), sem criar outra reserva.
--   Repetir um kickoff concluído não tem caminho nesta migration: exige um
--   mecanismo futuro, explícito, autorizado e auditável (suporte).
--
-- Fora desta etapa: convites, página pública, Zoom (inclusive coleta automática de
-- presença), e-mails, WhatsApp.
--
-- Acesso: como as outras tabelas agenda_*: RLS ligado, sem policies, nada para
-- anon/authenticated. O servidor do Meet (service_role) chama as funções; cada
-- função confere de novo, no banco, se o usuário informado gerencia kickoffs.

-- ---------------------------------------------------------------------------
-- 1. Quem alterou a configuração da sessão (capacidade, bloqueio)
-- ---------------------------------------------------------------------------
alter table public.agenda_kickoff_sessoes
  add column if not exists atualizado_por uuid;

-- ---------------------------------------------------------------------------
-- 2. Reservas: uma empresa numa sessão
-- ---------------------------------------------------------------------------
create table if not exists public.agenda_kickoff_reservas (
  id uuid primary key default gen_random_uuid(),
  -- Sessão (reunião da agenda marcada como kickoff). restrict: reunião com
  -- reserva, mesmo cancelada, não pode ser apagada (o histórico fica).
  meeting_id uuid not null references public.agenda_kickoff_sessoes(meeting_id) on delete restrict,
  -- Empresa participante real (nunca a organizadora; ver gatilho).
  tenant_id uuid not null references public.client_tenants(id) on delete restrict,
  participante_nome text not null
    check (participante_nome = btrim(participante_nome) and char_length(participante_nome) between 2 and 200),
  participante_email text not null
    check (participante_email = lower(btrim(participante_email))
           and char_length(participante_email) <= 254
           and participante_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  participante_telefone text
    check (participante_telefone is null
           or (participante_telefone = btrim(participante_telefone)
               and participante_telefone ~ '^\+?[0-9 ().-]+$'
               and char_length(regexp_replace(participante_telefone, '[^0-9]', '', 'g')) between 8 and 15)),
  -- ativa: vaga reservada, resultado ainda não registrado.
  -- cancelada: desistência antes de concluir (libera vaga e empresa).
  -- ausente: não compareceu (libera a empresa para reagendar; a vaga continua contada).
  -- concluida: kickoff concluído (definitivo).
  -- interrompida: compareceu e não concluiu (motivo obrigatório; pode reagendar).
  status text not null default 'ativa' check (status in ('ativa', 'cancelada', 'ausente', 'interrompida', 'concluida')),
  cancelada_em timestamptz,
  cancelada_por uuid,
  motivo_cancelamento text check (motivo_cancelamento is null or char_length(motivo_cancelamento) <= 500),
  -- Comparecimento (check-in). Não é conclusão.
  presenca text check (presenca in ('presente', 'ausente')),
  presenca_em timestamptz,
  presenca_por uuid,
  -- 'manual' nesta etapa; 'zoom' fica reservado para a coleta futura.
  presenca_origem text check (presenca_origem in ('manual', 'zoom')),
  -- Conclusão (ato explícito).
  concluida_em timestamptz,
  concluida_por uuid,
  observacao_conclusao text check (observacao_conclusao is null or char_length(observacao_conclusao) <= 500),
  -- Participação não concluída (ato explícito, motivo obrigatório).
  interrompida_em timestamptz,
  interrompida_por uuid,
  motivo_interrupcao text check (motivo_interrupcao is null or char_length(motivo_interrupcao) <= 500),
  -- Reagendamento depois de ausência ou interrupção: a reserva nova aponta para a anterior.
  origem_reserva_id uuid references public.agenda_kickoff_reservas(id) on delete restrict,
  criado_por uuid,
  criado_em timestamptz not null default now(),
  atualizado_por uuid,
  atualizado_em timestamptz not null default now(),
  constraint agenda_kickoff_reservas_cancelada_ck check ((status = 'cancelada') = (cancelada_em is not null)),
  constraint agenda_kickoff_reservas_concluida_ck check ((status = 'concluida') = (concluida_em is not null)),
  constraint agenda_kickoff_reservas_presenca_ck
    check ((presenca is null) = (presenca_em is null) and (presenca is null) = (presenca_origem is null)),
  -- Concluir exige presença registrada como presente. "is not distinct from": com
  -- presença nula, "presenca = 'presente'" daria nulo e o check deixaria passar.
  constraint agenda_kickoff_reservas_conclusao_presenca_ck
    check (status <> 'concluida' or presenca is not distinct from 'presente'),
  -- Ausência é estado e presença ao mesmo tempo.
  constraint agenda_kickoff_reservas_ausente_ck check ((status = 'ausente') = (presenca is not distinct from 'ausente')),
  constraint agenda_kickoff_reservas_interrompida_ck check ((status = 'interrompida') = (interrompida_em is not null)),
  -- Interrupção: só de quem compareceu, e sempre com motivo.
  constraint agenda_kickoff_reservas_interrompida_dados_ck
    check (status <> 'interrompida'
           or (presenca is not distinct from 'presente' and nullif(btrim(coalesce(motivo_interrupcao, '')), '') is not null)),
  -- Depois de presença registrada não se cancela (concluir ou registrar a interrupção).
  constraint agenda_kickoff_reservas_cancelada_sem_presenca_ck check (status <> 'cancelada' or presenca is null),
  constraint agenda_kickoff_reservas_origem_ck check (origem_reserva_id is distinct from id)
);

-- Kickoff único por empresa: no máximo UMA reserva ativa OU concluída por empresa.
-- Empresa concluída nunca mais tem reserva ativa; empresa com reserva ativa não
-- tem outra. Rede de segurança contra pedidos simultâneos e escrita fora das funções.
create unique index if not exists agenda_kickoff_reservas_empresa_key
  on public.agenda_kickoff_reservas (tenant_id) where status in ('ativa', 'concluida');
-- Uma ausência é reagendada no máximo uma vez.
create unique index if not exists agenda_kickoff_reservas_origem_key
  on public.agenda_kickoff_reservas (origem_reserva_id) where origem_reserva_id is not null;
create index if not exists agenda_kickoff_reservas_sessao_idx
  on public.agenda_kickoff_reservas (meeting_id, status);

-- ---------------------------------------------------------------------------
-- 3. Histórico das reservas: só inclusão, gravado por gatilho
-- ---------------------------------------------------------------------------
create table if not exists public.agenda_kickoff_reservas_historico (
  id bigint generated always as identity primary key,
  reserva_id uuid not null references public.agenda_kickoff_reservas(id) on delete restrict,
  acao text not null check (acao in (
    'criada', 'reagendada', 'remanejada', 'cancelada', 'participante_alterado',
    'presenca_registrada', 'ausente', 'concluida', 'interrompida', 'presenca_corrigida')),
  sessao_de uuid references public.agenda_kickoff_sessoes(meeting_id) on delete restrict,
  sessao_para uuid references public.agenda_kickoff_sessoes(meeting_id) on delete restrict,
  -- participante_alterado: {"antes": {...}, "depois": {...}}; reagendada: {"de_reserva": id};
  -- presenca_registrada/ausente: {"presenca": ..., "origem": ...}
  -- presenca_corrigida: {"antes": {"status", "presenca"}, "depois": {"status", "presenca"}}
  dados jsonb,
  motivo text,
  usuario_id uuid,
  em timestamptz not null default now(),
  constraint agenda_kickoff_hist_remanejada_ck
    check (acao <> 'remanejada' or (sessao_de is not null and sessao_para is not null and sessao_de <> sessao_para))
);
create index if not exists agenda_kickoff_reservas_historico_reserva_idx
  on public.agenda_kickoff_reservas_historico (reserva_id, em);

alter table public.agenda_kickoff_reservas enable row level security;
alter table public.agenda_kickoff_reservas_historico enable row level security;
revoke all on public.agenda_kickoff_reservas, public.agenda_kickoff_reservas_historico from anon, authenticated;
grant all on public.agenda_kickoff_reservas, public.agenda_kickoff_reservas_historico to service_role;

-- ---------------------------------------------------------------------------
-- 4. Regras internas
-- ---------------------------------------------------------------------------

-- Data e hora da sessão em Brasília, para as mensagens.
create or replace function public._agenda_kickoff_quando(p_meeting_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select to_char(m.scheduled_start_at at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI')
    from public.meetings m where m.id = p_meeting_id
$$;

-- O usuário (informado pelo servidor do Meet) gerencia kickoffs: perfil do Meet
-- com is_admin ou com a permissão 'kickoff_impulsao.manage'. Mesma regra de
-- podeGerenciarKickoff (lib/auth.ts), conferida de novo no banco.
create or replace function public._agenda_kickoff_exigir_gestor(p_usuario uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_usuario is null then
    raise exception 'Faça login para gerenciar os kickoffs.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.meet_user_profile p
     where p.user_id = p_usuario
       and (p.is_admin or 'kickoff_impulsao.manage' = any (p.capacidades))
  ) then
    raise exception 'Só quem gerencia os kickoffs do Impulsão pode fazer isso.' using errcode = '42501';
  end if;
end $$;

-- Fila única das escritas do kickoff (volume baixo): duas abas, dois gestores
-- nunca mexem em reservas ou sessões de kickoff ao mesmo tempo. Vale até o fim
-- da transação. As travas de linha abaixo continuam valendo sem ela.
create or replace function public._agenda_kickoff_fila()
returns void
language sql
security definer
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtext('public.agenda_kickoff_reservas'))
$$;

-- Vagas ocupadas: tudo que não foi cancelado (ativa, ausente, concluída).
create or replace function public._agenda_kickoff_ocupadas(p_meeting_id uuid, p_exceto uuid default null)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.agenda_kickoff_reservas r
   where r.meeting_id = p_meeting_id and r.status <> 'cancelada'
     and r.id is distinct from p_exceto
$$;

-- A empresa já tem kickoff ativo ou concluído? Mensagem clara (o índice único é a
-- garantia; aqui só se explica o motivo).
create or replace function public._agenda_kickoff_conferir_empresa(p_tenant_id uuid, p_meeting_id uuid, p_exceto uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v record;
begin
  select r.status, r.meeting_id, r.concluida_em into v
    from public.agenda_kickoff_reservas r
   where r.tenant_id = p_tenant_id and r.status in ('ativa', 'concluida')
     and r.id is distinct from p_exceto
   limit 1;
  if v.status = 'concluida' then
    raise exception 'Esta empresa já concluiu o kickoff (%). Um novo kickoff só pode ser tratado pelo suporte.',
      to_char(v.concluida_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') using errcode = '23505';
  end if;
  if v.status = 'ativa' then
    if v.meeting_id = p_meeting_id then
      raise exception 'Esta empresa já está inscrita nesta sessão.' using errcode = '23505';
    end if;
    raise exception 'Esta empresa já tem kickoff marcado em %. Para trocar, remaneje a reserva existente.',
      public._agenda_kickoff_quando(v.meeting_id) using errcode = '23505';
  end if;
end $$;

-- Trava a sessão e confere se ela recebe mais esta empresa. A trava (FOR UPDATE
-- na linha da sessão) vale até o fim da transação: a contagem e a gravação que
-- vêm depois não disputam com outra reserva, com a mudança de capacidade nem com
-- o cancelamento da mesma sessão. A reunião é lida DEPOIS da trava (outro
-- comando, outra foto do banco): vê o horário e o estado já atualizados.
create or replace function public._agenda_kickoff_conferir_vaga(p_meeting_id uuid, p_tenant_id uuid, p_reserva_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_k record;
  v_m record;
  v_ocupadas int;
begin
  select k.meeting_id, k.capacidade, k.aceita_reservas into v_k
    from public.agenda_kickoff_sessoes k where k.meeting_id = p_meeting_id for update;
  if v_k.meeting_id is null then
    raise exception 'Sessão de kickoff não encontrada.' using errcode = 'P0002';
  end if;

  select m.status::text as status, m.scheduled_start_at, m.tenant_id into v_m
    from public.meetings m where m.id = p_meeting_id;
  if v_m.status is null then
    raise exception 'Sessão de kickoff não encontrada.' using errcode = 'P0002';
  end if;
  if v_m.status = 'canceled' then
    raise exception 'Sessão indisponível: ela foi cancelada.' using errcode = '22023';
  end if;
  if v_m.status <> 'scheduled' or v_m.scheduled_start_at <= now() then
    raise exception 'Sessão indisponível: ela já começou ou já passou.' using errcode = '22023';
  end if;
  if not v_k.aceita_reservas then
    raise exception 'Sessão indisponível: ela está bloqueada para novas reservas.' using errcode = '22023';
  end if;

  -- A empresa organizadora (a da reunião) não é participante, nem a de outra sessão.
  if p_tenant_id = v_m.tenant_id or exists (
       select 1 from public.agenda_kickoff_sessoes k2
         join public.meetings m2 on m2.id = k2.meeting_id
        where m2.tenant_id = p_tenant_id) then
    raise exception 'A empresa organizadora dos kickoffs não pode ser inscrita como participante.' using errcode = '22023';
  end if;

  v_ocupadas := public._agenda_kickoff_ocupadas(p_meeting_id, p_reserva_id);
  if v_ocupadas >= v_k.capacidade then
    raise exception 'Sessão lotada: % de % empresas.', v_ocupadas, v_k.capacidade using errcode = '22023';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Gatilhos das reservas
-- ---------------------------------------------------------------------------

-- Antes de gravar: as transições permitidas. Vale para qualquer escrita.
create or replace function public._agenda_kickoff_reservas_regras()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m record;
  v_origem record;
  -- Correção de presença: só pela função agenda_kickoff_corrigir_presenca, que liga
  -- esta marca na transação junto com o motivo (obrigatório).
  v_correcao boolean := coalesce(current_setting('agenda_kickoff.correcao', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if new.status <> 'ativa' or new.presenca is not null or new.concluida_em is not null then
      raise exception 'Reserva nova precisa estar ativa, sem presença nem conclusão.' using errcode = '22023';
    end if;
    if new.origem_reserva_id is not null then
      select r.tenant_id, r.status into v_origem from public.agenda_kickoff_reservas r where r.id = new.origem_reserva_id;
      if v_origem.status is null or v_origem.status not in ('ausente', 'interrompida') or v_origem.tenant_id <> new.tenant_id then
        raise exception 'Só uma ausência ou participação não concluída da mesma empresa pode ser reagendada.' using errcode = '22023';
      end if;
    end if;
    new.criado_em := now();
    new.atualizado_em := now();
    new.atualizado_por := coalesce(new.atualizado_por, new.criado_por);
    perform public._agenda_kickoff_conferir_empresa(new.tenant_id, new.meeting_id, new.id);
    perform public._agenda_kickoff_conferir_vaga(new.meeting_id, new.tenant_id, new.id);
    return new;
  end if;

  -- UPDATE
  if new.id <> old.id or new.tenant_id <> old.tenant_id
     or new.criado_em <> old.criado_em or new.criado_por is distinct from old.criado_por
     or new.origem_reserva_id is distinct from old.origem_reserva_id then
    raise exception 'A empresa e a criação de uma reserva não mudam.' using errcode = '42501';
  end if;
  if old.status = 'cancelada' then
    raise exception 'Reserva cancelada não pode ser alterada.' using errcode = '22023';
  end if;

  -- Correção de presença (função própria, com motivo). Só presença ou ausência
  -- registradas; nunca concluída nem interrompida; nunca ausência já reagendada.
  if v_correcao and (new.status, new.presenca) is distinct from (old.status, old.presenca) then
    if nullif(btrim(coalesce(current_setting('agenda_kickoff.motivo', true), '')), '') is null then
      raise exception 'Informe o motivo da correção.' using errcode = '22023';
    end if;
    if not ((old.status = 'ativa' and old.presenca is not null) or old.status = 'ausente') then
      raise exception 'Só presença ou ausência registradas, sem conclusão nem interrupção, podem ser corrigidas.' using errcode = '22023';
    end if;
    if new.status not in ('ativa', 'ausente') or new.meeting_id <> old.meeting_id
       or (new.concluida_em, new.interrompida_em, new.cancelada_em) is distinct from (old.concluida_em, old.interrompida_em, old.cancelada_em) then
      raise exception 'A correção só muda a presença.' using errcode = '42501';
    end if;
    if old.status = 'ausente' and exists (select 1 from public.agenda_kickoff_reservas n where n.origem_reserva_id = old.id) then
      raise exception 'Esta ausência já gerou uma nova reserva (reagendamento) e não pode ser corrigida. Cancele a nova reserva se ela foi um engano; a ausência continua no histórico.'
        using errcode = '22023';
    end if;
    if new.presenca = 'ausente' then
      select m.scheduled_start_at, m.scheduled_end_at into v_m from public.meetings m where m.id = new.meeting_id;
      if coalesce(v_m.scheduled_end_at, v_m.scheduled_start_at) > now() then
        raise exception 'A ausência só pode ser registrada depois que a sessão terminar.' using errcode = '22023';
      end if;
    end if;
    new.atualizado_em := now();
    return new;
  end if;

  -- Ausente, interrompida e concluída são definitivas: só o participante pode ser corrigido.
  if old.status in ('ausente', 'interrompida', 'concluida') then
    if (new.status, new.meeting_id, new.presenca, new.presenca_em, new.presenca_origem, new.concluida_em,
        new.observacao_conclusao, new.interrompida_em, new.motivo_interrupcao, new.cancelada_em)
       is distinct from
       (old.status, old.meeting_id, old.presenca, old.presenca_em, old.presenca_origem, old.concluida_em,
        old.observacao_conclusao, old.interrompida_em, old.motivo_interrupcao, old.cancelada_em) then
      if old.status = 'concluida' then
        raise exception 'Kickoff concluído não muda: não pode ser cancelado, remanejado nem reaberto. Exceções só pelo suporte.'
          using errcode = '22023';
      end if;
      if old.status = 'interrompida' then
        raise exception 'Participação não concluída registrada não muda. Para a empresa fazer o kickoff, reagende.' using errcode = '22023';
      end if;
      raise exception 'Ausência registrada não muda. Para a empresa participar, reagende (ou corrija a ausência, com motivo, se foi engano).'
        using errcode = '22023';
    end if;
    new.atualizado_em := now();
    return new;
  end if;

  -- old.status = 'ativa'
  if old.presenca is not null and new.presenca is distinct from old.presenca then
    raise exception 'A presença desta reserva já foi registrada. Para corrigir, use a correção de presença (com motivo).' using errcode = '22023';
  end if;
  if new.meeting_id <> old.meeting_id then
    if new.status <> 'ativa' or old.presenca is not null then
      raise exception 'Só reservas ativas, sem presença registrada, podem ser remanejadas.' using errcode = '22023';
    end if;
    perform public._agenda_kickoff_conferir_vaga(new.meeting_id, new.tenant_id, new.id);
  end if;
  if old.presenca is null and new.presenca is not null then
    select m.status::text as status, m.scheduled_start_at, m.scheduled_end_at into v_m
      from public.meetings m where m.id = new.meeting_id;
    if v_m.status = 'canceled' then
      raise exception 'Sessão cancelada: não há presença a registrar.' using errcode = '22023';
    end if;
    if v_m.scheduled_start_at > now() then
      raise exception 'A presença só pode ser registrada depois que a sessão começar.' using errcode = '22023';
    end if;
    if new.presenca = 'ausente' and coalesce(v_m.scheduled_end_at, v_m.scheduled_start_at) > now() then
      raise exception 'A ausência só pode ser registrada depois que a sessão terminar.' using errcode = '22023';
    end if;
  end if;
  new.atualizado_em := now();
  return new;
end $$;

drop trigger if exists agenda_kickoff_reservas_regras on public.agenda_kickoff_reservas;
create trigger agenda_kickoff_reservas_regras
  before insert or update on public.agenda_kickoff_reservas
  for each row execute function public._agenda_kickoff_reservas_regras();

-- Depois de gravar: o histórico (não depende de quem escreveu).
create or replace function public._agenda_kickoff_reservas_historico()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo text := nullif(btrim(coalesce(current_setting('agenda_kickoff.motivo', true), '')), '');
  v_correcao boolean := coalesce(current_setting('agenda_kickoff.correcao', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    insert into public.agenda_kickoff_reservas_historico (reserva_id, acao, sessao_para, dados, motivo, usuario_id)
    values (new.id,
            case when new.origem_reserva_id is null then 'criada' else 'reagendada' end,
            new.meeting_id,
            case when new.origem_reserva_id is null then null else jsonb_build_object('de_reserva', new.origem_reserva_id) end,
            v_motivo, new.criado_por);
    return null;
  end if;

  if new.meeting_id <> old.meeting_id then
    insert into public.agenda_kickoff_reservas_historico (reserva_id, acao, sessao_de, sessao_para, motivo, usuario_id)
    values (new.id, 'remanejada', old.meeting_id, new.meeting_id, v_motivo, new.atualizado_por);
  end if;
  if (new.participante_nome, new.participante_email, new.participante_telefone)
       is distinct from (old.participante_nome, old.participante_email, old.participante_telefone) then
    insert into public.agenda_kickoff_reservas_historico (reserva_id, acao, sessao_de, dados, usuario_id)
    values (new.id, 'participante_alterado', new.meeting_id,
            jsonb_build_object(
              'antes', jsonb_build_object('nome', old.participante_nome, 'email', old.participante_email, 'telefone', old.participante_telefone),
              'depois', jsonb_build_object('nome', new.participante_nome, 'email', new.participante_email, 'telefone', new.participante_telefone)),
            new.atualizado_por);
  end if;
  if v_correcao and (new.status, new.presenca) is distinct from (old.status, old.presenca) then
    insert into public.agenda_kickoff_reservas_historico (reserva_id, acao, sessao_de, dados, motivo, usuario_id)
    values (new.id, 'presenca_corrigida', new.meeting_id,
            jsonb_build_object(
              'antes', jsonb_build_object('status', old.status, 'presenca', old.presenca),
              'depois', jsonb_build_object('status', new.status, 'presenca', new.presenca)),
            v_motivo, new.atualizado_por);
  elsif old.presenca is null and new.presenca is not null then
    insert into public.agenda_kickoff_reservas_historico (reserva_id, acao, sessao_de, dados, usuario_id)
    values (new.id, case when new.presenca = 'ausente' then 'ausente' else 'presenca_registrada' end, new.meeting_id,
            jsonb_build_object('presenca', new.presenca, 'origem', new.presenca_origem), coalesce(new.presenca_por, new.atualizado_por));
  end if;
  if new.status = 'interrompida' and old.status <> 'interrompida' then
    insert into public.agenda_kickoff_reservas_historico (reserva_id, acao, sessao_de, motivo, usuario_id)
    values (new.id, 'interrompida', new.meeting_id, new.motivo_interrupcao, coalesce(new.interrompida_por, new.atualizado_por));
  end if;
  if new.status = 'concluida' and old.status <> 'concluida' then
    insert into public.agenda_kickoff_reservas_historico (reserva_id, acao, sessao_de, motivo, usuario_id)
    values (new.id, 'concluida', new.meeting_id, new.observacao_conclusao, coalesce(new.concluida_por, new.atualizado_por));
  end if;
  if new.status = 'cancelada' and old.status <> 'cancelada' then
    insert into public.agenda_kickoff_reservas_historico (reserva_id, acao, sessao_de, motivo, usuario_id)
    values (new.id, 'cancelada', new.meeting_id, new.motivo_cancelamento, coalesce(new.cancelada_por, new.atualizado_por));
  end if;
  return null;
end $$;

drop trigger if exists agenda_kickoff_reservas_historico on public.agenda_kickoff_reservas;
create trigger agenda_kickoff_reservas_historico
  after insert or update on public.agenda_kickoff_reservas
  for each row execute function public._agenda_kickoff_reservas_historico();

-- Nada com histórico se apaga; o histórico não se reescreve.
create or replace function public._agenda_kickoff_imutavel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'agenda_kickoff_reservas' then
    raise exception 'Reservas de kickoff não se apagam: cancele a reserva.' using errcode = '42501';
  end if;
  raise exception 'O histórico das reservas de kickoff não pode ser alterado nem apagado.' using errcode = '42501';
end $$;

drop trigger if exists agenda_kickoff_reservas_sem_apagar on public.agenda_kickoff_reservas;
create trigger agenda_kickoff_reservas_sem_apagar
  before delete on public.agenda_kickoff_reservas
  for each row execute function public._agenda_kickoff_imutavel();
drop trigger if exists agenda_kickoff_reservas_sem_truncate on public.agenda_kickoff_reservas;
create trigger agenda_kickoff_reservas_sem_truncate
  before truncate on public.agenda_kickoff_reservas
  for each statement execute function public._agenda_kickoff_imutavel();
drop trigger if exists agenda_kickoff_historico_imutavel on public.agenda_kickoff_reservas_historico;
create trigger agenda_kickoff_historico_imutavel
  before update or delete on public.agenda_kickoff_reservas_historico
  for each row execute function public._agenda_kickoff_imutavel();
drop trigger if exists agenda_kickoff_historico_sem_truncate on public.agenda_kickoff_reservas_historico;
create trigger agenda_kickoff_historico_sem_truncate
  before truncate on public.agenda_kickoff_reservas_historico
  for each statement execute function public._agenda_kickoff_imutavel();

-- Capacidade nunca abaixo das vagas ocupadas (qualquer caminho).
create or replace function public._agenda_kickoff_sessoes_capacidade()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ocupadas int := public._agenda_kickoff_ocupadas(new.meeting_id);
begin
  if new.capacidade < v_ocupadas then
    raise exception 'Esta sessão tem % empresa(s) inscrita(s): a capacidade não pode ficar abaixo disso.', v_ocupadas
      using errcode = '22023';
  end if;
  new.atualizado_em := now();
  return new;
end $$;

drop trigger if exists agenda_kickoff_sessoes_capacidade on public.agenda_kickoff_sessoes;
create trigger agenda_kickoff_sessoes_capacidade
  before update of capacidade on public.agenda_kickoff_sessoes
  for each row when (new.capacidade < old.capacidade)
  execute function public._agenda_kickoff_sessoes_capacidade();

-- ---------------------------------------------------------------------------
-- 6. Operações (chamadas pelo servidor do Meet, com o usuário da sessão)
-- ---------------------------------------------------------------------------

-- Valida e normaliza o participante principal (mensagens claras; os checks da
-- tabela são a rede de segurança).
create or replace function public._agenda_kickoff_participante(p_nome text, p_email text, p_telefone text)
returns table (nome text, email text, telefone text)
language plpgsql
immutable
set search_path = ''
as $$
begin
  nome := nullif(btrim(coalesce(p_nome, '')), '');
  email := lower(nullif(btrim(coalesce(p_email, '')), ''));
  telefone := nullif(btrim(coalesce(p_telefone, '')), '');
  if nome is null or char_length(nome) < 2 or char_length(nome) > 200 then
    raise exception 'Informe o nome do participante principal (2 a 200 caracteres).' using errcode = '22023';
  end if;
  if email is null then
    raise exception 'Informe o e-mail do participante principal.' using errcode = '22023';
  end if;
  if char_length(email) > 254 or email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'E-mail do participante inválido.' using errcode = '22023';
  end if;
  if telefone is not null and (telefone !~ '^\+?[0-9 ().-]+$'
       or char_length(regexp_replace(telefone, '[^0-9]', '', 'g')) not between 8 and 15) then
    raise exception 'Telefone/WhatsApp do participante inválido (8 a 15 dígitos).' using errcode = '22023';
  end if;
  return next;
end $$;

-- Inscreve uma empresa numa sessão. Se a empresa tiver uma ausência ou participação
-- não concluída ainda não reagendada, a reserva nova fica ligada a ela ("reagendada").
create or replace function public.agenda_kickoff_reservar(
  p_meeting_id uuid,
  p_tenant_id uuid,
  p_nome text,
  p_email text,
  p_telefone text,
  p_usuario uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p record;
  v_ausencia uuid;
  v_r public.agenda_kickoff_reservas%rowtype;
begin
  perform public._agenda_kickoff_exigir_gestor(p_usuario);
  perform public._agenda_kickoff_fila();
  select * into v_p from public._agenda_kickoff_participante(p_nome, p_email, p_telefone);

  if p_tenant_id is null or not exists (select 1 from public.client_tenants t where t.id = p_tenant_id) then
    raise exception 'Empresa não encontrada.' using errcode = 'P0002';
  end if;
  perform public._agenda_kickoff_conferir_empresa(p_tenant_id, p_meeting_id, null);

  select r.id into v_ausencia
    from public.agenda_kickoff_reservas r
   where r.tenant_id = p_tenant_id and r.status in ('ausente', 'interrompida')
     and not exists (select 1 from public.agenda_kickoff_reservas n where n.origem_reserva_id = r.id)
   order by coalesce(r.interrompida_em, r.presenca_em) desc
   limit 1;

  begin
    insert into public.agenda_kickoff_reservas
      (meeting_id, tenant_id, participante_nome, participante_email, participante_telefone,
       origem_reserva_id, criado_por, atualizado_por)
    values
      (p_meeting_id, p_tenant_id, v_p.nome, v_p.email, v_p.telefone, v_ausencia, p_usuario, p_usuario)
    returning * into v_r;
  exception when unique_violation then
    raise exception 'Esta empresa já tem um kickoff marcado ou concluído.' using errcode = '23505';
  end;

  return to_jsonb(v_r);
end $$;

-- Reagenda uma empresa que não compareceu ou não concluiu: reserva NOVA na sessão
-- escolhida, com o mesmo participante, ligada à anterior (que fica intacta).
create or replace function public.agenda_kickoff_reagendar(
  p_reserva_ausente_id uuid,
  p_para_meeting_id uuid,
  p_motivo text,
  p_usuario uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.agenda_kickoff_reservas%rowtype;
  v_r public.agenda_kickoff_reservas%rowtype;
begin
  perform public._agenda_kickoff_exigir_gestor(p_usuario);
  perform public._agenda_kickoff_fila();

  select * into v_a from public.agenda_kickoff_reservas where id = p_reserva_ausente_id for update;
  if v_a.id is null then
    raise exception 'Reserva não encontrada.' using errcode = 'P0002';
  end if;
  if v_a.status not in ('ausente', 'interrompida') then
    raise exception 'Só reservas com ausência ou participação não concluída registradas podem ser reagendadas.' using errcode = '22023';
  end if;
  if exists (select 1 from public.agenda_kickoff_reservas n where n.origem_reserva_id = v_a.id) then
    raise exception 'Esta reserva já foi reagendada.' using errcode = '23505';
  end if;
  perform public._agenda_kickoff_conferir_empresa(v_a.tenant_id, p_para_meeting_id, null);

  perform set_config('agenda_kickoff.motivo', left(coalesce(p_motivo, ''), 500), true);
  begin
    insert into public.agenda_kickoff_reservas
      (meeting_id, tenant_id, participante_nome, participante_email, participante_telefone,
       origem_reserva_id, criado_por, atualizado_por)
    values
      (p_para_meeting_id, v_a.tenant_id, v_a.participante_nome, v_a.participante_email, v_a.participante_telefone,
       v_a.id, p_usuario, p_usuario)
    returning * into v_r;
  exception when unique_violation then
    raise exception 'Esta empresa já tem um kickoff marcado ou concluído.' using errcode = '23505';
  end;
  perform set_config('agenda_kickoff.motivo', '', true);

  return to_jsonb(v_r);
end $$;

-- Leva a MESMA reserva para outra sessão (o histórico registra a troca).
create or replace function public.agenda_kickoff_remanejar(
  p_reserva_id uuid,
  p_para_meeting_id uuid,
  p_motivo text,
  p_usuario uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.agenda_kickoff_reservas%rowtype;
begin
  perform public._agenda_kickoff_exigir_gestor(p_usuario);
  perform public._agenda_kickoff_fila();

  select * into v_r from public.agenda_kickoff_reservas where id = p_reserva_id for update;
  if v_r.id is null then
    raise exception 'Reserva não encontrada.' using errcode = 'P0002';
  end if;
  if v_r.status = 'concluida' then
    raise exception 'Kickoff concluído não muda: não pode ser cancelado, remanejado nem reaberto. Exceções só pelo suporte.'
      using errcode = '22023';
  end if;
  if v_r.status <> 'ativa' or v_r.presenca is not null then
    raise exception 'Só reservas ativas, sem presença registrada, podem ser remanejadas.' using errcode = '22023';
  end if;
  if p_para_meeting_id is null or v_r.meeting_id = p_para_meeting_id then
    raise exception 'A empresa já está nesta sessão.' using errcode = '22023';
  end if;

  perform set_config('agenda_kickoff.motivo', left(coalesce(p_motivo, ''), 500), true);
  update public.agenda_kickoff_reservas
     set meeting_id = p_para_meeting_id, atualizado_por = p_usuario
   where id = v_r.id
  returning * into v_r;
  perform set_config('agenda_kickoff.motivo', '', true);

  return to_jsonb(v_r);
end $$;

-- Cancela uma reserva ativa (libera a vaga e a empresa). Concluída não se cancela.
create or replace function public.agenda_kickoff_cancelar_reserva(p_reserva_id uuid, p_motivo text, p_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.agenda_kickoff_reservas%rowtype;
begin
  perform public._agenda_kickoff_exigir_gestor(p_usuario);
  perform public._agenda_kickoff_fila();

  select * into v_r from public.agenda_kickoff_reservas where id = p_reserva_id for update;
  if v_r.id is null then
    raise exception 'Reserva não encontrada.' using errcode = 'P0002';
  end if;
  if v_r.status = 'cancelada' then
    raise exception 'Esta reserva já está cancelada.' using errcode = '22023';
  end if;
  if v_r.status = 'concluida' then
    raise exception 'Kickoff concluído não muda: não pode ser cancelado, remanejado nem reaberto. Exceções só pelo suporte.'
      using errcode = '22023';
  end if;
  if v_r.status in ('ausente', 'interrompida') then
    raise exception 'Resultado já registrado não se cancela. Para a empresa fazer o kickoff, reagende.' using errcode = '22023';
  end if;
  if v_r.presenca is not null then
    raise exception 'A empresa compareceu: a reserva não pode ser cancelada. Conclua o kickoff ou registre a participação não concluída (com motivo); se a presença foi um engano, corrija-a.'
      using errcode = '22023';
  end if;

  update public.agenda_kickoff_reservas
     set status = 'cancelada',
         cancelada_em = now(),
         cancelada_por = p_usuario,
         motivo_cancelamento = left(nullif(btrim(coalesce(p_motivo, '')), ''), 500),
         atualizado_por = p_usuario
   where id = v_r.id
  returning * into v_r;

  return to_jsonb(v_r);
end $$;

-- Registra o comparecimento (check-in) manual: 'presente' (depois do início) ou
-- 'ausente' (depois do fim). Presença NÃO conclui o kickoff.
create or replace function public.agenda_kickoff_registrar_presenca(p_reserva_id uuid, p_presenca text, p_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.agenda_kickoff_reservas%rowtype;
begin
  perform public._agenda_kickoff_exigir_gestor(p_usuario);
  perform public._agenda_kickoff_fila();
  if p_presenca is null or p_presenca not in ('presente', 'ausente') then
    raise exception 'Presença inválida.' using errcode = '22023';
  end if;

  select * into v_r from public.agenda_kickoff_reservas where id = p_reserva_id for update;
  if v_r.id is null then
    raise exception 'Reserva não encontrada.' using errcode = 'P0002';
  end if;
  if v_r.status <> 'ativa' then
    raise exception 'Só reservas ativas recebem registro de presença.' using errcode = '22023';
  end if;
  if v_r.presenca is not null then
    raise exception 'A presença desta reserva já foi registrada.' using errcode = '22023';
  end if;

  update public.agenda_kickoff_reservas
     set presenca = p_presenca,
         presenca_em = now(),
         presenca_por = p_usuario,
         presenca_origem = 'manual',
         status = case when p_presenca = 'ausente' then 'ausente' else status end,
         atualizado_por = p_usuario
   where id = v_r.id
  returning * into v_r;

  return to_jsonb(v_r);
end $$;

-- Conclui o kickoff da empresa: ato explícito, só com presença 'presente'.
-- Definitivo: a empresa nunca mais reserva pelo fluxo normal.
create or replace function public.agenda_kickoff_concluir(p_reserva_id uuid, p_observacao text, p_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.agenda_kickoff_reservas%rowtype;
begin
  perform public._agenda_kickoff_exigir_gestor(p_usuario);
  perform public._agenda_kickoff_fila();

  select * into v_r from public.agenda_kickoff_reservas where id = p_reserva_id for update;
  if v_r.id is null then
    raise exception 'Reserva não encontrada.' using errcode = 'P0002';
  end if;
  if v_r.status = 'concluida' then
    raise exception 'O kickoff desta empresa já foi concluído.' using errcode = '22023';
  end if;
  if v_r.status <> 'ativa' or v_r.presenca is distinct from 'presente' then
    raise exception 'Para concluir, registre antes que a empresa compareceu.' using errcode = '22023';
  end if;

  update public.agenda_kickoff_reservas
     set status = 'concluida',
         concluida_em = now(),
         concluida_por = p_usuario,
         observacao_conclusao = left(nullif(btrim(coalesce(p_observacao, '')), ''), 500),
         atualizado_por = p_usuario
   where id = v_r.id
  returning * into v_r;

  return to_jsonb(v_r);
end $$;

-- Participação NÃO concluída (interrupção, problema técnico): ato explícito, com
-- motivo obrigatório, só para quem compareceu. Libera a empresa para reagendar;
-- a participação continua no histórico.
create or replace function public.agenda_kickoff_registrar_interrupcao(p_reserva_id uuid, p_motivo text, p_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo text := left(nullif(btrim(coalesce(p_motivo, '')), ''), 500);
  v_r public.agenda_kickoff_reservas%rowtype;
begin
  perform public._agenda_kickoff_exigir_gestor(p_usuario);
  perform public._agenda_kickoff_fila();
  if v_motivo is null then
    raise exception 'Informe o motivo da participação não concluída.' using errcode = '22023';
  end if;

  select * into v_r from public.agenda_kickoff_reservas where id = p_reserva_id for update;
  if v_r.id is null then
    raise exception 'Reserva não encontrada.' using errcode = 'P0002';
  end if;
  if v_r.status = 'concluida' then
    raise exception 'Kickoff concluído não muda: não pode ser cancelado, remanejado nem reaberto. Exceções só pelo suporte.'
      using errcode = '22023';
  end if;
  if v_r.status <> 'ativa' or v_r.presenca is distinct from 'presente' then
    raise exception 'Só quem compareceu pode ter a participação registrada como não concluída.' using errcode = '22023';
  end if;

  update public.agenda_kickoff_reservas
     set status = 'interrompida',
         interrompida_em = now(),
         interrompida_por = p_usuario,
         motivo_interrupcao = v_motivo,
         atualizado_por = p_usuario
   where id = v_r.id
  returning * into v_r;

  return to_jsonb(v_r);
end $$;

-- Corrige presença ou ausência registrada por engano, sem criar outra reserva.
-- p_presenca: 'presente', 'ausente' ou 'nenhuma' (volta a "sem registro").
-- Motivo obrigatório; o histórico guarda antes e depois. Não vale para reserva
-- concluída nem interrompida, nem para ausência que já gerou reagendamento.
create or replace function public.agenda_kickoff_corrigir_presenca(p_reserva_id uuid, p_presenca text, p_motivo text, p_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo text := left(nullif(btrim(coalesce(p_motivo, '')), ''), 500);
  v_nova text := case when p_presenca = 'nenhuma' then null else p_presenca end;
  v_r public.agenda_kickoff_reservas%rowtype;
begin
  perform public._agenda_kickoff_exigir_gestor(p_usuario);
  perform public._agenda_kickoff_fila();
  if p_presenca is null or p_presenca not in ('presente', 'ausente', 'nenhuma') then
    raise exception 'Presença inválida.' using errcode = '22023';
  end if;
  if v_motivo is null then
    raise exception 'Informe o motivo da correção.' using errcode = '22023';
  end if;

  select * into v_r from public.agenda_kickoff_reservas where id = p_reserva_id for update;
  if v_r.id is null then
    raise exception 'Reserva não encontrada.' using errcode = 'P0002';
  end if;
  if v_r.status = 'concluida' then
    raise exception 'Kickoff concluído não muda: não pode ser cancelado, remanejado nem reaberto. Exceções só pelo suporte.'
      using errcode = '22023';
  end if;
  if v_r.status = 'interrompida' then
    raise exception 'Participação não concluída registrada não muda. Para a empresa fazer o kickoff, reagende.' using errcode = '22023';
  end if;
  if v_r.status = 'cancelada' then
    raise exception 'Reserva cancelada não pode ser alterada.' using errcode = '22023';
  end if;
  if v_r.status = 'ativa' and v_r.presenca is null then
    raise exception 'Não há presença registrada para corrigir: use "Compareceu" ou "Não compareceu".' using errcode = '22023';
  end if;
  if v_r.presenca is not distinct from v_nova then
    raise exception 'A presença registrada já é essa.' using errcode = '22023';
  end if;

  perform set_config('agenda_kickoff.correcao', 'on', true);
  perform set_config('agenda_kickoff.motivo', v_motivo, true);
  begin
    update public.agenda_kickoff_reservas
       set presenca = v_nova,
           presenca_em = case when v_nova is null then null else now() end,
           presenca_por = case when v_nova is null then null else p_usuario end,
           presenca_origem = case when v_nova is null then null else 'manual' end,
           status = case when v_nova = 'ausente' then 'ausente' else 'ativa' end,
           atualizado_por = p_usuario
     where id = v_r.id
    returning * into v_r;
  exception when unique_violation then
    raise exception 'A empresa já tem outra reserva ativa ou o kickoff concluído: a ausência não pode voltar a valer como reserva.'
      using errcode = '23505';
  end;
  perform set_config('agenda_kickoff.correcao', '', true);
  perform set_config('agenda_kickoff.motivo', '', true);

  return to_jsonb(v_r);
end $$;

-- Corrige o participante principal (o histórico guarda antes e depois).
create or replace function public.agenda_kickoff_atualizar_participante(
  p_reserva_id uuid,
  p_nome text,
  p_email text,
  p_telefone text,
  p_usuario uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p record;
  v_r public.agenda_kickoff_reservas%rowtype;
begin
  perform public._agenda_kickoff_exigir_gestor(p_usuario);
  perform public._agenda_kickoff_fila();
  select * into v_p from public._agenda_kickoff_participante(p_nome, p_email, p_telefone);

  select * into v_r from public.agenda_kickoff_reservas where id = p_reserva_id for update;
  if v_r.id is null then
    raise exception 'Reserva não encontrada.' using errcode = 'P0002';
  end if;
  if v_r.status = 'cancelada' then
    raise exception 'Reserva cancelada não pode ser editada.' using errcode = '22023';
  end if;
  -- Nada mudou: não grava histórico à toa.
  if (v_r.participante_nome, v_r.participante_email, v_r.participante_telefone)
       is not distinct from (v_p.nome, v_p.email, v_p.telefone) then
    return to_jsonb(v_r);
  end if;

  update public.agenda_kickoff_reservas
     set participante_nome = v_p.nome,
         participante_email = v_p.email,
         participante_telefone = v_p.telefone,
         atualizado_por = p_usuario
   where id = v_r.id
  returning * into v_r;

  return to_jsonb(v_r);
end $$;

-- Capacidade e bloqueio da sessão (nulo = mantém).
create or replace function public.agenda_kickoff_configurar_sessao(
  p_meeting_id uuid,
  p_capacidade int,
  p_aceita_reservas boolean,
  p_usuario uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_k public.agenda_kickoff_sessoes%rowtype;
begin
  perform public._agenda_kickoff_exigir_gestor(p_usuario);
  perform public._agenda_kickoff_fila();

  select * into v_k from public.agenda_kickoff_sessoes where meeting_id = p_meeting_id for update;
  if v_k.meeting_id is null then
    raise exception 'Sessão de kickoff não encontrada.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.meetings m where m.id = p_meeting_id and m.status = 'canceled') then
    raise exception 'Sessão cancelada não pode ser alterada.' using errcode = '22023';
  end if;
  if p_capacidade is not null and p_capacidade not between 1 and 50 then
    raise exception 'A capacidade deve ser de 1 a 50 empresas.' using errcode = '22023';
  end if;

  update public.agenda_kickoff_sessoes
     set capacidade = coalesce(p_capacidade, capacidade),
         aceita_reservas = coalesce(p_aceita_reservas, aceita_reservas),
         atualizado_por = p_usuario,
         atualizado_em = now()
   where meeting_id = p_meeting_id
  returning * into v_k;

  return to_jsonb(v_k);
end $$;

-- Muda horário e título de sessões de kickoff (agenda: mover, redimensionar,
-- "Desfazer"). Sessão com reserva não cancelada (ativa, ausente ou concluída) não
-- muda de horário: as empresas reservaram aquele horário, ou ele já aconteceu.
-- p_itens: [{"id": uuid, "inicio": timestamptz, "fim": timestamptz, "titulo": text|null}]
create or replace function public.agenda_kickoff_remarcar_sessoes(p_itens jsonb, p_usuario uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_i record;
  v_m record;
  v_ocupadas int;
  v_n int := 0;
begin
  perform public._agenda_kickoff_exigir_gestor(p_usuario);
  perform public._agenda_kickoff_fila();

  for v_i in
    select (e->>'id')::uuid as id, (e->>'inicio')::timestamptz as inicio, (e->>'fim')::timestamptz as fim,
           nullif(btrim(coalesce(e->>'titulo', '')), '') as titulo
      from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e
     order by 1
  loop
    perform 1 from public.agenda_kickoff_sessoes k where k.meeting_id = v_i.id for update;
    if not found then
      raise exception 'Sessão de kickoff não encontrada.' using errcode = 'P0002';
    end if;
    select m.status::text as status, m.scheduled_start_at, m.scheduled_end_at into v_m
      from public.meetings m where m.id = v_i.id;
    if v_m.status is distinct from 'scheduled' then
      raise exception 'Só sessões agendadas podem ser alteradas.' using errcode = '22023';
    end if;
    if v_i.inicio is null or v_i.fim is null or v_i.fim <= v_i.inicio then
      raise exception 'Horário inválido.' using errcode = '22023';
    end if;
    if (v_i.inicio, v_i.fim) is distinct from (v_m.scheduled_start_at, v_m.scheduled_end_at) then
      v_ocupadas := public._agenda_kickoff_ocupadas(v_i.id);
      if v_ocupadas > 0 then
        raise exception 'A sessão de % tem % empresa(s) inscrita(s). Remaneje ou cancele as reservas antes de mudar o horário.',
          public._agenda_kickoff_quando(v_i.id), v_ocupadas using errcode = '22023';
      end if;
    end if;
    update public.meetings
       set scheduled_start_at = v_i.inicio,
           scheduled_end_at = v_i.fim,
           title = coalesce(v_i.titulo, title)
     where id = v_i.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Cancela sessões de kickoff (agenda: "esta", "esta e as seguintes", "todas").
-- Com reserva ativa, recusa, a não ser que p_cancelar_reservas = true (decisão
-- explícita: as reservas ativas são canceladas junto e ficam no histórico; nada é
-- remanejado sozinho). Sessão com presença registrada ou kickoff concluído já
-- aconteceu: não se cancela.
create or replace function public.agenda_kickoff_cancelar_sessoes(
  p_ids uuid[],
  p_cancelar_reservas boolean,
  p_motivo text,
  p_origem text,
  p_usuario uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_ativas int;
  v_motivo text := left(nullif(btrim(coalesce(p_motivo, '')), ''), 400);
  v_origem text := case when p_origem in ('cliente', 'executor', 'legacy') then p_origem else 'legacy' end;
  v_reservas int := 0;
  v_canceladas uuid[];
begin
  perform public._agenda_kickoff_exigir_gestor(p_usuario);
  perform public._agenda_kickoff_fila();
  if coalesce(array_length(p_ids, 1), 0) = 0 then
    raise exception 'Nenhuma sessão informada.' using errcode = '22023';
  end if;

  for v_id in select distinct x from unnest(p_ids) x order by 1 loop
    perform 1 from public.agenda_kickoff_sessoes k where k.meeting_id = v_id for update;
    if not found then
      raise exception 'Sessão de kickoff não encontrada.' using errcode = 'P0002';
    end if;
    if exists (select 1 from public.agenda_kickoff_reservas r
                where r.meeting_id = v_id and r.status <> 'cancelada'
                  and (r.presenca is not null or r.status <> 'ativa')) then
      raise exception 'A sessão de % já tem presença ou conclusão registrada: não pode ser cancelada.',
        public._agenda_kickoff_quando(v_id) using errcode = '22023';
    end if;
    select count(*) into v_ativas
      from public.agenda_kickoff_reservas r where r.meeting_id = v_id and r.status = 'ativa';
    if v_ativas > 0 and not coalesce(p_cancelar_reservas, false) then
      raise exception 'A sessão de % tem % empresa(s) inscrita(s). Remaneje ou cancele as reservas antes, ou cancele a sessão junto com as reservas em Kickoffs Impulsão.',
        public._agenda_kickoff_quando(v_id), v_ativas using errcode = '22023';
    end if;
  end loop;

  if coalesce(p_cancelar_reservas, false) then
    with alvo as (
      update public.agenda_kickoff_reservas
         set status = 'cancelada',
             cancelada_em = now(),
             cancelada_por = p_usuario,
             motivo_cancelamento = 'Sessão cancelada' || coalesce(': ' || v_motivo, ''),
             atualizado_por = p_usuario
       where meeting_id = any (p_ids) and status = 'ativa'
      returning 1
    )
    select count(*) into v_reservas from alvo;
  end if;

  with c as (
    update public.meetings set status = 'canceled'
     where id = any (p_ids) and status = 'scheduled'
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_canceladas from c;

  insert into public.agenda_cancelamentos (meeting_id, origem, usuario_id)
  select x, v_origem, p_usuario from unnest(v_canceladas) x;
  update public.agenda_ocorrencias set status = 'cancelada', atualizado_em = now()
   where meeting_id = any (v_canceladas);

  return jsonb_build_object('sessoes', to_jsonb(v_canceladas), 'reservasCanceladas', v_reservas);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Permissões: funções só para o servidor (service_role)
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public._agenda_kickoff_quando(uuid)',
    'public._agenda_kickoff_exigir_gestor(uuid)',
    'public._agenda_kickoff_fila()',
    'public._agenda_kickoff_ocupadas(uuid, uuid)',
    'public._agenda_kickoff_conferir_empresa(uuid, uuid, uuid)',
    'public._agenda_kickoff_conferir_vaga(uuid, uuid, uuid)',
    'public._agenda_kickoff_reservas_regras()',
    'public._agenda_kickoff_reservas_historico()',
    'public._agenda_kickoff_imutavel()',
    'public._agenda_kickoff_sessoes_capacidade()',
    'public._agenda_kickoff_participante(text, text, text)',
    'public.agenda_kickoff_reservar(uuid, uuid, text, text, text, uuid)',
    'public.agenda_kickoff_reagendar(uuid, uuid, text, uuid)',
    'public.agenda_kickoff_remanejar(uuid, uuid, text, uuid)',
    'public.agenda_kickoff_cancelar_reserva(uuid, text, uuid)',
    'public.agenda_kickoff_registrar_presenca(uuid, text, uuid)',
    'public.agenda_kickoff_concluir(uuid, text, uuid)',
    'public.agenda_kickoff_registrar_interrupcao(uuid, text, uuid)',
    'public.agenda_kickoff_corrigir_presenca(uuid, text, text, uuid)',
    'public.agenda_kickoff_atualizar_participante(uuid, text, text, text, uuid)',
    'public.agenda_kickoff_configurar_sessao(uuid, int, boolean, uuid)',
    'public.agenda_kickoff_remarcar_sessoes(jsonb, uuid)',
    'public.agenda_kickoff_cancelar_sessoes(uuid[], boolean, text, text, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
