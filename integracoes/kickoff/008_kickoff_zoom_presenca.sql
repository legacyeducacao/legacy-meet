-- Kickoff Impulsão, Zoom E3: presença automática pelos relatórios do Zoom.
-- Projeto legacy-plan (eddfdgefrwjxfafkkzls). ADITIVA: só tabelas e funções novas do
-- kickoff. Não altera nenhuma tabela nem função existente (nem do Meet, nem do Plan).
--
-- STATUS: NÃO APLICADA. Aplicar só com autorização (docs/kickoff/README.md,
-- "Zoom E3: presença pelo Zoom"). Depende de 001, 003, 006 e 007 (aplicadas).
--
-- Como funciona (sob demanda: a equipe clica "Sincronizar presença do Zoom" na sessão):
--   1. agenda_kickoff_zoom_presenca_contexto: o servidor pede ao banco a sessão, as
--      outras sessões de kickoff de horário vizinho, as salas Zoom e as inscrições
--      (E2) e reservas que servem para reconhecer as empresas. Sem link de entrada;
--   2. o servidor lê no Zoom (só leitura) as execuções da reunião recorrente e o
--      relatório de participantes de cada uma, e apura a evidência por empresa
--      (lib/kickoff/zoomPresenca.ts): identificador da inscrição (registrant_id) ou,
--      como alternativa, o e-mail da inscrição Zoom ligada à reserva desta sessão, na
--      sala certa (e-mail do cadastro sozinho vai para conferência); nome nunca basta;
--   3. agenda_kickoff_zoom_presenca_aplicar: o banco confere a evidência com as
--      inscrições, guarda a associação sessão -> execuções e a evidência, e registra
--      "presente" (origem 'zoom') SÓ em reserva ativa sem presença registrada e sem
--      correção manual anterior. Nunca marca ausência, nunca conclui, nunca muda uma
--      presença já registrada. Repetir dá o mesmo resultado (nada se duplica).
--
-- O registro de presença passa pelos mesmos gatilhos da M2 (regras e histórico):
-- o histórico da reserva ganha "presenca_registrada" com {"origem": "zoom"} e quem
-- sincronizou. Correção continua sendo agenda_kickoff_corrigir_presenca (com motivo).

-- ---------------------------------------------------------------------------
-- 1. Tabelas
-- ---------------------------------------------------------------------------

-- Execuções do Zoom (cada vez que a reunião recorrente foi iniciada) associadas a
-- uma sessão da agenda: a execução cruza a janela da sessão (30 min antes do início
-- até 30 min depois do fim, a mesma janela de entrada da E2).
create table if not exists public.agenda_kickoff_zoom_execucoes (
  id bigint generated always as identity primary key,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  zoom_meeting_id text not null check (zoom_meeting_id ~ '^[0-9]{9,12}$'),
  -- UUID da execução no Zoom (identifica a instância; o Meeting ID é o mesmo para todas).
  zoom_uuid text not null check (char_length(zoom_uuid) between 1 and 200),
  inicio timestamptz not null,
  -- Nulo: relatório ainda indisponível (reunião em andamento ou o Zoom não gerou).
  fim timestamptz,
  participantes int check (participantes is null or participantes >= 0),
  -- A execução também cruza a janela de outra sessão de kickoff: entradas só nesse
  -- trecho comum vão para conferência, nunca para presença automática.
  compartilhada boolean not null default false,
  relatorio text not null check (relatorio in ('ok', 'indisponivel')),
  primeira_sincronizacao_em timestamptz not null default now(),
  sincronizada_em timestamptz not null default now(),
  sincronizada_por uuid,
  constraint agenda_kickoff_zoom_execucoes_key unique (meeting_id, zoom_uuid)
);
create index if not exists agenda_kickoff_zoom_execucoes_uuid_idx on public.agenda_kickoff_zoom_execucoes (zoom_uuid);

