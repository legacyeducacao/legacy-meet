// Concorrência REAL das reservas do kickoff: várias conexões ao mesmo tempo num
// Postgres descartável (o PGlite tem uma conexão só). Pulado se não houver um.
//
// Para rodar (nunca contra o Supabase):
//   KICKOFF_PG_URL=postgresql://postgres:senha@localhost:5432/postgres \
//   KICKOFF_PSQL=/caminho/do/psql \
//   npx vitest run lib/kickoff/reservasConcorrencia.test.ts
// O teste cria um banco novo (kickoff_conc_<aleatório>), aplica as migrations reais
// e apaga o banco no fim. Recusa qualquer endereço que não seja localhost.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASE_DO_PLAN, sqlDoRepo } from './bancoDeTeste';

const URL_BASE = process.env.KICKOFF_PG_URL ?? '';
const PSQL = process.env.KICKOFF_PSQL || 'psql';
const local = (() => {
  try {
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(URL_BASE).hostname);
  } catch {
    return false;
  }
})();

const NOME = 'kickoff_conc_' + randomBytes(4).toString('hex');
const urlDo = (banco: string) => {
  const u = new URL(URL_BASE);
  u.pathname = '/' + banco;
  return u.toString();
};

type Saida = { ok: boolean; out: string; err: string };
function psql(url: string, sql: string): Promise<Saida> {
  return new Promise((resolve) => {
    const args = ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-d', url];
    // KICKOFF_PSQL pode ser o psql ou um script Node compatível (.mjs/.js).
    const [cmd, argv] = /\.(m?js)$/.test(PSQL) ? [process.execPath, [PSQL, ...args]] : [PSQL, args];
    const p = spawn(cmd, argv, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ ok: code === 0, out: out.trim(), err: err.trim() }));
    p.stdin.end(sql);
  });
}

const ORG = '0c000000-0000-4000-8000-000000000000';
const EMP = Array.from({ length: 12 }, (_, i) => `0e000000-0000-4000-8000-0000000000${String(i + 10)}`);
const GESTOR = '1a000000-0000-4000-8000-000000000001';
const S1 = '2a000000-0000-4000-8000-000000000001';
const S2 = '2a000000-0000-4000-8000-000000000002';
const S3 = '2a000000-0000-4000-8000-000000000003';
const S4 = '2a000000-0000-4000-8000-000000000004';
let URL_TESTE = '';

/**
 * Larga todas as chamadas no mesmo instante: um portão segura um advisory lock
 * exclusivo; cada conexão espera por ele (compartilhado) e corre quando abre.
 */
async function aoMesmoTempo(chamadas: string[]): Promise<Saida[]> {
  const portao = psql(URL_TESTE, 'select pg_advisory_lock(4242); select pg_sleep(1.5); select pg_advisory_unlock(4242);');
  await new Promise((r) => setTimeout(r, 400));
  const todas = chamadas.map((sql) =>
    psql(URL_TESTE, `select pg_advisory_lock_shared(4242); select pg_advisory_unlock_shared(4242);\n${sql}`),
  );
  const [, ...r] = await Promise.all([portao, ...todas]);
  return r;
}
const contar = async (sql: string) => Number((await psql(URL_TESTE, sql)).out);

