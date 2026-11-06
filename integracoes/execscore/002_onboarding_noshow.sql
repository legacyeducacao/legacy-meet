-- Onboarding e no-show fora do ExecScore.
-- Projeto Supabase: legacy-plan (eddfdgefrwjxfafkkzls). Migration ADITIVA.

-- 1) Reunião de onboarding (switch na criação/edição da reunião). Fica na
--    tabela do Meet (meet_meeting_sector), não em public.meetings, que é
--    compartilhada com o CRM.
alter table public.meet_meeting_sector
  add column if not exists onboarding boolean not null default false;

-- 2) Novo estado da integração: 'descartada' = a reunião não vai para o
--    ExecScore (onboarding ou no-show). O motivo fica em ultimo_erro.
--    O varredor e o envio só pegam 'aguardando', 'erro' e 'processando'
--    travado, então 'descartada' fica parada até alguém reabrir.
alter table execscore.meet_integracao
  drop constraint if exists meet_integracao_status_check;
alter table execscore.meet_integracao
  add constraint meet_integracao_status_check
  check (status in ('aguardando', 'processando', 'enviada', 'erro', 'descartada'));
