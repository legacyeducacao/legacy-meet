-- Kickoff Impulsão, etapa M3: convites por empresa e agendamento público
-- (/impulsao/agendar/<código>). Projeto legacy-plan (eddfdgefrwjxfafkkzls).
-- ADITIVA: tabelas novas do kickoff e uma coluna nova em agenda_kickoff_reservas
-- (tabela do kickoff, da 003).
--
-- STATUS: NÃO APLICADA. Aplicar só com autorização (docs/kickoff/README.md,
-- "Convites e agendamento público (M3)"). Depende de 001, 003 e 004 (aplicadas
-- em 12/11/2026; a 003 e a 004 pelo SQL Editor, sem linha em schema_migrations).
--
-- Origem: convites e página pública do Legacy CS (docs/kickoff/referencia-cs/
-- kickoff-cs-guia-tecnico.md, seção 4), adaptados ao Meet:
--   - a empresa é client_tenants.id; o código é a única coisa no link;
--   - o visitante NUNCA fala com o banco: as rotas públicas do Meet (servidor,
--     service_role) chamam estas funções e repassam a origem do visitante (hash
--     do IP, calculado no servidor). Nada é liberado para anon/authenticated;
--   - a reserva pública usa as MESMAS regras da M2: o insert passa pelo gatilho
--     _agenda_kickoff_reservas_regras (vaga com trava da sessão, uma reserva
--     ativa ou concluída por empresa, sessão futura e aberta, organizadora fora,
--     ligação com ausência/interrupção) e grava o histórico;
--   - o convite expira (validade definida na geração) e pode ser revogado:
--       válido ..................... agenda e consulta;
--       expirado SEM reserva ....... não abre ("convite_expirado");
--       expirado COM reserva ....... só consulta a reserva (ativa ou concluída),
--                                    nunca agenda de novo;
--       revogado ................... não abre.
--     A validade vale para NOVOS agendamentos. A futura rota /impulsao/reuniao/<código>
--     (Zoom) deve usar _agenda_kickoff_convite_aberto e aceitar convite expirado
--     com reserva válida: o acesso à reunião não depende da janela de 90 dias.
--
-- Fora desta etapa: Zoom (o futuro /impulsao/reuniao/<código> usará o MESMO
-- código para achar a reserva; o link individual do Zoom é outra coisa), e-mails.

-- ---------------------------------------------------------------------------
-- 1. Convites
-- ---------------------------------------------------------------------------
create table if not exists public.agenda_kickoff_convites (
  id uuid primary key default gen_random_uuid(),
  -- 12 caracteres de um alfabeto sem 0/o, 1/l/i (31 símbolos): ~7,9e17 códigos.
  codigo text not null unique check (codigo ~ '^[a-hj-km-np-z2-9]{12}$'),
  tenant_id uuid not null references public.client_tenants(id) on delete restrict,
  criado_por uuid,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null,
  revogado_em timestamptz,
  revogado_por uuid,
  motivo_revogacao text check (motivo_revogacao is null or char_length(motivo_revogacao) <= 500),
  constraint agenda_kickoff_convites_validade_ck check (expira_em > criado_em)
);
-- Um convite em vigor (não revogado) por empresa.
create unique index if not exists agenda_kickoff_convites_empresa_key
  on public.agenda_kickoff_convites (tenant_id) where revogado_em is null;

-- Qual convite fez a reserva (nulo = reserva feita pela equipe).
alter table public.agenda_kickoff_reservas
  add column if not exists convite_id uuid references public.agenda_kickoff_convites(id) on delete restrict;

-- Limite de tentativas das rotas públicas (janela fixa por chave).
create table if not exists public.agenda_kickoff_limite_publico (
  chave text primary key,
  janela_inicio timestamptz not null,
  tentativas int not null
);

alter table public.agenda_kickoff_convites enable row level security;
alter table public.agenda_kickoff_limite_publico enable row level security;
revoke all on public.agenda_kickoff_convites, public.agenda_kickoff_limite_publico from anon, authenticated;
grant all on public.agenda_kickoff_convites, public.agenda_kickoff_limite_publico to service_role;

