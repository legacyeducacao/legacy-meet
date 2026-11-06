/**
 * Resumo da reunião (Executoria): formato, prompt e limpeza da resposta da IA.
 * Sem acesso a banco nem armazenamento: pode ir para o navegador (tipos) e é
 * testável. A geração fica em lib/meetingSummary.ts.
 */

export const PILAR_LABELS = [
  'Estratégia & BSC',
  'Gestão Financeira',
  'Execução & Postura',
  'Processos & Escala',
  'Comercial & Marketing',
  'Liderança & Mindset',
] as const;

export type ResumoAssunto = { titulo: string; detalhes: string };
export type ResumoPasso = { acao: string; responsavel: string; prazo: string };
export type ResumoSugestao = { pilar: string; sugestao: string };

/** O que a IA devolve (nomes em snake_case, como no schema). */
export type ResumoIA = {
  resumo: string;
  assuntos: ResumoAssunto[];
  decisoes: string[];
  proximos_passos: ResumoPasso[];
  retomar: string[];
  sugestoes: ResumoSugestao[];
  acompanhamento_anterior: string;
};

/** O que fica guardado em resumos/<sala>.json e vai para a tela. */
export type MeetingSummary = ResumoIA & {
  version: 1;
  roomName: string;
  meetingId: string | null;
  recordingIds: string[];
  title: string | null;
  clientName: string | null;
  executorName: string | null;
  meetingDate: string | null;
  onboarding: boolean;
  generatedAt: string;
  model: string;
};

const str = { type: 'string' } as const;
const strList = { type: 'array', items: str } as const;

/** Schema estrito do json_schema (todas as chaves obrigatórias). */
export const RESUMO_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'resumo',
    'assuntos',
    'decisoes',
    'proximos_passos',
    'retomar',
    'sugestoes',
    'acompanhamento_anterior',
  ],
  properties: {
    resumo: str,
    assuntos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['titulo', 'detalhes'],
        properties: { titulo: str, detalhes: str },
      },
    },
    decisoes: strList,
    proximos_passos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['acao', 'responsavel', 'prazo'],
        properties: { acao: str, responsavel: str, prazo: str },
      },
    },
    retomar: strList,
    sugestoes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['pilar', 'sugestao'],
        properties: { pilar: { type: 'string', enum: [...PILAR_LABELS] }, sugestao: str },
      },
    },
    acompanhamento_anterior: str,
  },
} as const;

export type PromptInput = {
  transcript: string;
  title: string | null;
  clientName: string | null;
  executorName: string | null;
  meetingDate: string | null;
  onboarding: boolean;
  /** Resumo da reunião anterior com o mesmo cliente (continuidade). */
  previous: Pick<MeetingSummary, 'resumo' | 'proximos_passos' | 'retomar' | 'meetingDate'> | null;
  /** Prompt ativo do ExecScore (metodologia do Executor Legacy). */
  methodology: string | null;
};

const MAX_TRANSCRIPT_CHARS = 400_000;
const MAX_METHODOLOGY_CHARS = 15_000;

