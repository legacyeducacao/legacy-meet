-- Kickoff Impulsão, Zoom E1: a sala Zoom recorrente dos kickoffs.
-- Projeto legacy-plan (eddfdgefrwjxfafkkzls). ADITIVA: só tabelas e funções novas
-- do kickoff. Não altera nenhuma tabela existente (nem do Meet, nem do Plan).
--
-- STATUS: NÃO APLICADA. Aplicar só com autorização (docs/kickoff/README.md,
-- "Zoom E1: sala dos kickoffs"). Depende de 001, 003, 004 e 005 (aplicadas).
--
-- Origem: sala Zoom do Legacy CS (docs/kickoff/referencia-cs/kickoff-cs-guia-tecnico.md,
-- seção 6 e Apêndice B), adaptada ao Meet:
--   - UMA reunião recorrente do Zoom (Meeting ID único) serve TODAS as sessões de
--     kickoff. As sessões continuam sendo eventos da agenda do Meet; nada de Zoom
--     é gravado nelas;
--   - uma sala ativa por vez. Trocar exige motivo e desativa a anterior, que fica
--     guardada (as inscrições da E2 e a presença da E3 apontam para o Meeting ID
--     que estava em uso). Linha nunca se apaga e o Meeting ID de uma linha não muda;
--   - ativar exige verificação aprovada há menos de 2 horas (mesma trava do CS e
--     do Plan). Quem consulta o Zoom é o servidor do Meet, com as credenciais que só
--     ele tem; o banco recebe o resultado;
--   - sala usada por turma do Legacy Plan (cohort_schedules, cohort_sessions ou
--     cohort_zoom_meeting_checks) nunca é aceita: a coleta de presença do Plan
--     passaria a vigiar os kickoffs. Só leitura nessas tabelas;
--   - toda ativação, troca, reativação e verificação fica no histórico (imutável);
--   - quem mexe: admin do Meet ou quem tem kickoff_impulsao.manage (a mesma regra
--     das reservas e convites, _agenda_kickoff_exigir_gestor). Tudo só para
--     service_role: o navegador nunca fala com estas tabelas.
--
-- O resumo guardado é uma LISTA FECHADA de campos lidos do Zoom (tipo, inscrição,
-- recorrência, ocorrências, fuso, duração, opções de entrada): nunca link do
-- anfitrião, link de entrada, senha ou e-mail.
--
-- Fora desta etapa: inscrições (E2), /impulsao/reuniao/<código>, presença (E3).

-- ---------------------------------------------------------------------------
-- 1. Tabelas
-- ---------------------------------------------------------------------------
create table if not exists public.agenda_kickoff_zoom_salas (
  id uuid primary key default gen_random_uuid(),
  zoom_meeting_id text not null unique check (zoom_meeting_id ~ '^[0-9]{9,12}$'),
  -- Título da reunião no Zoom, só para reconhecer na tela.
  topico text check (topico is null or char_length(topico) <= 300),
  ativa boolean not null default true,
  -- Última verificação no Zoom (a da ativação ou a de "verificar de novo").
  verificacao_ok boolean not null,
  verificacao_problemas jsonb not null default '[]'::jsonb check (jsonb_typeof(verificacao_problemas) = 'array'),
  verificacao_resumo jsonb not null default '{}'::jsonb check (jsonb_typeof(verificacao_resumo) = 'object'),
  verificada_em timestamptz not null,
  verificada_por uuid,
  ativada_em timestamptz not null default now(),
  ativada_por uuid,
  desativada_em timestamptz,
  desativada_por uuid,
  motivo_desativacao text check (motivo_desativacao is null or char_length(motivo_desativacao) <= 500),
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now(),
  constraint agenda_kickoff_zoom_salas_ativa_ck check (ativa = (desativada_em is null))
);
-- Uma sala ativa por vez.
create unique index if not exists agenda_kickoff_zoom_salas_uma_ativa
  on public.agenda_kickoff_zoom_salas (ativa) where ativa;

