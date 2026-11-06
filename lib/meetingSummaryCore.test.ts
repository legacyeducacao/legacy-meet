import { describe, expect, it } from 'vitest';
import { buildSummaryPrompt, isEmptyResumo, normalizeResumo, PILAR_LABELS, RESUMO_SCHEMA } from './meetingSummaryCore';
import { PILARES } from './execscore';

const input = {
  transcript: 'Executor: vamos revisar o DRE.\nCliente: faturamos 120 mil em outubro.',
  title: 'Acompanhamento',
  clientName: 'Padaria Bom Sabor',
  executorName: 'Mariza',
  meetingDate: '06/11/2026',
  onboarding: false,
  previous: null,
  methodology: null,
};

describe('PILAR_LABELS', () => {
  it('são os mesmos 6 pilares do ExecScore', () => {
    expect([...PILAR_LABELS]).toEqual(PILARES.map((p) => p.label));
  });
});

describe('RESUMO_SCHEMA', () => {
  it('exige todas as chaves (json_schema estrito)', () => {
    expect([...RESUMO_SCHEMA.required].sort()).toEqual(Object.keys(RESUMO_SCHEMA.properties).sort());
  });
});

describe('buildSummaryPrompt', () => {
  it('traz cliente, executor, transcrição e a regra de não inventar', () => {
    const p = buildSummaryPrompt(input);
    expect(p).toContain('Cliente: Padaria Bom Sabor');
    expect(p).toContain('Executor: Mariza');
    expect(p).toContain('faturamos 120 mil');
    expect(p).toMatch(/Não invente/);
    expect(p).toContain('"acompanhamento_anterior": ""');
  });

  it('marca onboarding', () => {
    expect(buildSummaryPrompt({ ...input, onboarding: true })).toContain('ONBOARDING');
  });

  it('inclui os próximos passos da reunião anterior para continuidade', () => {
    const p = buildSummaryPrompt({
      ...input,
      previous: {
        resumo: 'Revisamos o caixa.',
        meetingDate: '30/10/2026',
        proximos_passos: [{ acao: 'Montar o fluxo de caixa', responsavel: 'Cliente', prazo: 'sexta' }],
        retomar: ['Preço do pão francês'],
      },
    });
    expect(p).toContain('reunião anterior com este cliente (30/10/2026)');
    expect(p).toContain('- Montar o fluxo de caixa (responsável: Cliente; prazo: sexta)');
    expect(p).toContain('- Preço do pão francês');
  });

  it('inclui a metodologia só como referência', () => {
    const p = buildSummaryPrompt({ ...input, methodology: 'Você é o Gestor dos Executores Legacy.' });
    expect(p).toContain('<metodologia>');
    expect(p).toMatch(/Não dê notas/);
  });
});

describe('normalizeResumo', () => {
  it('limpa textos, troca travessão, descarta itens vazios e pilar inválido', () => {
    const r = normalizeResumo({
      resumo: '  Reunião  boa — com metas  ',
      assuntos: [{ titulo: 'DRE', detalhes: 'Faturamento de 120 mil' }, { titulo: ' ', detalhes: 'x' }],
      decisoes: ['Subir preço', '', 3],
      proximos_passos: [{ acao: 'Enviar planilha', responsavel: 'Executor', prazo: '' }, { acao: '' }],
      retomar: ['Estoque'],
      sugestoes: [
        { pilar: 'Gestão Financeira', sugestao: 'Pedir o DRE antes' },
        { pilar: 'Inventado', sugestao: 'Outra' },
        { pilar: 'Gestão Financeira', sugestao: '' },
      ],
      acompanhamento_anterior: '',
    });
    expect(r.resumo).toBe('Reunião boa, com metas');
    expect(r.assuntos).toEqual([{ titulo: 'DRE', detalhes: 'Faturamento de 120 mil' }]);
    expect(r.decisoes).toEqual(['Subir preço']);
    expect(r.proximos_passos).toEqual([{ acao: 'Enviar planilha', responsavel: 'Executor', prazo: '' }]);
    expect(r.sugestoes).toEqual([
      { pilar: 'Gestão Financeira', sugestao: 'Pedir o DRE antes' },
      { pilar: '', sugestao: 'Outra' },
    ]);
  });

  it('resposta quebrada vira resumo vazio', () => {
    const r = normalizeResumo('não é objeto');
    expect(isEmptyResumo(r)).toBe(true);
    expect(r.assuntos).toEqual([]);
  });
});
