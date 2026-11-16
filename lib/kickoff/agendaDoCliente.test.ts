// Compatibilidade de agenda_do_cliente() com o Legacy Plan: a versão da
// migration do kickoff devolve exatamente o mesmo que a versão atual (003)
// para todo login e todo tipo de reunião, e só deixa de fora as sessões de
// kickoff. Postgres em memória (PGlite) com as migrations reais.
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASE_DO_PLAN, sqlDoRepo } from './bancoDeTeste';

const T = {
  A: '0a000000-0000-4000-8000-000000000001', // cliente do Legado
  B: '0b000000-0000-4000-8000-000000000002', // cliente do Impulsão
  ORG: '0c000000-0000-4000-8000-000000000003', // organizadora interna (Customer Success)
};
const U = {
  cliA: '1a000000-0000-4000-8000-000000000001',
  colabA: '1a000000-0000-4000-8000-000000000002',
  cliB: '1b000000-0000-4000-8000-000000000003',
  loginOrg: '1c000000-0000-4000-8000-000000000004',
  executor: '1d000000-0000-4000-8000-000000000005',
};
const M = {
  legadoComRotulo: '2a000000-0000-4000-8000-000000000001',
  gravada: '2a000000-0000-4000-8000-000000000002',
  cancelada: '2a000000-0000-4000-8000-000000000003',
  comercial: '2a000000-0000-4000-8000-000000000004',
  foraDaJanela: '2a000000-0000-4000-8000-000000000005',
  aoVivo: '2a000000-0000-4000-8000-000000000006',
  grupoImpulsao: '2c000000-0000-4000-8000-000000000007', // reunião da organizadora com B matriculada
  impulsaoB: '2b000000-0000-4000-8000-000000000008',
  kickoff: '2c000000-0000-4000-8000-000000000009',
};

let db: PGlite;

const DADOS = `
  insert into auth.users (id) select unnest(array['${Object.values(U).join("','")}'])::uuid;
  insert into public.client_tenants (id, name, produto) values
    ('${T.A}', 'Cliente A', 'legado_online'), ('${T.B}', 'Cliente B', 'impulsao_empresarial'), ('${T.ORG}', 'Customer Success', null);
  insert into public.users (id, name, role, tenant_id) values
    ('${U.cliA}', 'Dono A', 'CLIENT', '${T.A}'), ('${U.colabA}', 'Colab A', 'COLLABORATOR', '${T.A}'),
    ('${U.cliB}', 'Dono B', 'CLIENT', '${T.B}'), ('${U.loginOrg}', 'Login interno', 'COLLABORATOR', '${T.ORG}'),
    ('${U.executor}', 'Executor', 'EXECUTOR', null);
  insert into public.meetings (id, tenant_id, host_id, title, scheduled_start_at, scheduled_end_at, status, room_name) values
    ('${M.legadoComRotulo}', '${T.A}', '${U.executor}', 'Encontro', now() + interval '1 day', now() + interval '1 day 1 hour', 'scheduled', 'r1'),
    ('${M.gravada}', '${T.A}', '${U.executor}', ' ', now() - interval '3 days', now() - interval '3 days' + interval '1 hour', 'ended', 'r2'),
    ('${M.cancelada}', '${T.A}', '${U.executor}', 'Cancelada', now() + interval '2 days', now() + interval '2 days 1 hour', 'canceled', 'r3'),
    ('${M.comercial}', '${T.A}', '${U.executor}', 'Comercial', now() + interval '3 days', now() + interval '3 days 1 hour', 'scheduled', 'r4'),
    ('${M.foraDaJanela}', '${T.A}', '${U.executor}', 'Longe', now() + interval '200 days', now() + interval '200 days 1 hour', 'scheduled', 'r5'),
    ('${M.aoVivo}', '${T.A}', '${U.executor}', 'Ao vivo', now(), now() + interval '1 hour', 'live', 'r6'),
    ('${M.grupoImpulsao}', '${T.ORG}', '${U.executor}', 'Impulsão · Grupo Terça · F1', now() + interval '4 days', now() + interval '4 days 2 hours', 'scheduled', 'r7'),
    ('${M.impulsaoB}', '${T.B}', '${U.executor}', 'Reunião B', now() + interval '5 days', now() + interval '5 days 1 hour', 'scheduled', 'r8'),
    ('${M.kickoff}', '${T.ORG}', '${U.executor}', 'Kickoff Impulsão', now() + interval '6 days', now() + interval '6 days 1 hour', 'scheduled', 'r9');
  insert into public.meet_meeting_sector (meeting_id, sector, onboarding)
    select id, case when id = '${M.comercial}' then 'comercial' else 'executoria' end, id = '${M.kickoff}' from public.meetings;
  insert into public.agenda_series (id, executor_id, titulo, rrule, inicio_local, duracao_min)
    values ('3a000000-0000-4000-8000-000000000001', '${U.executor}', 'Legado', 'FREQ=WEEKLY;COUNT=12', '2026-12-01T10:00', 60);
  insert into public.agenda_ocorrencias (serie_id, inicio_original, rotulo, meeting_id)
    values ('3a000000-0000-4000-8000-000000000001', now(), 'E1', '${M.legadoComRotulo}');
  insert into public.agenda_gravacoes_duracao (recording_id, meeting_id, room_name, duracao_seg) values ('rec-1', '${M.gravada}', 'r2', 3600);
  insert into public.agenda_jornadas (id, tenant_id, produto, inicio, encontros_previstos)
    values ('4b000000-0000-4000-8000-000000000001', '${T.B}', 'impulsao', current_date, 4);
  insert into public.agenda_jornada_encontros (jornada_id, numero, rotulo, meeting_id)
    values ('4b000000-0000-4000-8000-000000000001', 1, 'F1', '${M.grupoImpulsao}');
`;

