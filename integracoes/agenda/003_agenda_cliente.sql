-- Agenda para o cliente acompanhar pelo Legacy Plan (o Meet é o dono dos dados).
-- Duas funções para o usuário LOGADO no Plan (role CLIENT ou COLLABORATOR com
-- tenant): devolvem só os dados da empresa dele. Nada interno sai daqui
-- (bloqueios, motivos, justificativas, executores de outras empresas).
-- Uso no Plan: supabase.rpc('agenda_do_cliente', { p_de, p_ate }) e
--              supabase.rpc('jornadas_do_cliente').

create or replace function public.agenda_tenant_do_usuario()
returns uuid
language sql stable security definer set search_path = public as $$
  select u.tenant_id from public.users u
  where u.id = auth.uid() and u.role in ('CLIENT', 'COLLABORATOR') and u.tenant_id is not null
$$;

create or replace function public.agenda_do_cliente(
  p_de date default (current_date - 30),
  p_ate date default (current_date + 120)
)
returns table (
  reuniao_id uuid,
  titulo text,
  inicio timestamptz,
  fim timestamptz,
  status text,
  produto text,
  rotulo text,
  executor text,
  em_grupo boolean,
  link_sala text,
  tem_gravacao boolean
)
language sql stable security definer set search_path = public as $$
  with t as (select public.agenda_tenant_do_usuario() as tenant_id),
  -- reuniões da empresa + encontros em grupo (Impulsão) em que ela está matriculada
  ids as (
    select m.id, false as em_grupo from public.meetings m, t where m.tenant_id = t.tenant_id
    union
    select e.meeting_id, true from public.agenda_jornada_encontros e
      join public.agenda_jornadas j on j.id = e.jornada_id, t
      where j.tenant_id = t.tenant_id and e.meeting_id is not null and j.produto = 'impulsao'
  )
  select
    m.id,
    coalesce(nullif(trim(m.title), ''), 'Reunião'),
    m.scheduled_start_at,
    coalesce(m.scheduled_end_at, m.scheduled_start_at + interval '1 hour'),
    m.status::text,
    case
      when bool_or(ids.em_grupo) then 'impulsao'
      when ct.produto = 'impulsao_empresarial' then 'impulsao'
      when ct.produto like 'legado%' then 'legado'
      else 'outro'
    end,
    max(o.rotulo),
    max(u.name),
    bool_or(ids.em_grupo),
    case when m.status in ('scheduled', 'live') then 'https://meet.legacyexecutoria.com.br/rooms/' || m.room_name end,
    exists (select 1 from public.agenda_gravacoes_duracao g where g.meeting_id = m.id)
  from ids
  join public.meetings m on m.id = ids.id
  join public.meet_meeting_sector s on s.meeting_id = m.id and s.sector = 'executoria'
  left join public.client_tenants ct on ct.id = m.tenant_id
  left join public.users u on u.id = m.host_id
  left join public.agenda_ocorrencias o on o.meeting_id = m.id
  where m.status <> 'canceled'
    and m.scheduled_start_at >= p_de::timestamptz - interval '1 day'
    and m.scheduled_start_at < (p_ate + 1)::timestamptz + interval '1 day'
  group by m.id, ct.produto
  order by m.scheduled_start_at
$$;

create or replace function public.jornadas_do_cliente()
returns table (
  jornada_id uuid,
  produto text,
  grupo text,
  status text,
  inicio date,
  fim_previsto date,
  encontros_previstos int,
  encontros_realizados int,
  encontros jsonb
)
language sql stable security definer set search_path = public as $$
  select
    j.id,
    j.produto,
    g.nome,
    j.status,
    j.inicio,
    j.fim_previsto,
    j.encontros_previstos,
    (
      select count(*)::int from public.agenda_jornada_encontros e
      left join public.meetings m on m.id = e.meeting_id
      where e.jornada_id = j.id
        and (e.presenca = 'presente' or m.status = 'ended'
             or exists (select 1 from public.agenda_gravacoes_duracao gd where gd.meeting_id = e.meeting_id))
    ),
    coalesce((
      select jsonb_agg(jsonb_build_object('numero', e.numero, 'rotulo', e.rotulo, 'data', e.data, 'presenca', e.presenca, 'reposicao', e.recuperacao) order by e.numero)
      from public.agenda_jornada_encontros e where e.jornada_id = j.id
    ), '[]'::jsonb)
  from public.agenda_jornadas j
  left join public.agenda_grupos g on g.id = j.grupo_id
  where j.tenant_id = public.agenda_tenant_do_usuario()
    and j.status in ('ativa', 'concluida', 'pausada')
  order by j.inicio desc
$$;

revoke all on function public.agenda_tenant_do_usuario() from public, anon;
revoke all on function public.agenda_do_cliente(date, date) from public, anon;
revoke all on function public.jornadas_do_cliente() from public, anon;
grant execute on function public.agenda_tenant_do_usuario() to authenticated;
grant execute on function public.agenda_do_cliente(date, date) to authenticated;
grant execute on function public.jornadas_do_cliente() to authenticated;
