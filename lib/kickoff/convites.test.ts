// Convites e agendamento público do kickoff (M3), num Postgres em memória (PGlite)
// com as migrations reais (001, 003, 004 e 005). A disputa da última vaga com
// conexões simultâneas de verdade está em reservasConcorrencia.test.ts.
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASE_DO_PLAN, sqlDoRepo } from './bancoDeTeste';

const ORG = '0c000000-0000-4000-8000-000000000000';
const GESTOR = '1a000000-0000-4000-8000-000000000001';
const EQUIPE = '1a000000-0000-4000-8000-000000000003';
const ANFITRIAO = '1a000000-0000-4000-8000-000000000005';
const S = {
  aberta: '2a000000-0000-4000-8000-000000000001',
  outra: '2a000000-0000-4000-8000-000000000002',
  passada: '2a000000-0000-4000-8000-000000000003',
  cancelada: '2a000000-0000-4000-8000-000000000004',
  bloqueada: '2a000000-0000-4000-8000-000000000005',
  pequena: '2a000000-0000-4000-8000-000000000006', // capacidade 1
  comum: '2c000000-0000-4000-8000-000000000001', // reunião comum (não é kickoff)
  expira: '2a000000-0000-4000-8000-000000000007', // usada pelos casos de convite expirado
};
const CODIGO = /^[a-hj-km-np-z2-9]{12}$/;

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

let empresas = 0;
async function novaEmpresa(nome = 'Empresa'): Promise<string> {
  empresas += 1;
  const id = `0e000000-0000-4000-8000-${String(empresas).padStart(12, '0')}`;
  await db.query('insert into public.client_tenants (id, name) values ($1, $2)', [id, `${nome} ${empresas}`]);
  return id;
}
type Convite = { codigo: string; reutilizado: boolean; expira_em: string };
const gerar = async (tenant: string, usuario = GESTOR, dias: number | null = null) =>
  (await um<{ r: Convite }>('select public.agenda_kickoff_convite_gerar($1, $2, $3) as r', [tenant, dias, usuario])).r;
type Pagina = {
  status: string;
  empresa?: { nome: string };
  situacao?: string;
  reserva?: Record<string, unknown> | null;
  sessoes?: Array<{ id: string; data: string; inicio: string; fim: string; vagas: number; anfitriao: { nome: string; foto: string | null } }>;
};
const abrir = async (codigo: string, origem = 'ip:teste') =>
  (await um<{ r: Pagina }>('select public.agenda_kickoff_publico_convite($1, $2) as r', [codigo, origem])).r;
type Agendado = { status: string; mensagem?: string; reserva?: Record<string, unknown> };
const agendar = async (
  codigo: string,
  sessao: string | null,
  p: { nome?: string; email?: string | null; telefone?: string | null } = {},
  origem = 'ip:teste',
) =>
  (
    await um<{ r: Agendado }>('select public.agenda_kickoff_publico_agendar($1, $2, $3, $4, $5, $6) as r', [
      codigo,
      sessao,
      p.nome ?? 'Maria Cliente',
      p.email === undefined ? 'maria@cliente.com.br' : p.email,
      p.telefone ?? null,
      origem,
    ])
  ).r;

