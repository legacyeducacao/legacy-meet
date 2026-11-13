// Regra definitiva: o kickoff acontece UMA VEZ por empresa. Reserva, comparecimento e
// conclusão são coisas diferentes; só a conclusão (ato explícito, depois de presença
// registrada) encerra o kickoff da empresa. Postgres em memória (PGlite) com as
// migrations reais. A corrida entre concluir e reservar de novo está em
// reservasConcorrencia.test.ts (conexões simultâneas de verdade).
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BASE_DO_PLAN, sqlDoRepo } from './bancoDeTeste';

const ORG = '0c000000-0000-4000-8000-000000000000';
const GESTOR = '1a000000-0000-4000-8000-000000000001';
const EQUIPE = '1a000000-0000-4000-8000-000000000003';
const S = {
  a: '2a000000-0000-4000-8000-000000000001',
  b: '2a000000-0000-4000-8000-000000000002',
  c: '2a000000-0000-4000-8000-000000000003',
};

let db: PGlite;
type Erro = { message: string; code?: string };
async function falha(sql: string, params: unknown[] = []): Promise<Erro> {
  try {
    await db.query(sql, params);
  } catch (e) {
    return { message: (e as Error).message, code: (e as { code?: string }).code };
  }
  throw new Error('era para falhar: ' + sql);
}
const um = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];

/** Empresa participante nova (cada teste usa as suas). */
let empresas = 0;
async function novaEmpresa(): Promise<string> {
  empresas += 1;
  const id = `0e000000-0000-4000-8000-${String(empresas).padStart(12, '0')}`;
  await db.query('insert into public.client_tenants (id, name) values ($1, $2)', [id, `Empresa ${empresas}`]);
  return id;
}

const reservar = async (sessao: string, empresa: string) =>
  (
    await um<{ r: { id: string } }>("select public.agenda_kickoff_reservar($1, $2, 'Pessoa', 'p@x.com.br', null, $3) as r", [
      sessao,
      empresa,
      GESTOR,
    ])
  ).r.id;
const tentarReservar = (sessao: string, empresa: string, usuario = GESTOR) =>
  falha("select public.agenda_kickoff_reservar($1, $2, 'Pessoa', 'p@x.com.br', null, $3)", [sessao, empresa, usuario]);
const presenca = (reserva: string, p: 'presente' | 'ausente', usuario = GESTOR) =>
  db.query('select public.agenda_kickoff_registrar_presenca($1, $2, $3)', [reserva, p, usuario]);
const concluir = (reserva: string, usuario = GESTOR) => db.query("select public.agenda_kickoff_concluir($1, 'Ok', $2)", [reserva, usuario]);
const reserva = (id: string) =>
  um<{ status: string; presenca: string | null; concluida_em: string | null; meeting_id: string; origem_reserva_id: string | null }>(
    'select status, presenca, concluida_em, meeting_id, origem_reserva_id from public.agenda_kickoff_reservas where id = $1',
    [id],
  );
const historico = async (id: string) =>
  (await db.query<{ acao: string }>('select acao from public.agenda_kickoff_reservas_historico where reserva_id = $1 order by id', [id])).rows.map(
    (x) => x.acao,
  );

/**
 * Simula a passagem do tempo: a sessão vira passada (começou há 2 h, terminou há 1 h).
 * Só para montar o cenário de teste: desliga os gatilhos SÓ nesta escrita (papel de
 * réplica), como o tempo passando faria sem ninguém escrever no banco.
 */
