-- Conferência da migration 006 (Zoom E1) e preservação de 001-005. SÓ LEITURA.
-- Uma linha por conferência: item, resultado (OK/DIVERGE) e detalhe.
with esperado(nome, md5, origem) as (values
  ('agenda_do_cliente','682d77488d270470c5b361e48c646aa8','001'),
  ('_agenda_kickoff_quando','b94cab84b4cd5a0ff2f91c90b4863c16','003'),
  ('_agenda_kickoff_exigir_gestor','2ed3d490991740e3a8eb69ba944cf442','003'),
  ('_agenda_kickoff_fila','182a6e56fa2055e8869ec01375a7ef48','003'),
  ('_agenda_kickoff_ocupadas','e50168ba846f2d811c28ce86f08764ab','003'),
  ('_agenda_kickoff_conferir_empresa','f9134f1e67ed6d23badca2d47cbbd40e','003'),
  ('_agenda_kickoff_conferir_vaga','692a4d6475dc5d86d3793c9721b4b4c8','003'),
  ('_agenda_kickoff_reservas_regras','c6eda26582a50477aec0d9e5037a1244','003'),
  ('_agenda_kickoff_reservas_historico','f828788be31e5c9fe419f767f94e1c08','003'),
  ('_agenda_kickoff_imutavel','bf2e3b16e90e3cdd2a10f2ef5bd77467','003'),
  ('_agenda_kickoff_sessoes_capacidade','dab6b2e3a60784094e71bd99397173ce','003'),
  ('_agenda_kickoff_participante','73e29a591d47d003573440d9ebfe2c24','003'),
  ('agenda_kickoff_reservar','d116613f024062132943d870d94a516e','003'),
  ('agenda_kickoff_reagendar','ff9f384fb87cd7f6fc7bc032bc52366a','003'),
  ('agenda_kickoff_remanejar','81d98ca81ed58918430ff0deec1094a2','003'),
  ('agenda_kickoff_cancelar_reserva','09c3e1ad8b694cd1e0c7ccdb22b22632','003'),
  ('agenda_kickoff_registrar_presenca','a827f78eb0dde5f3ad9d563066bc9ff6','003'),
  ('agenda_kickoff_concluir','c39fb441514d9255d1e96e9af93fbd83','003'),
  ('agenda_kickoff_registrar_interrupcao','31933361003bbcbd5c844ee7c99b5558','003'),
  ('agenda_kickoff_corrigir_presenca','4586aa9e2a9f16f7d3258338e723828f','003'),
  ('agenda_kickoff_atualizar_participante','7fb87db046ce78e4b5c2a79fe9acbd41','003'),
  ('agenda_kickoff_configurar_sessao','6cb6c48d32a0d5e6bb81fc2c701ab2b8','003'),
  ('agenda_kickoff_remarcar_sessoes','50c1b64f95565a47f364bf7d25d76e17','003'),
  ('agenda_kickoff_cancelar_sessoes','e3f6d91e2e009fc1ee504a140ee38606','003'),
  ('_agenda_kickoff_reuniao_protegida','221351dfeb76ac2bfcba8f5cd14cfd84','004'),
  ('_agenda_kickoff_convites_imutavel','ddce481cd8f9840ed603327f2bbba02f','005'),
  ('_agenda_kickoff_codigo_convite','20bc48fcc2758fba5f15b93af9995a74','005'),
  ('_agenda_kickoff_limite_estourado','f2e36073356674d1124ac709b8f1976a','005'),
  ('_agenda_kickoff_limite_contar','70084d0eef9938e3f09b05e28dede2cd','005'),
  ('_agenda_kickoff_convite_aberto','08f1ef3edf127453ec5b04021e85f716','005'),
  ('_agenda_kickoff_convite_expirado','c6033444c4f7e05d758d4603f8e6d4c7','005'),
  ('_agenda_kickoff_publico_anfitriao','6813c0e3cf36cc39e18051054d9e6b97','005'),
  ('_agenda_kickoff_publico_reserva','b003613b40a873365fdd7986ff91d593','005'),
  ('agenda_kickoff_publico_convite','d769ce9fc26f9e664aec7c426df45543','005'),
  ('agenda_kickoff_publico_agendar','c8def5ce57c7b1ca4d100012664a462e','005'),
  ('_agenda_kickoff_convite_empresa','87875e7dad247f5006cac4aa1b3c5815','005'),
  ('_agenda_kickoff_convite_novo','d3f63387011856564e80937fba3a1e9b','005'),
  ('_agenda_kickoff_convite_revogar_vigente','f76ed43b8bc01e089b6b161bcd6d75a8','005'),
  ('agenda_kickoff_convite_gerar','393ff0d4f9de37b1f37099a25918bca0','005'),
  ('agenda_kickoff_convite_reemitir','4c7cf40acc4623a364f92dea21b92a4b','005'),
  ('agenda_kickoff_convite_revogar','1f73bad5cfe1bd69f859567b8c5bc93e','005'),
  ('agenda_kickoff_zoom_sala_usada_no_plan','7ca58adad938bfba0bbeb8b26ce2a342','006'),
  ('_agenda_kickoff_zoom_sala_guarda','560510dcd2ca2f4c1e75f90f9dbd75db','006'),
  ('_agenda_kickoff_zoom_sem_apagar','5cc5c4ada67a230ec47221ad54c54c39','006'),
  ('agenda_kickoff_zoom_sala_ativar','f961cbededf8a40b5ff35ab4cfac2ea3','006'),
  ('agenda_kickoff_zoom_sala_registrar_verificacao','b753f82e5d84cd04094366f18ac3d29d','006')
),
funcoes as (
  select e.nome, e.origem, count(p.oid) as versoes,
         bool_and(md5(btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))) = e.md5) as corpo_igual,
         bool_or(has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')) as cliente_executa,
         bool_or(exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')) as public_executa,
         bool_and(has_function_privilege('service_role', p.oid, 'execute')) as servidor_executa,
         bool_and(p.proconfig @> array['search_path=""']) as search_path_vazio,
         bool_and(p.prosecdef) as definer
    from esperado e
    left join pg_proc p on p.proname = e.nome and p.pronamespace = 'public'::regnamespace
   group by e.nome, e.origem
)
select '1a. tabela de salas: colunas' as item,
       case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'agenda_kickoff_zoom_salas') = 16 then 'OK' else 'DIVERGE' end,
       (select count(*) || ' colunas (esperado 16)' from information_schema.columns where table_schema = 'public' and table_name = 'agenda_kickoff_zoom_salas')