-- Convite não se apaga nem muda; só pode ser revogado (uma vez).
create or replace function public._agenda_kickoff_convites_imutavel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'Convites de kickoff não se apagam: revogue o convite.' using errcode = '42501';
  end if;
  if old.revogado_em is not null then
    raise exception 'Convite revogado não muda.' using errcode = '22023';
  end if;
  if (new.id, new.codigo, new.tenant_id, new.criado_por, new.criado_em, new.expira_em)
       is distinct from (old.id, old.codigo, old.tenant_id, old.criado_por, old.criado_em, old.expira_em)
     or new.revogado_em is null then
    raise exception 'Convite só pode ser revogado.' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists agenda_kickoff_convites_imutavel on public.agenda_kickoff_convites;
create trigger agenda_kickoff_convites_imutavel
  before update or delete on public.agenda_kickoff_convites
  for each row execute function public._agenda_kickoff_convites_imutavel();
drop trigger if exists agenda_kickoff_convites_sem_truncate on public.agenda_kickoff_convites;
create trigger agenda_kickoff_convites_sem_truncate
  before truncate on public.agenda_kickoff_convites
  for each statement execute function public._agenda_kickoff_convites_imutavel();

-- ---------------------------------------------------------------------------
-- 2. Regras internas
-- ---------------------------------------------------------------------------

-- Código do convite: 12 bytes aleatórios de gen_random_uuid (pg_strong_random),
-- só das posições sem bits fixos de versão/variante (0-5 e 9-14).
create or replace function public._agenda_kickoff_codigo_convite()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(substr('abcdefghjkmnpqrstuvwxyz23456789', 1 + (get_byte(x.b, i) % 31), 1), '' order by o)
    from (select decode(replace(gen_random_uuid()::text, '-', ''), 'hex') as b) x,
         unnest(array[0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14]) with ordinality as p(i, o)
$$;

-- A chave passou do limite na janela? (só lê)
create or replace function public._agenda_kickoff_limite_estourado(p_chave text, p_limite int, p_janela interval)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.agenda_kickoff_limite_publico l
     where l.chave = p_chave and l.janela_inicio > now() - p_janela and l.tentativas >= p_limite)
$$;

-- Conta uma tentativa na janela da chave. True = chegou ao limite.
create or replace function public._agenda_kickoff_limite_contar(p_chave text, p_limite int, p_janela interval)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  -- Janelas velhas não servem para nada: a tabela guarda só o último dia.
  delete from public.agenda_kickoff_limite_publico where janela_inicio < now() - interval '1 day';
  insert into public.agenda_kickoff_limite_publico as l (chave, janela_inicio, tentativas)
  values (p_chave, now(), 1)
  on conflict (chave) do update
     set tentativas = case when l.janela_inicio <= now() - p_janela then 1 else l.tentativas + 1 end,
         janela_inicio = case when l.janela_inicio <= now() - p_janela then now() else l.janela_inicio end
  returning tentativas into v_n;
  return v_n >= p_limite;
end $$;

