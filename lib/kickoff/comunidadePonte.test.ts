// comunidade_ponte.reunioes() (ponte Legacy Plan -> Hub) sem as sessões de kickoff do
// Impulsão. Postgres em memória (PGlite): versão de produção (arquivo .reverter, conferida
// por hash) x versão corrigida (002), sobre as migrations reais da agenda e da M1.
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASE_DO_PLAN, sqlDoRepo } from './bancoDeTeste';

const CORRECAO = 'integracoes/kickoff/002_comunidade_ponte_sem_kickoff.sql';
const PRODUCAO = 'integracoes/kickoff/002_comunidade_ponte_sem_kickoff.reverter.sql';
/** Hash do corpo normalizado da função em produção, lido do banco em 12/11/2026. */
const HASH_PRODUCAO = '808d0f8d78c401993f3076834d8fba6d';

const T = { A: '0a000000-0000-4000-8000-000000000001', B: '0b000000-0000-4000-8000-000000000002', ORG: '0c000000-0000-4000-8000-000000000003' };
const U = {
  host: '1d000000-0000-4000-8000-000000000001',
  cliA: '1a000000-0000-4000-8000-000000000002',
  colabA: '1a000000-0000-4000-8000-000000000003',
  invalidoA: '1a000000-0000-4000-8000-000000000004',
  cliB: '1b000000-0000-4000-8000-000000000005',
};
const M = {
  comum: '2a000000-0000-4000-8000-000000000001',
  cancelada: '2a000000-0000-4000-8000-000000000002',
  ontem: '2a000000-0000-4000-8000-000000000003',
  antiga: '2a000000-0000-4000-8000-000000000004',
  distante: '2a000000-0000-4000-8000-000000000005',
  comercial: '2a000000-0000-4000-8000-000000000006',
  doB: '2b000000-0000-4000-8000-000000000007',
  kickoff: '2c000000-0000-4000-8000-000000000008',
};

const EXTRAS_DO_PLAN = `
  alter table public.users add column email text;
  alter table public.client_tenants add column owner text, add column email text;
  alter table public.meetings
    add column started_at timestamptz, add column ended_at timestamptz, add column cancelled_at timestamptz,
    add column created_at timestamptz not null default now(), add column updated_at timestamptz not null default now(),
    add column recurrence_parent_id uuid, add column recurrence_rule text;
  create schema comunidade_ponte;
`;

