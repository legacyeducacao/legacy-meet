import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Rotas PÚBLICAS do agendamento (M3). O banco é simulado: aqui se testa o que o
// servidor manda para as funções do banco e o que devolve ao visitante. As regras
// (vaga, convite, limite de tentativas) estão testadas no banco real em
// lib/kickoff/convites.test.ts e reservasConcorrencia.test.ts.
const state = vi.hoisted(() => ({
  chamadas: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  resposta: null as unknown,
  erro: null as null | { code: string; message: string },
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.chamadas.push({ fn, args });
      return { data: state.erro ? null : state.resposta, error: state.erro };
    },
  }),
}));

import { GET } from './[codigo]/route';
import { POST } from './[codigo]/agendar/route';

const CODIGO = 'abcdefghjkmn';
const FOTO = 'https://abcdefgh.supabase.co/storage/v1/object/public/avatars/bia.jpg';
const SESSAO = '22222222-2222-4222-8222-222222222222';
const params = (codigo: string) => ({ params: Promise.resolve({ codigo }) });
const get = (codigo: string, ip = '203.0.113.7', extra: Record<string, string> = {}) =>
  GET(new NextRequest(`https://meet.example/api/impulsao/convites/${codigo}`, { headers: { 'cf-connecting-ip': ip, ...extra } }), params(codigo));
