import { describe, expect, it } from 'vitest';
import { ZoomApiError, type ZoomMeeting } from '@/lib/zoom/api';
import { avaliarSala, credenciaisDoZoom, explicarFalha, lerEntradaDaSala, resumoDaSala } from './zoomSala';

const AGORA = new Date('2026-11-13T12:00:00Z');
const ID = '81234567890';
const dias = (n: number) => new Date(AGORA.getTime() + n * 86_400_000).toISOString();

/** Sala adequada: recorrente com horário fixo, inscrição obrigatória e automática, uma vez para todas. */
const salaBoa = (over: Partial<ZoomMeeting> = {}, settings: ZoomMeeting['settings'] = {}): ZoomMeeting => ({
  id: 81234567890,
  topic: 'Kickoff Impulsão',
  type: 8,
  timezone: 'America/Sao_Paulo',
  duration: 60,
  recurrence: { type: 2, repeat_interval: 1, end_times: 20 },
  occurrences: [
    { occurrence_id: '1', start_time: dias(-7), status: 'available' },
    { occurrence_id: '2', start_time: dias(7), status: 'available' },
    { occurrence_id: '3', start_time: dias(14), status: 'deleted' },
    { occurrence_id: '4', start_time: dias(90), status: 'available' },
  ],
  start_url: 'https://zoom.us/s/81234567890?zak=SEGREDO',
  join_url: 'https://zoom.us/j/81234567890?pwd=SEGREDO',
  password: 'senha123',
  settings: { approval_type: 0, registration_type: 1, waiting_room: false, meeting_authentication: false, join_before_host: false, ...settings },
  ...over,
});
const codigos = (a: { problemas: Array<{ codigo: string }> }) => a.problemas.map((p) => p.codigo);

describe('credenciais', () => {
  it('sem as três variáveis: lista o que falta (só nomes)', () => {
    expect(credenciaisDoZoom({})).toEqual({ ok: false, faltando: ['ZOOM_ACCOUNT_ID', 'ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET'] });
    expect(credenciaisDoZoom({ ZOOM_ACCOUNT_ID: 'a', ZOOM_CLIENT_ID: ' ', ZOOM_CLIENT_SECRET: 's' })).toEqual({ ok: false, faltando: ['ZOOM_CLIENT_ID'] });
    expect(credenciaisDoZoom({ ZOOM_ACCOUNT_ID: ' a ', ZOOM_CLIENT_ID: 'c', ZOOM_CLIENT_SECRET: 's' })).toEqual({
      ok: true,
      credenciais: { accountId: 'a', clientId: 'c', clientSecret: 's' },
    });
  });
});

describe('entrada da sala', () => {
  it('aceita Meeting ID com espaços, pontos ou hífens e links de entrada', () => {
    for (const t of ['81234567890', '812 3456 7890', '812-3456-7890', '812.3456.7890', 'https://us02web.zoom.us/j/81234567890?pwd=abc', 'https://zoom.us/w/81234567890', 'https://zoom.us/wc/join/81234567890']) {
      expect(lerEntradaDaSala(t)).toEqual({ ok: true, meetingId: ID });
    }
  });
  it('recusa o resto com mensagem clara (link de inscrição explicado)', () => {
    expect(lerEntradaDaSala('https://us02web.zoom.us/meeting/register/tZAbc')).toMatchObject({ ok: false, mensagem: expect.stringMatching(/link de inscrição/) });
    for (const t of ['', '   ', null, 1234, '12345678', '1234567890123', 'abc', 'https://evil.com/j/81234567890', '81234567890; drop table']) {
      expect(lerEntradaDaSala(t).ok).toBe(false);
    }
  });
});

