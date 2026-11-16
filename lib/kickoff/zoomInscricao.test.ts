import { describe, expect, it } from 'vitest';
import { ZoomApiError } from '@/lib/zoom/api';
import { codigoDaEmpresa, codigoNoNome, descreverFalhaDaInscricao, ehLinkDoZoom, identidadeNoZoom, inscricaoAindaServe, valeProcurarPeloEmail, ZOOM_NOME_MAX } from './zoomInscricao';
import { ACESSO_ABRE_ANTES_MIN, ACESSO_FECHA_DEPOIS_MIN, estadoPublico, janelaDoAcesso, limitesDoAcesso, podeGerarAcesso } from './zoomAcessoRegras';

// Regras puras do acesso Zoom (E2): identidade no Zoom (regras do Plan, como no CS),
// falhas, e quando o endereço da reunião encaminha.
const TENANT = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

describe('código da empresa no Zoom', () => {
  it('são os 8 primeiros hexadecimais de client_tenants.id, em maiúsculas (a regra do Plan)', () => {
    expect(codigoDaEmpresa(TENANT)).toBe('1A2B3C4D');
    expect(codigoDaEmpresa(TENANT.toUpperCase())).toBe('1A2B3C4D');
    for (const ruim of ['', 'nao-e-uuid', '1a2b3c4d', `${TENANT} or 1=1`]) expect(() => codigoDaEmpresa(ruim)).toThrow('tenant_id inválido');
  });

  it('é reconhecido de volta no nome exibido (o que a E3 vai usar)', () => {
    expect(codigoNoNome('Maria Silva | Padaria #1A2B3C4D')).toBe('1A2B3C4D');
    expect(codigoNoNome('maria | padaria #1a2b3c4d')).toBe('1A2B3C4D');
    expect(codigoNoNome('Maria Silva')).toBeNull();
    expect(codigoNoNome('Maria #1A2B3C4D5')).toBeNull();
    expect(codigoNoNome(null)).toBeNull();
  });
});