union all
select '1b. histórico: colunas',
       case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'agenda_kickoff_zoom_salas_historico') = 8 then 'OK' else 'DIVERGE' end,
       (select count(*) || ' colunas (esperado 8)' from information_schema.columns where table_schema = 'public' and table_name = 'agenda_kickoff_zoom_salas_historico')
union all
select '1c. restrições',
       case when (select count(*) from pg_constraint where contype <> 'n' and conrelid = 'public.agenda_kickoff_zoom_salas'::regclass) = 8
             and (select count(*) from pg_constraint where contype <> 'n' and conrelid = 'public.agenda_kickoff_zoom_salas_historico'::regclass) = 5 then 'OK' else 'DIVERGE' end,
       (select string_agg(conname, ', ' order by conname) from pg_constraint
         where contype <> 'n' and conrelid in ('public.agenda_kickoff_zoom_salas'::regclass, 'public.agenda_kickoff_zoom_salas_historico'::regclass))
union all
select '1d. índices',
       case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'agenda_kickoff_zoom_salas_uma_ativa' and indexdef like '%UNIQUE%WHERE ativa%')
             and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'agenda_kickoff_zoom_salas_historico_sala_idx') then 'OK' else 'DIVERGE' end,
       (select string_agg(indexname, ', ' order by indexname) from pg_indexes where schemaname = 'public' and tablename like 'agenda_kickoff_zoom_salas%')
union all
select '1e. gatilhos (5, ativos)',
       case when (select count(*) from pg_trigger where not tgisinternal and tgenabled = 'O'
                   and tgrelid in ('public.agenda_kickoff_zoom_salas'::regclass, 'public.agenda_kickoff_zoom_salas_historico'::regclass)) = 5 then 'OK' else 'DIVERGE' end,
       (select string_agg(tgname, ', ' order by tgname) from pg_trigger where not tgisinternal
         and tgrelid in ('public.agenda_kickoff_zoom_salas'::regclass, 'public.agenda_kickoff_zoom_salas_historico'::regclass))
union all
select '1f. RLS ligado, sem policies, sem acesso de anon/authenticated',
       case when (select bool_and(relrowsecurity) from pg_class where oid in ('public.agenda_kickoff_zoom_salas'::regclass, 'public.agenda_kickoff_zoom_salas_historico'::regclass))
             and not exists (select 1 from pg_policies where tablename like 'agenda_kickoff_zoom_salas%')
             and not exists (select 1 from unnest(array['public.agenda_kickoff_zoom_salas', 'public.agenda_kickoff_zoom_salas_historico']) t, unnest(array['anon', 'authenticated']) r, unnest(array['select', 'insert', 'update', 'delete']) p
                              where has_table_privilege(r, t, p)) then 'OK' else 'DIVERGE' end,
       'service_role: ' || (select string_agg(distinct privilege_type, ',') from information_schema.role_table_grants where table_name = 'agenda_kickoff_zoom_salas' and grantee = 'service_role')