/** Só para montar cenário de teste: muda a linha sem gatilhos (como o tempo passando). */
async function semGatilhos(sql: string) {
  await db.exec(`set session_replication_role = replica; ${sql}; set session_replication_role = default;`);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(BASE_DO_PLAN);
  await db.exec('alter table public.users add column avatar_url text');
  await db.exec(sqlDoRepo('integracoes/agenda/001_agenda.sql'));
  await db.exec(sqlDoRepo('integracoes/agenda/003_agenda_cliente.sql'));
  await db.exec(sqlDoRepo('integracoes/kickoff/001_kickoff_m1.sql'));
  await db.exec(sqlDoRepo('integracoes/kickoff/003_kickoff_reservas.sql'));
  await db.exec(sqlDoRepo('integracoes/kickoff/004_kickoff_reuniao_protegida.sql'));
  await db.exec(sqlDoRepo('integracoes/kickoff/005_kickoff_convites.sql'));
  await db.exec(`
    insert into auth.users (id) values ('${GESTOR}'), ('${EQUIPE}'), ('${ANFITRIAO}');
    insert into public.client_tenants (id, name) values ('${ORG}', 'Customer Success');
    insert into public.users (id, name, role, avatar_url) values
      ('${ANFITRIAO}', 'Ana Anfitriã', 'CUSTOMER_SUCCESS', 'https://abcdefgh.supabase.co/storage/v1/object/public/avatars/ana.jpg'),
      ('${GESTOR}', 'Gestor', 'CUSTOMER_SUCCESS', 'https://outro.site/foto.jpg');
    insert into public.meet_user_profile (user_id, is_admin, sector, capacidades) values
      ('${GESTOR}', false, 'executoria', '{kickoff_impulsao.manage}'), ('${EQUIPE}', false, 'executoria', '{}');
    insert into public.meetings (id, tenant_id, host_id, title, scheduled_start_at, scheduled_end_at, status, room_name) values
      ('${S.aberta}', '${ORG}', '${ANFITRIAO}', 'Kickoff', now() + interval '2 days', now() + interval '2 days 1 hour', 'scheduled', 'k1'),
      ('${S.outra}', '${ORG}', '${GESTOR}', 'Kickoff', now() + interval '9 days', now() + interval '9 days 1 hour', 'scheduled', 'k2'),
      ('${S.passada}', '${ORG}', '${ANFITRIAO}', 'Kickoff', now() - interval '2 days', now() - interval '2 days' + interval '1 hour', 'scheduled', 'k3'),
      ('${S.cancelada}', '${ORG}', '${ANFITRIAO}', 'Kickoff', now() + interval '3 days', now() + interval '3 days 1 hour', 'canceled', 'k4'),
      ('${S.bloqueada}', '${ORG}', '${ANFITRIAO}', 'Kickoff', now() + interval '4 days', now() + interval '4 days 1 hour', 'scheduled', 'k5'),
      ('${S.pequena}', '${ORG}', '${ANFITRIAO}', 'Kickoff', now() + interval '5 days', now() + interval '5 days 1 hour', 'scheduled', 'k6'),
      ('${S.comum}', '${ORG}', '${ANFITRIAO}', 'Reunião comum', now() + interval '1 day', now() + interval '1 day 1 hour', 'scheduled', 'c1'),
      ('${S.expira}', '${ORG}', '${ANFITRIAO}', 'Kickoff', now() + interval '6 days', now() + interval '6 days 1 hour', 'scheduled', 'k7');
    insert into public.meet_meeting_sector (meeting_id, sector, onboarding) select id, 'executoria', true from public.meetings;
    insert into public.agenda_kickoff_sessoes (meeting_id, capacidade, aceita_reservas) values
      ('${S.aberta}', 5, true), ('${S.outra}', 5, true), ('${S.passada}', 5, true),
      ('${S.cancelada}', 5, true), ('${S.bloqueada}', 5, false), ('${S.pequena}', 1, true), ('${S.expira}', 50, true);
  `);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe('gestão dos convites', () => {
  it('gera um código aleatório de 12 caracteres; pedir de novo devolve o mesmo (um em vigor por empresa)', async () => {
    const e = await novaEmpresa();
    const c1 = await gerar(e);
    expect(c1.codigo).toMatch(CODIGO);
    expect(c1.reutilizado).toBe(false);
    const c2 = await gerar(e);
    expect(c2).toMatchObject({ codigo: c1.codigo, reutilizado: true });
    // Códigos de empresas diferentes são diferentes.
    expect((await gerar(await novaEmpresa())).codigo).not.toBe(c1.codigo);
    // Validade padrão: 90 dias.
    const dias = (Date.parse(c1.expira_em) - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(89);
    expect(dias).toBeLessThan(91);
  });

  it('reemitir troca o código (o antigo para de abrir); revogar desliga sem criar outro', async () => {
    const e = await novaEmpresa();
    const antigo = (await gerar(e)).codigo;
    const novo = (await um<{ r: Convite }>("select public.agenda_kickoff_convite_reemitir($1, null, 'Vazou', $2) as r", [e, GESTOR])).r.codigo;
    expect(novo).not.toBe(antigo);
    expect((await abrir(antigo)).status).toBe('convite_revogado');
    expect((await abrir(novo)).status).toBe('ok');
    await db.query("select public.agenda_kickoff_convite_revogar($1, 'Não vai mais participar', $2)", [e, GESTOR]);
    expect((await abrir(novo)).status).toBe('convite_revogado');
    expect((await falha("select public.agenda_kickoff_convite_revogar($1, null, $2)", [e, GESTOR])).message).toBe(
      'Esta empresa não tem convite em vigor.',
    );
    const m = await um<{ motivo_revogacao: string }>('select motivo_revogacao from public.agenda_kickoff_convites where codigo = $1', [antigo]);
    expect(m.motivo_revogacao).toBe('Vazou');
  });

  it('empresa organizadora, empresa que concluiu e empresa inexistente não recebem convite', async () => {
    expect((await falha('select public.agenda_kickoff_convite_gerar($1, null, $2)', [ORG, GESTOR])).message).toBe(
      'A empresa organizadora dos kickoffs não recebe convite.',
    );
    expect((await falha('select public.agenda_kickoff_convite_gerar($1, null, $2)', ['0f000000-0000-4000-8000-000000000000', GESTOR])).code).toBe('P0002');
    const e = await novaEmpresa();
    await db.query("select public.agenda_kickoff_reservar($1, $2, 'Pessoa', 'p@x.com.br', null, $3)", [S.outra, e, GESTOR]);
    const r = await um<{ id: string }>('select id from public.agenda_kickoff_reservas where tenant_id = $1', [e]);
    await semGatilhos(
      `update public.agenda_kickoff_reservas set status = 'concluida', presenca = 'presente', presenca_em = now(), presenca_origem = 'manual', concluida_em = now() where id = '${r.id}'`,
    );
    expect((await falha('select public.agenda_kickoff_convite_gerar($1, null, $2)', [e, GESTOR])).message).toBe(
      'Esta empresa já concluiu o kickoff: não precisa de convite.',
    );
  });

  it('quem não gerencia kickoffs não gera, não reemite e não revoga', async () => {
    const e = await novaEmpresa();
    await gerar(e);
    for (const u of [EQUIPE, null]) {
      expect((await falha('select public.agenda_kickoff_convite_gerar($1, null, $2)', [e, u])).code).toBe('42501');
      expect((await falha('select public.agenda_kickoff_convite_reemitir($1, null, null, $2)', [e, u])).code).toBe('42501');
      expect((await falha('select public.agenda_kickoff_convite_revogar($1, null, $2)', [e, u])).code).toBe('42501');
    }
  });

  it('convite não se apaga nem muda (só se revoga)', async () => {
    const e = await novaEmpresa();
    const c = await gerar(e);
    expect((await falha('delete from public.agenda_kickoff_convites where codigo = $1', [c.codigo])).code).toBe('42501');
    expect((await falha("update public.agenda_kickoff_convites set tenant_id = $1 where codigo = $2", [ORG, c.codigo])).code).toBe('42501');
    expect((await falha("update public.agenda_kickoff_convites set expira_em = now() + interval '9 years' where codigo = $1", [c.codigo])).code).toBe(
      '42501',
    );
  });
});

describe('página pública do convite', () => {
  it('convite válido: só o nome da empresa e as sessões abertas, futuras e com vaga', async () => {
    const e = await novaEmpresa('Padaria');
    const c = await gerar(e);
    const p = await abrir(c.codigo);
    expect(p.status).toBe('ok');
    expect(p.empresa).toEqual({ nome: `Padaria ${empresas}` });
    expect(p.situacao).toBe('disponivel');
    expect(p.reserva).toBeNull();
    const ids = p.sessoes!.map((s) => s.id);
    expect(ids).toContain(S.aberta);
    for (const fora of [S.passada, S.cancelada, S.bloqueada, S.comum]) expect(ids).not.toContain(fora);
    const s = p.sessoes!.find((x) => x.id === S.aberta)!;
    expect(s).toMatchObject({ vagas: expect.any(Number), anfitriao: { nome: 'Ana Anfitriã', foto: 'https://abcdefgh.supabase.co/storage/v1/object/public/avatars/ana.jpg' } });
    expect(s.data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(s.inicio).toMatch(/^\d{2}:\d{2}$/);
    // Foto fora do bucket público de avatares não sai (a página mostra as iniciais).
    expect(p.sessoes!.find((x) => x.id === S.outra)!.anfitriao).toEqual({ nome: 'Gestor', foto: null });
  });

  it('não expõe dados empresariais: nem id da empresa, nem do convite, nem e-mails', async () => {
    const e = await novaEmpresa();
    const c = await gerar(e);
    await agendar(c.codigo, S.aberta);
    const texto = JSON.stringify(await abrir(c.codigo));
    expect(texto).not.toContain(e);
    expect(texto).not.toContain(ORG);
    expect(texto).not.toMatch(/@/); // nenhum e-mail
    const conv = await um<{ id: string }>('select id from public.agenda_kickoff_convites where codigo = $1', [c.codigo]);
    expect(texto).not.toContain(conv.id);
    expect(texto).not.toContain('tenant');
  });

  it('código inválido, revogado e expirado têm respostas próprias', async () => {
    expect((await abrir('abcdefghjkmn')).status).toBe('convite_invalido');
    expect((await abrir('')).status).toBe('convite_invalido');
    const e = await novaEmpresa();
    const c = await gerar(e);
    await semGatilhos(`update public.agenda_kickoff_convites set criado_em = now() - interval '100 days', expira_em = now() - interval '1 day' where codigo = '${c.codigo}'`);
    expect((await abrir(c.codigo, 'ip:exp0')).status).toBe('convite_expirado');
    expect((await agendar(c.codigo, S.aberta, {}, 'ip:exp0')).status).toBe('convite_expirado');
    // Gerar de novo troca o expirado por um novo.
    const novo = await gerar(e);
    expect(novo.reutilizado).toBe(false);
    expect(novo.codigo).not.toBe(c.codigo);
    expect((await abrir(novo.codigo)).status).toBe('ok');
  });

  it('expirado COM reserva: consulta a reserva, mas não agenda de novo', async () => {
    const e = await novaEmpresa();
    const c = await gerar(e);
    expect((await agendar(c.codigo, S.expira)).status).toBe('ok');
    await semGatilhos(`update public.agenda_kickoff_convites set criado_em = now() - interval '100 days', expira_em = now() - interval '1 day' where codigo = '${c.codigo}'`);
    const p = await abrir(c.codigo, 'ip:consulta');
    expect(p).toMatchObject({ status: 'ok', situacao: 'reservada', expirado: true, sessoes: [] });
    expect(p.reserva).toMatchObject({ participante: 'Maria Cliente' });
    // Consultar não gasta tentativa: muitas consultas seguidas continuam abrindo.
    for (let i = 0; i < 12; i++) expect((await abrir(c.codigo, 'ip:consulta')).status).toBe('ok');
    // Agendar (mesma ou outra sessão) com o convite expirado: recusado, nada muda.
    expect((await agendar(c.codigo, S.expira, {}, 'ip:exp1')).status).toBe('convite_expirado');
    expect((await agendar(c.codigo, S.aberta, {}, 'ip:exp1')).status).toBe('convite_expirado');
    expect(Number((await um<{ n: number }>('select count(*)::int n from public.agenda_kickoff_reservas where tenant_id = $1', [e])).n)).toBe(1);
  });

  it('expirado de empresa que concluiu: consulta "concluída"; expirado depois de cancelar a reserva: não abre', async () => {
    const e1 = await novaEmpresa();
    const c1 = await gerar(e1);
    await agendar(c1.codigo, S.expira);
    const r1 = await um<{ id: string }>("select id from public.agenda_kickoff_reservas where tenant_id = $1 and status = 'ativa'", [e1]);
    await semGatilhos(
      `update public.agenda_kickoff_reservas set status = 'concluida', presenca = 'presente', presenca_em = now(), presenca_origem = 'manual', concluida_em = now() where id = '${r1.id}';
       update public.agenda_kickoff_convites set criado_em = now() - interval '100 days', expira_em = now() - interval '1 day' where codigo = '${c1.codigo}'`,
    );
    expect(await abrir(c1.codigo)).toMatchObject({ status: 'ok', situacao: 'concluida', expirado: true });

    const e2 = await novaEmpresa();
    const c2 = await gerar(e2);
    await agendar(c2.codigo, S.expira);
    const r2 = await um<{ id: string }>("select id from public.agenda_kickoff_reservas where tenant_id = $1 and status = 'ativa'", [e2]);
    await db.query("select public.agenda_kickoff_cancelar_reserva($1, 'desistiu', $2)", [r2.id, GESTOR]);
    await semGatilhos(`update public.agenda_kickoff_convites set criado_em = now() - interval '100 days', expira_em = now() - interval '1 day' where codigo = '${c2.codigo}'`);
    expect((await abrir(c2.codigo, 'ip:exp2')).status).toBe('convite_expirado');
  });

  it('expirado sem reserva conta tentativa (como código errado); revogado bloqueia mesmo com reserva', async () => {
    const e = await novaEmpresa();
    const c = await gerar(e);
    await semGatilhos(`update public.agenda_kickoff_convites set criado_em = now() - interval '100 days', expira_em = now() - interval '1 day' where codigo = '${c.codigo}'`);
    for (let i = 0; i < 10; i++) expect((await abrir(c.codigo, 'ip:expirado')).status).toBe('convite_expirado');
    expect((await abrir(c.codigo, 'ip:expirado')).status).toBe('muitas_tentativas');

    const e2 = await novaEmpresa();
    const c2 = await gerar(e2);
    await agendar(c2.codigo, S.expira);
    await db.query("select public.agenda_kickoff_convite_revogar($1, 'Vazou', $2)", [e2, GESTOR]);
    expect((await abrir(c2.codigo, 'ip:rev')).status).toBe('convite_revogado');
    expect((await agendar(c2.codigo, S.expira, {}, 'ip:rev')).status).toBe('convite_revogado');
  });

  it('convite válido sem reserva não é "expirado"', async () => {
    const c = await gerar(await novaEmpresa());
    expect(await abrir(c.codigo)).toMatchObject({ status: 'ok', situacao: 'disponivel', expirado: false });
  });
});

describe('agendamento pelo link', () => {
  it('agenda pela regra da M2, liga a reserva ao convite e grava o histórico', async () => {
    const e = await novaEmpresa();
    const c = await gerar(e);
    const r = await agendar(c.codigo, S.outra, { nome: '  Maria  ', email: ' Maria@Cliente.com.br ', telefone: '(11) 98888-7777' });
    expect(r.status).toBe('ok');
    expect(r.reserva).toMatchObject({ participante: 'Maria', anfitriao: { nome: 'Gestor', foto: null } });
    const linha = await um<{ status: string; participante_email: string; convite_id: string; criado_por: string | null }>(
      'select status, participante_email, convite_id, criado_por from public.agenda_kickoff_reservas where tenant_id = $1',
      [e],
    );
    expect(linha).toMatchObject({ status: 'ativa', participante_email: 'maria@cliente.com.br', criado_por: null });
    expect(linha.convite_id).toBeTruthy();
    const h = await um<{ acao: string; motivo: string }>(
      'select h.acao, h.motivo from public.agenda_kickoff_reservas_historico h join public.agenda_kickoff_reservas r on r.id = h.reserva_id where r.tenant_id = $1',
      [e],
    );
    expect(h).toEqual({ acao: 'criada', motivo: 'Agendado pela empresa, pelo link do convite' });
    // A página passa a mostrar a reserva (recuperação), sem sessões.
    const p = await abrir(c.codigo);
    expect(p).toMatchObject({ situacao: 'reservada', reserva: { participante: 'Maria' }, sessoes: [] });
  });

  it('pedido repetido não duplica: mesma sessão devolve "ok" com a mesma reserva; outra sessão, "ja_inscrita"', async () => {
    const e = await novaEmpresa();
    const c = await gerar(e);
    await agendar(c.codigo, S.aberta);
    expect((await agendar(c.codigo, S.aberta)).status).toBe('ok');
    const outra = await agendar(c.codigo, S.outra);
    expect(outra.status).toBe('ja_inscrita');
    expect(outra.reserva).toBeTruthy();
    expect(Number((await um<{ n: number }>('select count(*)::int n from public.agenda_kickoff_reservas where tenant_id = $1', [e])).n)).toBe(1);
  });

  it('o convite só agenda a própria empresa (não há como pedir outra)', async () => {
    const a = await novaEmpresa();
    const b = await novaEmpresa();
    const ca = await gerar(a);
    await gerar(b);
    await agendar(ca.codigo, S.outra);
    const porEmpresa = (await db.query<{ tenant_id: string }>('select tenant_id from public.agenda_kickoff_reservas where tenant_id in ($1, $2)', [a, b])).rows;
    expect(porEmpresa.map((x) => x.tenant_id)).toEqual([a]);
  });

  it('empresa que concluiu: a página diz isso e o agendamento é recusado', async () => {
    const e = await novaEmpresa();
    const c = await gerar(e);
    await agendar(c.codigo, S.outra);
    const r = await um<{ id: string }>("select id from public.agenda_kickoff_reservas where tenant_id = $1 and status = 'ativa'", [e]);
    await semGatilhos(
      `update public.agenda_kickoff_reservas set status = 'concluida', presenca = 'presente', presenca_em = now(), presenca_origem = 'manual', concluida_em = now() where id = '${r.id}'`,
    );
    expect(await abrir(c.codigo)).toMatchObject({ status: 'ok', situacao: 'concluida', reserva: null, sessoes: [] });
    expect((await agendar(c.codigo, S.aberta)).status).toBe('concluida');
  });

  it('sessão lotada, bloqueada, passada, cancelada, inexistente ou que não é kickoff: recusadas', async () => {
    const x = await gerar(await novaEmpresa());
    const y = await gerar(await novaEmpresa());
    expect((await agendar(x.codigo, S.pequena)).status).toBe('ok');
    expect((await agendar(y.codigo, S.pequena)).status).toBe('sessao_lotada');
    for (const s of [S.bloqueada, S.passada, S.cancelada, S.comum, '2f000000-0000-4000-8000-000000000000', null]) {
      expect((await agendar(y.codigo, s)).status).toBe('sessao_indisponivel');
    }
  });

  it('participante validado pelo banco: e-mail obrigatório, nome e telefone', async () => {
    const c = await gerar(await novaEmpresa());
    expect(await agendar(c.codigo, S.aberta, { email: null })).toEqual({
      status: 'dados_invalidos',
      mensagem: 'Informe o e-mail do participante principal.',
    });
    expect((await agendar(c.codigo, S.aberta, { email: 'sem-arroba' })).mensagem).toBe('E-mail do participante inválido.');
    expect((await agendar(c.codigo, S.aberta, { nome: 'A' })).status).toBe('dados_invalidos');
    expect((await agendar(c.codigo, S.aberta, { telefone: '123' })).mensagem).toBe('Telefone/WhatsApp do participante inválido (8 a 15 dígitos).');
  });

  it('empresa que faltou agenda de novo pelo link, ligada à ausência', async () => {
    const e = await novaEmpresa();
    const c = await gerar(e);
    await agendar(c.codigo, S.outra);
    const r = await um<{ id: string }>("select id from public.agenda_kickoff_reservas where tenant_id = $1 and status = 'ativa'", [e]);
    await semGatilhos(`update public.agenda_kickoff_reservas set status = 'ausente', presenca = 'ausente', presenca_em = now(), presenca_origem = 'manual' where id = '${r.id}'`);
    expect((await abrir(c.codigo)).situacao).toBe('disponivel');
    expect((await agendar(c.codigo, S.aberta)).status).toBe('ok');
    const nova = await um<{ origem_reserva_id: string }>("select origem_reserva_id from public.agenda_kickoff_reservas where tenant_id = $1 and status = 'ativa'", [e]);
    expect(nova.origem_reserva_id).toBe(r.id);
  });
});

describe('limite de tentativas', () => {
  it('10 códigos errados da mesma origem bloqueiam a origem, inclusive para o código certo; outra origem segue', async () => {
    const c = await gerar(await novaEmpresa());
    for (let i = 0; i < 10; i++) expect((await abrir('zzzzzzzzzzzz', 'ip:atacante')).status).toBe('convite_invalido');
    expect((await abrir(c.codigo, 'ip:atacante')).status).toBe('muitas_tentativas');
    expect((await agendar(c.codigo, S.aberta, {}, 'ip:atacante')).status).toBe('muitas_tentativas');
    expect((await abrir(c.codigo, 'ip:outra')).status).toBe('ok');
    // Código certo não conta tentativa.
    for (let i = 0; i < 12; i++) expect((await abrir(c.codigo, 'ip:visitante')).status).toBe('ok');
  });

  it('o mesmo convite não martela a reserva: 10 pedidos em 15 minutos', async () => {
    const c = await gerar(await novaEmpresa());
    for (let i = 0; i < 10; i++) expect((await agendar(c.codigo, S.aberta, { email: null }, `ip:${i}`)).status).toBe('dados_invalidos');
    expect((await agendar(c.codigo, S.aberta, {}, 'ip:nova')).status).toBe('muitas_tentativas');
  });
});

describe('acesso', () => {
  it('anon e authenticated não leem convites nem chamam as funções; só o servidor (service_role)', async () => {
    const c = await gerar(await novaEmpresa());
    for (const papel of ['anon', 'authenticated']) {
      await db.exec(`set role ${papel}`);
      try {
        expect((await falha('select * from public.agenda_kickoff_convites')).code).toBe('42501');
        expect((await falha('select * from public.agenda_kickoff_limite_publico')).code).toBe('42501');
        expect((await falha('select public.agenda_kickoff_publico_convite($1, $2)', [c.codigo, 'ip:x'])).code).toBe('42501');
        expect((await falha('select public.agenda_kickoff_publico_agendar($1, $2, $3, $4, null, $5)', [c.codigo, S.aberta, 'Nome', 'a@b.com', 'ip:x'])).code).toBe(
          '42501',
        );
        expect((await falha('select public.agenda_kickoff_convite_gerar($1, null, $2)', [ORG, GESTOR])).code).toBe('42501');
      } finally {
        await db.exec('reset role');
      }
    }
    await db.exec('set role service_role');
    try {
      expect((await abrir(c.codigo, 'ip:servidor')).status).toBe('ok');
    } finally {
      await db.exec('reset role');
    }
  });

  it('reuniões comuns continuam sem mudança', async () => {
    await db.query(`update public.meetings set scheduled_start_at = scheduled_start_at + interval '1 hour', scheduled_end_at = scheduled_end_at + interval '1 hour' where id = $1`, [S.comum]);
    await db.query(`update public.meetings set status = 'canceled' where id = $1`, [S.comum]);
  });
});