-- Evidência do Zoom por reserva na sessão (uma linha por reserva e sessão,
-- atualizada a cada sincronização).
create table if not exists public.agenda_kickoff_zoom_presencas (
  id bigint generated always as identity primary key,
  reserva_id uuid not null references public.agenda_kickoff_reservas(id) on delete restrict,
  meeting_id uuid not null references public.meetings(id) on delete restrict,
  tenant_id uuid not null references public.client_tenants(id) on delete restrict,
  -- registrante: o Zoom devolveu o identificador da inscrição da empresa (E2).
  -- email: o e-mail da entrada é o da inscrição Zoom (presença automática) ou só o do
  -- participante da reserva (vai para conferência).
  evidencia text not null check (evidencia in ('registrante', 'email')),
  zoom_registrant_ids text[] not null default '{}',
  execucoes text[] not null default '{}',
  -- Entradas no relatório (reconexões contam como entradas separadas).
  entradas int not null check (entradas >= 0),
  -- Tempo dentro da janela da sessão, sem contar duas vezes o que se sobrepõe (pessoa mais presente).
  duracao_s int not null check (duracao_s >= 0),
  primeira_entrada timestamptz,
  ultima_saida timestamptz,
  -- Resultado da última sincronização:
  --   registrada    esta sincronização gravou "presente" (origem zoom);
  --   ja_registrada a reserva já tinha "presente" (à mão ou numa sincronização anterior);
  --   preservada    houve correção manual da presença: a sincronização não muda;
  --   revisar       há participação, mas não dá para registrar sozinho (ver detalhe).
  resultado text not null check (resultado in ('registrada', 'ja_registrada', 'preservada', 'revisar')),
  detalhe text check (detalhe is null or char_length(detalhe) <= 300),
  -- Quando a sincronização gravou a presença (nunca volta a nulo).
  registrada_em timestamptz,
  primeira_sincronizacao_em timestamptz not null default now(),
  sincronizada_em timestamptz not null default now(),
  sincronizada_por uuid,
  constraint agenda_kickoff_zoom_presencas_key unique (reserva_id, meeting_id)
);
create index if not exists agenda_kickoff_zoom_presencas_sessao_idx on public.agenda_kickoff_zoom_presencas (meeting_id);

alter table public.agenda_kickoff_zoom_execucoes enable row level security;
alter table public.agenda_kickoff_zoom_presencas enable row level security;
revoke all on public.agenda_kickoff_zoom_execucoes, public.agenda_kickoff_zoom_presencas from anon, authenticated;
grant all on public.agenda_kickoff_zoom_execucoes, public.agenda_kickoff_zoom_presencas to service_role;

-- ---------------------------------------------------------------------------
-- 2. Sessão que pode sincronizar
-- ---------------------------------------------------------------------------

-- A sessão de kickoff existe, não foi cancelada e já começou. Devolve início e fim.
create or replace function public._agenda_kickoff_zoom_presenca_sessao(p_meeting_id uuid)
returns record
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_m record;
begin
  select m.id, m.status::text as status, m.scheduled_start_at as inicio,
         coalesce(m.scheduled_end_at, m.scheduled_start_at + interval '1 hour') as fim
    into v_m
    from public.meetings m
    join public.agenda_kickoff_sessoes k on k.meeting_id = m.id
   where m.id = p_meeting_id;
  if v_m.id is null then
    raise exception 'Sessão de kickoff não encontrada.' using errcode = 'P0002';
  end if;
  if v_m.status = 'canceled' then
    raise exception 'Sessão cancelada: não há presença a sincronizar.' using errcode = '22023';
  end if;
  if v_m.inicio > now() then
    raise exception 'A sessão ainda não começou: a presença do Zoom só existe depois do início.' using errcode = '22023';
  end if;
  return v_m;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Contexto para o servidor (só leitura; nunca devolve link de entrada)