async function sessaoJaAconteceu(sessao: string, comecouHa = '2 hours', terminouHa = '1 hour') {
  await db.exec(`
    set session_replication_role = replica;
    update public.meetings set scheduled_start_at = now() - interval '${comecouHa}', scheduled_end_at = now() - interval '${terminouHa}' where id = '${sessao}';
    set session_replication_role = default;
  `);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(BASE_DO_PLAN);
  await db.exec(sqlDoRepo('integracoes/agenda/001_agenda.sql'));
  await db.exec(sqlDoRepo('integracoes/agenda/003_agenda_cliente.sql'));
  await db.exec(sqlDoRepo('integracoes/kickoff/001_kickoff_m1.sql'));
  await db.exec(sqlDoRepo('integracoes/kickoff/003_kickoff_reservas.sql'));
  await db.exec(sqlDoRepo('integracoes/kickoff/004_kickoff_reuniao_protegida.sql'));
  await db.exec(`
    insert into auth.users (id) values ('${GESTOR}'), ('${EQUIPE}');
    insert into public.client_tenants (id, name) values ('${ORG}', 'Customer Success');
    insert into public.meet_user_profile (user_id, is_admin, sector, capacidades) values
      ('${GESTOR}', false, 'executoria', '{kickoff_impulsao.manage}'), ('${EQUIPE}', false, 'executoria', '{}');
  `);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

// Cada teste começa com três sessões futuras novas e sem reservas (as anteriores
// ficam, com o histórico, porque nada se apaga).
let rodada = 0;
beforeEach(async () => {
  rodada += 1;
  for (const [i, id] of Object.values(S).entries()) {
    const novo = id.slice(0, -4) + String(rodada).padStart(2, '0') + String(i).padStart(2, '0');
    (S as Record<string, string>)[Object.keys(S)[i]] = novo;
    await db.exec(`
      insert into public.meetings (id, tenant_id, title, scheduled_start_at, scheduled_end_at, room_name)
        values ('${novo}', '${ORG}', 'Kickoff', now() + interval '${i + 1} days', now() + interval '${i + 1} days 1 hour', 'k${novo}');
      insert into public.meet_meeting_sector (meeting_id, sector, onboarding) values ('${novo}', 'executoria', true);
      insert into public.agenda_kickoff_sessoes (meeting_id) values ('${novo}');
    `);
  }
});

describe('kickoff concluído: a empresa nunca mais reserva pelo fluxo normal', () => {
  it('1. concluiu e tenta reservar de novo: recusada (nesta ou em outra sessão)', async () => {
    const e0 = await novaEmpresa();
    const r = await reservar(S.a, e0);
    await sessaoJaAconteceu(S.a);
    await presenca(r, 'presente');
    await concluir(r);
    const e = await tentarReservar(S.b, e0);
    expect(e.code).toBe('23505');
    expect(e.message).toMatch(/^Esta empresa já concluiu o kickoff \(\d{2}\/\d{2}\/\d{4}\)\. Um novo kickoff só pode ser tratado pelo suporte\.$/);
    // Nem por escrita direta, fora das funções (gatilho e índice único).
    expect(
      (await falha(`insert into public.agenda_kickoff_reservas (meeting_id, tenant_id, participante_nome, participante_email) values ($1, $2, 'P', 'p@x.com.br')`, [S.c, e0]))
        .code,
    ).toBe('23505');
  });

  it('2. concluiu, tenta cancelar a reserva para reservar de novo: recusado', async () => {
    const e1 = await novaEmpresa();
    const r = await reservar(S.a, e1);
    await sessaoJaAconteceu(S.a);
    await presenca(r, 'presente');
    await concluir(r);
    const msg = 'Kickoff concluído não muda: não pode ser cancelado, remanejado nem reaberto. Exceções só pelo suporte.';
    expect((await falha("select public.agenda_kickoff_cancelar_reserva($1, 'contornar', $2)", [r, GESTOR])).message).toBe(msg);
    expect((await falha('select public.agenda_kickoff_remanejar($1, $2, null, $3)', [r, S.b, GESTOR])).message).toBe(msg);
    // Nem direto no banco: cancelar, reabrir, tirar a presença ou mudar de sessão.
    for (const sql of [
      "update public.agenda_kickoff_reservas set status = 'cancelada', cancelada_em = now(), concluida_em = null where id = $1",
      "update public.agenda_kickoff_reservas set status = 'ativa', concluida_em = null where id = $1",
      'update public.agenda_kickoff_reservas set presenca = null, presenca_em = null, presenca_origem = null where id = $1',
    ]) {
      expect((await falha(sql, [r])).code).toMatch(/^(22023|23514)$/);
    }
    expect((await reserva(r)).status).toBe('concluida');
    expect((await tentarReservar(S.b, e1)).code).toBe('23505');
    // O participante ainda pode ser corrigido (contato), com histórico.
    await db.query("select public.agenda_kickoff_atualizar_participante($1, 'Outra Pessoa', 'outra@x.com.br', null, $2)", [r, GESTOR]);
    expect(await historico(r)).toEqual(['criada', 'presenca_registrada', 'concluida', 'participante_alterado']);
  });

  it('o admin do Meet também não contorna (a regra vale para as operações administrativas)', async () => {
    const e6 = await novaEmpresa();
    const ADMIN = '1a000000-0000-4000-8000-000000000009';
    await db.exec(`insert into public.meet_user_profile (user_id, is_admin) values ('${ADMIN}', true) on conflict do nothing`);
    const r = await reservar(S.a, e6);
    await sessaoJaAconteceu(S.a);
    await presenca(r, 'presente');
    await concluir(r);
    expect((await falha('select public.agenda_kickoff_cancelar_reserva($1, null, $2)', [r, ADMIN])).code).toBe('22023');
    expect((await tentarReservar(S.b, e6, ADMIN)).code).toBe('23505');
  });
});

describe('ausência: a empresa pode ser reagendada, com o histórico preservado', () => {
  it('3. não compareceu: reagendar cria uma reserva NOVA, ligada à ausência; nunca duas ativas', async () => {
    const e2 = await novaEmpresa();
    const r1 = await reservar(S.a, e2);
    await sessaoJaAconteceu(S.a);
    await presenca(r1, 'ausente');
    expect(await reserva(r1)).toMatchObject({ status: 'ausente', presenca: 'ausente', concluida_em: null });

    const r2 = (
      await um<{ r: { id: string } }>("select public.agenda_kickoff_reagendar($1, $2, 'Faltou', $3) as r", [r1, S.b, GESTOR])
    ).r.id;
    expect(r2).not.toBe(r1);
    expect(await reserva(r2)).toMatchObject({ status: 'ativa', meeting_id: S.b, origem_reserva_id: r1 });
    expect(await reserva(r1)).toMatchObject({ status: 'ausente' }); // a ausência fica
    expect(await historico(r1)).toEqual(['criada', 'ausente']);
    expect(await historico(r2)).toEqual(['reagendada']);
    // Não dá para reagendar a mesma ausência duas vezes, nem ter duas ativas.
    expect((await falha('select public.agenda_kickoff_reagendar($1, $2, null, $3)', [r1, S.c, GESTOR])).message).toBe(
      'Esta reserva já foi reagendada.',
    );
    expect((await tentarReservar(S.c, e2)).code).toBe('23505');
    // A ausência não muda (nem para "presente" depois).
    expect((await falha("update public.agenda_kickoff_reservas set status = 'ativa', presenca = null, presenca_em = null, presenca_origem = null where id = $1", [r1])).code).toMatch(/^(22023|23514)$/);
  });

  it('pelo fluxo normal de inscrição, a reserva nova também fica ligada à ausência', async () => {
    const e3 = await novaEmpresa();
    const r1 = await reservar(S.a, e3);
    await sessaoJaAconteceu(S.a);
    await presenca(r1, 'ausente');
    const r2 = await reservar(S.b, e3);
    expect((await reserva(r2)).origem_reserva_id).toBe(r1);
    expect(await historico(r2)).toEqual(['reagendada']);
  });

  it('ausência só depois do fim da sessão; presença só depois do início', async () => {
    const e4 = await novaEmpresa();
    const r = await reservar(S.a, e4);
    expect((await falha("select public.agenda_kickoff_registrar_presenca($1, 'presente', $2)", [r, GESTOR])).message).toBe(
      'A presença só pode ser registrada depois que a sessão começar.',
    );
    await sessaoJaAconteceu(S.a, '30 minutes', '-30 minutes'); // em andamento
    expect((await falha("select public.agenda_kickoff_registrar_presenca($1, 'ausente', $2)", [r, GESTOR])).message).toBe(
      'A ausência só pode ser registrada depois que a sessão terminar.',
    );
    await presenca(r, 'presente'); // check-in durante a sessão
    expect((await reserva(r)).status).toBe('ativa'); // compareceu, mas NÃO concluiu
    expect((await falha("select public.agenda_kickoff_registrar_presenca($1, 'ausente', $2)", [r, GESTOR])).message).toBe(
      'A presença desta reserva já foi registrada.',
    );
  });
});

describe('cancelamento antes de participar', () => {
  it('4. cancelou antes de participar: pode reservar de novo', async () => {
    const e5 = await novaEmpresa();
    const r1 = await reservar(S.a, e5);
    await db.query("select public.agenda_kickoff_cancelar_reserva($1, 'Não pode no dia', $2)", [r1, GESTOR]);
    const r2 = await reservar(S.b, e5);
    expect(await reserva(r2)).toMatchObject({ status: 'ativa', origem_reserva_id: null });
    expect(await historico(r1)).toEqual(['criada', 'cancelada']);
  });
});

describe('o horário não conclui nada sozinho', () => {
  it('5. sessão terminou sem registro: a reserva continua ativa, não concluída, e a empresa não reserva outra', async () => {
    const e7 = await novaEmpresa();
    const r = await reservar(S.a, e7);
    await sessaoJaAconteceu(S.a, '3 days', '3 days');
    expect(await reserva(r)).toMatchObject({ status: 'ativa', presenca: null, concluida_em: null });
    expect(Number((await um<{ n: number }>("select count(*)::int n from public.agenda_kickoff_reservas where status = 'concluida' and id = $1", [r])).n)).toBe(0);
    expect((await tentarReservar(S.b, e7)).message).toMatch(/^Esta empresa já tem kickoff marcado em/);
    // Concluir sem presença registrada: recusado.
    expect((await falha("select public.agenda_kickoff_concluir($1, null, $2)", [r, GESTOR])).message).toBe(
      'Para concluir, registre antes que a empresa compareceu.',
    );
    expect(
      (await falha("update public.agenda_kickoff_reservas set status = 'concluida', concluida_em = now() where id = $1", [r])).code,
    ).toBe('23514'); // check: concluir exige presença 'presente'
  });
});

describe('autorização', () => {
  it('7. quem não gerencia kickoffs não registra presença, não conclui, não reagenda; histórico não se altera', async () => {
    const r = await reservar(S.a, await novaEmpresa());
    await sessaoJaAconteceu(S.a);
    for (const u of [EQUIPE, null]) {
      expect((await falha("select public.agenda_kickoff_registrar_presenca($1, 'presente', $2)", [r, u])).code).toBe('42501');
      expect((await falha("select public.agenda_kickoff_concluir($1, null, $2)", [r, u])).code).toBe('42501');
      expect((await falha('select public.agenda_kickoff_reagendar($1, $2, null, $3)', [r, S.b, u])).code).toBe('42501');
    }
    expect(await reserva(r)).toMatchObject({ status: 'ativa', presenca: null });
    for (const papel of ['anon', 'authenticated']) {
      await db.exec(`set role ${papel}`);
      try {
        expect((await falha("select public.agenda_kickoff_concluir($1, null, $2)", [r, GESTOR])).code).toBe('42501');
        expect((await falha('update public.agenda_kickoff_reservas_historico set motivo = null')).code).toBe('42501');
      } finally {
        await db.exec('reset role');
      }
    }
    expect((await falha("update public.agenda_kickoff_reservas_historico set acao = 'concluida'")).code).toBe('42501');
    expect((await falha('delete from public.agenda_kickoff_reservas_historico')).code).toBe('42501');
  });
});

describe('capacidade com empresas diferentes', () => {
  it('8. empresas diferentes dividem a sessão até o limite; ausência e conclusão continuam ocupando a vaga', async () => {
    const novas: string[] = [];
    for (let i = 0; i < 6; i++) novas.push(await novaEmpresa());
    for (const e of novas.slice(0, 5)) await reservar(S.c, e);
    expect((await tentarReservar(S.c, novas[5])).message).toBe('Sessão lotada: 5 de 5 empresas.');
    expect(
      (await falha('select public.agenda_kickoff_configurar_sessao($1, 4, null, $2)', [S.c, GESTOR])).message,
    ).toBe('Esta sessão tem 5 empresa(s) inscrita(s): a capacidade não pode ficar abaixo disso.');
  });
});

describe('sessão que já aconteceu fica protegida', () => {
  it('com presença ou conclusão registrada, não se cancela nem muda de horário', async () => {
    const r = await reservar(S.a, await novaEmpresa());
    await sessaoJaAconteceu(S.a);
    await presenca(r, 'presente');
    expect((await falha('select public.agenda_kickoff_cancelar_sessoes($1, true, null, null, $2)', [[S.a], GESTOR])).message).toMatch(
      /já tem presença ou conclusão registrada: não pode ser cancelada\.$/,
    );
    expect((await falha(`update public.meetings set status = 'canceled' where id = $1`, [S.a])).message).toMatch(/^Esta sessão de kickoff tem 1 empresa/);
  });
});

describe('compareceu e não concluiu (participação interrompida)', () => {
  const interromper = (r: string, motivo: string | null, usuario: string | null = GESTOR) =>
    db.query('select public.agenda_kickoff_registrar_interrupcao($1, $2, $3)', [r, motivo, usuario]);

  it('compareceu e tenta cancelar normalmente para reservar de novo: recusado (função e SQL direto)', async () => {
    const e = await novaEmpresa();
    const r = await reservar(S.a, e);
    await sessaoJaAconteceu(S.a);
    await presenca(r, 'presente');
    expect((await falha("select public.agenda_kickoff_cancelar_reserva($1, 'refazer', $2)", [r, GESTOR])).message).toMatch(
      /^A empresa compareceu: a reserva não pode ser cancelada\./,
    );
    expect(
      (await falha("update public.agenda_kickoff_reservas set status = 'cancelada', cancelada_em = now() where id = $1", [r])).code,
    ).toBe('23514'); // check: cancelada exige presença nula
    expect((await tentarReservar(S.b, e)).code).toBe('23505'); // ainda tem a reserva ativa
  });

  it('registra a interrupção com motivo obrigatório e então reagenda, sem perder a participação', async () => {
    const e = await novaEmpresa();
    const r1 = await reservar(S.a, e);
    await sessaoJaAconteceu(S.a);
    await presenca(r1, 'presente');
    expect((await falha('select public.agenda_kickoff_registrar_interrupcao($1, $2, $3)', [r1, '   ', GESTOR])).message).toBe(
      'Informe o motivo da participação não concluída.',
    );
    await interromper(r1, 'Queda de conexão no meio da sessão');
    expect(await reserva(r1)).toMatchObject({ status: 'interrompida', presenca: 'presente', concluida_em: null });
    // Pelo SQL direto, interrupção sem motivo não passa (check).
    const e2 = await novaEmpresa();
    const r9 = await reservar(S.c, e2);
    await sessaoJaAconteceu(S.c);
    await presenca(r9, 'presente');
    expect(
      (await falha("update public.agenda_kickoff_reservas set status = 'interrompida', interrompida_em = now() where id = $1", [r9])).code,
    ).toBe('23514');

    const r2 = (await um<{ r: { id: string } }>("select public.agenda_kickoff_reagendar($1, $2, 'Refazer', $3) as r", [r1, S.b, GESTOR])).r.id;
    expect(await reserva(r2)).toMatchObject({ status: 'ativa', origem_reserva_id: r1 });
    expect(await reserva(r1)).toMatchObject({ status: 'interrompida', presenca: 'presente' }); // a participação fica
    expect(await historico(r1)).toEqual(['criada', 'presenca_registrada', 'interrompida']);
    // Interrompida não se cancela, não se corrige, não conclui.
    expect((await falha('select public.agenda_kickoff_cancelar_reserva($1, null, $2)', [r1, GESTOR])).code).toBe('22023');
    expect((await falha("select public.agenda_kickoff_corrigir_presenca($1, 'ausente', 'x', $2)", [r1, GESTOR])).code).toBe('22023');
    expect((await falha('select public.agenda_kickoff_concluir($1, null, $2)', [r1, GESTOR])).code).toBe('22023');
  });

  it('interrupção só para quem compareceu; nunca para concluída (que continua impedindo nova reserva)', async () => {
    const e = await novaEmpresa();
    const r = await reservar(S.a, e);
    expect((await falha('select public.agenda_kickoff_registrar_interrupcao($1, $2, $3)', [r, 'motivo', GESTOR])).message).toBe(
      'Só quem compareceu pode ter a participação registrada como não concluída.',
    );
    await sessaoJaAconteceu(S.a);
    await presenca(r, 'presente');
    await concluir(r);
    expect((await falha('select public.agenda_kickoff_registrar_interrupcao($1, $2, $3)', [r, 'motivo', GESTOR])).message).toMatch(
      /^Kickoff concluído não muda/,
    );
    expect((await tentarReservar(S.b, e)).code).toBe('23505');
  });

  it('quem não gerencia não registra interrupção', async () => {
    const e = await novaEmpresa();
    const r = await reservar(S.a, e);
    await sessaoJaAconteceu(S.a);
    await presenca(r, 'presente');
    for (const u of [EQUIPE, null]) expect((await falha('select public.agenda_kickoff_registrar_interrupcao($1, $2, $3)', [r, 'x', u])).code).toBe('42501');
    expect((await reserva(r)).status).toBe('ativa');
  });
});

describe('correção de presença ou ausência registrada por engano', () => {
  const corrigir = (r: string, p: string, motivo: string | null, usuario: string | null = GESTOR) =>
    db.query('select public.agenda_kickoff_corrigir_presenca($1, $2, $3, $4)', [r, p, motivo, usuario]);
  const reservasDa = async (empresa: string) =>
    Number((await um<{ n: number }>('select count(*)::int n from public.agenda_kickoff_reservas where tenant_id = $1', [empresa])).n);

  it('"compareceu" por engano: volta a "sem registro" ou vira ausência, na MESMA reserva, com antes/depois no histórico', async () => {
    const e = await novaEmpresa();
    const r = await reservar(S.a, e);
    await sessaoJaAconteceu(S.a);
    await presenca(r, 'presente');
    await corrigir(r, 'nenhuma', 'Clique na empresa errada');
    expect(await reserva(r)).toMatchObject({ status: 'ativa', presenca: null });
    await presenca(r, 'presente');
    await corrigir(r, 'ausente', 'Não estava na sessão');
    expect(await reserva(r)).toMatchObject({ status: 'ausente', presenca: 'ausente' });
    expect(await reservasDa(e)).toBe(1); // nenhuma reserva nova
    const h = await db.query<{ acao: string; motivo: string | null; dados: unknown }>(
      "select acao, motivo, dados from public.agenda_kickoff_reservas_historico where reserva_id = $1 and acao = 'presenca_corrigida' order by id",
      [r],
    );
    expect(h.rows).toEqual([
      {
        acao: 'presenca_corrigida',
        motivo: 'Clique na empresa errada',
        dados: { antes: { status: 'ativa', presenca: 'presente' }, depois: { status: 'ativa', presenca: null } },
      },
      {
        acao: 'presenca_corrigida',
        motivo: 'Não estava na sessão',
        dados: { antes: { status: 'ativa', presenca: 'presente' }, depois: { status: 'ausente', presenca: 'ausente' } },
      },
    ]);
  });

  it('"não compareceu" por engano: a mesma reserva volta a valer (compareceu), sem reserva nova', async () => {
    const e = await novaEmpresa();
    const r = await reservar(S.a, e);
    await sessaoJaAconteceu(S.a);
    await presenca(r, 'ausente');
    await corrigir(r, 'presente', 'Participou pelo celular de um colega');
    expect(await reserva(r)).toMatchObject({ status: 'ativa', presenca: 'presente' });
    await concluir(r); // e segue o fluxo normal
    expect(await reservasDa(e)).toBe(1);
  });

  it('sem motivo, sem permissão, por SQL direto ou de reserva concluída: recusado, e nada muda', async () => {
    const e = await novaEmpresa();
    const r = await reservar(S.a, e);
    await sessaoJaAconteceu(S.a);
    await presenca(r, 'presente');
    expect((await falha("select public.agenda_kickoff_corrigir_presenca($1, 'nenhuma', '  ', $2)", [r, GESTOR])).message).toBe(
      'Informe o motivo da correção.',
    );
    for (const u of [EQUIPE, null]) {
      expect((await falha("select public.agenda_kickoff_corrigir_presenca($1, 'nenhuma', 'x', $2)", [r, u])).code).toBe('42501');
    }
    await db.exec('set role authenticated');
    try {
      expect((await falha("select public.agenda_kickoff_corrigir_presenca($1, 'nenhuma', 'x', $2)", [r, GESTOR])).code).toBe('42501');
    } finally {
      await db.exec('reset role');
    }
    expect(
      (await falha('update public.agenda_kickoff_reservas set presenca = null, presenca_em = null, presenca_origem = null where id = $1', [r])).code,
    ).toBe('22023');
    expect(await reserva(r)).toMatchObject({ status: 'ativa', presenca: 'presente' });
    await concluir(r);
    expect((await falha("select public.agenda_kickoff_corrigir_presenca($1, 'ausente', 'engano', $2)", [r, GESTOR])).message).toMatch(
      /^Kickoff concluído não muda/,
    );
  });

  it('ausência que já gerou reagendamento não pode ser corrigida (e a mensagem explica por quê)', async () => {
    const e = await novaEmpresa();
    const r1 = await reservar(S.a, e);
    await sessaoJaAconteceu(S.a);
    await presenca(r1, 'ausente');
    const r2 = await reservar(S.b, e); // reserva nova, ligada à ausência
    expect((await reserva(r2)).origem_reserva_id).toBe(r1);
    const msg = await falha("select public.agenda_kickoff_corrigir_presenca($1, 'presente', 'engano', $2)", [r1, GESTOR]);
    expect(msg.message).toMatch(/^Esta ausência já gerou uma nova reserva \(reagendamento\) e não pode ser corrigida\./);
    // Mesmo cancelando a reserva nova, a ausência continua ligada a ela: não volta.
    await db.query("select public.agenda_kickoff_cancelar_reserva($1, 'engano', $2)", [r2, GESTOR]);
    expect((await falha("select public.agenda_kickoff_corrigir_presenca($1, 'presente', 'engano', $2)", [r1, GESTOR])).code).toBe('22023');
    expect(await reserva(r1)).toMatchObject({ status: 'ausente' });
  });

  it('correção sem registro anterior ou sem mudança: recusada (não é correção)', async () => {
    const e = await novaEmpresa();
    const r = await reservar(S.a, e);
    await sessaoJaAconteceu(S.a);
    expect((await falha("select public.agenda_kickoff_corrigir_presenca($1, 'presente', 'x', $2)", [r, GESTOR])).message).toMatch(
      /^Não há presença registrada para corrigir/,
    );
    await presenca(r, 'presente');
    expect((await falha("select public.agenda_kickoff_corrigir_presenca($1, 'presente', 'x', $2)", [r, GESTOR])).message).toBe(
      'A presença registrada já é essa.',
    );
  });
});
