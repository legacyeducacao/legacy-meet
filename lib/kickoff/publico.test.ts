import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  anfitriaoComum,
  avisoDoAgendamento,
  dataPorExtenso,
  duracaoComum,
  duracaoPorExtenso,
  ehCodigoDeConvite,
  hojeEmSaoPaulo,
  iniciais,
  linkDaReuniao,
  linkDoAgendamento,
  minutosEntre,
  sessoesPorDia,
  type SessaoPublica,
} from './publico';
import {
  diaAoNavegar,
  gradeDoMes,
  intervaloDaSemana,
  limitesDoCalendario,
  podeNavegar,
  rotuloDoMes,
  seteDias,
  visaoInicial,
} from './publicoCalendario';
import { configuracaoDaOrigem, ipDoVisitante, origemDoVisitante } from './origem';
import { enderecoPublico, linkOficial } from './enderecoPublico';

const s = (data: string, inicio: string, fim = '10:00', anfitriao = 'Ana'): SessaoPublica => ({
  id: `${data}-${inicio}`,
  data,
  inicio,
  fim,
  starts_at: `${data}T${inicio}:00-03:00`,
  vagas: 5,
  anfitriao: { nome: anfitriao, foto: null },
});

describe('código e links', () => {
  it('só aceita 12 caracteres do alfabeto (sem 0/o, 1/l/i) em minúsculas', () => {
    expect(ehCodigoDeConvite('abcdefghjkmn')).toBe(true);
    expect(ehCodigoDeConvite('23456789abcd')).toBe(true);
    for (const ruim of ['abcdefghjkm', 'abcdefghjkmnp', 'abcdefghjkm0', 'abcdefghjkmo', 'abcdefghjkml', 'abcdefghjkmi', 'ABCDEFGHJKMN', 'abc def ghjk', '', null, 12]) {
      expect(ehCodigoDeConvite(ruim)).toBe(false);
    }
  });

  it('link de agendamento e futuro link da reunião usam o mesmo código, em rotas diferentes', () => {
    expect(linkDoAgendamento('https://meet.exemplo/', 'abcdefghjkmn')).toBe('https://meet.exemplo/impulsao/agendar/abcdefghjkmn');
    expect(linkDaReuniao('https://meet.exemplo', 'abcdefghjkmn')).toBe('https://meet.exemplo/impulsao/reuniao/abcdefghjkmn');
  });
});

describe('textos e datas da página', () => {
  it('avisos da confirmação', () => {
    expect(avisoDoAgendamento({ status: 'sessao_lotada' })).toBe('Este horário acabou de lotar. Escolha outro.');
    expect(avisoDoAgendamento({ status: 'dados_invalidos', mensagem: 'E-mail do participante inválido.' })).toBe('E-mail do participante inválido.');
    expect(avisoDoAgendamento({ status: 'ok' })).toBeNull();
  });

  it('datas sem fuso do navegador; hoje em Brasília', () => {
    expect(dataPorExtenso('2026-11-17')).toBe('Terça-feira, 17 de novembro');
    // 02:30 UTC de 13/11 ainda é 12/11 em Brasília.
    expect(hojeEmSaoPaulo(new Date('2026-11-13T02:30:00Z'))).toBe('2026-11-12');
  });

  it('duração, iniciais e anfitrião comum', () => {
    expect(minutosEntre('09:00', '10:30')).toBe(90);
    expect(duracaoPorExtenso(60)).toBe('1 hora');
    expect(duracaoPorExtenso(90)).toBe('1 h 30 min');
    expect(duracaoComum([s('2026-11-12', '09:00'), s('2026-11-13', '08:00', '09:00')])).toBe(60);
    expect(duracaoComum([s('2026-11-12', '09:00'), s('2026-11-13', '08:00', '10:00')])).toBeNull();
    expect(iniciais('Ana Paula Souza')).toBe('AS');
    expect(anfitriaoComum([s('2026-11-12', '09:00'), s('2026-11-13', '09:00')])?.nome).toBe('Ana');
    expect(anfitriaoComum([s('2026-11-12', '09:00'), s('2026-11-13', '09:00', '10:00', 'Bia')])).toBeNull();
  });

  it('sessões agrupadas por dia, em ordem', () => {
    const dias = sessoesPorDia([s('2026-11-19', '10:00', '11:00'), s('2026-11-12', '15:00', '16:00'), s('2026-11-12', '09:30')]);
    expect(dias.map((d) => d.data)).toEqual(['2026-11-12', '2026-11-19']);
    expect(dias[0].sessoes.map((x) => x.inicio)).toEqual(['09:30', '15:00']);
  });
});