-- ---------------------------------------------------------------------------
--   {"sessao": {id, inicio, fim},
--    "outras": [{id, inicio, fim}]            outras sessões de kickoff de horário vizinho,
--    "salas": ["<meeting id>", ...]          salas Zoom a consultar,
--    "inscricoes": [{zoom_meeting_id, registrant_id, email, tenant_id, empresa}],
--    "reservas": [{reserva_id, tenant_id, email, empresa, status, presenca}]}
create or replace function public.agenda_kickoff_zoom_presenca_contexto(p_meeting_id uuid, p_usuario uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_m record;
  v_salas text[];
begin
  perform public._agenda_kickoff_exigir_gestor(p_usuario);
  select * into v_m from public._agenda_kickoff_zoom_presenca_sessao(p_meeting_id)
    as (id uuid, status text, inicio timestamptz, fim timestamptz);

  -- Salas em que as empresas desta sessão têm inscrição; sem nenhuma, a sala ativa.
  select coalesce(array_agg(distinct i.zoom_meeting_id), '{}') into v_salas
    from public.agenda_kickoff_zoom_inscricoes i
    join public.agenda_kickoff_reservas r on r.tenant_id = i.tenant_id
   where r.meeting_id = p_meeting_id and r.status <> 'cancelada';
  if cardinality(v_salas) = 0 then
    select coalesce(array_agg(s.zoom_meeting_id), '{}') into v_salas from public.agenda_kickoff_zoom_salas s where s.ativa;
  end if;

  return jsonb_build_object(
    'sessao', jsonb_build_object('id', v_m.id, 'inicio', v_m.inicio, 'fim', v_m.fim),
    'outras', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', m.id, 'inicio', m.scheduled_start_at,
               'fim', coalesce(m.scheduled_end_at, m.scheduled_start_at + interval '1 hour'))), '[]'::jsonb)
        from public.meetings m
        join public.agenda_kickoff_sessoes k on k.meeting_id = m.id
       where m.id <> v_m.id
         and m.status::text <> 'canceled'
         and m.scheduled_start_at < v_m.fim + interval '2 hours'
         and coalesce(m.scheduled_end_at, m.scheduled_start_at + interval '1 hour') > v_m.inicio - interval '2 hours'),
    'salas', to_jsonb(v_salas),
    'inscricoes', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'zoom_meeting_id', i.zoom_meeting_id, 'registrant_id', i.zoom_registrant_id, 'email', i.email,
               'tenant_id', i.tenant_id, 'empresa', coalesce(nullif(btrim(t.name), ''), 'Empresa'))), '[]'::jsonb)
        from public.agenda_kickoff_zoom_inscricoes i
        join public.client_tenants t on t.id = i.tenant_id
       where i.zoom_meeting_id = any (v_salas)),
    'reservas', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'reserva_id', r.id, 'tenant_id', r.tenant_id, 'email', r.participante_email,
               'empresa', coalesce(nullif(btrim(t.name), ''), 'Empresa'), 'status', r.status, 'presenca', r.presenca)), '[]'::jsonb)
        from public.agenda_kickoff_reservas r
        join public.client_tenants t on t.id = r.tenant_id
       where r.meeting_id = p_meeting_id and r.status <> 'cancelada'));
end $$;