describe('avaliação da sala', () => {
  it('sala adequada: aprovada, sem avisos', () => {
    const a = avaliarSala(ID, salaBoa(), AGORA);
    expect(a).toMatchObject({ ok: true, topico: 'Kickoff Impulsão', problemas: [], avisos: [] });
  });

  it('tipo incorreto: instantânea, única e recorrente sem horário fixo', () => {
    expect(codigos(avaliarSala(ID, salaBoa({ type: 1 }), AGORA))).toEqual(['reuniao_instantanea']);
    expect(codigos(avaliarSala(ID, salaBoa({ type: 2 }), AGORA))).toEqual(['reuniao_unica']);
    expect(codigos(avaliarSala(ID, salaBoa({ type: 3 }), AGORA))).toEqual(['sem_horario_fixo']);
    expect(codigos(avaliarSala(ID, salaBoa({ type: 4 }), AGORA))).toEqual(['tipo_desconhecido']);
  });

  it('inscrição desligada, aprovação manual e inscrição por ocorrência', () => {
    expect(codigos(avaliarSala(ID, salaBoa({}, { approval_type: 2 }), AGORA))).toEqual(['inscricao_desligada']);
    expect(codigos(avaliarSala(ID, salaBoa({}, { approval_type: undefined }), AGORA))).toEqual(['inscricao_desligada']);
    expect(codigos(avaliarSala(ID, salaBoa({}, { approval_type: 1 }), AGORA))).toEqual(['aprovacao_manual']);
    expect(codigos(avaliarSala(ID, salaBoa({}, { registration_type: 2 }), AGORA))).toEqual(['inscricao_por_ocorrencia']);
    expect(codigos(avaliarSala(ID, salaBoa({}, { registration_type: 3 }), AGORA))).toEqual(['inscricao_por_ocorrencia']);
    // Regra do Plan: sem o campo, conta como "uma vez para todas".
    expect(avaliarSala(ID, salaBoa({}, { registration_type: undefined }), AGORA).ok).toBe(true);
  });

  it('login obrigatório bloqueia; sala de teste do CS nunca passa', () => {
    expect(codigos(avaliarSala(ID, salaBoa({}, { meeting_authentication: true }), AGORA))).toEqual(['autenticacao_obrigatoria']);
    expect(codigos(avaliarSala('88672328525', salaBoa(), AGORA))).toEqual(['sala_de_teste']);
  });

  it('avisos não bloqueiam: sem ocorrências futuras, última perto, sala de espera, entrada antes do anfitrião', () => {
    const semFuturas = avaliarSala(ID, salaBoa({ occurrences: [{ start_time: dias(-1), status: 'available' }] }), AGORA);
    expect(semFuturas.ok).toBe(true);
    expect(semFuturas.avisos.map((x) => x.codigo)).toEqual(['sem_ocorrencias_futuras']);
    const perto = avaliarSala(ID, salaBoa({ occurrences: [{ start_time: dias(20), status: 'available' }] }), AGORA);
    expect(perto.avisos.map((x) => x.codigo)).toEqual(['ultima_ocorrencia_proxima']);
    const opcoes = avaliarSala(ID, salaBoa({}, { waiting_room: true, join_before_host: true }), AGORA);
    expect(opcoes).toMatchObject({ ok: true });
    expect(opcoes.avisos.map((x) => x.codigo)).toEqual(['sala_de_espera', 'entrada_antes_do_anfitriao']);
  });

  it('cada problema traz como corrigir', () => {
    for (const p of avaliarSala(ID, salaBoa({ type: 2 }, { approval_type: 1, meeting_authentication: true }), AGORA).problemas) {
      expect(p.titulo.length).toBeGreaterThan(10);
      expect(p.orientacao.length).toBeGreaterThan(10);
    }
  });

  it('resumo: lista fechada; nunca link do anfitrião, link de entrada ou senha', () => {
    const r = resumoDaSala(salaBoa(), AGORA);
    expect(r).toEqual({
      tipo: 8,
      recorrencia: { tipo: 2, intervalo: 1, fimEm: null, fimApos: 20 },
      aprovacao: 0,
      inscricao: 1,
      fuso: 'America/Sao_Paulo',
      duracaoMin: 60,
      ocorrenciasFuturas: 2, // passada e apagada ficam de fora
      proxima: dias(7),
      ultima: dias(90),
      salaDeEspera: false,
      autenticacao: false,
      entradaAntesDoAnfitriao: false,
    });
    expect(JSON.stringify(avaliarSala(ID, salaBoa(), AGORA))).not.toMatch(/SEGREDO|senha123|zak|pwd/);
  });
});

describe('falhas do Zoom', () => {
  it('cada falha vira mensagem para a equipe, sem texto do Zoom', () => {
    expect(explicarFalha(new ZoomApiError(404, 3001, 'x'))).toMatchObject({ tipo: 'nao_encontrada', temporaria: false });
    expect(explicarFalha(new ZoomApiError(400, 3001, 'x'))).toMatchObject({ tipo: 'nao_encontrada' });
    expect(explicarFalha(new ZoomApiError(400, null, 'x', 'oauth'))).toMatchObject({ tipo: 'credenciais', temporaria: false });
    expect(explicarFalha(new ZoomApiError(401, null, 'x', 'oauth'))).toMatchObject({ tipo: 'credenciais' });
    expect(explicarFalha(new ZoomApiError(403, 4711, 'x'))).toMatchObject({ tipo: 'sem_permissao', temporaria: false });
    expect(explicarFalha(new ZoomApiError(429, null, 'x', 'api', 12))).toMatchObject({ tipo: 'limite', temporaria: true, mensagem: expect.stringMatching(/12 s/) });
    expect(explicarFalha(new ZoomApiError(0, null, 'x'))).toMatchObject({ tipo: 'indisponivel', temporaria: true });
    expect(explicarFalha(new ZoomApiError(502, null, 'x'))).toMatchObject({ tipo: 'indisponivel', temporaria: true });
    expect(explicarFalha(new ZoomApiError(400, 300, 'x'))).toMatchObject({ tipo: 'outra', mensagem: expect.stringMatching(/300/) });
    expect(explicarFalha(new Error('boom'))).toMatchObject({ tipo: 'outra', temporaria: true });
  });
});