union all
select '2a. funções da 006: corpo igual ao arquivo, uma versão, search_path vazio, definer',
       case when bool_and(versoes = 1 and corpo_igual and search_path_vazio and definer) then 'OK' else 'DIVERGE' end,
       count(*) || ' funções; divergentes: ' || coalesce(string_agg(nome, ', ') filter (where not (versoes = 1 and corpo_igual and search_path_vazio and definer)), 'nenhuma')
  from funcoes where origem = '006'
union all
select '2b. funções da 006: só service_role executa',
       case when bool_and(not cliente_executa and not public_executa and servidor_executa) then 'OK' else 'DIVERGE' end,
       coalesce(string_agg(nome, ', ') filter (where cliente_executa or public_executa or not servidor_executa), 'nenhuma exceção')
  from funcoes where origem = '006'
union all
select '3. uma sala ativa por vez (índice único parcial em ativa)',
       case when exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
                          where c.relname = 'agenda_kickoff_zoom_salas_uma_ativa' and i.indisunique and i.indpred is not null) then 'OK' else 'DIVERGE' end,
       (select pg_get_indexdef('public.agenda_kickoff_zoom_salas_uma_ativa'::regclass))
union all
select '4. ativar exige verificação aprovada nas últimas 2 horas (gatilho na inserção e na atualização)',
       case when (select corpo_igual from funcoes where nome = '_agenda_kickoff_zoom_sala_guarda')
             and exists (select 1 from pg_trigger where tgname = 'agenda_kickoff_zoom_salas_guarda' and tgenabled = 'O'
                          and pg_get_triggerdef(oid) like '%BEFORE INSERT OR UPDATE%') then 'OK' else 'DIVERGE' end,
       'gatilho agenda_kickoff_zoom_salas_guarda + corpo idêntico ao arquivo'
union all
select '5a. sala de teste antiga (88672328525) reconhecida como turma do Plan',
       case when public.agenda_kickoff_zoom_sala_usada_no_plan('88672328525') then 'OK' else 'DIVERGE' end,
       'agenda_kickoff_zoom_sala_usada_no_plan = ' || public.agenda_kickoff_zoom_sala_usada_no_plan('88672328525')::text
union all
select '5b. salas de turmas do Plan reconhecidas (todas as de cronogramas e sessões)',
       case when not exists (select 1 from (select zoom_meeting_id from public.cohort_schedules union select zoom_meeting_id from public.cohort_sessions) t
                              where t.zoom_meeting_id is not null and not public.agenda_kickoff_zoom_sala_usada_no_plan(regexp_replace(t.zoom_meeting_id, '\D', '', 'g'))) then 'OK' else 'DIVERGE' end,
       (select count(distinct zoom_meeting_id) || ' Meeting IDs de turmas' from (select zoom_meeting_id from public.cohort_schedules union select zoom_meeting_id from public.cohort_sessions) t where zoom_meeting_id is not null)
union all
select '6. M1, M2 e M3: funções iguais aos arquivos (e as de 003-005 só para service_role)',
       case when bool_and(versoes = 1 and corpo_igual and (origem = '001' or not cliente_executa)) then 'OK' else 'DIVERGE' end,
       count(*) || ' funções de 001/003/004/005; divergentes: ' || coalesce(string_agg(nome, ', ') filter (where not (versoes = 1 and corpo_igual and (origem = '001' or not cliente_executa))), 'nenhuma')
  from funcoes where origem <> '006'
union all
select '7. dados existentes (contagens)', 'VER',
       'sessões ' || (select count(*) from public.agenda_kickoff_sessoes) || ', reservas ' || (select count(*) from public.agenda_kickoff_reservas)
       || ', histórico reservas ' || (select count(*) from public.agenda_kickoff_reservas_historico) || ', convites ' || (select count(*) from public.agenda_kickoff_convites)
       || ', empresas ' || (select count(*) from public.client_tenants) || ', reuniões ' || (select count(*) from public.meetings)
union all
select '7b. escritas em reuniões e empresas na última hora (uso normal do Meet/Plan)', 'VER',
       'reuniões ' || (select count(*) from public.meetings where updated_at > now() - interval '1 hour')
       || ', empresas ' || (select count(*) from public.client_tenants where updated_at > now() - interval '1 hour')
union all
select '8. nenhuma sala cadastrada nem ativação',
       case when (select count(*) from public.agenda_kickoff_zoom_salas) = 0 and (select count(*) from public.agenda_kickoff_zoom_salas_historico) = 0 then 'OK' else 'DIVERGE' end,
       'salas ' || (select count(*) from public.agenda_kickoff_zoom_salas) || ', histórico ' || (select count(*) from public.agenda_kickoff_zoom_salas_historico);
