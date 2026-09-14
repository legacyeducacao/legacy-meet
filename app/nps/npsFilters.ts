/**
 * Lógica pura de filtro e agregação da tela de NPS.
 * Mantida fora do componente para ser testável sem React.
 */

export interface NpsResponse {
  id: string;
  meetingId: string | null;
  title: string | null;
  clientName: string | null;
  createdAt: string;
  score: number;
  comment: string | null;
  respondentName: string | null;
  hostName: string | null;
  hostId: string | null;
}

export type NpsCategory = 'promotor' | 'neutro' | 'detrator';

export interface NpsFilters {
  company: string;
  host: string;
  dateFrom: string;
  dateTo: string;
  /** Notas selecionadas (0–10). Vazio = todas. */
  scores: number[];
  onlyWithComment: boolean;
  search: string;
}

export type DatePreset = '7d' | '30d' | 'month' | 'quarter';

export function emptyNpsFilters(): NpsFilters {
  return {
    company: '',
    host: '',
    dateFrom: '',
    dateTo: '',
    scores: [],
    onlyWithComment: false,
    search: '',
  };
}

export function categoryOf(score: number): NpsCategory {
  if (score >= 9) return 'promotor';
  if (score >= 7) return 'neutro';
  return 'detrator';
}

export function categoryScores(cat: NpsCategory): number[] {
  if (cat === 'detrator') return [0, 1, 2, 3, 4, 5, 6];
  if (cat === 'neutro') return [7, 8];
  return [9, 10];
}

export function toggleScore(selected: number[], score: number): number[] {
  return selected.includes(score) ? selected.filter((s) => s !== score) : [...selected, score];
}

/** Seleciona a faixa inteira; se ela já estiver toda selecionada, remove a faixa. */
export function toggleCategory(selected: number[], cat: NpsCategory): number[] {
  const range = categoryScores(cat);
  const allIn = range.every((s) => selected.includes(s));
  if (allIn) return selected.filter((s) => !range.includes(s));
  return [...selected, ...range.filter((s) => !selected.includes(s))];
}

export function isCategorySelected(selected: number[], cat: NpsCategory): boolean {
  return categoryScores(cat).every((s) => selected.includes(s));
}

function normalize(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function applyNpsFilters(responses: NpsResponse[], f: NpsFilters): NpsResponse[] {
  const search = normalize(f.search.trim());
  return responses.filter((r) => {
    if (f.company && r.clientName !== f.company) return false;
    if (f.host && r.hostName !== f.host) return false;
    const day = r.createdAt.slice(0, 10);
    if (f.dateFrom && day < f.dateFrom) return false;
    if (f.dateTo && day > f.dateTo) return false;
    if (f.scores.length > 0 && !f.scores.includes(r.score)) return false;
    if (f.onlyWithComment && !(r.comment ?? '').trim()) return false;
    if (search) {
      const hay = normalize(
        [r.comment, r.respondentName, r.title, r.clientName].filter(Boolean).join(' '),
      );
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function presetRange(preset: DatePreset, today: Date = new Date()): { from: string; to: string } {
  const to = toDateStr(today);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (preset === '7d') start.setDate(start.getDate() - 6);
  else if (preset === '30d') start.setDate(start.getDate() - 29);
  else if (preset === 'month') start.setDate(1);
  else {
    start.setMonth(Math.floor(start.getMonth() / 3) * 3, 1);
  }
  return { from: toDateStr(start), to };
}

export interface TrendPoint {
  month: string; // YYYY-MM
  label: string; // ex.: set/26
  nps: number;
  media: number;
  total: number;
}

const MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function trendByMonth(responses: NpsResponse[]): TrendPoint[] {
  const buckets = new Map<string, number[]>();
  for (const r of responses) {
    const month = r.createdAt.slice(0, 7);
    const arr = buckets.get(month);
    if (arr) arr.push(r.score);
    else buckets.set(month, [r.score]);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, scores]) => {
      const n = scores.length;
      const promotores = scores.filter((s) => s >= 9).length;
      const detratores = scores.filter((s) => s <= 6).length;
      const [y, m] = month.split('-');
      return {
        month,
        label: `${MONTHS_PT[Number(m) - 1]}/${y.slice(2)}`,
        nps: Math.round(((promotores - detratores) / n) * 100),
        media: Math.round((scores.reduce((a, s) => a + s, 0) / n) * 10) / 10,
        total: n,
      };
    });
}