-- ---------------------------------------------------------------------------
-- 4. Aplicar a evidência apurada pelo servidor
-- ---------------------------------------------------------------------------
-- p_execucoes: [{zoom_meeting_id, zoom_uuid, inicio, fim, participantes, compartilhada, relatorio}]
-- p_empresas:  [{tenant_id, evidencia, exclusiva, registrantes[], emails[], execucoes[],
--                entradas, duracao_s, primeira_entrada, ultima_saida}]
--   exclusiva: alguma entrada da empresa cai num trecho da janela desta sessão que não
--   é janela de outra sessão de kickoff.
-- Devolve {"itens": [{reserva_id, tenant_id, resultado, detalhe}],
--          "fora_da_sessao": [{tenant_id, empresa}], "pendentes": [{reserva_id, tenant_id}]}
create or replace function public.agenda_kickoff_zoom_presenca_aplicar(
  p_meeting_id uuid,
  p_execucoes jsonb,
  p_empresas jsonb,
  p_usuario uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m record;
  v_e record;
  v_x record;
  v_r public.agenda_kickoff_reservas%rowtype;
  v_resultado text;
  v_detalhe text;
  v_registrada boolean;
  v_tenants uuid[] := '{}';
  v_itens jsonb := '[]'::jsonb;
  v_fora jsonb := '[]'::jsonb;
begin
  perform public._agenda_kickoff_exigir_gestor(p_usuario);
  perform public._agenda_kickoff_fila();
  if jsonb_typeof(coalesce(p_execucoes, 'null'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_empresas, 'null'::jsonb)) <> 'array' then
    raise exception 'Dados do Zoom inválidos.' using errcode = '22023';
  end if;
  select * into v_m from public._agenda_kickoff_zoom_presenca_sessao(p_meeting_id)
    as (id uuid, status text, inicio timestamptz, fim timestamptz);

  -- Associação sessão -> execuções do Zoom.
  for v_e in
    select * from jsonb_to_recordset(p_execucoes)
      as x(zoom_meeting_id text, zoom_uuid text, inicio timestamptz, fim timestamptz, participantes int, compartilhada boolean, relatorio text)
  loop
    if v_e.zoom_meeting_id is null or not exists (select 1 from public.agenda_kickoff_zoom_salas s where s.zoom_meeting_id = v_e.zoom_meeting_id) then
      raise exception 'A execução não é de uma sala Zoom dos kickoffs.' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(v_e.zoom_uuid, '')), '') is null or v_e.inicio is null or v_e.relatorio is null or v_e.relatorio not in ('ok', 'indisponivel') then
      raise exception 'Execução do Zoom inválida.' using errcode = '22023';
    end if;
    insert into public.agenda_kickoff_zoom_execucoes
      (meeting_id, zoom_meeting_id, zoom_uuid, inicio, fim, participantes, compartilhada, relatorio, sincronizada_por)
    values
      (p_meeting_id, v_e.zoom_meeting_id, v_e.zoom_uuid, v_e.inicio, v_e.fim, v_e.participantes,
       coalesce(v_e.compartilhada, false), v_e.relatorio, p_usuario)
    on conflict (meeting_id, zoom_uuid) do update
      set fim = excluded.fim, participantes = excluded.participantes, compartilhada = excluded.compartilhada,
          relatorio = excluded.relatorio, sincronizada_em = now(), sincronizada_por = excluded.sincronizada_por;
  end loop;

  for v_x in
    select * from jsonb_to_recordset(p_empresas)
      as x(tenant_id uuid, evidencia text, exclusiva boolean, registrantes text[], emails text[], execucoes text[],
           entradas int, duracao_s int, primeira_entrada timestamptz, ultima_saida timestamptz)
  loop
    if v_x.tenant_id is null or v_x.tenant_id = any (v_tenants) then
      raise exception 'Evidência do Zoom repetida ou sem empresa.' using errcode = '22023';
    end if;
    v_tenants := v_tenants || v_x.tenant_id;

    -- A evidência tem de bater com o que o banco sabe da empresa (não confia só no servidor).
    if v_x.evidencia = 'registrante' then
      if not exists (select 1 from public.agenda_kickoff_zoom_inscricoes i
                      where i.tenant_id = v_x.tenant_id and i.zoom_registrant_id = any (coalesce(v_x.registrantes, '{}'))) then
        raise exception 'A evidência do Zoom não confere com as inscrições da empresa.' using errcode = '22023';
      end if;
    elsif v_x.evidencia = 'email' then
      if not exists (select 1 from public.agenda_kickoff_zoom_inscricoes i
                      where i.tenant_id = v_x.tenant_id and i.email = any (coalesce(v_x.emails, '{}')))
         and not exists (select 1 from public.agenda_kickoff_reservas r
                          where r.meeting_id = p_meeting_id and r.tenant_id = v_x.tenant_id
                            and r.participante_email = any (coalesce(v_x.emails, '{}'))) then
        raise exception 'A evidência do Zoom não confere com as inscrições da empresa.' using errcode = '22023';
      end if;
    else
      raise exception 'Evidência do Zoom inválida.' using errcode = '22023';
    end if;

    select * into v_r from public.agenda_kickoff_reservas r
     where r.meeting_id = p_meeting_id and r.tenant_id = v_x.tenant_id and r.status <> 'cancelada'
     order by r.criado_em desc
     limit 1
     for update;
    if v_r.id is null then
      -- A empresa entrou, mas a reserva dela não é desta sessão: nada é registrado.
      v_fora := v_fora || jsonb_build_object('tenant_id', v_x.tenant_id,
        'empresa', (select coalesce(nullif(btrim(t.name), ''), 'Empresa') from public.client_tenants t where t.id = v_x.tenant_id));
      continue;
    end if;

    v_detalhe := null;
    v_registrada := false;
    if v_r.presenca = 'presente' then
      v_resultado := 'ja_registrada';
    elsif not coalesce(v_x.exclusiva, false) then
      v_resultado := 'revisar';
      v_detalhe := 'A participação coincide só com o horário de outra sessão de kickoff. Confira antes de registrar.';
    elsif v_x.evidencia = 'email' and not exists (
      -- Só pelo e-mail: vale apenas a inscrição Zoom DESTA reserva (não substituída), na
      -- sala das execuções em que a empresa apareceu. O e-mail do cadastro sozinho não basta.
      select 1 from public.agenda_kickoff_zoom_inscricoes i
       where i.tenant_id = v_x.tenant_id
         and i.email = any (coalesce(v_x.emails, '{}'))
         and i.status = 'pronta'
         and i.ultima_reserva_id = v_r.id
         and i.substituida_em is null
         and i.zoom_meeting_id in (
           select e->>'zoom_meeting_id' from jsonb_array_elements(p_execucoes) e
            where e->>'zoom_uuid' = any (coalesce(v_x.execucoes, '{}')))) then
      v_resultado := 'revisar';
      v_detalhe := 'Reconhecida só pelo e-mail, sem a inscrição Zoom desta reserva na sala. Confira antes de registrar.';
    elsif exists (select 1 from public.agenda_kickoff_reservas_historico h where h.reserva_id = v_r.id and h.acao = 'presenca_corrigida') then
      v_resultado := 'preservada';
      v_detalhe := 'A presença desta reserva foi corrigida à mão; a sincronização não muda.';
    elsif v_r.status = 'ausente' then
      v_resultado := 'revisar';
      v_detalhe := 'Registrada como "não compareceu", mas o Zoom mostra participação. Se foi engano, use Corrigir presença.';
    elsif v_r.status = 'ativa' and v_r.presenca is null then
      update public.agenda_kickoff_reservas
         set presenca = 'presente',
             presenca_em = now(),
             presenca_por = p_usuario,
             presenca_origem = 'zoom',
             atualizado_por = p_usuario
       where id = v_r.id;
      v_resultado := 'registrada';
      v_registrada := true;
    else
      v_resultado := 'preservada';
    end if;

    insert into public.agenda_kickoff_zoom_presencas
      (reserva_id, meeting_id, tenant_id, evidencia, zoom_registrant_ids, execucoes, entradas, duracao_s,
       primeira_entrada, ultima_saida, resultado, detalhe, registrada_em, sincronizada_por)
    values
      (v_r.id, p_meeting_id, v_x.tenant_id, v_x.evidencia, coalesce(v_x.registrantes, '{}'), coalesce(v_x.execucoes, '{}'),
       greatest(coalesce(v_x.entradas, 0), 0), greatest(coalesce(v_x.duracao_s, 0), 0), v_x.primeira_entrada, v_x.ultima_saida,
       v_resultado, v_detalhe, case when v_registrada then now() end, p_usuario)
    on conflict (reserva_id, meeting_id) do update
      set evidencia = excluded.evidencia, zoom_registrant_ids = excluded.zoom_registrant_ids, execucoes = excluded.execucoes,
          entradas = excluded.entradas, duracao_s = excluded.duracao_s, primeira_entrada = excluded.primeira_entrada,
          ultima_saida = excluded.ultima_saida, resultado = excluded.resultado, detalhe = excluded.detalhe,
          registrada_em = coalesce(public.agenda_kickoff_zoom_presencas.registrada_em, excluded.registrada_em),
          sincronizada_em = now(), sincronizada_por = excluded.sincronizada_por;

    v_itens := v_itens || jsonb_build_object('reserva_id', v_r.id, 'tenant_id', v_r.tenant_id, 'resultado', v_resultado, 'detalhe', v_detalhe);
  end loop;

  return jsonb_build_object(
    'itens', v_itens,
    'fora_da_sessao', v_fora,
    -- Reservas ativas sem presença e sem participação identificada: continuam pendentes
    -- (nunca viram ausência pela sincronização).
    'pendentes', (
      select coalesce(jsonb_agg(jsonb_build_object('reserva_id', r.id, 'tenant_id', r.tenant_id)), '[]'::jsonb)
        from public.agenda_kickoff_reservas r
       where r.meeting_id = p_meeting_id and r.status = 'ativa' and r.presenca is null
         and not (r.tenant_id = any (v_tenants))));
end $$;

-- ---------------------------------------------------------------------------
-- 5. Permissões: tudo só para o servidor (service_role)
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public._agenda_kickoff_zoom_presenca_sessao(uuid)',
    'public.agenda_kickoff_zoom_presenca_contexto(uuid, uuid)',
    'public.agenda_kickoff_zoom_presenca_aplicar(uuid, jsonb, jsonb, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