describe('identidade no Zoom: "Nome | Empresa #CÓDIGO"', () => {
  const id = (participante: string | null, empresa: string | null, email = 'maria@padaria.com.br') => identidadeNoZoom({ participante, email, empresa, tenantId: TENANT });

  it('monta o nome, o sobrenome com a empresa e o código, e a organização', () => {
    expect(id('Maria Silva', 'Padaria Pão Bom')).toEqual({
      first_name: 'Maria',
      last_name: 'Silva | Padaria Pão Bom #1A2B3C4D',
      org: 'Padaria Pão Bom',
      codigo: '1A2B3C4D',
      nomeExibido: 'Maria Silva | Padaria Pão Bom #1A2B3C4D',
    });
    expect(id('Maria', 'Padaria').last_name).toBe('| Padaria #1A2B3C4D');
  });

  it('sem nome usa o começo do e-mail; sem empresa usa "Empresa"; separadores do formato são retirados', () => {
    expect(id(null, null).nomeExibido).toBe('maria | Empresa #1A2B3C4D');
    expect(id('  ', '')).toMatchObject({ first_name: 'maria', org: 'Empresa' });
    const sujo = id('Maria #9F9F9F9F | Admin', 'Padaria <b>#DEADBEEF</b> [x]');
    expect(codigoNoNome(sujo.nomeExibido)).toBe('1A2B3C4D');
    expect(sujo.nomeExibido.match(/#/g)).toHaveLength(1);
    expect(sujo.nomeExibido.match(/\|/g)).toHaveLength(1);
  });

  it('respeita o limite de 64 caracteres do Zoom sem nunca cortar o código', () => {
    const longo = id('Maria Aparecida dos Santos Oliveira de Albuquerque Cavalcanti', 'Indústria e Comércio de Alimentos e Bebidas Pão Bom do Brasil Ltda');
    expect(longo.first_name.length).toBeLessThanOrEqual(ZOOM_NOME_MAX);
    expect(longo.last_name.length).toBeLessThanOrEqual(ZOOM_NOME_MAX);
    expect(longo.org.length).toBeLessThanOrEqual(ZOOM_NOME_MAX);
    expect(longo.last_name.endsWith(' #1A2B3C4D')).toBe(true);
    expect(longo.last_name).toContain('| Indústria e Comércio');
  });
});

describe('falhas e conferências', () => {
  it('só inscrição aprovada (ou sem status) ainda serve', () => {
    expect(inscricaoAindaServe(undefined)).toBe(true);
    expect(inscricaoAindaServe('approved')).toBe(true);
    for (const s of ['pending', 'denied', 'cancelled']) expect(inscricaoAindaServe(s)).toBe(false);
  });

  it('procura pelo e-mail só quando a resposta ao inscrever é ambígua (4xx comum)', () => {
    for (const s of [400, 409, 422]) expect(valeProcurarPeloEmail(new ZoomApiError(s, 3027, 'x'))).toBe(true);
    for (const s of [0, 401, 403, 404, 429, 500, 503]) expect(valeProcurarPeloEmail(new ZoomApiError(s, null, 'x'))).toBe(false);
    expect(valeProcurarPeloEmail(new Error('x'))).toBe(false);
  });

  it('mensagens para a equipe: nunca o texto do Zoom, token ou segredo', () => {
    const casos: Array<[unknown, RegExp]> = [
      [new ZoomApiError(401, null, 'token tok-123 recusado', 'oauth'), /credenciais/],
      [new ZoomApiError(404, 3001, 'Meeting does not exist'), /não encontrada/],
      [new ZoomApiError(0, null, 'rede'), /falar com o Zoom/],
      [new ZoomApiError(429, null, 'x'), /limitou/],
      [new ZoomApiError(503, null, 'x'), /instabilidade/],
      [new ZoomApiError(403, 4711, 'does not contain scopes'), /sem permissão/],
      [new ZoomApiError(400, 300, 'Validation Failed: e-mail maria@x.com'), /código 300/],
      [new Error('segredo'), /Não foi possível gerar/],
    ];
    for (const [erro, esperado] of casos) {
      const m = descreverFalhaDaInscricao(erro);
      expect(m).toMatch(esperado);
      expect(m).not.toMatch(/tok-123|does not|Validation|maria@|segredo/);
    }
  });

  it('só endereços https de zoom.us servem de destino do encaminhamento', () => {
    for (const ok of ['https://zoom.us/w/1?tk=a', 'https://us02web.zoom.us/w/81234567890?tk=abc', 'https://legacy.zoom.us/j/1']) expect(ehLinkDoZoom(ok)).toBe(true);
    for (const ruim of [
      'http://zoom.us/w/1',
      'https://zoom.us.exemplo.com/w/1',
      'https://exemplo.com/zoom.us',
      'https://naozoom.us/w/1',
      'https://user:senha@zoom.us/w/1',
      'javascript:alert(1)',
      '//zoom.us/w/1',
      '',
      null,
      undefined,
      42,
    ]) {
      expect(ehLinkDoZoom(ruim)).toBe(false);
    }
  });
});

describe('estados para as telas', () => {
  it('a empresa nunca vê erro, conflito ou problema de sala: "preparando" ou "indisponivel"', () => {
    expect(estadoPublico('pronto')).toBe('pronto');
    for (const e of ['preparando', 'erro', 'pendente']) expect(estadoPublico(e)).toBe('preparando');
    expect(estadoPublico('pendente', true)).toBe('indisponivel');
    for (const e of ['conflito', 'sem_sala', 'inativo', 'sala_com_problemas', 'reserva_inativa', 'qualquer']) expect(estadoPublico(e)).toBe('indisponivel');
  });

  it('a equipe pode pedir o acesso quando falta, falhou, deu conflito ou falta o endereço da Legacy', () => {
    for (const estado of ['pendente', 'erro', 'conflito'] as const) expect(podeGerarAcesso({ estado, endereco: null })).toBe(true);
    expect(podeGerarAcesso({ estado: 'pronto', endereco: null })).toBe(true);
    expect(podeGerarAcesso({ estado: 'pronto', endereco: 'https://x/impulsao/reuniao/abc' })).toBe(false);
    for (const estado of ['preparando', 'sem_sala', 'inativo'] as const) expect(podeGerarAcesso({ estado, endereco: null })).toBe(false);
  });
});

describe('quando o endereço da reunião encaminha ao Zoom', () => {
  const INICIO = '2026-12-01T17:00:00.000Z';
  const FIM = '2026-12-01T18:00:00.000Z';
  const l = limitesDoAcesso(INICIO, FIM);
  const em = (iso: string) => Date.parse(iso);

  it('abre 30 minutos antes do início e fecha 30 minutos depois do fim da sessão da reserva', () => {
    expect(ACESSO_ABRE_ANTES_MIN).toBe(30);
    expect(ACESSO_FECHA_DEPOIS_MIN).toBe(30);
    expect(l).toEqual({ abreEm: '2026-12-01T16:30:00.000Z', fechaEm: '2026-12-01T18:30:00.000Z' });
    expect(janelaDoAcesso(l, em('2026-12-01T16:29:59Z'))).toBe('antes');
    expect(janelaDoAcesso(l, em('2026-11-20T17:00:00Z'))).toBe('antes');
    expect(janelaDoAcesso(l, em('2026-12-01T16:30:00Z'))).toBe('aberta');
    expect(janelaDoAcesso(l, em('2026-12-01T17:45:00Z'))).toBe('aberta');
    expect(janelaDoAcesso(l, em('2026-12-01T18:30:00Z'))).toBe('aberta');
    expect(janelaDoAcesso(l, em('2026-12-01T18:30:01Z'))).toBe('encerrada');
    // Outra ocorrência da mesma sala recorrente, uma semana depois: fechado.
    expect(janelaDoAcesso(l, em('2026-12-08T17:00:00Z'))).toBe('encerrada');
  });

  it('datas inválidas nunca abrem', () => {
    expect(limitesDoAcesso('x', FIM)).toBeNull();
    expect(janelaDoAcesso(null)).toBe('encerrada');
    // Fim antes do início (dado estranho): a janela ainda se limita ao início.
    expect(limitesDoAcesso(INICIO, '2026-12-01T10:00:00.000Z')).toEqual({ abreEm: '2026-12-01T16:30:00.000Z', fechaEm: '2026-12-01T17:30:00.000Z' });
  });
});
