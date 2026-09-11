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
- Use exatamente um dos nomes da lista de participantes, ou "desconhecido" se não houver evidência.
- Um mesmo participante NÃO pode corresponder a dois rótulos.
- "confidence" entre 0 e 1: use valores baixos quando for suposição. Na dúvida, "desconhecido".
- NÃO invente nomes fora da lista.

Transcrição (início):
${lines}

Responda APENAS com JSON no formato:
{"mapping": [{"label": "A", "name": "<nome da lista ou desconhecido>", "confidence": 0.0}]}`;
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
            confidence: { type: 'number' },
          },
          required: ['label', 'name', 'confidence'],
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
export function validateMapping(
  entries: MappingEntry[],
  labels: string[],
  participants: string[],
  minConfidence: number,
): SpeakerMap {
  const byNorm = new Map(participants.map((p) => [norm(p), p]));
  const best = new Map<string, { label: string; confidence: number }>();
  for (const e of entries ?? []) {
    const label = String(e?.label ?? '').trim();
    const name = byNorm.get(norm(String(e?.name ?? '')));
    const confidence = Number(e?.confidence ?? 0);
    if (!labels.includes(label) || !name || !(confidence >= minConfidence)) continue;
    const cur = best.get(name);
    if (!cur || confidence > cur.confidence) best.set(name, { label, confidence });
  }
  const map = genericMap(labels);
  for (const [name, { label }] of best) map[label] = name;
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
    return { map: validateMapping(parsed.mapping, labels, participants, opts.minConfidence), source: 'llm' };
  } catch {
    return { map: genericMap(labels), source: 'fallback' };
  }
}
