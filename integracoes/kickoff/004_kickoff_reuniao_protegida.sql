-- Kickoff Impulsão, etapa M2: a reunião de uma sessão com reservas (ativas, ausentes
-- ou concluídas) não muda de horário, de estado nem de empresa por nenhum caminho.
-- Projeto legacy-plan (eddfdgefrwjxfafkkzls). Depende de 003_kickoff_reservas.sql.
--
-- STATUS: NÃO APLICADA. Separada da 003 porque cria um gatilho em public.meetings,
-- tabela do Legacy Plan. Precisa de autorização própria (docs/kickoff/README.md,
-- "Reservas (M2)", "Proteção da reunião").
--
-- Por quê: a 003 protege as reservas em todas as escritas nas tabelas do kickoff,
-- e as rotas do Meet que mudam sessões de kickoff passam pelas funções da 003.
-- Mas a reunião (public.meetings) é escrita por vários caminhos: as rotas antigas
-- do Meet (/api/meetings/[id], /api/meetings/cancel, no-show), a agenda nova, o
-- webhook da sala e o Planner do Plan, que divide a tabela. Sem este gatilho, uma
-- escrita direta poderia mover ou cancelar uma sessão com empresas inscritas sem
-- passar pela regra, e a reserva ficaria apontando para um horário que a empresa
-- não escolheu ou para uma sessão cancelada.
--
-- Efeito para o resto do Plan e do Meet: nenhum. O gatilho só roda quando muda
-- horário, estado ou empresa (cláusula WHEN), e só recusa se a reunião for uma
-- sessão de kickoff com reserva não cancelada. Hoje não há nenhuma. Título, sala,
-- gravação e os demais campos continuam livres. Convive com os gatilhos que já
-- existem em meetings (meetings_updated_at_trigger, trg_guard_writable; conferido
-- em 12/11/2026): roda antes deles (ordem alfabética) e não muda a linha.
-- SECURITY DEFINER: quem atualiza pelo Plan (papel authenticated, com RLS) não tem
-- acesso às tabelas do kickoff, e mesmo assim o gatilho consegue conferir.
--
-- Concorrência: trava a linha da sessão (agenda_kickoff_sessoes) como a reserva
-- faz, então reservar e mover/cancelar a mesma sessão nunca se cruzam.
-- Desfazer: drop trigger agenda_kickoff_reuniao_protegida on public.meetings;
--           drop function public._agenda_kickoff_reuniao_protegida();

create or replace function public._agenda_kickoff_reuniao_protegida()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ativas int;
begin
  perform 1 from public.agenda_kickoff_sessoes k where k.meeting_id = old.id for update;
  if not found then
    return new; -- não é sessão de kickoff
  end if;
  -- Reservas não canceladas: ativas (as empresas escolheram o horário), ausentes ou
  -- concluídas (a sessão já aconteceu; o histórico depende dela).
  select count(*) into v_ativas
    from public.agenda_kickoff_reservas r where r.meeting_id = old.id and r.status <> 'cancelada';
  if v_ativas > 0 then
    raise exception 'Esta sessão de kickoff tem % empresa(s) inscrita(s): horário, estado e empresa não mudam. Remaneje ou cancele as reservas em Kickoffs Impulsão.', v_ativas
      using errcode = '22023';
  end if;
  return new;
end $$;

revoke all on function public._agenda_kickoff_reuniao_protegida() from public, anon, authenticated;

drop trigger if exists agenda_kickoff_reuniao_protegida on public.meetings;
create trigger agenda_kickoff_reuniao_protegida
  before update of scheduled_start_at, scheduled_end_at, status, tenant_id on public.meetings
  for each row
  when (old.scheduled_start_at is distinct from new.scheduled_start_at
        or old.scheduled_end_at is distinct from new.scheduled_end_at
        or old.status is distinct from new.status
        or old.tenant_id is distinct from new.tenant_id)
  execute function public._agenda_kickoff_reuniao_protegida();