const DADOS = `
  insert into public.client_tenants (id, name, produto, owner, email) values
    ('${T.A}', 'Cliente A', 'legado_online', 'Dono A', ' Contato@A.com.br '),
    ('${T.B}', 'Cliente B', 'impulsao_empresarial', 'Dono B', 'b@b.com.br'),
    ('${T.ORG}', 'Customer Success', null, null, null);
  insert into public.users (id, name, role, tenant_id, email) values
    ('${U.host}', 'Executor', 'EXECUTOR', null, 'Exec@LegacyEducacaoCorp.com.br'),
    ('${U.cliA}', 'Cliente A', 'CLIENT', '${T.A}', 'cli@a.com.br'),
    ('${U.colabA}', 'Colab A', 'COLLABORATOR', '${T.A}', 'colab@a.com.br'),
    ('${U.invalidoA}', 'Sem e-mail', 'CLIENT', '${T.A}', 'sem-arroba'),
    ('${U.cliB}', 'Cliente B', 'CLIENT', '${T.B}', 'cli@b.com.br');
  insert into public.meetings (id, tenant_id, host_id, title, scheduled_start_at, scheduled_end_at, status, room_name,
                               started_at, ended_at, cancelled_at, created_at, updated_at, recurrence_parent_id, recurrence_rule) values
    ('${M.comum}', '${T.A}', '${U.host}', 'Encontro', now() + interval '1 day', now() + interval '1 day 1 hour', 'scheduled', 'r1', null, null, null, '2026-11-01', '2026-11-02', null, null),
    ('${M.cancelada}', '${T.A}', '${U.host}', 'Cancelada', now() + interval '2 days', now() + interval '2 days 1 hour', 'canceled', 'r2', null, null, '2026-11-03', '2026-11-01', '2026-11-03', null, null),
    ('${M.ontem}', '${T.A}', '${U.host}', 'Ontem', now() - interval '12 hours', now() - interval '11 hours', 'ended', 'r3', '2026-11-11 10:00', '2026-11-11 11:00', null, '2026-11-01', '2026-11-11', null, null),
    ('${M.antiga}', '${T.A}', '${U.host}', 'Antiga', now() - interval '3 days', now() - interval '3 days' + interval '1 hour', 'ended', 'r4', null, null, null, '2026-11-01', '2026-11-01', null, null),
    ('${M.distante}', '${T.A}', '${U.host}', 'Distante', now() + interval '10 days', now() + interval '10 days 1 hour', 'scheduled', 'r5', null, null, null, '2026-11-01', '2026-11-01', null, null),
    ('${M.comercial}', '${T.A}', '${U.host}', 'Comercial', now() + interval '1 day', now() + interval '1 day 1 hour', 'scheduled', 'r6', null, null, null, '2026-11-01', '2026-11-01', null, null),
    ('${M.doB}', '${T.B}', '${U.host}', 'Série B', now() + interval '4 days', now() + interval '4 days 1 hour', 'scheduled', 'r7', null, null, null, '2026-11-01', '2026-11-01', '${M.doB}', 'weekly;count=4'),
    ('${M.kickoff}', '${T.ORG}', '${U.host}', 'Kickoff Impulsão', now() + interval '3 days', now() + interval '3 days 1 hour', 'scheduled', 'r8', null, null, null, '2026-11-01', '2026-11-01', null, null);
  insert into public.meet_meeting_sector (meeting_id, sector, onboarding)
    select id, case when id = '${M.comercial}' then 'comercial' else 'executoria' end, id = '${M.kickoff}' from public.meetings;
`;

type Reuniao = { id: string; status: string; emails: string[]; recorrente: boolean; cancelada_em: string | null; comecou_em: string | null; empresa: string };

let db: PGlite;
let antes: Reuniao[];
let antesJanelaLarga: Reuniao[];
let atributosAntes: unknown;

const reunioes = async (args = '') =>
  (await db.query<{ r: Reuniao[] }>(`select comunidade_ponte.reunioes(${args})->'reunioes' as r`)).rows[0].r;
const janela = async () =>
  (await db.query<{ j: Record<string, unknown> }>(`select comunidade_ponte.reunioes()->'janela' as j`)).rows[0].j;
const ids = (rs: Reuniao[]) => rs.map((r) => r.id);
const atributos = async () =>
  (
    await db.query(`
      select pg_get_userbyid(p.proowner) as dono, p.prosecdef, p.proconfig, p.provolatile, p.proacl::text as acl,
             pg_get_function_arguments(p.oid) as args, pg_get_function_result(p.oid) as resultado
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'comunidade_ponte' and p.proname = 'reunioes'`)
  ).rows;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(BASE_DO_PLAN);
  await db.exec(sqlDoRepo('integracoes/agenda/001_agenda.sql'));
  await db.exec(sqlDoRepo('integracoes/agenda/003_agenda_cliente.sql'));
  await db.exec(sqlDoRepo('integracoes/kickoff/001_kickoff_m1.sql'));
  await db.exec(EXTRAS_DO_PLAN);
  await db.exec(DADOS);
  await db.exec(sqlDoRepo(PRODUCAO));
  antes = await reunioes();
  antesJanelaLarga = await reunioes(`'4 days', '15 days'`);
  atributosAntes = await atributos();
  await db.exec(sqlDoRepo(CORRECAO));
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe('comunidade_ponte.reunioes(): versão de produção', () => {
  it('o arquivo usado como "antes" é a função que está em produção (mesmo hash)', () => {
    const s = sqlDoRepo(PRODUCAO);
    const a = s.indexOf('$function$') + 10;
    const corpo = s.slice(a, s.indexOf('$function$', a));
    const hash = createHash('md5').update(corpo.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim()).digest('hex');
    expect(hash).toBe(HASH_PRODUCAO);
  });

  it('comportamento atual: janela, setor Executoria, todos os status, e-mails da empresa, e o kickoff indo junto', () => {
    expect(ids(antes)).toEqual([M.ontem, M.comum, M.cancelada, M.kickoff, M.doB]);
    const comum = antes.find((r) => r.id === M.comum)!;
    // e-mail da empresa + logins CLIENT; sem COLLABORATOR e sem e-mail inválido; minúsculas.
    expect(comum.emails).toEqual(['cli@a.com.br', 'contato@a.com.br']);
    expect(antes.find((r) => r.id === M.kickoff)!.emails).toEqual([]);
  });
});

