-- Kickoff Impulsão, Zoom E2: inscrição do participante na sala Zoom e acesso individual.
-- Projeto legacy-plan (eddfdgefrwjxfafkkzls). ADITIVA: só tabelas e funções novas do
-- kickoff. Não altera nenhuma tabela nem função existente (nem do Meet, nem do Plan).
--
-- STATUS: NÃO APLICADA. Aplicar só com autorização (docs/kickoff/README.md,
-- "Zoom E2: acesso individual"). Depende de 001, 003, 004, 005 e 006 (aplicadas).
--
-- Origem: inscrições Zoom do Legacy CS (docs/kickoff/referencia-cs/kickoff-cs-guia-tecnico.md,
-- seção 7 e Apêndice D), adaptadas ao Meet:
--   - a inscrição é da SALA (reunião recorrente do Zoom), não da sessão: a chave é
--     sala + e-mail. Data, horário e anfitrião continuam só na reunião da agenda; a
--     RESERVA diz em qual sessão a empresa participa;
--   - a empresa é client_tenants.id. O código que vai no nome do Zoom
--     ("Nome | Empresa #CÓDIGO") são os 8 primeiros hexadecimais desse id, em
--     maiúsculas: a mesma regra do Plan e do CS;
--   - só reserva ATIVA tem acesso. Cancelada, ausente, interrompida e concluída não
--     geram inscrição nem recebem o link;
--   - o join_url é credencial: fica só nesta tabela, lida só pelo servidor. Nenhuma
--     função de estado (painel, página pública) devolve o link; ele só sai em
--     agenda_kickoff_zoom_inscricao_decidir, para o servidor encaminhar o participante;
--   - antes de chamar o Zoom, o banco "reserva" a inscrição (status criando) com trava
--     por sala + e-mail: dois pedidos ao mesmo tempo, só um fala com o Zoom;
--   - o mesmo e-mail já inscrito na sala por OUTRA empresa nunca é reaproveitado;
--   - trocar o e-mail do participante leva a outra chave: a inscrição antiga fica
--     marcada como substituída (histórico) e nunca mais é entregue por aquela reserva;
--   - trocar a sala ativa não migra nada: as inscrições da sala anterior ficam
--     guardadas e cada reserva ativa gera outra na sala nova, quando pedida;
--   - nada se apaga; cada pedido, resultado e substituição fica no histórico.
--
-- Fora desta etapa: presença automática pelo Zoom (E3) e cancelamento de inscrições
-- no Zoom (o app não tem esse escopo).

