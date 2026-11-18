-- Reunião avulsa: terceiro setor de reunião, sem cliente (empresa interna da
-- Legacy). Fica fora do ExecScore, do NPS e do painel; a gravação é só dos
-- anfitriões e dos admins. Decisão do usuário em 18/11/2026.
alter table public.meet_meeting_sector drop constraint if exists meet_meeting_sector_sector_check;
alter table public.meet_meeting_sector add constraint meet_meeting_sector_sector_check
  check (sector = any (array['comercial'::text, 'executoria'::text, 'avulsa'::text]));

alter table public.agenda_series drop constraint if exists agenda_series_setor_check;
alter table public.agenda_series add constraint agenda_series_setor_check
  check (setor = any (array['executoria'::text, 'comercial'::text, 'avulsa'::text]));