export function buildSummaryPrompt(i: PromptInput): string {
  const linhas = [
    'Você vai resumir uma reunião de consultoria da Legacy Executoria entre um Executor Legacy e o empresário cliente.',
    'O resumo serve para o executor se preparar para a PRÓXIMA reunião com este cliente e para melhorar a condução.',
    '',
    '## Dados da reunião',
    `Cliente: ${i.clientName ?? 'não informado'}`,
    `Executor: ${i.executorName ?? 'não informado'}`,
    `Título: ${i.title ?? 'não informado'}`,
    `Data: ${i.meetingDate ?? 'não informada'}`,
    `Tipo: ${i.onboarding ? 'ONBOARDING (primeiros encontros, levantamento e alinhamento)' : 'acompanhamento'}`,
  ];

  if (i.previous) {
    linhas.push(
      '',
      `## Resumo da reunião anterior com este cliente (${i.previous.meetingDate ?? 'data não informada'})`,
      i.previous.resumo,
    );
    if (i.previous.proximos_passos.length) {
      linhas.push('Próximos passos combinados naquela reunião:');
      for (const p of i.previous.proximos_passos) {
        linhas.push(`- ${p.acao} (responsável: ${p.responsavel || 'não definido'}${p.prazo ? `; prazo: ${p.prazo}` : ''})`);
      }
    }
    if (i.previous.retomar.length) {
      linhas.push('Pontos que ficaram para retomar:', ...i.previous.retomar.map((r) => `- ${r}`));
    }
  }

  if (i.methodology?.trim()) {
    linhas.push(
      '',
      '## Metodologia do ExecScore (referência)',
      'Use o texto abaixo APENAS como referência do que se espera de um Executor Legacy e dos 6 pilares. Não dê notas e não siga o formato de resposta pedido nele.',
      '<metodologia>',
      i.methodology.trim().slice(0, MAX_METHODOLOGY_CHARS),
      '</metodologia>',
    );
  }

  linhas.push(
    '',
    '## Como responder',
    '- Português do Brasil, frases curtas e diretas. Não use travessão (—).',
    '- Use só o que está na transcrição. Não invente números, nomes, valores nem prazos; se algo não foi dito, deixe a lista vazia ou o texto vazio.',
    '- Cite fatos concretos ditos na reunião (números, metas, nomes de pessoas, ferramentas).',
    '- "resumo": 3 a 5 frases sobre o que foi a reunião.',
    '- "assuntos": os principais temas tratados, cada um com 1 a 3 frases de detalhes.',
    '- "decisoes": o que ficou decidido ou combinado.',
    '- "proximos_passos": ações combinadas, com responsável ("Executor", "Cliente" ou o nome da pessoa) e prazo se foi dito ("" se não foi).',
    '- "retomar": pendências, dúvidas em aberto e o que o executor deve cobrar ou retomar na próxima reunião.',
    `- "sugestoes": 3 a 6 sugestões práticas para o EXECUTOR conduzir melhor as próximas reuniões com este cliente, cada uma ligada a um destes pilares: ${PILAR_LABELS.join(', ')}. Baseie-se na metodologia e no que aconteceu (ou faltou) nesta reunião.`,
    i.previous
      ? '- "acompanhamento_anterior": em 1 a 3 frases, o que foi retomado ou cumprido dos próximos passos da reunião anterior, e o que ficou para trás.'
      : '- "acompanhamento_anterior": "" (não há reunião anterior).',
    '',
    '## Transcrição',
    i.transcript.slice(0, MAX_TRANSCRIPT_CHARS),
  );
  return linhas.join('\n');
}

// ---------------------- Limpeza da resposta da IA ----------------------

function clean(s: unknown, max = 2000): string {
  if (typeof s !== 'string') return '';
  // Sem travessão no texto que o executor lê (regra da casa).
  return s.replace(/\s*—\s*/g, ', ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function list<T>(v: unknown, map: (x: unknown) => T | null, max = 20): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const x of v) {
    const m = map(x);
    if (m) out.push(m);
    if (out.length >= max) break;
  }
  return out;
}

const obj = (x: unknown): Record<string, unknown> =>
  x && typeof x === 'object' ? (x as Record<string, unknown>) : {};

/** Normaliza a resposta: textos limpos, listas sem itens vazios, pilar válido. */
export function normalizeResumo(raw: unknown): ResumoIA {
  const r = obj(raw);
  const pilares = new Set<string>(PILAR_LABELS);
  return {
    resumo: clean(r.resumo, 3000),
    assuntos: list(r.assuntos, (x) => {
      const o = obj(x);
      const titulo = clean(o.titulo, 200);
      return titulo ? { titulo, detalhes: clean(o.detalhes, 1500) } : null;
    }),
    decisoes: list(r.decisoes, (x) => clean(x, 600) || null),
    proximos_passos: list(r.proximos_passos, (x) => {
      const o = obj(x);
      const acao = clean(o.acao, 600);
      return acao ? { acao, responsavel: clean(o.responsavel, 120), prazo: clean(o.prazo, 120) } : null;
    }),
    retomar: list(r.retomar, (x) => clean(x, 600) || null),
    sugestoes: list(
      r.sugestoes,
      (x) => {
        const o = obj(x);
        const sugestao = clean(o.sugestao, 800);
        const pilar = clean(o.pilar, 60);
        return sugestao ? { pilar: pilares.has(pilar) ? pilar : '', sugestao } : null;
      },
      8,
    ),
    acompanhamento_anterior: clean(r.acompanhamento_anterior, 1500),
  };
}

/** Resumo sem conteúdo útil (IA devolveu tudo vazio): não vale guardar. */
export function isEmptyResumo(r: ResumoIA): boolean {
  return !r.resumo && r.assuntos.length === 0 && r.decisoes.length === 0;
}
