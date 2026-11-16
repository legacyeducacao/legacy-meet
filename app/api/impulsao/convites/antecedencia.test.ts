import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Antecedência mínima do agendamento pela empresa (15 minutos) e atalho da equipe
// para a sala Zoom. Banco simulado; nenhuma chamada externa.
const state = vi.hoisted(() => ({
  user: null as unknown,
  rpcs: [] as string[],
  resposta: null as unknown,
  inicioDaSessao: null as string | null,
  erroAoLerSessao: false,
  sala: null as string | null,
}));

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getCurrentUser: async () => state.user,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: () => ({
    rpc: async (fn: string) => {
      state.rpcs.push(fn);
      return { data: state.resposta, error: null };
    },
    from: (tabela: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq']) q[m] = () => q;
      q.maybeSingle = async () => {
        if (tabela === 'meetings') {
          return state.erroAoLerSessao ? { data: null, error: { code: 'XX000', message: 'x' } } : { data: state.inicioDaSessao ? { scheduled_start_at: state.inicioDaSessao } : null, error: null };
        }
        if (tabela === 'agenda_kickoff_zoom_salas') return { data: state.sala ? { zoom_meeting_id: state.sala } : null, error: null };
        return { data: null, error: null };
      };
      return q;
    },
  }),
}));

import { GET as abrir } from './[codigo]/route';
import { POST as agendar } from './[codigo]/agendar/route';
import { GET as entrarComoEquipe } from '@/app/api/agenda/kickoffs/zoom/entrar/route';
import { ANTECEDENCIA_MINIMA_MIN, dentroDaAntecedencia } from '@/lib/kickoff/publico';

const CODIGO = 'abcdefghjkmn';
const SESSAO = '22222222-2222-4222-8222-222222222222';
const params = { params: Promise.resolve({ codigo: CODIGO }) };
const cabecalhos = { 'cf-connecting-ip': '203.0.113.7', 'content-type': 'application/json' };
const daqui = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
const sessao = (id: string, emMin: number) => ({ id, data: '2026-12-01', inicio: '14:00', fim: '15:00', starts_at: daqui(emMin), vagas: 3, anfitriao: null });
const postar = () =>
  agendar(new NextRequest(`https://meet.example/api/impulsao/convites/${CODIGO}/agendar`, { method: 'POST', headers: cabecalhos, body: JSON.stringify({ sessaoId: SESSAO, nome: 'Maria', email: 'maria@x.com.br' }) }), params);

beforeEach(() => {
  state.user = null;
  state.rpcs = [];
  state.resposta = null;
  state.inicioDaSessao = null;
  state.erroAoLerSessao = false;
  state.sala = null;
  process.env.KICKOFF_ORIGEM_SECRET = 'segredo-de-teste-com-mais-de-32-caracteres';
});

describe('antecedência mínima do agendamento pela empresa', () => {
  it('a regra: 15 minutos antes do início', () => {
    const agora = Date.parse('2026-12-01T17:00:00Z');
    expect(ANTECEDENCIA_MINIMA_MIN).toBe(15);
    expect(dentroDaAntecedencia('2026-12-01T17:15:00Z', agora)).toBe(true);
    expect(dentroDaAntecedencia('2026-12-01T17:14:59Z', agora)).toBe(false);
    expect(dentroDaAntecedencia('2026-12-01T16:59:00Z', agora)).toBe(false);
    // Data ilegível não esconde a sessão: quem decide é o banco.
    expect(dentroDaAntecedencia('sem data', agora)).toBe(true);
  });

  it('a página não oferece sessão que começa em menos de 15 minutos (nem a que já começou)', async () => {
    const [A, B, C, D] = ['1', '2', '3', '4'].map((n) => `${n.repeat(8)}-0000-4000-8000-000000000000`);
    state.resposta = { status: 'ok', empresa: { nome: 'Padaria' }, situacao: 'disponivel', expirado: false, reserva: null, sessoes: [sessao(A, -1), sessao(B, 14), sessao(C, 16), sessao(D, 60 * 24)] };
    const j = await (await abrir(new NextRequest(`https://meet.example/api/impulsao/convites/${CODIGO}`, { headers: cabecalhos }), params)).json();
    expect(j.sessoes.map((s: { id: string }) => s.id)).toEqual([C, D]);
  });

  it('confirmar uma sessão que começa em menos de 15 minutos: "sessao_indisponivel", sem chegar à função de reserva', async () => {
    for (const emMin of [14, 1, -2]) {
      state.rpcs = [];
      state.inicioDaSessao = daqui(emMin);
      expect(await (await postar()).json()).toEqual({ status: 'sessao_indisponivel' });
      expect(state.rpcs).toEqual([]);
    }
  });

  it('com 15 minutos ou mais, ou sem conseguir ler o horário, a reserva segue para o banco', async () => {
    state.resposta = { status: 'ok', reserva: { data: '2026-12-01', inicio: '14:00', fim: '15:00', starts_at: 'x', participante: 'Maria', anfitriao: null } };
    state.inicioDaSessao = daqui(16);
    expect((await (await postar()).json()).status).toBe('ok');
    expect(state.rpcs[0]).toBe('agenda_kickoff_publico_agendar');
    // Sessão que não existe ou falha de leitura: quem responde é o banco.
    for (const preparar of [() => (state.inicioDaSessao = null), () => (state.erroAoLerSessao = true)]) {
      state.rpcs = [];
      preparar();
      await postar();
      expect(state.rpcs[0]).toBe('agenda_kickoff_publico_agendar');
    }
  });
});

describe('GET /api/agenda/kickoffs/zoom/entrar (atalho da equipe para a sala)', () => {
  const equipe = (over: Record<string, unknown>) => ({ id: 'u', email: 'u@legacyeducacaocorp.com.br', name: 'U', role: 'EXECUTOR', isStaff: true, isAdmin: false, sector: 'executoria', ...over });
  const abrirSala = () => entrarComoEquipe(new NextRequest('https://meet.example/api/agenda/kickoffs/zoom/entrar'));

  it('sem login, equipe sem a permissão e cliente do Plan não recebem o endereço da sala', async () => {
    state.sala = '81234567890';
    for (const user of [null, equipe({}), equipe({ isStaff: false, role: 'CLIENT' })]) {
      state.user = user;
      const res = await abrirSala();
      expect([401, 403]).toContain(res.status);
      expect(res.headers.get('location')).toBeNull();
    }
  });

  it('quem gerencia kickoffs (ou admin) é encaminhado à sala ativa no Zoom, sem chamar a API do Zoom', async () => {
    const zoom = vi.fn();
    vi.stubGlobal('fetch', zoom);
    state.sala = '81234567890';
    for (const user of [equipe({ capacidades: ['kickoff_impulsao.manage'] }), equipe({ isAdmin: true })]) {
      state.user = user;
      const res = await abrirSala();
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('https://zoom.us/j/81234567890');
      expect(res.headers.get('cache-control')).toContain('no-store');
    }
    expect(zoom).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('sem sala ativa (ou com um valor estranho no banco): vai para a seção Kickoffs, que explica', async () => {
    state.user = equipe({ isAdmin: true });
    for (const sala of [null, 'https://exemplo.com/roubo', '123']) {
      state.sala = sala;
      const res = await abrirSala();
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('https://meet.example/agenda/kickoffs');
    }
  });
});