create table if not exists public.agenda_kickoff_zoom_salas_historico (
  id bigint generated always as identity primary key,
  sala_id uuid not null references public.agenda_kickoff_zoom_salas(id) on delete restrict,
  acao text not null check (acao in ('ativada', 'reativada', 'desativada', 'verificada')),
  verificacao_ok boolean,
  problemas jsonb check (problemas is null or jsonb_typeof(problemas) = 'array'),
  motivo text check (motivo is null or char_length(motivo) <= 500),
  usuario uuid,
  em timestamptz not null default now()
);
create index if not exists agenda_kickoff_zoom_salas_historico_sala_idx
  on public.agenda_kickoff_zoom_salas_historico (sala_id, em desc);

alter table public.agenda_kickoff_zoom_salas enable row level security;
alter table public.agenda_kickoff_zoom_salas_historico enable row level security;
revoke all on public.agenda_kickoff_zoom_salas, public.agenda_kickoff_zoom_salas_historico from anon, authenticated;
grant all on public.agenda_kickoff_zoom_salas, public.agenda_kickoff_zoom_salas_historico to service_role;

-- ---------------------------------------------------------------------------
-- 2. Regras
-- ---------------------------------------------------------------------------

-- O Meeting ID é de uma turma do Legacy Plan? (só leitura nas tabelas do Plan;
-- compara só os dígitos, como o Plan guarda).
create or replace function public.agenda_kickoff_zoom_sala_usada_no_plan(p_zoom_meeting_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.cohort_schedules c
                  where regexp_replace(coalesce(c.zoom_meeting_id, ''), '\D', '', 'g') = btrim(coalesce(p_zoom_meeting_id, '')))
      or exists (select 1 from public.cohort_sessions c
                  where regexp_replace(coalesce(c.zoom_meeting_id, ''), '\D', '', 'g') = btrim(coalesce(p_zoom_meeting_id, '')))
      or exists (select 1 from public.cohort_zoom_meeting_checks c
                  where regexp_replace(coalesce(c.zoom_meeting_id, ''), '\D', '', 'g') = btrim(coalesce(p_zoom_meeting_id, '')))
$$;

-- Meeting ID fixo; ativar só com verificação aprovada, recente e de sala que não é do Plan.
create or replace function public._agenda_kickoff_zoom_sala_guarda()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.zoom_meeting_id is distinct from old.zoom_meeting_id
                           or new.criada_em is distinct from old.criada_em) then
    raise exception 'O Meeting ID de uma sala não muda: cadastre a nova sala.' using errcode = '42501';
  end if;
  if new.ativa and (tg_op = 'INSERT' or not old.ativa) then
    if not (new.verificacao_ok and new.verificada_em > now() - interval '2 hours' and new.verificada_em <= now() + interval '1 minute') then
      raise exception 'A sala Zoom precisa de uma verificação aprovada nas últimas 2 horas para ser ativada.' using errcode = '22023';
    end if;
    if public.agenda_kickoff_zoom_sala_usada_no_plan(new.zoom_meeting_id) then
      raise exception 'Esta reunião Zoom é usada por uma turma do Legacy Plan: a sala do Impulsão precisa ser exclusiva.' using errcode = '22023';
    end if;
  end if;
  new.atualizada_em := now();
  return new;
end $$;

drop trigger if exists agenda_kickoff_zoom_salas_guarda on public.agenda_kickoff_zoom_salas;
create trigger agenda_kickoff_zoom_salas_guarda
  before insert or update on public.agenda_kickoff_zoom_salas
  for each row execute function public._agenda_kickoff_zoom_sala_guarda();

-- Salas e histórico não se apagam; o histórico também não muda.
create or replace function public._agenda_kickoff_zoom_sem_apagar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'agenda_kickoff_zoom_salas_historico' then
    raise exception 'O histórico da sala Zoom não muda nem se apaga.' using errcode = '42501';
  end if;
  raise exception 'Salas Zoom dos kickoffs não se apagam: ative outra sala para trocar.' using errcode = '42501';
end $$;

drop trigger if exists agenda_kickoff_zoom_salas_sem_apagar on public.agenda_kickoff_zoom_salas;
create trigger agenda_kickoff_zoom_salas_sem_apagar
  before delete on public.agenda_kickoff_zoom_salas
  for each row execute function public._agenda_kickoff_zoom_sem_apagar();