-- ---------------------------------------------------------------------------
-- 1. Tabelas
-- ---------------------------------------------------------------------------
create table if not exists public.agenda_kickoff_zoom_inscricoes (
  id uuid primary key default gen_random_uuid(),
  sala_id uuid not null references public.agenda_kickoff_zoom_salas(id) on delete restrict,
  -- Meeting ID da sala (copiado da sala pelo gatilho; não muda).
  zoom_meeting_id text not null check (zoom_meeting_id ~ '^[0-9]{9,12}$'),
  email text not null
    check (email = lower(btrim(email)) and char_length(email) <= 254
           and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  -- Empresa dona da inscrição (a da reserva que a pediu).
  tenant_id uuid not null references public.client_tenants(id) on delete restrict,
  -- Código da empresa no nome do Zoom: 8 primeiros hexadecimais de tenant_id.
  codigo_empresa text not null check (codigo_empresa ~ '^[0-9A-F]{8}$'),
  primeira_reserva_id uuid not null references public.agenda_kickoff_reservas(id) on delete restrict,
  ultima_reserva_id uuid not null references public.agenda_kickoff_reservas(id) on delete restrict,
  -- Nome do participante quando a inscrição foi pedida ao Zoom (o Zoom não muda depois).
  participante_nome text not null,
  -- criando: um pedido está falando com o Zoom agora (reivindicada_em).
  -- pronta: link individual guardado. erro: a última tentativa falhou (ultimo_erro).
  -- conflito: o Zoom tem este e-mail com o código de outra empresa.
  status text not null default 'criando' check (status in ('criando', 'pronta', 'erro', 'conflito')),
  zoom_registrant_id text check (zoom_registrant_id is null or char_length(zoom_registrant_id) <= 200),
  -- Link individual de entrada: CREDENCIAL. Só o servidor lê.
  join_url text check (join_url is null or (join_url ~ '^https://[^[:space:]]+$' and char_length(join_url) <= 2000)),
  -- Identidade que o Zoom guardou (pode ser de uma inscrição feita fora do Meet).
  zoom_nome text,
  zoom_sobrenome text,
  zoom_organizacao text,
  nome_confere boolean,
  tentativas int not null default 0 check (tentativas >= 0),
  reivindicada_em timestamptz,
  ultima_tentativa_em timestamptz,
  ultimo_erro text check (ultimo_erro is null or char_length(ultimo_erro) <= 300),
  -- Quem pediu por último (nulo = a própria empresa, pelo link do convite).
  solicitada_por uuid,
  verificada_em timestamptz,
  pronta_em timestamptz,
  -- Vezes em que o link foi entregue ao participante (/impulsao/reuniao/<código>).
  acessos int not null default 0 check (acessos >= 0),
  ultimo_acesso_em timestamptz,
  -- A reserva passou a usar outro e-mail: esta inscrição deixou de valer para ela.
  substituida_em timestamptz,
  substituida_por uuid references public.agenda_kickoff_zoom_inscricoes(id) on delete restrict,
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now(),
  constraint agenda_kickoff_zoom_inscricoes_sala_email_key unique (sala_id, email),
  constraint agenda_kickoff_zoom_inscricoes_pronta_ck
    check (status <> 'pronta' or (zoom_registrant_id is not null and join_url is not null)),
  constraint agenda_kickoff_zoom_inscricoes_criando_ck check ((status = 'criando') = (reivindicada_em is not null))
);
-- Um registrante do Zoom pertence a uma inscrição só.
create unique index if not exists agenda_kickoff_zoom_inscricoes_registrante_key
  on public.agenda_kickoff_zoom_inscricoes (sala_id, zoom_registrant_id) where zoom_registrant_id is not null;
create index if not exists agenda_kickoff_zoom_inscricoes_empresa_idx on public.agenda_kickoff_zoom_inscricoes (tenant_id);
create index if not exists agenda_kickoff_zoom_inscricoes_reserva_idx on public.agenda_kickoff_zoom_inscricoes (ultima_reserva_id);

create table if not exists public.agenda_kickoff_zoom_inscricoes_historico (
  id bigint generated always as identity primary key,
  inscricao_id uuid not null references public.agenda_kickoff_zoom_inscricoes(id) on delete restrict,
  reserva_id uuid references public.agenda_kickoff_reservas(id) on delete restrict,
  -- solicitada: pedido ao Zoom. refeita: uma inscrição pronta deixou de valer no Zoom.
  -- pronta | erro | conflito: resultado. substituida: a reserva trocou de e-mail.
  acao text not null check (acao in ('solicitada', 'refeita', 'pronta', 'erro', 'conflito', 'substituida')),
  detalhe text check (detalhe is null or char_length(detalhe) <= 300),
  usuario uuid,
  em timestamptz not null default now()
);
create index if not exists agenda_kickoff_zoom_inscricoes_historico_idx
  on public.agenda_kickoff_zoom_inscricoes_historico (inscricao_id, em desc);

alter table public.agenda_kickoff_zoom_inscricoes enable row level security;
alter table public.agenda_kickoff_zoom_inscricoes_historico enable row level security;
revoke all on public.agenda_kickoff_zoom_inscricoes, public.agenda_kickoff_zoom_inscricoes_historico from anon, authenticated;
grant all on public.agenda_kickoff_zoom_inscricoes, public.agenda_kickoff_zoom_inscricoes_historico to service_role;

-- ---------------------------------------------------------------------------
-- 2. Regras
-- ---------------------------------------------------------------------------

-- Inscrição não se apaga e não troca de sala, e-mail nem empresa; o histórico não
-- muda nem se apaga.
create or replace function public._agenda_kickoff_zoom_inscricoes_guarda()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'agenda_kickoff_zoom_inscricoes_historico' then
    raise exception 'O histórico das inscrições Zoom não muda nem se apaga.' using errcode = '42501';
  end if;
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'Inscrições Zoom dos kickoffs não se apagam: são o histórico do acesso.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    select s.zoom_meeting_id into new.zoom_meeting_id from public.agenda_kickoff_zoom_salas s where s.id = new.sala_id;
    if new.zoom_meeting_id is null then
      raise exception 'Sala Zoom não encontrada.' using errcode = 'P0002';
    end if;
  elsif (new.sala_id, new.zoom_meeting_id, new.email, new.tenant_id, new.codigo_empresa, new.primeira_reserva_id, new.criada_em)
          is distinct from (old.sala_id, old.zoom_meeting_id, old.email, old.tenant_id, old.codigo_empresa, old.primeira_reserva_id, old.criada_em) then
    raise exception 'A inscrição Zoom não muda de sala, e-mail nem empresa.' using errcode = '42501';
  end if;
  new.atualizada_em := now();
  return new;
end $$;

drop trigger if exists agenda_kickoff_zoom_inscricoes_guarda on public.agenda_kickoff_zoom_inscricoes;
create trigger agenda_kickoff_zoom_inscricoes_guarda
  before insert or update or delete on public.agenda_kickoff_zoom_inscricoes
  for each row execute function public._agenda_kickoff_zoom_inscricoes_guarda();
drop trigger if exists agenda_kickoff_zoom_inscricoes_sem_truncate on public.agenda_kickoff_zoom_inscricoes;
create trigger agenda_kickoff_zoom_inscricoes_sem_truncate
  before truncate on public.agenda_kickoff_zoom_inscricoes
  for each statement execute function public._agenda_kickoff_zoom_inscricoes_guarda();
drop trigger if exists agenda_kickoff_zoom_inscricoes_historico_imutavel on public.agenda_kickoff_zoom_inscricoes_historico;
create trigger agenda_kickoff_zoom_inscricoes_historico_imutavel
  before update or delete on public.agenda_kickoff_zoom_inscricoes_historico
  for each row execute function public._agenda_kickoff_zoom_inscricoes_guarda();
drop trigger if exists agenda_kickoff_zoom_inscricoes_historico_sem_truncate on public.agenda_kickoff_zoom_inscricoes_historico;
create trigger agenda_kickoff_zoom_inscricoes_historico_sem_truncate
  before truncate on public.agenda_kickoff_zoom_inscricoes_historico
  for each statement execute function public._agenda_kickoff_zoom_inscricoes_guarda();

-- ---------------------------------------------------------------------------
-- 3. Estado do acesso (só leitura; NUNCA devolve o link)
-- ---------------------------------------------------------------------------

-- Estado do acesso Zoom de uma reserva, na sala ativa:
--   {"reserva_id", "estado", "erro", "nome_no_zoom", "nome_difere", "sala_anterior",
--    "sala_com_problemas", "atualizado_em"}
-- estado: pronto | preparando | pendente (ainda não gerado) | sem_sala | conflito
--         | erro | inativo (a reserva não está ativa: não recebe acesso)
create or replace function public._agenda_kickoff_zoom_estado(p_reserva_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'reserva_id', x.reserva_id,
           'estado', x.estado,
           'erro', case when x.estado in ('erro', 'conflito') then x.erro end,
           'nome_no_zoom', case when x.estado = 'pronto' then x.nome_no_zoom end,
           'nome_difere', x.estado = 'pronto' and x.nome_difere,
           'sala_anterior', x.estado = 'pendente' and x.sala_anterior,
           'sala_com_problemas', x.estado not in ('inativo', 'sem_sala') and not x.sala_ok,
           'atualizado_em', x.atualizado_em)
    from (
      select r.id as reserva_id,
             i.atualizada_em as atualizado_em,
             coalesce(s.verificacao_ok, false) as sala_ok,
             nullif(btrim(coalesce(i.zoom_nome, '') || ' ' || coalesce(i.zoom_sobrenome, '')), '') as nome_no_zoom,
             lower(btrim(i.participante_nome)) is distinct from lower(btrim(r.participante_nome)) as nome_difere,
             exists (select 1 from public.agenda_kickoff_zoom_inscricoes a
                      where a.tenant_id = r.tenant_id and a.email = r.participante_email
                        and a.status = 'pronta' and a.sala_id is distinct from s.id) as sala_anterior,
             case
               when i.id is not null and i.tenant_id <> r.tenant_id then 'Este e-mail já tem acesso de outra empresa nesta sala. Revise o e-mail do participante.'
               when i.status = 'criando' then 'A última tentativa foi interrompida.'
               else i.ultimo_erro
             end as erro,
             case
               when r.status <> 'ativa' then 'inativo'
               when s.id is null then 'sem_sala'
               when i.id is null then 'pendente'
               when i.tenant_id <> r.tenant_id then 'conflito'
               when i.status = 'pronta' then 'pronto'
               when i.status = 'criando' and i.reivindicada_em > now() - interval '2 minutes' then 'preparando'
               when i.status = 'conflito' then 'conflito'
               else 'erro'
             end as estado
        from public.agenda_kickoff_reservas r
        left join public.agenda_kickoff_zoom_salas s on s.ativa
        left join public.agenda_kickoff_zoom_inscricoes i on i.sala_id = s.id and i.email = r.participante_email
       where r.id = p_reserva_id
    ) x
$$;

-- Painel: estado do acesso de várias reservas (sem chamar o Zoom, sem link).
create or replace function public.agenda_kickoff_zoom_acessos(p_reserva_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(e.estado), '[]'::jsonb)
    from (select public._agenda_kickoff_zoom_estado(r.id) as estado
            from public.agenda_kickoff_reservas r
           where r.id = any (coalesce(p_reserva_ids, '{}'::uuid[]))) e
   where e.estado is not null
$$;

-- Convite -> reserva ativa da empresa (página pública e /impulsao/reuniao/<código>,
-- sempre pelo servidor, que repassa a origem do visitante). Mesmas regras do convite
-- da M3 (_agenda_kickoff_convite_aberto): código errado ou revogado conta tentativa da
-- origem. Convite EXPIRADO com reserva ativa continua valendo: o acesso à reunião não
-- depende do prazo para novos agendamentos.
-- p_contar: o pedido vai gerar ou entregar acesso (limite de 30 por convite em 15 min).
--   {"status": "ok", "reserva_id", "inicio", "fim", "acesso": {estado...}}
--   | {"status": "sem_reserva" | "concluida"}
--   | {"status": "convite_invalido" | "convite_revogado" | "convite_expirado" | "muitas_tentativas"}
create or replace function public.agenda_kickoff_zoom_reserva_do_convite(p_codigo text, p_origem text, p_contar boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aberto jsonb := public._agenda_kickoff_convite_aberto(p_codigo, p_origem);
  v_convite uuid;
  v_tenant uuid;
  v_reserva uuid;
  v_inicio timestamptz;
  v_fim timestamptz;
begin
  if v_aberto->>'status' <> 'ok' then
    return jsonb_build_object('status', v_aberto->>'status');
  end if;
  v_convite := (v_aberto->>'convite_id')::uuid;
  v_tenant := (v_aberto->>'tenant_id')::uuid;

  select r.id, m.scheduled_start_at, coalesce(m.scheduled_end_at, m.scheduled_start_at + interval '1 hour')
    into v_reserva, v_inicio, v_fim
    from public.agenda_kickoff_reservas r
    join public.meetings m on m.id = r.meeting_id
   where r.tenant_id = v_tenant and r.status = 'ativa';

  if v_reserva is null then
    if exists (select 1 from public.agenda_kickoff_reservas r where r.tenant_id = v_tenant and r.status = 'concluida') then
      return jsonb_build_object('status', 'concluida');
    end if;
    if (v_aberto->>'expirado')::boolean then
      return public._agenda_kickoff_convite_expirado(p_origem);
    end if;
    return jsonb_build_object('status', 'sem_reserva');
  end if;

  if coalesce(p_contar, false) then
    if public._agenda_kickoff_limite_estourado('zoom:' || v_convite, 30, interval '15 minutes') then
      return jsonb_build_object('status', 'muitas_tentativas');
    end if;
    perform public._agenda_kickoff_limite_contar('zoom:' || v_convite, 30, interval '15 minutes');
  end if;

  return jsonb_build_object('status', 'ok', 'reserva_id', v_reserva, 'inicio', v_inicio, 'fim', v_fim,
                            'acesso', public._agenda_kickoff_zoom_estado(v_reserva));
end $$;

-- ---------------------------------------------------------------------------
-- 4. Inscrição (chamadas só pelo servidor, em volta das chamadas ao Zoom)
-- ---------------------------------------------------------------------------

-- Antes de chamar o Zoom: o que fazer com a inscrição desta reserva.
-- p_modo:
--   normal          pedido comum (agendamento, entrada na reunião);
--   tentar_de_novo  a equipe pediu de novo: ignora a espera de 15 s depois de um erro
--                   e reavalia um conflito; não refaz inscrição pronta;
--   refazer         a inscrição pronta deixou de valer no Zoom: cria outra.
-- p_usuario: quem pediu, quando é a equipe (confere a permissão de kickoff); nulo
--            quando o pedido vem da própria empresa, pelo link do convite.
-- Devolve {"acao": ...}:
--   indisponivel (+ motivo: reserva_inativa | sem_sala | sala_com_problemas)
--   conflito (+ motivo: outra_empresa | zoom)
--   aguardar                          outro pedido está criando agora
--   aguardar_erro (+ erro)            falhou há menos de 15 s
--   reaproveitar (+ inscricao {id, zoom_registrant_id, join_url, verificada_em}, contexto)
--   criar (+ inscricao {id}, contexto) a inscrição ficou "criando" para este pedido
-- contexto: {reserva_id, tenant_id, empresa, participante, email, zoom_meeting_id}
create or replace function public.agenda_kickoff_zoom_inscricao_decidir(p_reserva_id uuid, p_modo text, p_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.agenda_kickoff_reservas%rowtype;
  v_sala public.agenda_kickoff_zoom_salas%rowtype;
  v_i public.agenda_kickoff_zoom_inscricoes%rowtype;
  v_empresa text;
  v_ctx jsonb;
  v_acao text;
begin
  if p_modo is null or p_modo not in ('normal', 'tentar_de_novo', 'refazer') then
    raise exception 'Modo inválido.' using errcode = '22023';
  end if;
  if p_usuario is not null then
    perform public._agenda_kickoff_exigir_gestor(p_usuario);
  end if;

  select * into v_r from public.agenda_kickoff_reservas where id = p_reserva_id;
  if v_r.id is null or v_r.status <> 'ativa' then
    return jsonb_build_object('acao', 'indisponivel', 'motivo', 'reserva_inativa');
  end if;

  select * into v_sala from public.agenda_kickoff_zoom_salas where ativa;
  if v_sala.id is null then
    return jsonb_build_object('acao', 'indisponivel', 'motivo', 'sem_sala');
  end if;

  select coalesce(nullif(btrim(t.name), ''), 'Empresa') into v_empresa from public.client_tenants t where t.id = v_r.tenant_id;
  v_ctx := jsonb_build_object(
    'reserva_id', v_r.id,
    'tenant_id', v_r.tenant_id,
    'empresa', v_empresa,
    'participante', v_r.participante_nome,
    'email', v_r.participante_email,
    'zoom_meeting_id', v_sala.zoom_meeting_id);

  -- Um pedido por vez para a mesma sala + e-mail.
  perform pg_advisory_xact_lock(hashtext('agenda_kickoff_zoom_inscricao:' || v_sala.id || ':' || v_r.participante_email));

  select * into v_i from public.agenda_kickoff_zoom_inscricoes
   where sala_id = v_sala.id and email = v_r.participante_email
   for update;

  if v_i.id is null then
    if not v_sala.verificacao_ok then
      return jsonb_build_object('acao', 'indisponivel', 'motivo', 'sala_com_problemas');
    end if;
    insert into public.agenda_kickoff_zoom_inscricoes
      (sala_id, zoom_meeting_id, email, tenant_id, codigo_empresa, primeira_reserva_id, ultima_reserva_id,
       participante_nome, status, tentativas, reivindicada_em, ultima_tentativa_em, solicitada_por)
    values
      (v_sala.id, v_sala.zoom_meeting_id, v_r.participante_email, v_r.tenant_id,
       upper(substr(replace(v_r.tenant_id::text, '-', ''), 1, 8)), v_r.id, v_r.id,
       v_r.participante_nome, 'criando', 1, now(), now(), p_usuario)
    returning * into v_i;
    v_acao := 'solicitada';
  elsif v_i.tenant_id <> v_r.tenant_id then
    -- O mesmo e-mail já é de outra empresa nesta sala: nunca reaproveita.
    return jsonb_build_object('acao', 'conflito', 'motivo', 'outra_empresa');
  elsif v_i.status = 'pronta' and p_modo <> 'refazer' then
    update public.agenda_kickoff_zoom_inscricoes
       set ultima_reserva_id = v_r.id, substituida_em = null, substituida_por = null
     where id = v_i.id and (ultima_reserva_id <> v_r.id or substituida_em is not null);
    v_acao := 'reaproveitada';
  elsif v_i.status = 'criando' and v_i.reivindicada_em > now() - interval '2 minutes' then
    return jsonb_build_object('acao', 'aguardar');
  elsif v_i.status = 'conflito' and p_modo = 'normal' then
    return jsonb_build_object('acao', 'conflito', 'motivo', 'zoom');
  elsif v_i.status = 'erro' and p_modo = 'normal' and v_i.ultima_tentativa_em > now() - interval '15 seconds' then
    return jsonb_build_object('acao', 'aguardar_erro', 'erro', v_i.ultimo_erro);
  elsif not v_sala.verificacao_ok then
    return jsonb_build_object('acao', 'indisponivel', 'motivo', 'sala_com_problemas');
  else
    v_acao := case when v_i.status = 'pronta' then 'refeita' else 'solicitada' end;
    update public.agenda_kickoff_zoom_inscricoes
       set status = 'criando', reivindicada_em = now(), tentativas = tentativas + 1, ultima_tentativa_em = now(),
           ultima_reserva_id = v_r.id, participante_nome = v_r.participante_nome, solicitada_por = p_usuario,
           substituida_em = null, substituida_por = null
     where id = v_i.id;
  end if;

  -- A reserva usava outro e-mail nesta sala: aquela inscrição deixa de valer para ela.
  with antigas as (
    update public.agenda_kickoff_zoom_inscricoes a
       set substituida_em = now(), substituida_por = v_i.id
     where a.sala_id = v_sala.id and a.ultima_reserva_id = v_r.id and a.id <> v_i.id and a.substituida_em is null
    returning a.id
  )
  insert into public.agenda_kickoff_zoom_inscricoes_historico (inscricao_id, reserva_id, acao, detalhe, usuario)
  select id, v_r.id, 'substituida', 'O participante da reserva passou a usar outro e-mail.', p_usuario from antigas;

  if v_acao = 'reaproveitada' then
    return jsonb_build_object('acao', 'reaproveitar',
      'inscricao', jsonb_build_object('id', v_i.id, 'zoom_registrant_id', v_i.zoom_registrant_id,
                                      'join_url', v_i.join_url, 'verificada_em', v_i.verificada_em),
      'contexto', v_ctx);
  end if;

  insert into public.agenda_kickoff_zoom_inscricoes_historico (inscricao_id, reserva_id, acao, usuario)
  values (v_i.id, v_r.id, v_acao, p_usuario);
  return jsonb_build_object('acao', 'criar', 'inscricao', jsonb_build_object('id', v_i.id), 'contexto', v_ctx);
end $$;

-- Grava o resultado da chamada ao Zoom. Só vale para a inscrição que está "criando"
-- (quem a reservou); devolve false se outro pedido já concluiu.
create or replace function public.agenda_kickoff_zoom_inscricao_concluir(
  p_id uuid,
  p_status text,
  p_zoom_registrant_id text,
  p_join_url text,
  p_nome text,
  p_sobrenome text,
  p_organizacao text,
  p_nome_confere boolean,
  p_erro text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := p_status;
  v_erro text := left(coalesce(nullif(btrim(coalesce(p_erro, '')), ''), 'Falha ao gerar o acesso ao Zoom.'), 300);
  v_i public.agenda_kickoff_zoom_inscricoes%rowtype;
begin
  if p_status is null or p_status not in ('pronta', 'erro', 'conflito') then
    raise exception 'Resultado inválido.' using errcode = '22023';
  end if;
  if v_status = 'pronta' and (nullif(btrim(coalesce(p_zoom_registrant_id, '')), '') is null
                              or coalesce(p_join_url, '') !~ '^https://[^[:space:]]+$' or char_length(p_join_url) > 2000) then
    v_status := 'erro';
    v_erro := 'O Zoom não devolveu um link de entrada válido.';
  end if;

  if v_status = 'pronta' then
    begin
      update public.agenda_kickoff_zoom_inscricoes
         set status = 'pronta', zoom_registrant_id = left(btrim(p_zoom_registrant_id), 200), join_url = p_join_url,
             zoom_nome = left(p_nome, 200), zoom_sobrenome = left(p_sobrenome, 200), zoom_organizacao = left(p_organizacao, 200),
             nome_confere = p_nome_confere, ultimo_erro = null, reivindicada_em = null,
             verificada_em = now(), pronta_em = now()
       where id = p_id and status = 'criando'
      returning * into v_i;
    exception when unique_violation then
      v_status := 'erro';
      v_erro := 'Esta inscrição do Zoom já está ligada a outro e-mail nesta sala.';
    end;
  end if;
  if v_status <> 'pronta' then
    update public.agenda_kickoff_zoom_inscricoes
       set status = v_status, ultimo_erro = v_erro, reivindicada_em = null
     where id = p_id and status = 'criando'
    returning * into v_i;
  end if;
  if v_i.id is null then
    return false;
  end if;
  insert into public.agenda_kickoff_zoom_inscricoes_historico (inscricao_id, reserva_id, acao, detalhe, usuario)
  values (v_i.id, v_i.ultima_reserva_id, v_status, case when v_status <> 'pronta' then v_erro end, v_i.solicitada_por);
  return v_status = p_status;
end $$;

-- A inscrição pronta foi conferida no Zoom agora.
create or replace function public.agenda_kickoff_zoom_inscricao_verificada(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.agenda_kickoff_zoom_inscricoes set verificada_em = now() where id = p_id and status = 'pronta';
$$;

-- O link foi entregue ao participante (encaminhamento de /impulsao/reuniao/<código>).
create or replace function public.agenda_kickoff_zoom_inscricao_entregue(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.agenda_kickoff_zoom_inscricoes
     set acessos = acessos + 1, ultimo_acesso_em = now()
   where id = p_id and status = 'pronta';
$$;

-- ---------------------------------------------------------------------------
-- 5. Permissões: tudo só para o servidor (service_role)
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public._agenda_kickoff_zoom_inscricoes_guarda()',
    'public._agenda_kickoff_zoom_estado(uuid)',
    'public.agenda_kickoff_zoom_acessos(uuid[])',
    'public.agenda_kickoff_zoom_reserva_do_convite(text, text, boolean)',
    'public.agenda_kickoff_zoom_inscricao_decidir(uuid, text, uuid)',
    'public.agenda_kickoff_zoom_inscricao_concluir(uuid, text, text, text, text, text, text, boolean, text)',
    'public.agenda_kickoff_zoom_inscricao_verificada(uuid)',
    'public.agenda_kickoff_zoom_inscricao_entregue(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