const post = (codigo: string, body: unknown, ip = '203.0.113.7') =>
  POST(
    new NextRequest(`https://meet.example/api/impulsao/convites/${codigo}/agendar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
      body: JSON.stringify(body),
    }),
    params(codigo),
  );

beforeEach(() => {
  state.chamadas = [];
  state.resposta = null;
  state.erro = null;
  process.env.KICKOFF_ORIGEM_SECRET = 'segredo-de-teste-com-mais-de-32-caracteres';
  vi.unstubAllEnvs();
});

describe('GET /api/impulsao/convites/[codigo] (público)', () => {
  it('código fora do formato: "convite_invalido" sem ir ao banco', async () => {
    for (const c of ['curto', 'abcdefghjkm0', '../../etc', 'abcdefghjkmnp']) {
      const res = await get(c);
      expect(await res.json()).toEqual({ status: 'convite_invalido' });
    }
    expect(state.chamadas).toEqual([]);
  });

  it('código em maiúsculas ou com espaços é normalizado; a origem vai em hash, nunca o IP', async () => {
    state.resposta = { status: 'convite_revogado' };
    await get(' ABCDEFGHJKMN ');
    expect(state.chamadas).toHaveLength(1);
    expect(state.chamadas[0].fn).toBe('agenda_kickoff_publico_convite');
    expect(state.chamadas[0].args.p_codigo).toBe(CODIGO);
    expect(String(state.chamadas[0].args.p_origem)).toMatch(/^ip:[0-9a-f]{32}$/);
    expect(JSON.stringify(state.chamadas[0].args)).not.toContain('203.0.113.7');
  });

  it('devolve só o contrato público (nada de ids da empresa, e-mails ou campos extras do banco)', async () => {
    state.resposta = {
      status: 'ok',
      tenant_id: '11111111-1111-4111-8111-111111111111',
      empresa: { nome: 'Padaria', email: 'dono@padaria.com.br', cnpj: '00.000.000/0001-00' },
      situacao: 'disponivel',
      expirado: false,
      reserva: null,
      sessoes: [
        { id: SESSAO, data: '2026-12-01', inicio: '14:00', fim: '15:00', starts_at: '2026-12-01T17:00:00Z', vagas: 3, anfitriao: { nome: 'Ana', foto: 'javascript:x', email: 'ana@legacy.com' }, tenant_id: 'x' },
        { id: '33333333-3333-4333-8333-333333333333', data: '2026-12-03', inicio: '09:00', fim: '10:00', starts_at: 'y', vagas: 1, anfitriao: { nome: 'Bia', foto: FOTO } },
        { id: 'nao-e-uuid', data: '2026-12-02' },
      ],
    };
    const res = await get(CODIGO);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j).toEqual({
      status: 'ok',
      empresa: { nome: 'Padaria' },
      situacao: 'disponivel',
      expirado: false,
      reserva: null,
      sessoes: [
        { id: SESSAO, data: '2026-12-01', inicio: '14:00', fim: '15:00', starts_at: '2026-12-01T17:00:00Z', vagas: 3, anfitriao: { nome: 'Ana', foto: null } },
        { id: '33333333-3333-4333-8333-333333333333', data: '2026-12-03', inicio: '09:00', fim: '10:00', starts_at: 'y', vagas: 1, anfitriao: { nome: 'Bia', foto: FOTO } },
      ],
    });
    expect(JSON.stringify(j)).not.toMatch(/@|tenant|cnpj/);
  });

  it('cabeçalhos: sem cache, sem indexação, sem referrer', async () => {
    state.resposta = { status: 'convite_invalido' };
    const res = await get(CODIGO);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('convite expirado com reserva: a página recebe a reserva e "expirado", sem sessões', async () => {
    state.resposta = {
      status: 'ok',
      empresa: { nome: 'Padaria' },
      situacao: 'reservada',
      expirado: true,
      reserva: { data: '2026-12-01', inicio: '14:00', fim: '15:00', starts_at: 'x', participante: 'Maria', anfitriao: null },
      sessoes: [],
    };
    expect(await (await get(CODIGO)).json()).toMatchObject({ status: 'ok', situacao: 'reservada', expirado: true, reserva: { participante: 'Maria' } });
  });

  it('a origem vem da Cloudflare: trocar x-forwarded-for não muda a chave do limite', async () => {
    state.resposta = { status: 'convite_invalido' };
    await get(CODIGO, '203.0.113.7', { 'x-forwarded-for': '1.1.1.1' });
    await get(CODIGO, '203.0.113.7', { 'x-forwarded-for': '2.2.2.2' });
    expect(state.chamadas[0].args.p_origem).toBe(state.chamadas[1].args.p_origem);
    await get(CODIGO, '198.51.100.9');
    expect(state.chamadas[2].args.p_origem).not.toBe(state.chamadas[0].args.p_origem);
  });

  it('em produção sem KICKOFF_ORIGEM_SECRET: rotas públicas fechadas (503 genérico), sem ir ao banco', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    delete process.env.KICKOFF_ORIGEM_SECRET;
    process.env.HOST_LINK_SECRET = 'x'.repeat(40); // não serve de reserva
    const erro = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const g = await get(CODIGO);
    const p = await post(CODIGO, { sessaoId: SESSAO, nome: 'Maria', email: 'm@x.com' });
    expect(g.status).toBe(503);
    expect(p.status).toBe(503);
    expect(JSON.stringify(await g.json())).not.toMatch(/KICKOFF|SECRET/);
    expect(state.chamadas).toEqual([]);
    erro.mockRestore();
    delete process.env.HOST_LINK_SECRET;
  });

  it('falha do banco: 503 com mensagem genérica, sem detalhe interno', async () => {
    state.erro = { code: 'XX000', message: 'relation "agenda_kickoff_convites" does not exist' };
    const res = await get(CODIGO);
    expect(res.status).toBe(503);
    const j = await res.json();
    expect(j.status).toBe('erro');
    expect(JSON.stringify(j)).not.toMatch(/relation|agenda_kickoff|XX000/);
  });
});

describe('POST /api/impulsao/convites/[codigo]/agendar (público)', () => {
  it('a empresa nunca vem do pedido: tenant no corpo é ignorado', async () => {
    state.resposta = { status: 'ok', reserva: { data: '2026-12-01', inicio: '14:00', fim: '15:00', starts_at: 'x', participante: 'Maria', anfitriao: null } };
    const res = await post(CODIGO, {
      sessaoId: SESSAO,
      nome: 'Maria',
      email: 'maria@cliente.com.br',
      telefone: null,
      tenantId: '99999999-9999-4999-8999-999999999999',
      tenant_id: '99999999-9999-4999-8999-999999999999',
      p_tenant_id: 'x',
    });
    expect(await res.json()).toMatchObject({ status: 'ok', reserva: { participante: 'Maria' } });
    // Depois de agendar, o servidor consulta o acesso à reunião (Zoom E2), também só pelo código.
    expect(state.chamadas.map((c) => c.fn)).toEqual(['agenda_kickoff_publico_agendar', 'agenda_kickoff_zoom_reserva_do_convite']);
    expect(Object.keys(state.chamadas[0].args).sort()).toEqual(['p_codigo', 'p_email', 'p_meeting_id', 'p_nome', 'p_origem', 'p_telefone']);
    expect(Object.keys(state.chamadas[1].args).sort()).toEqual(['p_codigo', 'p_contar', 'p_origem']);
    expect(JSON.stringify(state.chamadas)).not.toContain('99999999');
  });

  it('sessão que não é UUID nem chega ao banco', async () => {
    expect(await (await post(CODIGO, { sessaoId: '1 or 1=1', nome: 'M', email: 'm@x.com' })).json()).toEqual({ status: 'sessao_indisponivel' });
    expect(await (await post('ruim', { sessaoId: SESSAO })).json()).toEqual({ status: 'convite_invalido' });
    expect(state.chamadas).toEqual([]);
  });

  it('repassa as recusas do banco no formato público', async () => {
    for (const status of ['sessao_lotada', 'sessao_indisponivel', 'concluida', 'muitas_tentativas', 'convite_revogado', 'convite_expirado']) {
      state.resposta = { status, tenant_id: 'x' };
      expect(await (await post(CODIGO, { sessaoId: SESSAO, nome: 'Maria', email: 'm@x.com' })).json()).toEqual({ status });
    }
    state.resposta = { status: 'dados_invalidos', mensagem: 'Informe o e-mail do participante principal.' };
    expect(await (await post(CODIGO, { sessaoId: SESSAO, nome: 'Maria' })).json()).toEqual({
      status: 'dados_invalidos',
      mensagem: 'Informe o e-mail do participante principal.',
    });
    // Status desconhecido do banco não vaza: vira falha genérica.
    state.resposta = { status: 'algo_interno', detalhe: 'x' };
    expect((await post(CODIGO, { sessaoId: SESSAO, nome: 'Maria', email: 'm@x.com' })).status).toBe(503);
  });
});