drop trigger if exists agenda_kickoff_zoom_salas_sem_truncate on public.agenda_kickoff_zoom_salas;
create trigger agenda_kickoff_zoom_salas_sem_truncate
  before truncate on public.agenda_kickoff_zoom_salas
  for each statement execute function public._agenda_kickoff_zoom_sem_apagar();
drop trigger if exists agenda_kickoff_zoom_historico_imutavel on public.agenda_kickoff_zoom_salas_historico;
create trigger agenda_kickoff_zoom_historico_imutavel
  before update or delete on public.agenda_kickoff_zoom_salas_historico
  for each row execute function public._agenda_kickoff_zoom_sem_apagar();
drop trigger if exists agenda_kickoff_zoom_historico_sem_truncate on public.agenda_kickoff_zoom_salas_historico;
create trigger agenda_kickoff_zoom_historico_sem_truncate
  before truncate on public.agenda_kickoff_zoom_salas_historico
  for each statement execute function public._agenda_kickoff_zoom_sem_apagar();

-- ---------------------------------------------------------------------------
-- 3. Operações (chamadas só pelo servidor, depois de consultar o Zoom)
-- ---------------------------------------------------------------------------

-- Passa a usar a sala. O servidor chama logo depois de o Zoom aprovar a
-- configuração; o gatilho confere de novo a trava de 2 horas e o Plan.
--   - outra sala ativa: exige motivo; ela é desativada (fica no histórico);
--   - sala nova: cria a linha; sala usada antes: reativa a mesma linha;
--   - a própria sala ativa: só registra a nova verificação.
-- {"acao": "ativada" | "reativada" | "verificada", "sala_id", "zoom_meeting_id", "anterior": <Meeting ID desativado> | null}
create or replace function public.agenda_kickoff_zoom_sala_ativar(
  p_zoom_meeting_id text,
  p_topico text,
  p_resumo jsonb,
  p_verificada_em timestamptz,
  p_motivo text,
  p_usuario uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text := btrim(coalesce(p_zoom_meeting_id, ''));
  v_topico text := left(nullif(btrim(coalesce(p_topico, '')), ''), 300);
  v_motivo text := left(nullif(btrim(coalesce(p_motivo, '')), ''), 500);
  v_atual public.agenda_kickoff_zoom_salas%rowtype;
  v_sala public.agenda_kickoff_zoom_salas%rowtype;
  v_acao text;
  v_anterior text;
begin
  perform public._agenda_kickoff_exigir_gestor(p_usuario);
  if v_id !~ '^[0-9]{9,12}$' then
    raise exception 'Meeting ID inválido (9 a 12 dígitos).' using errcode = '22023';
  end if;
  if p_verificada_em is null then
    raise exception 'Verificação da sala ausente.' using errcode = '22023';
  end if;
  -- Mesma fila das outras escritas do kickoff: duas abas não trocam a sala juntas.
  perform public._agenda_kickoff_fila();

  select * into v_atual from public.agenda_kickoff_zoom_salas where ativa for update;
  if v_atual.id is not null and v_atual.zoom_meeting_id <> v_id then
    if v_motivo is null then
      raise exception 'Informe o motivo da troca de sala.' using errcode = '22023';
    end if;
    update public.agenda_kickoff_zoom_salas
       set ativa = false, desativada_em = now(), desativada_por = p_usuario, motivo_desativacao = v_motivo
     where id = v_atual.id;
    insert into public.agenda_kickoff_zoom_salas_historico (sala_id, acao, motivo, usuario)
    values (v_atual.id, 'desativada', v_motivo, p_usuario);
    v_anterior := v_atual.zoom_meeting_id;
  end if;

  select * into v_sala from public.agenda_kickoff_zoom_salas where zoom_meeting_id = v_id for update;
  if v_sala.id is null then
    insert into public.agenda_kickoff_zoom_salas
      (zoom_meeting_id, topico, ativa, verificacao_ok, verificacao_problemas, verificacao_resumo,
       verificada_em, verificada_por, ativada_em, ativada_por)
    values
      (v_id, v_topico, true, true, '[]'::jsonb, coalesce(p_resumo, '{}'::jsonb),
       p_verificada_em, p_usuario, now(), p_usuario)
    returning * into v_sala;
    v_acao := 'ativada';
  elsif v_sala.ativa then
    update public.agenda_kickoff_zoom_salas
       set topico = coalesce(v_topico, topico), verificacao_ok = true, verificacao_problemas = '[]'::jsonb,
           verificacao_resumo = coalesce(p_resumo, verificacao_resumo),
           verificada_em = p_verificada_em, verificada_por = p_usuario
     where id = v_sala.id
    returning * into v_sala;
    v_acao := 'verificada';
  else
    update public.agenda_kickoff_zoom_salas
       set ativa = true, desativada_em = null, desativada_por = null, motivo_desativacao = null,
           ativada_em = now(), ativada_por = p_usuario,
           topico = coalesce(v_topico, topico), verificacao_ok = true, verificacao_problemas = '[]'::jsonb,
           verificacao_resumo = coalesce(p_resumo, verificacao_resumo),
           verificada_em = p_verificada_em, verificada_por = p_usuario
     where id = v_sala.id
    returning * into v_sala;
    v_acao := 'reativada';
  end if;

  insert into public.agenda_kickoff_zoom_salas_historico (sala_id, acao, verificacao_ok, problemas, motivo, usuario)
  values (v_sala.id, v_acao, true, '[]'::jsonb, v_motivo, p_usuario);

  return jsonb_build_object('acao', v_acao, 'sala_id', v_sala.id, 'zoom_meeting_id', v_sala.zoom_meeting_id, 'anterior', v_anterior);
end $$;

-- Guarda uma nova verificação de uma sala já cadastrada (aprovada ou não). Não
-- ativa nem desativa: se o Zoom mudou e a sala deixou de servir, a tela mostra os
-- problemas e a equipe decide (corrigir no Zoom ou trocar de sala).
create or replace function public.agenda_kickoff_zoom_sala_registrar_verificacao(
  p_sala_id uuid,
  p_ok boolean,
  p_problemas jsonb,
  p_topico text,
  p_resumo jsonb,
  p_verificada_em timestamptz,
  p_usuario uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sala public.agenda_kickoff_zoom_salas%rowtype;
begin
  perform public._agenda_kickoff_exigir_gestor(p_usuario);
  if p_ok is null or p_verificada_em is null then
    raise exception 'Resultado da verificação ausente.' using errcode = '22023';
  end if;
  if p_verificada_em > now() + interval '1 minute' then
    raise exception 'Horário da verificação inválido.' using errcode = '22023';
  end if;
  update public.agenda_kickoff_zoom_salas
     set verificacao_ok = p_ok,
         verificacao_problemas = coalesce(p_problemas, '[]'::jsonb),
         -- Sala não encontrada no Zoom: mantém o último título e resumo lidos.
         topico = coalesce(left(nullif(btrim(coalesce(p_topico, '')), ''), 300), topico),
         verificacao_resumo = coalesce(p_resumo, verificacao_resumo),
         verificada_em = p_verificada_em,
         verificada_por = p_usuario
   where id = p_sala_id
  returning * into v_sala;
  if v_sala.id is null then
    raise exception 'Sala Zoom não encontrada.' using errcode = 'P0002';
  end if;
  insert into public.agenda_kickoff_zoom_salas_historico (sala_id, acao, verificacao_ok, problemas, usuario)
  values (v_sala.id, 'verificada', p_ok, coalesce(p_problemas, '[]'::jsonb), p_usuario);
  return jsonb_build_object('sala_id', v_sala.id, 'verificacao_ok', v_sala.verificacao_ok);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Permissões: tudo só para o servidor (service_role)
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.agenda_kickoff_zoom_sala_usada_no_plan(text)',
    'public._agenda_kickoff_zoom_sala_guarda()',
    'public._agenda_kickoff_zoom_sem_apagar()',
    'public.agenda_kickoff_zoom_sala_ativar(text, text, jsonb, timestamptz, text, uuid)',
    'public.agenda_kickoff_zoom_sala_registrar_verificacao(uuid, boolean, jsonb, text, jsonb, timestamptz, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