describe('comunidade_ponte.reunioes(): com a correção (002)', () => {
  it('sem sessões de kickoff cadastradas, manda exatamente o mesmo de antes (todos os campos)', async () => {
    expect(await reunioes()).toEqual(antes);
    expect(await reunioes(`'4 days', '15 days'`)).toEqual(antesJanelaLarga);
  });

  it('dono, segurança, search_path, volatilidade, permissões e assinatura não mudam', async () => {
    expect(await atributos()).toEqual(atributosAntes);
  });

  it('com a sessão marcada como kickoff, só ela deixa de ir; as reuniões comuns continuam', async () => {
    await db.exec(`insert into public.agenda_kickoff_sessoes (meeting_id) values ('${M.kickoff}')`);
    const depois = await reunioes();
    expect(depois).toEqual(antes.filter((r) => r.id !== M.kickoff));
    expect(ids(depois)).toContain(M.comum);
    expect(Object.keys(await janela()).sort()).toEqual(['ate', 'de']);
  });

  it('filtros de data, setor, status e empresa continuam iguais', async () => {
    const depois = await reunioes();
    // data: fora da janela padrão (3 dias atrás, 10 dias à frente) não vai; janela maior inclui.
    expect(ids(depois)).not.toContain(M.antiga);
    expect(ids(depois)).not.toContain(M.distante);
    expect(ids(await reunioes(`'4 days', '15 days'`))).toEqual(
      ids(antesJanelaLarga).filter((id) => id !== M.kickoff),
    );
    expect(ids(await reunioes(`'4 days', '15 days'`))).toEqual(expect.arrayContaining([M.antiga, M.distante]));
    // setor: Comercial nunca vai.
    expect(ids(depois)).not.toContain(M.comercial);
    // status: cancelada e encerrada continuam indo, com os campos de antes.
    expect(depois.find((r) => r.id === M.cancelada)).toMatchObject({ status: 'canceled' });
    expect(depois.find((r) => r.id === M.cancelada)!.cancelada_em).not.toBeNull();
    expect(depois.find((r) => r.id === M.ontem)).toMatchObject({ status: 'ended' });
    // empresa: cada reunião com a empresa e os e-mails dela; série continua "recorrente".
    expect(depois.find((r) => r.id === M.doB)).toMatchObject({ empresa: T.B, emails: ['b@b.com.br', 'cli@b.com.br'], recorrente: true });
  });

  it('só o tipo kickoff_impulsao é excluído (outro tipo na mesma tabela não tiraria a reunião)', async () => {
    // Hoje a tabela só aceita kickoff_impulsao; aqui o check é tirado só neste banco de teste.
    await db.exec(`alter table public.agenda_kickoff_sessoes drop constraint agenda_kickoff_sessoes_tipo_check`);
    await db.exec(`insert into public.agenda_kickoff_sessoes (meeting_id, tipo) values ('${M.comum}', 'outro_tipo')`);
    expect(ids(await reunioes())).toContain(M.comum);
    expect(ids(await reunioes())).not.toContain(M.kickoff);
  });
});
