import { describe, expect, it, vi } from 'vitest';
import {
  applySpeakerMap,
  buildSpeakerMapPrompt,
  mapSpeakers,
  sampleForMapping,
  validateMapping,
  type LlmRequest,
} from './speakerMap';
import type { Utterance } from './text';

const utts: Utterance[] = [
  { speaker: 'A', text: 'Bom dia, aqui é a Ana da Legacy.', start: 0, end: 3 },
  { speaker: 'B', text: 'Oi Ana, Bruno falando.', start: 3.5, end: 5 },
  { speaker: 'A', text: 'Vamos ao DRE.', start: 6, end: 8 },
  { speaker: 'C', text: 'Posso entrar?', start: 700, end: 701 },
];
const participants = ['Ana Souza', 'Bruno Lima'];

describe('sampleForMapping', () => {
  it('pega só os primeiros minutos, limita a quantidade e trunca o texto', () => {
    const s = sampleForMapping(utts, { maxSeconds: 600, maxUtterances: 2, maxChars: 10 });
    expect(s).toHaveLength(2);
    expect(s[0].text).toBe('Bom dia, a…');
  });
});

describe('validateMapping', () => {
  it('aceita nome da lista com confiança suficiente', () => {
    expect(
      validateMapping(
        [
          { label: 'A', name: 'Ana Souza', confidence: 0.95 },
          { label: 'B', name: 'Bruno Lima', confidence: 0.8 },
        ],
        ['A', 'B'],
        participants,
        0.7,
      ),
    ).toEqual({ A: 'Ana Souza', B: 'Bruno Lima' });
  });

  it('confiança baixa, nome fora da lista ou "desconhecido" mantêm rótulo genérico', () => {
    expect(
      validateMapping(
        [
          { label: 'A', name: 'Ana Souza', confidence: 0.4 },
          { label: 'B', name: 'Carlos', confidence: 0.99 },
          { label: 'C', name: 'desconhecido', confidence: 1 },
        ],
        ['A', 'B', 'C'],
        participants,
        0.7,
      ),
    ).toEqual({ A: 'Falante A', B: 'Falante B', C: 'Falante C' });
  });

  it('mesmo nome em dois rótulos: fica só o de maior confiança', () => {
    expect(
      validateMapping(
        [
          { label: 'A', name: 'Ana Souza', confidence: 0.9 },
          { label: 'B', name: 'Ana Souza', confidence: 0.95 },
        ],
        ['A', 'B'],
        participants,
        0.7,
      ),
    ).toEqual({ A: 'Falante A', B: 'Ana Souza' });
  });

  it('rótulo repetido na resposta: vale a entrada de maior confiança', () => {
    expect(
      validateMapping(
        [
          { label: 'A', name: 'Ana Souza', confidence: 0.9 },
          { label: 'A', name: 'Bruno Lima', confidence: 0.8 },
        ],
        ['A', 'B'],
        participants,
        0.7,
      ),
    ).toEqual({ A: 'Ana Souza', B: 'Falante B' });
  });

  it('casa o nome ignorando caixa/acento e rótulos ausentes ficam genéricos', () => {
    expect(
      validateMapping([{ label: 'A', name: 'ana souza', confidence: 0.9 }], ['A', 'B'], participants, 0.7),
    ).toEqual({ A: 'Ana Souza', B: 'Falante B' });
  });
});

describe('applySpeakerMap', () => {
  it('substitui os rótulos pelas entradas do mapa', () => {
    const out = applySpeakerMap(utts.slice(0, 2), { A: 'Ana Souza', B: 'Falante B' });
    expect(out.map((u) => u.speaker)).toEqual(['Ana Souza', 'Falante B']);
  });
});

describe('mapSpeakers', () => {
  it('sem participantes: rótulos genéricos sem chamar o LLM', async () => {
    const llm = vi.fn();
    const r = await mapSpeakers(utts, [], { llm, minConfidence: 0.7 });
    expect(r.map).toEqual({ A: 'Falante A', B: 'Falante B', C: 'Falante C' });
    expect(r.source).toBe('none');
    expect(llm).not.toHaveBeenCalled();
  });

  it('um participante e um rótulo: mapeia direto', async () => {
    const llm = vi.fn();
    const r = await mapSpeakers(utts.filter((u) => u.speaker === 'A'), ['Ana Souza'], { llm, minConfidence: 0.7 });
    expect(r.map).toEqual({ A: 'Ana Souza' });
    expect(r.source).toBe('direct');
    expect(llm).not.toHaveBeenCalled();
  });

  it('caso geral: usa o LLM e valida a resposta', async () => {
    const llm = vi.fn(async (_req: LlmRequest) =>
      JSON.stringify({
        mapping: [
          { label: 'A', name: 'Ana Souza', confidence: 0.9 },
          { label: 'B', name: 'Bruno Lima', confidence: 0.85 },
          { label: 'C', name: 'desconhecido', confidence: 0.2 },
        ],
      }),
    );
    const r = await mapSpeakers(utts, participants, { llm, minConfidence: 0.7 });
    expect(r.map).toEqual({ A: 'Ana Souza', B: 'Bruno Lima', C: 'Falante C' });
    expect(r.source).toBe('llm');
    const prompt = llm.mock.calls[0][0];
    expect(prompt.prompt).toContain('Ana Souza');
    expect(prompt.prompt).toContain('[A]');
  });

  it('LLM com erro ou JSON inválido: rótulos genéricos (não bloqueia)', async () => {
    const bad = vi.fn(async () => 'isso não é json');
    const r1 = await mapSpeakers(utts, participants, { llm: bad, minConfidence: 0.7 });
    expect(r1.map).toEqual({ A: 'Falante A', B: 'Falante B', C: 'Falante C' });
    expect(r1.source).toBe('fallback');
    const boom = vi.fn(async () => {
      throw new Error('timeout');
    });
    const r2 = await mapSpeakers(utts, participants, { llm: boom, minConfidence: 0.7 });
    expect(r2.source).toBe('fallback');
  });
});

describe('buildSpeakerMapPrompt', () => {
  it('pede mapeamento em JSON com os participantes e as falas iniciais', () => {
    const p = buildSpeakerMapPrompt(participants, utts.slice(0, 2));
    expect(p).toContain('Ana Souza, Bruno Lima');
    expect(p).toContain('[A] Bom dia');
    expect(p).toMatch(/desconhecido/);
  });
});
