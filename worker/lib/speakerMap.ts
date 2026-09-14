/**
 * Mapeamento dos rótulos genéricos da diarização (A, B, C…) para os nomes
 * reais dos participantes. A AssemblyAI separa as vozes; quem sabe "qual voz
 * é quem" é o conteúdo da conversa (apresentações, vocativos, papel de cada
 * um) — por isso o LLM (Gemini via OpenRouter) recebe a lista de
 * participantes e os primeiros minutos da transcrição e devolve o mapeamento
 * em JSON. Conservador de propósito: sem confiança, o rótulo genérico fica.
 */
import { norm } from './participants';
import type { Utterance } from './text';
import { genericSpeakerName } from './utterances';

export interface MappingEntry {
  label: string;
  name: string;
  /** Nome EVIDENTE no texto quando o rótulo não corresponde a ninguém da lista. */
  inferredName?: string;
  confidence: number;
}

export type SpeakerMap = Record<string, string>;

export interface SampleOptions {
  maxSeconds: number;
  maxUtterances: number;
  maxChars: number;
}

export const DEFAULT_SAMPLE: SampleOptions = { maxSeconds: 600, maxUtterances: 80, maxChars: 200 };

// Primeiros minutos da reunião: é onde as pessoas se apresentam e se chamam
// pelo nome. Limita quantidade e tamanho para o prompt ficar barato.
export function sampleForMapping(utts: Utterance[], opts: SampleOptions = DEFAULT_SAMPLE): Utterance[] {
  return utts
    .filter((u) => u.start <= opts.maxSeconds)
    .slice(0, opts.maxUtterances)
    .map((u) => ({
      ...u,
      text: u.text.length > opts.maxChars ? `${u.text.slice(0, opts.maxChars)}…` : u.text,
    }));
}

export function buildSpeakerMapPrompt(participants: string[], sample: Utterance[]): string {
  const lines = sample.map((u) => `[${u.speaker}] ${u.text}`).join('\n');
  return `Você recebe o início da transcrição de uma reunião empresarial em português do Brasil.
As vozes foram separadas automaticamente e receberam rótulos genéricos (A, B, C...).

Participantes conhecidos da reunião: ${participants.join(', ')}.

Sua tarefa: dizer qual participante corresponde a cada rótulo, usando APENAS evidências do texto
(quem se apresenta, como os outros chamam a pessoa, papel na conversa). Regras:
- ATENÇÃO a vocativos: quem CUMPRIMENTA ou chama alguém pelo nome NÃO é essa pessoa.
  Ex.: a voz que diz "Bom dia, Pedro!" NÃO é Pedro; a voz que diz "a Sofia tá aí também" NÃO é Sofia.
- Quem se apresenta ("eu sou X", "aqui é o X", "meu nome é X") É essa pessoa.
- Uma pessoa raramente fala o próprio nome na terceira pessoa; nomes ditos por uma voz
  normalmente identificam OUTRAS vozes.
- Use exatamente um dos nomes da lista de participantes, ou "desconhecido" se não houver evidência.
- Um mesmo participante NÃO pode corresponder a dois rótulos.
- "confidence" entre 0 e 1: use valores baixos quando for suposição. Na dúvida, "desconhecido".
- Em "name", NÃO invente nomes fora da lista.
- "inferredName": quando "name" for "desconhecido" mas o nome REAL da pessoa ficar
  evidente no texto (ela se apresenta ou é chamada pelo nome), escreva esse nome
  EXATAMENTE como aparece no texto. Sem evidência literal no texto, deixe "".

Transcrição (início):
${lines}

Responda APENAS com JSON no formato:
{"mapping": [{"label": "A", "name": "<nome da lista ou desconhecido>", "inferredName": "<nome evidente no texto ou vazio>", "confidence": 0.0}]}`;
}

export function buildSpeakerMapSchema(participants: string[]) {
  return {
    type: 'object',
    properties: {
      mapping: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            name: { type: 'string', enum: [...participants, 'desconhecido'] },
            inferredName: { type: 'string' },
            confidence: { type: 'number' },
          },
          required: ['label', 'name', 'inferredName', 'confidence'],
          additionalProperties: false,
        },
      },
    },
    required: ['mapping'],
    additionalProperties: false,
  };
}

const genericMap = (labels: string[]): SpeakerMap =>
  Object.fromEntries(labels.map((l) => [l, genericSpeakerName(l)]));