describe('calendário (adaptado do CS)', () => {
  const HOJE = '2026-11-10';
  const DATAS = ['2026-11-12', '2026-11-19', '2026-12-03'];
  const LIMITES = limitesDoCalendario(DATAS, HOJE);

  it('visão inicial: mês na tela larga, dia no celular', () => {
    expect(visaoInicial(true)).toBe('mes');
    expect(visaoInicial(false)).toBe('dia');
  });

  it('grade do mês com células vazias fora do mês', () => {
    const nov = gradeDoMes('2026-11-17');
    expect(nov).toHaveLength(5);
    expect(nov[0]).toEqual(seteDias('2026-11-01'));
    expect(gradeDoMes('2026-12-03')[0].slice(0, 3)).toEqual([null, null, '2026-12-01']);
    expect(rotuloDoMes('2026-11-17')).toBe('Novembro de 2026');
    expect(intervaloDaSemana('2026-11-29')).toBe('29 de novembro a 5 de dezembro');
  });

  it('navegação limitada de hoje ao último dia com horário', () => {
    expect(podeNavegar('mes', '2026-11-12', -1, LIMITES)).toBe(false);
    expect(podeNavegar('mes', '2026-11-12', 1, LIMITES)).toBe(true);
    expect(podeNavegar('mes', '2026-12-03', 1, LIMITES)).toBe(false);
    expect(diaAoNavegar('mes', '2026-11-12', 1, DATAS, LIMITES)).toBe('2026-12-03');
    expect(diaAoNavegar('dia', '2026-11-12', 1, DATAS, LIMITES)).toBe('2026-11-13');
  });
});