describe.skipIf(!URL_BASE || !local)('reservas com conexões simultâneas (Postgres real)', () => {
  beforeAll(async () => {
    const c = await psql(URL_BASE, `create database ${NOME};`);
    if (!c.ok) throw new Error(c.err);
    URL_TESTE = urlDo(NOME);
    const sql = [
      BASE_DO_PLAN,
      sqlDoRepo('integracoes/agenda/001_agenda.sql'),
      sqlDoRepo('integracoes/agenda/003_agenda_cliente.sql'),
      sqlDoRepo('integracoes/kickoff/001_kickoff_m1.sql'),
      sqlDoRepo('integracoes/kickoff/003_kickoff_reservas.sql'),
      sqlDoRepo('integracoes/kickoff/004_kickoff_reuniao_protegida.sql'),
      'alter table public.users add column avatar_url text;',
      sqlDoRepo('integracoes/kickoff/005_kickoff_convites.sql'),
      // Zoom E1 e E2 (a 006 só lê as tabelas de turmas do Plan).
      `create table public.cohort_schedules (id uuid primary key default gen_random_uuid(), zoom_meeting_id text);
       create table public.cohort_sessions (id uuid primary key default gen_random_uuid(), zoom_meeting_id text);
       create table public.cohort_zoom_meeting_checks (id uuid primary key default gen_random_uuid(), zoom_meeting_id text);`,
      sqlDoRepo('integracoes/kickoff/006_kickoff_zoom_sala.sql'),
      sqlDoRepo('integracoes/kickoff/007_kickoff_zoom_inscricoes.sql'),
      `
      insert into auth.users (id) values ('${GESTOR}');
      insert into public.client_tenants (id, name) values ('${ORG}', 'Customer Success'),
        ${EMP.map((e, i) => `('${e}', 'Empresa ${i}')`).join(', ')};
      insert into public.users (id, name, role) values ('${GESTOR}', 'Gestor', 'CUSTOMER_SUCCESS');
      insert into public.meet_user_profile (user_id, is_admin, sector, capacidades) values ('${GESTOR}', false, 'executoria', '{kickoff_impulsao.manage}');
      insert into public.meetings (id, tenant_id, host_id, title, scheduled_start_at, scheduled_end_at, room_name)
        select id::uuid, '${ORG}', '${GESTOR}', 'Kickoff', now() + (n || ' days')::interval, now() + (n || ' days 1 hour')::interval, 'k' || n
          from (values ('${S1}', 1), ('${S2}', 2), ('${S3}', 3), ('${S4}', 4)) v(id, n);
      insert into public.meet_meeting_sector (meeting_id, sector, onboarding) select id, 'executoria', true from public.meetings;
      insert into public.agenda_kickoff_sessoes (meeting_id, capacidade) select id, 5 from public.meetings;
      `,
    ].join('\n');
    const m = await psql(URL_TESTE, sql);
    if (!m.ok) throw new Error(m.err);
  }, 120_000);

  afterAll(async () => {
    if (URL_TESTE) await psql(URL_BASE, `drop database if exists ${NOME} with (force);`);
  }, 60_000);

  it('12 empresas pela função, ao mesmo tempo, numa sessão de 5: exatamente 5 entram', async () => {
    const r = await aoMesmoTempo(
      EMP.map((e) => `select (public.agenda_kickoff_reservar('${S1}', '${e}', 'Pessoa', 'p@x.com.br', null, '${GESTOR}'))->>'id';`),
    );
    expect(r.filter((x) => x.ok)).toHaveLength(5);
    expect(r.filter((x) => !x.ok).every((x) => x.err.includes('Sessão lotada: 5 de 5 empresas.'))).toBe(true);
    expect(await contar(`select count(*) from public.agenda_kickoff_reservas where meeting_id = '${S1}' and status = 'ativa'`)).toBe(5);
  }, 60_000);

  it('escrita direta (sem a fila das funções), ao mesmo tempo: a trava da sessão segura a capacidade', async () => {
    const livres = EMP.slice(0, 12);
    const r = await aoMesmoTempo(
      livres.map(
        (e) =>
          `insert into public.agenda_kickoff_reservas (meeting_id, tenant_id, participante_nome, participante_email) values ('${S2}', '${e}', 'Pessoa', 'p@x.com.br');`,
      ),
    );
    // As 5 que já estão na S1 batem no índice de "uma ativa por empresa"; das outras 7, só 5 cabem.
    expect(r.filter((x) => x.ok)).toHaveLength(5);
    expect(await contar(`select count(*) from public.agenda_kickoff_reservas where meeting_id = '${S2}' and status = 'ativa'`)).toBe(5);
    // Cada recusa é por lotação (gatilho) ou por empresa já inscrita (índice), nunca outra coisa.
    const erros = r.filter((x) => !x.ok).map((x) => x.err);
    expect(erros).toHaveLength(7);
    expect(
      erros.every(
        (e) =>
          e.includes('Sessão lotada: 5 de 5 empresas.') ||
          e.includes('agenda_kickoff_reservas_empresa_key') ||
          e.includes('Esta empresa já tem kickoff marcado'),
      ),
    ).toBe(true);
    // Nenhuma empresa ficou com duas reservas ativas.
    expect(await contar(`select count(*) from (select tenant_id from public.agenda_kickoff_reservas where status = 'ativa' group by 1 having count(*) > 1) x`)).toBe(0);
  }, 60_000);

  it('a mesma empresa em duas sessões ao mesmo tempo: só uma reserva ativa', async () => {
    await psql(URL_TESTE, `update public.agenda_kickoff_reservas set status = 'cancelada', cancelada_em = now() where status = 'ativa';`);
    const e = EMP[0];
    const r = await aoMesmoTempo(
      [S3, S4, S3, S4].map(
        (s) =>
          `insert into public.agenda_kickoff_reservas (meeting_id, tenant_id, participante_nome, participante_email) values ('${s}', '${e}', 'Pessoa', 'p@x.com.br');`,
      ),
    );
    expect(r.filter((x) => x.ok)).toHaveLength(1);
    expect(await contar(`select count(*) from public.agenda_kickoff_reservas where tenant_id = '${e}' and status = 'ativa'`)).toBe(1);
  }, 60_000);

  it('reduzir a capacidade enquanto empresas reservam: nunca fica com mais inscritas que a capacidade', async () => {
    const chamadas = [
      ...EMP.slice(1, 6).map(
        (e) =>
          `insert into public.agenda_kickoff_reservas (meeting_id, tenant_id, participante_nome, participante_email) values ('${S4}', '${e}', 'Pessoa', 'p@x.com.br');`,
      ),
      `update public.agenda_kickoff_sessoes set capacidade = 2 where meeting_id = '${S4}';`,
    ];
    await aoMesmoTempo(chamadas);
    const cap = await contar(`select capacidade from public.agenda_kickoff_sessoes where meeting_id = '${S4}'`);
    const n = await contar(`select count(*) from public.agenda_kickoff_reservas where meeting_id = '${S4}' and status = 'ativa'`);
    expect(n).toBeLessThanOrEqual(cap);
  }, 60_000);

  it('mover a sessão para o passado enquanto uma empresa reserva: só uma das duas acontece', async () => {
    // Reserva primeiro: a 004 recusa mover. Mover primeiro: a reserva vê a sessão já passada.
    await psql(URL_TESTE, `update public.agenda_kickoff_reservas set status = 'cancelada', cancelada_em = now() where meeting_id = '${S3}' and status = 'ativa';`);
    const antes = (await psql(URL_TESTE, `select scheduled_start_at from public.meetings where id = '${S3}'`)).out;
    const r = await aoMesmoTempo([
      `insert into public.agenda_kickoff_reservas (meeting_id, tenant_id, participante_nome, participante_email) values ('${S3}', '${EMP[11]}', 'Pessoa', 'p@x.com.br');`,
      `update public.meetings set scheduled_start_at = now() - interval '2 hours', scheduled_end_at = now() - interval '1 hour' where id = '${S3}';`,
    ]);
    const depois = (await psql(URL_TESTE, `select scheduled_start_at from public.meetings where id = '${S3}'`)).out;
    const reservou = r[0].ok;
    const moveu = depois !== antes;
    expect(r[1].ok).toBe(moveu);
    expect(reservou !== moveu).toBe(true);
  }, 60_000);

  it('concluir o kickoff ao mesmo tempo em que se tenta cancelar e reservar de novo: a empresa nunca fica concluída E com outra reserva', async () => {
    const E = '0e000000-0000-4000-8000-000000000099';
    const S5 = '2a000000-0000-4000-8000-000000000005';
    const S6 = '2a000000-0000-4000-8000-000000000006';
    const S7 = '2a000000-0000-4000-8000-000000000007';
    const preparo = await psql(
      URL_TESTE,
      `
      insert into public.client_tenants (id, name) values ('${E}', 'Empresa da corrida');
      insert into public.meetings (id, tenant_id, host_id, title, scheduled_start_at, scheduled_end_at, room_name)
        select id::uuid, '${ORG}', '${GESTOR}', 'Kickoff', now() + (n || ' days')::interval, now() + (n || ' days 1 hour')::interval, 'k' || n
          from (values ('${S5}', 5), ('${S6}', 6), ('${S7}', 7)) v(id, n);
      insert into public.meet_meeting_sector (meeting_id, sector, onboarding) select id, 'executoria', true from public.meetings where id in ('${S5}', '${S6}', '${S7}');
      insert into public.agenda_kickoff_sessoes (meeting_id, capacidade) values ('${S5}', 5), ('${S6}', 5), ('${S7}', 5);
      select (public.agenda_kickoff_reservar('${S5}', '${E}', 'Pessoa', 'p@x.com.br', null, '${GESTOR}'))->>'id';
      `,
    );
    if (!preparo.ok) throw new Error(preparo.err);
    const R = preparo.out.trim(); // a saída é só o resultado do último comando: o id da reserva
    expect(R).toMatch(/^[0-9a-f-]{36}$/);
    // A sessão acontece (o tempo passa) e a empresa comparece.
    const presenca = await psql(
      URL_TESTE,
      `set session_replication_role = replica;
       update public.meetings set scheduled_start_at = now() - interval '2 hours', scheduled_end_at = now() - interval '1 hour' where id = '${S5}';
       set session_replication_role = default;
       select public.agenda_kickoff_registrar_presenca('${R}', 'presente', '${GESTOR}');`,
    );
    if (!presenca.ok) throw new Error(presenca.err);

    const r = await aoMesmoTempo([
      `select public.agenda_kickoff_concluir('${R}', null, '${GESTOR}');`,
      `begin;
       select public.agenda_kickoff_cancelar_reserva('${R}', 'contornar', '${GESTOR}');
       select public.agenda_kickoff_reservar('${S6}', '${E}', 'Pessoa', 'p@x.com.br', null, '${GESTOR}');
       commit;`,
      `insert into public.agenda_kickoff_reservas (meeting_id, tenant_id, participante_nome, participante_email) values ('${S7}', '${E}', 'Pessoa', 'p@x.com.br');`,
    ]);
    const status = (await psql(URL_TESTE, `select status from public.agenda_kickoff_reservas where id = '${R}'`)).out;
    const vivas = await contar(`select count(*) from public.agenda_kickoff_reservas where tenant_id = '${E}' and status in ('ativa', 'concluida')`);
    expect(vivas).toBe(1); // uma, e só uma: a concluída OU uma ativa nova
    if (status === 'concluida') {
      expect(r[0].ok).toBe(true);
      expect(r[1].ok).toBe(false); // cancelar a concluída foi recusado; nada foi reservado
      expect(r[2].ok).toBe(false);
    } else {
      expect(status).toBe('cancelada');
      expect(r[0].ok).toBe(false); // concluir uma reserva já cancelada foi recusado
    }
  }, 60_000);

  it('M3: seis empresas pelo link público, ao mesmo tempo, na última vaga: só uma leva', async () => {
    const S9 = '2a000000-0000-4000-8000-000000000009';
    const novas = Array.from({ length: 6 }, (_, i) => `0e000000-0000-4000-8000-0000000009${String(i).padStart(2, '0')}`);
    const preparo = await psql(
      URL_TESTE,
      `
      insert into public.client_tenants (id, name) values ${novas.map((e) => `('${e}', 'Pelo link')`).join(', ')};
      insert into public.meetings (id, tenant_id, host_id, title, scheduled_start_at, scheduled_end_at, room_name)
        values ('${S9}', '${ORG}', '${GESTOR}', 'Kickoff', now() + interval '9 days', now() + interval '9 days 1 hour', 'k9');
      insert into public.meet_meeting_sector (meeting_id, sector, onboarding) values ('${S9}', 'executoria', true);
      insert into public.agenda_kickoff_sessoes (meeting_id, capacidade) values ('${S9}', 1);
      select string_agg((public.agenda_kickoff_convite_gerar(id, null, '${GESTOR}'))->>'codigo', ',' order by id)
        from public.client_tenants where id in (${novas.map((e) => `'${e}'`).join(', ')});
      `,
    );
    if (!preparo.ok) throw new Error(preparo.err);
    const codigos = preparo.out.trim().split(',');
    expect(codigos).toHaveLength(6);
    const r = await aoMesmoTempo(
      codigos.map(
        (c, i) =>
          `select (public.agenda_kickoff_publico_agendar('${c}', '${S9}', 'Pessoa', 'p@x.com.br', null, 'ip:${i}'))->>'status';`,
      ),
    );
    const status = r.map((x) => x.out.trim());
    expect(status.filter((s) => s === 'ok')).toHaveLength(1);
    expect(status.filter((s) => s === 'sessao_lotada')).toHaveLength(5);
    expect(await contar(`select count(*) from public.agenda_kickoff_reservas where meeting_id = '${S9}' and status <> 'cancelada'`)).toBe(1);
  }, 60_000);

  it('Zoom E2: oito pedidos de acesso da mesma reserva, ao mesmo tempo: só um fica com a inscrição para criar no Zoom', async () => {
    const S10 = '2a000000-0000-4000-8000-000000000010';
    const [A, B] = ['a0000010-0000-4000-8000-000000000001', 'b0000010-0000-4000-8000-000000000001'];
    const preparo = await psql(
      URL_TESTE,
      `
      insert into public.client_tenants (id, name) values ('${A}', 'Empresa A'), ('${B}', 'Empresa B');
      insert into public.meetings (id, tenant_id, host_id, title, scheduled_start_at, scheduled_end_at, room_name)
        values ('${S10}', '${ORG}', '${GESTOR}', 'Kickoff', now() + interval '10 days', now() + interval '10 days 1 hour', 'k10');
      insert into public.meet_meeting_sector (meeting_id, sector, onboarding) values ('${S10}', 'executoria', true);
      insert into public.agenda_kickoff_sessoes (meeting_id, capacidade) values ('${S10}', 5);
      select public.agenda_kickoff_zoom_sala_ativar('81234567890', 'Kickoff', '{}'::jsonb, now(), null, '${GESTOR}');
      select string_agg((public.agenda_kickoff_reservar('${S10}', t.id, 'Pessoa', t.email, null, '${GESTOR}'))->>'id', ',' order by t.id)
        from (values ('${A}'::uuid, 'a@empresa-a.com.br'), ('${B}'::uuid, 'mesmo@contabilidade.com.br')) t(id, email);
      `,
    );
    if (!preparo.ok) throw new Error(preparo.err);
    const [reservaA, reservaB] = preparo.out.trim().split('\n').pop()!.split(',');

    const r = await aoMesmoTempo(
      Array.from({ length: 8 }, () => `select (public.agenda_kickoff_zoom_inscricao_decidir('${reservaA}', 'normal', null))->>'acao';`),
    );
    const acoes = r.map((x) => x.out.trim());
    expect(acoes.filter((a) => a === 'criar')).toHaveLength(1);
    expect(acoes.filter((a) => a === 'aguardar')).toHaveLength(7);
    expect(await contar("select count(*) from public.agenda_kickoff_zoom_inscricoes where email = 'a@empresa-a.com.br'")).toBe(1);

    // O mesmo e-mail pedido por duas empresas no mesmo instante: uma fica com a inscrição, a outra recebe conflito.
    const troca = await psql(URL_TESTE, `select public.agenda_kickoff_atualizar_participante('${reservaA}', 'Pessoa', 'mesmo@contabilidade.com.br', null, '${GESTOR}');`);
    if (!troca.ok) throw new Error(troca.err);
    const disputa = await aoMesmoTempo(
      [reservaA, reservaB, reservaA, reservaB].map((id) => `select (public.agenda_kickoff_zoom_inscricao_decidir('${id}', 'normal', null))->>'acao';`),
    );
    const resultado = disputa.map((x) => x.out.trim()).sort();
    expect(resultado.filter((a) => a === 'criar')).toHaveLength(1);
    expect(resultado.filter((a) => a === 'conflito' || a === 'aguardar')).toHaveLength(3);
    expect(resultado).toContain('conflito');
    expect(await contar("select count(*) from public.agenda_kickoff_zoom_inscricoes where email = 'mesmo@contabilidade.com.br'")).toBe(1);
  }, 60_000);
});