// Valida a resposta do LLM: nome precisa estar na lista (comparação sem
// caixa/acento), confiança acima do mínimo e cada nome em no máximo um rótulo
// (fica o de maior confiança). O que não passa mantém o rótulo genérico.
// Texto normalizado para busca de nomes: sem acentos/caixa e pontuação vira espaço.
const searchable = (s: string) => ` ${norm(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;

export function validateMapping(
  entries: MappingEntry[],
  labels: string[],
  participants: string[],
  minConfidence: number,
  /** Texto da amostra enviada ao LLM — valida nomes inferidos (sem ele, são ignorados). */
  sampleText = '',
): SpeakerMap {
  const byNorm = new Map(participants.map((p) => [norm(p), p]));
  // Primeiro uma entrada por rótulo (maior confiança); só então um rótulo por
  // nome. Sem isso, um rótulo repetido na resposta podia receber o nome de
  // menor confiança.
  const perLabel = new Map<string, { name: string; confidence: number }>();
  for (const e of entries ?? []) {
    const label = String(e?.label ?? '').trim();
    const name = byNorm.get(norm(String(e?.name ?? '')));
    const confidence = Number(e?.confidence ?? 0);
    if (!labels.includes(label) || !name || !(confidence >= minConfidence)) continue;
    const cur = perLabel.get(label);
    if (!cur || confidence > cur.confidence) perLabel.set(label, { name, confidence });
  }
  const best = new Map<string, { label: string; confidence: number }>();
  for (const [label, { name, confidence }] of perLabel) {
    const cur = best.get(name);
    if (!cur || confidence > cur.confidence) best.set(name, { label, confidence });
  }
  const map = genericMap(labels);
  for (const [name, { label }] of best) map[label] = name;

  // Nomes INFERIDOS do texto: para rótulos que sobraram sem participante (lista
  // incompleta — ex.: convidado não registrado), aceita o nome que o LLM
  // apontou SOMENTE se ele aparece literalmente na amostra (trava contra
  // invenção), com confiança mínima e sem duplicar um nome já usado.
  if (sampleText) {
    const haystack = searchable(sampleText);
    const used = new Set(
      Object.values(map)
        .filter((n) => !n.startsWith('Falante '))
        .map((n) => norm(n)),
    );
    for (const e of entries ?? []) {
      const label = String(e?.label ?? '').trim();
      const inferred = String(e?.inferredName ?? '').trim();
      const confidence = Number(e?.confidence ?? 0);
      if (!labels.includes(label) || !inferred || !(confidence >= minConfidence)) continue;
      if (!map[label]?.startsWith('Falante ')) continue; // rótulo já tem nome
      if (!haystack.includes(` ${searchable(inferred).trim()} `)) continue;
      // Se o inferido é um participante da lista, usa a grafia da lista.
      const display = byNorm.get(norm(inferred)) ?? inferred;
      const key = norm(display);
      if (used.has(key)) continue;
      map[label] = display;
      used.add(key);
    }
  }
  return map;
}

export function applySpeakerMap(utts: Utterance[], map: SpeakerMap): Utterance[] {
  return utts.map((u) => ({ ...u, speaker: map[u.speaker] ?? genericSpeakerName(u.speaker) }));
}

export interface LlmRequest {
  prompt: string;
  schema: unknown;
}

export interface MapSpeakersOptions {
  /** Chama o LLM e devolve o conteúdo (string JSON). */
  llm: (req: LlmRequest) => Promise<string>;
  minConfidence: number;
  sample?: SampleOptions;
}

export interface MapSpeakersResult {
  map: SpeakerMap;
  source: 'none' | 'direct' | 'llm' | 'fallback';
}

function parseJsonLoose(content: string): { mapping?: MappingEntry[] } | null {
  const s = content.trim();
  const candidates = [s];
  const block = s.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (block) candidates.push(block[1]);
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(s.slice(first, last + 1));
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // tenta o próximo
    }
  }
  return null;
}

export async function mapSpeakers(
  utts: Utterance[],
  participants: string[],
  opts: MapSpeakersOptions,
): Promise<MapSpeakersResult> {
  const labels = [...new Set(utts.map((u) => u.speaker))];
  if (!labels.length || !participants.length) return { map: genericMap(labels), source: 'none' };
  if (labels.length === 1 && participants.length === 1) {
    return { map: { [labels[0]]: participants[0] }, source: 'direct' };
  }
  const sample = sampleForMapping(utts, opts.sample ?? DEFAULT_SAMPLE);
  try {
    const content = await opts.llm({
      prompt: buildSpeakerMapPrompt(participants, sample),
      schema: buildSpeakerMapSchema(participants),
    });
    const parsed = parseJsonLoose(content);
    if (!parsed || !Array.isArray(parsed.mapping)) return { map: genericMap(labels), source: 'fallback' };
    const sampleText = sample.map((u) => u.text).join(' ');
    return {
      map: validateMapping(parsed.mapping, labels, participants, opts.minConfidence, sampleText),
      source: 'llm',
    };
  } catch {
    return { map: genericMap(labels), source: 'fallback' };
  }
}