-- Abre o convite do link. {"status": "ok", "convite_id", "tenant_id", "expirado"} (só
-- para as funções daqui; nunca sai para o visitante) ou o motivo.
-- Código errado ou revogado conta tentativa da origem; com 10 em 15 minutos a origem
-- fica bloqueada, inclusive para código certo (senão o bloqueio diria qual código
-- existe). Expirado volta "ok" com expirado = true: quem chama decide se só consulta
-- (há reserva) ou recusa e conta a tentativa (_agenda_kickoff_convite_expirado).
create or replace function public._agenda_kickoff_convite_aberto(p_codigo text, p_origem text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chave text := 'origem:' || coalesce(nullif(btrim(p_origem), ''), '?');
  v_c public.agenda_kickoff_convites%rowtype;
begin
  if public._agenda_kickoff_limite_estourado(v_chave, 10, interval '15 minutes') then
    return jsonb_build_object('status', 'muitas_tentativas');
  end if;
  select * into v_c from public.agenda_kickoff_convites where codigo = lower(btrim(coalesce(p_codigo, '')));
  if v_c.id is null then
    perform public._agenda_kickoff_limite_contar(v_chave, 10, interval '15 minutes');
    return jsonb_build_object('status', 'convite_invalido');
  end if;
  if v_c.revogado_em is not null then
    perform public._agenda_kickoff_limite_contar(v_chave, 10, interval '15 minutes');
    return jsonb_build_object('status', 'convite_revogado');
  end if;
  return jsonb_build_object('status', 'ok', 'convite_id', v_c.id, 'tenant_id', v_c.tenant_id,
                            'expirado', v_c.expira_em <= now());
end $$;

-- Convite expirado usado onde não vale: conta a tentativa da origem e devolve o motivo.
create or replace function public._agenda_kickoff_convite_expirado(p_origem text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._agenda_kickoff_limite_contar('origem:' || coalesce(nullif(btrim(p_origem), ''), '?'), 10, interval '15 minutes');
  return jsonb_build_object('status', 'convite_expirado');
end $$;

-- Quem conduz: nome e foto do anfitrião. Foto só do bucket PÚBLICO de avatares do
-- Supabase (storage/v1/object/public/avatars/); qualquer outra fica de fora (a página
-- mostra as iniciais).
create or replace function public._agenda_kickoff_publico_anfitriao(p_usuario uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when u.id is null then null else jsonb_build_object(
           'nome', coalesce(nullif(btrim(u.name), ''), 'Equipe Legacy'),
           'foto', case when u.avatar_url ~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/avatars/[^?#[:space:]]+$'
                        then u.avatar_url end) end
    from (select p_usuario as id) x
    left join public.users u on u.id = x.id
$$;

-- Reserva ativa da empresa, no formato da página (sem ids da empresa).
create or replace function public._agenda_kickoff_publico_reserva(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'data', to_char(m.scheduled_start_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'),
           'inicio', to_char(m.scheduled_start_at at time zone 'America/Sao_Paulo', 'HH24:MI'),
           'fim', to_char(coalesce(m.scheduled_end_at, m.scheduled_start_at + interval '1 hour') at time zone 'America/Sao_Paulo', 'HH24:MI'),
           'starts_at', m.scheduled_start_at,
           'participante', r.participante_nome,
           'anfitriao', public._agenda_kickoff_publico_anfitriao(m.host_id))
    from public.agenda_kickoff_reservas r
    join public.meetings m on m.id = r.meeting_id
   where r.tenant_id = p_tenant_id and r.status = 'ativa'
$$;

-- ---------------------------------------------------------------------------
-- 3. Funções públicas (chamadas só pelo servidor do Meet, com a origem do visitante)
-- ---------------------------------------------------------------------------

-- Tudo o que a página mostra, só da empresa do convite:
--   {"status": "ok",
--    "empresa": {"nome"},
--    "situacao": "disponivel" | "reservada" | "concluida",
--    "expirado": true | false,                    -- true: só consulta (há reserva)
--    "reserva": {...} | null,                     -- reserva ativa
--    "sessoes": [{"id","data","inicio","fim","starts_at","vagas","anfitriao"}]}  -- só em "disponivel"
--   ou {"status": "convite_invalido" | "convite_revogado" | "convite_expirado" | "muitas_tentativas"}
create or replace function public.agenda_kickoff_publico_convite(p_codigo text, p_origem text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aberto jsonb := public._agenda_kickoff_convite_aberto(p_codigo, p_origem);
  v_tenant uuid;
  v_nome text;
  v_reserva jsonb;
  v_situacao text;
  v_sessoes jsonb := '[]'::jsonb;
begin
  if v_aberto->>'status' <> 'ok' then
    return jsonb_build_object('status', v_aberto->>'status');
  end if;
  v_tenant := (v_aberto->>'tenant_id')::uuid;
  select coalesce(nullif(btrim(t.name), ''), 'Sua empresa') into v_nome from public.client_tenants t where t.id = v_tenant;

  v_reserva := public._agenda_kickoff_publico_reserva(v_tenant);
  v_situacao := case
    when exists (select 1 from public.agenda_kickoff_reservas r where r.tenant_id = v_tenant and r.status = 'concluida') then 'concluida'
    when v_reserva is not null then 'reservada'
    else 'disponivel' end;
  -- Expirado: só serve para consultar uma reserva (ativa ou concluída).
  if (v_aberto->>'expirado')::boolean and v_situacao = 'disponivel' then
    return public._agenda_kickoff_convite_expirado(p_origem);
  end if;

  if v_situacao = 'disponivel' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', s.meeting_id,
             'data', to_char(s.inicio at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'),
             'inicio', to_char(s.inicio at time zone 'America/Sao_Paulo', 'HH24:MI'),
             'fim', to_char(s.fim at time zone 'America/Sao_Paulo', 'HH24:MI'),
             'starts_at', s.inicio,
             'vagas', s.vagas,
             'anfitriao', public._agenda_kickoff_publico_anfitriao(s.host_id))
           order by s.inicio, s.meeting_id), '[]'::jsonb)
      into v_sessoes
      from (
        select k.meeting_id, m.scheduled_start_at as inicio,
               coalesce(m.scheduled_end_at, m.scheduled_start_at + interval '1 hour') as fim,
               m.host_id, k.capacidade - public._agenda_kickoff_ocupadas(k.meeting_id) as vagas
          from public.agenda_kickoff_sessoes k
          join public.meetings m on m.id = k.meeting_id
         where k.tipo = 'kickoff_impulsao'
           and k.aceita_reservas
           and m.status = 'scheduled'
           and m.scheduled_start_at > now()
           and m.scheduled_start_at < now() + interval '180 days'
           and m.tenant_id <> v_tenant
      ) s
     where s.vagas > 0;
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'empresa', jsonb_build_object('nome', v_nome),
    'situacao', v_situacao,
    'expirado', (v_aberto->>'expirado')::boolean,
    'reserva', v_reserva,
    'sessoes', v_sessoes);
end $$;

-- Marca o kickoff da empresa do convite na sessão escolhida.
--   {"status": "ok", "reserva": {...}}            marcado (ou já estava nesta sessão)
--   {"status": "ja_inscrita", "reserva": {...}}   já tem kickoff marcado em outra sessão
--   {"status": "concluida"}                       a empresa já concluiu o kickoff
--   {"status": "sessao_lotada" | "sessao_indisponivel" | "dados_invalidos" (+ "mensagem")
--             | "muitas_tentativas" | "convite_invalido" | "convite_revogado" | "convite_expirado"}
-- Casos esperados devolvem status (não erro): a contagem de tentativas fica gravada.
-- A empresa sai SEMPRE do convite, nunca do pedido.
create or replace function public.agenda_kickoff_publico_agendar(
  p_codigo text,
  p_meeting_id uuid,
  p_nome text,
  p_email text,
  p_telefone text,
  p_origem text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aberto jsonb := public._agenda_kickoff_convite_aberto(p_codigo, p_origem);
  v_convite uuid;
  v_tenant uuid;
  v_p record;
  v_atual uuid;
  v_ausencia uuid;
begin
  if v_aberto->>'status' <> 'ok' then
    return jsonb_build_object('status', v_aberto->>'status');
  end if;
  v_convite := (v_aberto->>'convite_id')::uuid;
  v_tenant := (v_aberto->>'tenant_id')::uuid;
  -- Convite expirado não agenda (nem com reserva: essa só se consulta).
  if (v_aberto->>'expirado')::boolean then
    return public._agenda_kickoff_convite_expirado(p_origem);
  end if;

  -- Quem tem o link não fica martelando a reserva: 10 pedidos em 15 minutos.
  if public._agenda_kickoff_limite_estourado('reserva:' || v_convite, 10, interval '15 minutes') then
    return jsonb_build_object('status', 'muitas_tentativas');
  end if;
  perform public._agenda_kickoff_limite_contar('reserva:' || v_convite, 10, interval '15 minutes');

  -- Mesmas validações da reserva pela equipe (e-mail obrigatório).
  begin
    select * into v_p from public._agenda_kickoff_participante(p_nome, p_email, p_telefone);
  exception when sqlstate '22023' then
    return jsonb_build_object('status', 'dados_invalidos', 'mensagem', sqlerrm);
  end;

  -- Mesma fila das funções da equipe: uma escrita de kickoff por vez.
  perform public._agenda_kickoff_fila();

  if exists (select 1 from public.agenda_kickoff_reservas r where r.tenant_id = v_tenant and r.status = 'concluida') then
    return jsonb_build_object('status', 'concluida');
  end if;
  -- Uma reserva ativa por empresa. Pedido repetido para a mesma sessão (clique
  -- duplo, rede que reenviou) devolve a reserva que já existe.
  select r.meeting_id into v_atual from public.agenda_kickoff_reservas r
   where r.tenant_id = v_tenant and r.status = 'ativa';
  if v_atual is not null then
    return jsonb_build_object(
      'status', case when v_atual = p_meeting_id then 'ok' else 'ja_inscrita' end,
      'reserva', public._agenda_kickoff_publico_reserva(v_tenant));
  end if;
  if p_meeting_id is null then
    return jsonb_build_object('status', 'sessao_indisponivel');
  end if;

  -- Reagendamento depois de ausência ou interrupção (mesma regra da reserva da equipe).
  select r.id into v_ausencia
    from public.agenda_kickoff_reservas r
   where r.tenant_id = v_tenant and r.status in ('ausente', 'interrompida')
     and not exists (select 1 from public.agenda_kickoff_reservas n where n.origem_reserva_id = r.id)
   order by coalesce(r.interrompida_em, r.presenca_em) desc
   limit 1;

  perform set_config('agenda_kickoff.motivo', 'Agendado pela empresa, pelo link do convite', true);
  begin
    -- O gatilho da M2 confere vaga (com trava), sessão aberta e futura,
    -- organizadora e unicidade, e grava o histórico.
    insert into public.agenda_kickoff_reservas
      (meeting_id, tenant_id, participante_nome, participante_email, participante_telefone,
       origem_reserva_id, convite_id)
    values
      (p_meeting_id, v_tenant, v_p.nome, v_p.email, v_p.telefone, v_ausencia, v_convite);
  exception
    when sqlstate '22023' then
      perform set_config('agenda_kickoff.motivo', '', true);
      return jsonb_build_object('status',
        case when sqlerrm like 'Sessão lotada%' then 'sessao_lotada' else 'sessao_indisponivel' end);
    when sqlstate 'P0002' then
      perform set_config('agenda_kickoff.motivo', '', true);
      return jsonb_build_object('status', 'sessao_indisponivel');
    when unique_violation then
      perform set_config('agenda_kickoff.motivo', '', true);
      if exists (select 1 from public.agenda_kickoff_reservas r where r.tenant_id = v_tenant and r.status = 'concluida') then
        return jsonb_build_object('status', 'concluida');
      end if;
      return jsonb_build_object('status', 'ja_inscrita', 'reserva', public._agenda_kickoff_publico_reserva(v_tenant));
  end;
  perform set_config('agenda_kickoff.motivo', '', true);

  return jsonb_build_object('status', 'ok', 'reserva', public._agenda_kickoff_publico_reserva(v_tenant));
end $$;

-- ---------------------------------------------------------------------------
-- 4. Gestão dos convites (equipe com a permissão de kickoff ou admin)
-- ---------------------------------------------------------------------------

-- Confere se a empresa pode receber convite.
create or replace function public._agenda_kickoff_convite_empresa(p_tenant_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_tenant_id is null or not exists (select 1 from public.client_tenants t where t.id = p_tenant_id) then
    raise exception 'Empresa não encontrada.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.agenda_kickoff_sessoes k join public.meetings m on m.id = k.meeting_id
              where m.tenant_id = p_tenant_id) then
    raise exception 'A empresa organizadora dos kickoffs não recebe convite.' using errcode = '22023';
  end if;
  if exists (select 1 from public.agenda_kickoff_reservas r where r.tenant_id = p_tenant_id and r.status = 'concluida') then
    raise exception 'Esta empresa já concluiu o kickoff: não precisa de convite.' using errcode = '22023';
  end if;
end $$;

-- Cria um convite em vigor (o anterior já foi revogado ou não existe).
create or replace function public._agenda_kickoff_convite_novo(p_tenant_id uuid, p_validade_dias int, p_usuario uuid)
returns public.agenda_kickoff_convites
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.agenda_kickoff_convites%rowtype;
begin
  if p_validade_dias is null or p_validade_dias not between 1 and 365 then
    raise exception 'A validade do convite deve ser de 1 a 365 dias.' using errcode = '22023';
  end if;
  -- Código repetido é quase impossível; se acontecer, sorteia de novo.
  for i in 1..5 loop
    begin
      insert into public.agenda_kickoff_convites (codigo, tenant_id, criado_por, expira_em)
      values (public._agenda_kickoff_codigo_convite(), p_tenant_id, p_usuario, now() + make_interval(days => p_validade_dias))
      returning * into v_c;
      return v_c;
    exception when unique_violation then
      if exists (select 1 from public.agenda_kickoff_convites where tenant_id = p_tenant_id and revogado_em is null) then
        raise exception 'Esta empresa já tem um convite em vigor.' using errcode = '23505';
      end if;
    end;
  end loop;
  raise exception 'Não foi possível gerar o convite. Tente de novo.' using errcode = 'P0001';
end $$;

-- Revoga o convite em vigor da empresa (se houver). Devolve quantos revogou.
create or replace function public._agenda_kickoff_convite_revogar_vigente(p_tenant_id uuid, p_motivo text, p_usuario uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  with r as (
    update public.agenda_kickoff_convites
       set revogado_em = now(), revogado_por = p_usuario,
           motivo_revogacao = left(nullif(btrim(coalesce(p_motivo, '')), ''), 500)
     where tenant_id = p_tenant_id and revogado_em is null
    returning 1
  )
  select count(*) into v_n from r;
  return v_n;
end $$;

-- Devolve o convite em vigor da empresa ou cria um. Expirado é revogado e trocado.
-- {"codigo", "criado_em", "expira_em", "reutilizado"}
create or replace function public.agenda_kickoff_convite_gerar(p_tenant_id uuid, p_validade_dias int, p_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.agenda_kickoff_convites%rowtype;
begin
  perform public._agenda_kickoff_exigir_gestor(p_usuario);
  perform public._agenda_kickoff_fila();
  perform public._agenda_kickoff_convite_empresa(p_tenant_id);

  select * into v_c from public.agenda_kickoff_convites
   where tenant_id = p_tenant_id and revogado_em is null for update;
  if v_c.id is not null and v_c.expira_em > now() then
    return jsonb_build_object('codigo', v_c.codigo, 'criado_em', v_c.criado_em, 'expira_em', v_c.expira_em, 'reutilizado', true);
  end if;
  if v_c.id is not null then
    perform public._agenda_kickoff_convite_revogar_vigente(p_tenant_id, 'Expirado', p_usuario);
  end if;
  v_c := public._agenda_kickoff_convite_novo(p_tenant_id, coalesce(p_validade_dias, 90), p_usuario);
  return jsonb_build_object('codigo', v_c.codigo, 'criado_em', v_c.criado_em, 'expira_em', v_c.expira_em, 'reutilizado', false);
end $$;

-- Troca o convite: o link antigo para de abrir na hora e nasce outro.
create or replace function public.agenda_kickoff_convite_reemitir(p_tenant_id uuid, p_validade_dias int, p_motivo text, p_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.agenda_kickoff_convites%rowtype;
  v_n int;
begin
  perform public._agenda_kickoff_exigir_gestor(p_usuario);
  perform public._agenda_kickoff_fila();
  perform public._agenda_kickoff_convite_empresa(p_tenant_id);
  v_n := public._agenda_kickoff_convite_revogar_vigente(p_tenant_id, coalesce(nullif(btrim(coalesce(p_motivo, '')), ''), 'Reemitido'), p_usuario);
  v_c := public._agenda_kickoff_convite_novo(p_tenant_id, coalesce(p_validade_dias, 90), p_usuario);
  return jsonb_build_object('codigo', v_c.codigo, 'criado_em', v_c.criado_em, 'expira_em', v_c.expira_em,
                            'reutilizado', false, 'revogados', v_n);
end $$;

-- Revoga o convite em vigor, sem criar outro.
create or replace function public.agenda_kickoff_convite_revogar(p_tenant_id uuid, p_motivo text, p_usuario uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  perform public._agenda_kickoff_exigir_gestor(p_usuario);
  perform public._agenda_kickoff_fila();
  v_n := public._agenda_kickoff_convite_revogar_vigente(p_tenant_id, p_motivo, p_usuario);
  if v_n = 0 then
    raise exception 'Esta empresa não tem convite em vigor.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('revogados', v_n);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Permissões: tudo só para o servidor (service_role)
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public._agenda_kickoff_convites_imutavel()',
    'public._agenda_kickoff_codigo_convite()',
    'public._agenda_kickoff_limite_estourado(text, int, interval)',
    'public._agenda_kickoff_limite_contar(text, int, interval)',
    'public._agenda_kickoff_convite_aberto(text, text)',
    'public._agenda_kickoff_convite_expirado(text)',
    'public._agenda_kickoff_publico_reserva(uuid)',
    'public._agenda_kickoff_publico_anfitriao(uuid)',
    'public.agenda_kickoff_publico_convite(text, text)',
    'public.agenda_kickoff_publico_agendar(text, uuid, text, text, text, text)',
    'public._agenda_kickoff_convite_empresa(uuid)',
    'public._agenda_kickoff_convite_novo(uuid, int, uuid)',
    'public._agenda_kickoff_convite_revogar_vigente(uuid, text, uuid)',
    'public.agenda_kickoff_convite_gerar(uuid, int, uuid)',
    'public.agenda_kickoff_convite_reemitir(uuid, int, text, uuid)',
    'public.agenda_kickoff_convite_revogar(uuid, text, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