/** Resultado de agenda_do_cliente() visto por um login, como a sessão do Plan. */
async function comoLogin(login: string | null): Promise<unknown> {
  await db.exec(`set role ${login ? 'authenticated' : 'anon'}; select set_config('request.jwt.claim.sub', '${login ?? ''}', false);`);
  try {
    return (await db.query('select * from public.agenda_do_cliente()')).rows;
  } catch (e) {
    return `ERRO: ${(e as Error).message}`;
  } finally {
    await db.exec('reset role;');
  }
}
const logins = [U.cliA, U.colabA, U.cliB, U.loginOrg, U.executor, null];
// Um login de cada vez: a troca de papel (set role) vale para a conexão inteira.
const tudo = async () => {
  const r: unknown[] = [];
  for (const l of logins) r.push(await comoLogin(l));
  return r;
};

const atributos = async () =>
  (
    await db.query(`
      select p.prosecdef, p.proconfig, p.provolatile, p.proacl::text as acl, pg_get_userbyid(p.proowner) as dono,
             pg_get_function_arguments(p.oid) as args, pg_get_function_result(p.oid) as resultado
      from pg_proc p where p.proname = 'agenda_do_cliente'`)
  ).rows;

let antes: unknown[];
let atributosAntes: unknown;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(BASE_DO_PLAN);
  await db.exec(sqlDoRepo('integracoes/agenda/001_agenda.sql'));
  await db.exec(sqlDoRepo('integracoes/agenda/003_agenda_cliente.sql'));
  await db.exec(DADOS);
  antes = await tudo();
  atributosAntes = await atributos();
  await db.exec(sqlDoRepo('integracoes/kickoff/001_kickoff_m1.sql'));
}, 60_000);

afterAll(async () => {
  await db?.close();
});

const ids = (rows: unknown) => (rows as Array<{ reuniao_id: string }>).map((r) => r.reuniao_id);

describe('agenda_do_cliente(): versão atual x versão da migration do kickoff', () => {
  it('o cenário cobre os casos do Plan (sanidade da versão atual)', () => {
    const [cliA, colabA, cliB, loginOrg, executor, semLogin] = antes;
    // A: Legado com rótulo, gravada, ao vivo; sem cancelada, comercial e fora da janela.
    expect(ids(cliA).sort()).toEqual([M.legadoComRotulo, M.gravada, M.aoVivo].sort());
    expect(colabA).toEqual(cliA);
    // B: a própria reunião + o encontro em grupo do Impulsão em que está matriculada.
    expect(ids(cliB).sort()).toEqual([M.grupoImpulsao, M.impulsaoB].sort());
    expect((cliB as Array<{ reuniao_id: string; em_grupo: boolean; produto: string }>).find((r) => r.reuniao_id === M.grupoImpulsao))
      .toMatchObject({ em_grupo: true, produto: 'impulsao' });
    // Organizadora: hoje veria o grupo e o kickoff (o problema que a migration resolve).
    expect(ids(loginOrg).sort()).toEqual([M.grupoImpulsao, M.kickoff].sort());
    expect(executor).toEqual([]);
    expect(semLogin).toMatch(/permission denied/);
  });

  it('sem sessões de kickoff marcadas, o resultado é idêntico (todas as colunas, todos os logins)', async () => {
    expect(await tudo()).toEqual(antes);
  });

  it('assinatura, dono, segurança, search_path e permissões não mudam', async () => {
    expect(await atributos()).toEqual(atributosAntes);
  });

  it('com a sessão marcada como kickoff, só ela sai, e só para quem a via', async () => {
    await db.exec(`insert into public.agenda_kickoff_sessoes (meeting_id) values ('${M.kickoff}')`);
    const depois = await tudo();
    const esperado = antes.map((r, k) =>
      logins[k] === U.loginOrg ? (r as Array<{ reuniao_id: string }>).filter((x) => x.reuniao_id !== M.kickoff) : r,
    );
    expect(depois).toEqual(esperado);
    // O encontro em grupo do Impulsão continua para a organizadora e para B.
    expect(ids(depois[3])).toEqual([M.grupoImpulsao]);
    expect(ids(depois[2]).sort()).toEqual([M.grupoImpulsao, M.impulsaoB].sort());
  });
});