describe('origem do visitante (limite de tentativas)', () => {
  const h = (o: Record<string, string>) => new Headers(o);
  const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres';

  it('padrão: cf-connecting-ip (preenchido pela Cloudflare); x-forwarded-for forjado é ignorado', () => {
    expect(ipDoVisitante(h({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4' }))).toBe('203.0.113.7');
    expect(ipDoVisitante(h({ 'x-forwarded-for': '1.2.3.4' }))).toBe('?'); // sem o cabeçalho da Cloudflare: chave comum
    expect(ipDoVisitante(h({ 'cf-connecting-ip': '<script>' }))).toBe('?');
    const env = { KICKOFF_ORIGEM_SECRET: SEGREDO };
    const a = origemDoVisitante(h({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '9.9.9.1' }), env);
    const b = origemDoVisitante(h({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '9.9.9.2' }), env);
    expect(a).toBe(b); // trocar o x-forwarded-for não muda a origem (não foge do limite)
  });

  it('modo x-forwarded-for: conta da DIREITA (o que o proxy confiável acrescentou), nunca o primeiro', () => {
    const xff = h({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7, 172.70.1.1' });
    expect(ipDoVisitante(xff, 'x-forwarded-for', 1)).toBe('172.70.1.1');
    expect(ipDoVisitante(xff, 'x-forwarded-for', 2)).toBe('203.0.113.7');
    expect(ipDoVisitante(h({ 'x-forwarded-for': '203.0.113.7' }), 'x-forwarded-for', 2)).toBe('?');
  });

  it('guarda só um HMAC do IP, com KICKOFF_ORIGEM_SECRET; nunca o IP', () => {
    const o = origemDoVisitante(h({ 'cf-connecting-ip': '203.0.113.7' }), { KICKOFF_ORIGEM_SECRET: SEGREDO });
    expect(o).toBe(`ip:${createHmac('sha256', SEGREDO).update('203.0.113.7').digest('hex').slice(0, 32)}`);
    expect(o).not.toContain('203');
    expect(origemDoVisitante(h({ 'cf-connecting-ip': '203.0.113.8' }), { KICKOFF_ORIGEM_SECRET: SEGREDO })).not.toBe(o);
  });

  it('produção exige KICKOFF_ORIGEM_SECRET (32+), sem usar outras chaves do servidor', () => {
    const semChave = { NODE_ENV: 'production', HOST_LINK_SECRET: 'x'.repeat(40), LIVEKIT_API_SECRET: 'y'.repeat(40) };
    expect(configuracaoDaOrigem(semChave)).toEqual({ ok: false, motivo: expect.stringMatching(/^KICKOFF_ORIGEM_SECRET não configurada/) });
    expect(() => origemDoVisitante(h({ 'cf-connecting-ip': '203.0.113.7' }), semChave)).toThrow(/KICKOFF_ORIGEM_SECRET/);
    expect(configuracaoDaOrigem({ NODE_ENV: 'production', KICKOFF_ORIGEM_SECRET: 'curta' })).toMatchObject({ ok: false });
    expect(configuracaoDaOrigem({ NODE_ENV: 'production', KICKOFF_ORIGEM_SECRET: SEGREDO })).toMatchObject({ ok: true, fonte: 'cf-connecting-ip' });
    expect(configuracaoDaOrigem({ KICKOFF_IP_CABECALHO: 'x-real-ip', KICKOFF_ORIGEM_SECRET: SEGREDO })).toMatchObject({ ok: false });
    // Fora de produção, sem chave: sha256 simples (desenvolvimento e testes).
    expect(origemDoVisitante(h({ 'cf-connecting-ip': '203.0.113.7' }), { NODE_ENV: 'development' })).toMatch(/^ip:[0-9a-f]{32}$/);
  });
});

describe('endereço oficial dos links (KICKOFF_PUBLIC_BASE_URL)', () => {
  it('sem a variável ou com valor impróprio para cliente: erro claro, sem link', () => {
    expect(enderecoPublico({})).toEqual({ ok: false, motivo: expect.stringMatching(/^KICKOFF_PUBLIC_BASE_URL não configurada/) });
    for (const ruim of [
      'meet.legacy.com.br',
      'http://agenda.exemplo.com.br',
      'https://localhost:3000',
      'https://app.localhost',
      'https://127.0.0.1',
      'https://192.168.0.10',
      'https://10.0.0.5',
      'https://[::1]',
      'https://servidor.local',
      'https://usuario:senha@agenda.exemplo.com.br',
      'https://agenda.exemplo.com.br/?x=1',
      'https://agenda.exemplo.com.br/#topo',
    ]) {
      expect(enderecoPublico({ KICKOFF_PUBLIC_BASE_URL: ruim }).ok).toBe(false);
    }
    expect(linkOficial('abcdefghjkmn', {})).toBeNull();
  });

  it('com o endereço oficial, o link não depende do navegador', () => {
    expect(enderecoPublico({ KICKOFF_PUBLIC_BASE_URL: ' https://agenda.exemplo.com.br/ ' })).toEqual({ ok: true, base: 'https://agenda.exemplo.com.br' });
    expect(linkOficial('abcdefghjkmn', { KICKOFF_PUBLIC_BASE_URL: 'https://agenda.exemplo.com.br' })).toBe(
      'https://agenda.exemplo.com.br/impulsao/agendar/abcdefghjkmn',
    );
    expect(linkOficial('abcdefghjkmn', { KICKOFF_PUBLIC_BASE_URL: 'https://exemplo.com.br/legacy/' })).toBe(
      'https://exemplo.com.br/legacy/impulsao/agendar/abcdefghjkmn',
    );
  });
});
