# Agenda Recorrente + No-show — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agendamento em massa de reuniões recorrentes (diária/semanal/quinzenal/mensal, término por data ou nº de vezes) e marcação de no-show, conforme a spec `docs/superpowers/specs/2026-07-31-agenda-recorrencia-noshow-design.md`.

**Architecture:** Ocorrências materializadas na criação (cada uma com sala própria), ligadas por `recurrence_parent_id` (coluna já existente). Datas calculadas por função pura testada. Eventos do Google Agenda em segundo plano via `after()`. No-show é valor novo do enum `meeting_status`.

**Tech Stack:** Next.js 15 App Router, Supabase (Postgres via MCP para migração), vitest.

## Global Constraints

- pt-BR em UI/comentários/commits (`feat(agenda): ...`).
- Teto de recorrência: **104 ocorrências**.
- Timezone fixa `America/Sao_Paulo` (UTC-3, sem horário de verão) — offset constante de 3h.
- `pnpm test` (via `npx pnpm`), `npx pnpm exec tsc --noEmit`, lint sem erros novos.

---

### Task 1: Migração — enum `no_show`

**Files:** nenhum (migração via MCP Supabase, projeto `eddfdgefrwjxfafkkzls`).

- [ ] **Step 1:** `apply_migration` nome `add_no_show_meeting_status`:

```sql
ALTER TYPE meeting_status ADD VALUE IF NOT EXISTS 'no_show';
```

- [ ] **Step 2:** Verificar com `execute_sql`: `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='meeting_status';` → deve listar `no_show`.

### Task 2: `lib/recurrence.ts` (TDD)

**Files:**
- Create: `lib/recurrence.ts`, `lib/recurrence.test.ts`

**Interfaces:**
- Produces: `type Frequency = 'daily'|'weekly'|'biweekly'|'monthly'`; `MAX_OCCURRENCES = 104`; `computeOccurrences(start: Date, rec: { frequency: Frequency; until?: Date; count?: number }): Date[]` — lança `Error` com mensagem pt-BR em regra inválida ou estouro do teto.

- [ ] **Step 1:** Escrever `lib/recurrence.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeOccurrences, MAX_OCCURRENCES } from './recurrence';

const start = new Date('2026-08-05T17:00:00.000Z'); // qua, 14h em São Paulo

describe('computeOccurrences', () => {
  it('semanal com count', () => {
    const out = computeOccurrences(start, { frequency: 'weekly', count: 3 });
    expect(out.map((d) => d.toISOString())).toEqual([
      '2026-08-05T17:00:00.000Z',
      '2026-08-12T17:00:00.000Z',
      '2026-08-19T17:00:00.000Z',
    ]);
  });

  it('quinzenal com count', () => {
    const out = computeOccurrences(start, { frequency: 'biweekly', count: 2 });
    expect(out[1].toISOString()).toBe('2026-08-19T17:00:00.000Z');
  });

  it('diária com until inclusivo', () => {
    const until = new Date('2026-08-07T23:59:59.999-03:00');
    const out = computeOccurrences(start, { frequency: 'daily', until });
    expect(out).toHaveLength(3); // 5, 6, 7
  });

  it('mensal dia 31 ajusta para fim de mês curto e volta ao 31', () => {
    const s = new Date('2026-08-31T17:00:00.000Z'); // 31/08 14h SP
    const out = computeOccurrences(s, { frequency: 'monthly', count: 3 });
    expect(out.map((d) => d.toISOString())).toEqual([
      '2026-08-31T17:00:00.000Z',
      '2026-09-30T17:00:00.000Z', // setembro tem 30
      '2026-10-31T17:00:00.000Z', // outubro volta ao 31
    ]);
  });

  it('count acima do teto lança', () => {
    expect(() => computeOccurrences(start, { frequency: 'weekly', count: MAX_OCCURRENCES + 1 })).toThrow();
  });

  it('until que gera mais que o teto lança', () => {
    const until = new Date('2036-01-01T00:00:00.000Z');
    expect(() => computeOccurrences(start, { frequency: 'daily', until })).toThrow();
  });

  it('until e count juntos (ou nenhum) lançam', () => {
    expect(() => computeOccurrences(start, { frequency: 'weekly' } as never)).toThrow();
    expect(() =>
      computeOccurrences(start, { frequency: 'weekly', count: 2, until: new Date() }),
    ).toThrow();
  });
});
```

- [ ] **Step 2:** Rodar `npx pnpm test` → falha (módulo ausente).
- [ ] **Step 3:** Implementar `lib/recurrence.ts`:

```ts
export type Frequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';

export interface RecurrenceInput {
  frequency: Frequency;
  /** Término por data (inclusivo). Exclusivo com `count`. */
  until?: Date;
  /** Término por nº de ocorrências (1ª inclusa). Exclusivo com `until`. */
  count?: number;
}

export const MAX_OCCURRENCES = 104;

// America/Sao_Paulo é UTC-3 fixo (sem horário de verão desde 2019) — offset
// constante permite aritmética de datas sem biblioteca de timezone.
const TZ_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Soma `months` meses preservando o horário e ancorando no dia do mês da
// primeira ocorrência: 31 vira 30/28 em mês curto e VOLTA a 31 quando o mês
// permite.
function addMonthsClamped(start: Date, months: number, anchorDay: number): Date {
  const local = new Date(start.getTime() - TZ_OFFSET_MS);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const day = Math.min(anchorDay, lastDay);
  const res = Date.UTC(
    y,
    m,
    day,
    local.getUTCHours(),
    local.getUTCMinutes(),
    local.getUTCSeconds(),
    local.getUTCMilliseconds(),
  );
  return new Date(res + TZ_OFFSET_MS);
}

export function computeOccurrences(start: Date, rec: RecurrenceInput): Date[] {
  const hasUntil = rec.until instanceof Date && !isNaN(rec.until.getTime());
  const hasCount = typeof rec.count === 'number' && Number.isFinite(rec.count);
  if (hasUntil === hasCount) {
    throw new Error('Informe o término por data OU por número de vezes (apenas um dos dois).');
  }
  if (hasCount && (rec.count! < 1 || rec.count! > MAX_OCCURRENCES)) {
    throw new Error(`O número de ocorrências deve estar entre 1 e ${MAX_OCCURRENCES}.`);
  }

  const stepDays = rec.frequency === 'daily' ? 1 : rec.frequency === 'weekly' ? 7 : 14;
  const anchorDay = new Date(start.getTime() - TZ_OFFSET_MS).getUTCDate();
  const out: Date[] = [];

  for (let i = 0; ; i++) {
    const next =
      rec.frequency === 'monthly'
        ? addMonthsClamped(start, i, anchorDay)
        : new Date(start.getTime() + i * stepDays * DAY_MS);
    if (hasCount && out.length >= (rec.count as number)) break;
    if (hasUntil && next.getTime() > (rec.until as Date).getTime()) break;
    if (out.length >= MAX_OCCURRENCES) {
      throw new Error(
        `A regra geraria mais de ${MAX_OCCURRENCES} reuniões — reduza o período ou a frequência.`,
      );
    }
    out.push(next);
  }
  return out;
}
```

- [ ] **Step 4:** `npx pnpm test` → PASS. Commit `feat(agenda): cálculo de ocorrências recorrentes (lib/recurrence)`.

### Task 3: `POST /api/meetings/schedule` com recorrência

**Files:**
- Modify: `app/api/meetings/schedule/route.ts`

**Interfaces:**
- Consumes: `computeOccurrences` da Task 2.
- Produces: corpo aceita `recurrence?: { frequency; until?: string; count?: number }`; resposta `{ id, roomName, occurrences }`.

- [ ] **Step 1:** Parsear `recurrence` do corpo; quando presente: `until` vira `new Date(until + 'T23:59:59.999-03:00')` se vier como `yyyy-mm-dd` (senão `new Date(until)`); chamar `computeOccurrences` dentro de try/catch → erro vira 400 com a mensagem.
- [ ] **Step 2:** Gerar `ids = occurrences.map(() => crypto.randomUUID())` e `roomNames` idem. Montar `rows` (uma por ocorrência) com `id`, `recurrence_parent_id: occurrences.length > 1 ? ids[0] : null`, `recurrence_rule` (`weekly;count=52` etc., só quando série) e demais campos como hoje. Um único `.insert(rows)`.
- [ ] **Step 3:** Inserir `meet_meeting_sector` em lote (`rows.map(id => ({ meeting_id: id, sector }))`). Em erro: `delete().in('id', ids)` e 500 (proteção atual, agora em lote).
- [ ] **Step 4:** Resolver `attendees` uma vez (código atual). Mover a criação de eventos para `after(async () => { ... })` (`import { after } from 'next/server'`): loop sequencial pelas ocorrências → `createCalendarEvent` com o link daquela sala → update do `calendar_event_id` na linha de setor correspondente; erros logados por ocorrência, nunca lançam.
- [ ] **Step 5:** Resposta `{ id: ids[0], roomName: roomNames[0], occurrences: ids.length }`. Typecheck + lint + commit `feat(agenda): agendamento recorrente em massa`.

### Task 4: Cancelar série + No-show (APIs)

**Files:**
- Modify: `app/api/meetings/cancel/route.ts`
- Create: `app/api/meetings/no-show/route.ts`

- [ ] **Step 1 (cancel):** corpo ganha `scope?: 'single' | 'future'`. Buscar também `recurrence_parent_id, scheduled_start_at` da reunião. Se `scope === 'future'` e há `recurrence_parent_id`: selecionar `id, meet_meeting_sector(calendar_event_id)` de todas com mesmo `recurrence_parent_id`, `scheduled_start_at >= ` o da reunião e `status = 'scheduled'`; `update status='canceled'` com `.in('id', ids)`; remover os eventos do Calendar dentro de `after()` (loop, não-fatal). Senão: fluxo atual. Resposta `{ ok: true, canceled: n }`.
- [ ] **Step 2 (no-show):** nova rota, espelho do cancel:

```ts
// Marca uma reunião agendada como no-show (cliente não compareceu).
// Só o host dono ou admin; só depois do horário de início; mantém registro.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Não autorizado', { status: 401 });
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id) return new NextResponse('id obrigatório', { status: 400 });

  const admin = createAdminSupabase();
  const { data: meeting } = await admin
    .from('meetings')
    .select('host_id, status, scheduled_start_at')
    .eq('id', id)
    .maybeSingle();
  if (!meeting) return new NextResponse('Reunião não encontrada', { status: 404 });
  if (!user.isAdmin && meeting.host_id !== user.id)
    return new NextResponse('Não autorizado', { status: 403 });
  if (meeting.status !== 'scheduled')
    return new NextResponse('Só reuniões agendadas podem virar no-show', { status: 400 });
  if (new Date(meeting.scheduled_start_at as string).getTime() > Date.now())
    return new NextResponse('A reunião ainda não chegou no horário de início', { status: 400 });

  const { error } = await admin.from('meetings').update({ status: 'no_show' }).eq('id', id);
  if (error) return new NextResponse('Falha ao marcar no-show: ' + error.message, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3:** Typecheck + lint + commit `feat(agenda): cancelamento de série e marcação de no-show`.

### Task 5: UI da Agenda + listagem

**Files:**
- Modify: `app/api/meetings/scheduled/route.ts` (select + map ganham `recurrence_parent_id` → `recurrenceParentId`)
- Modify: `app/agenda/page.tsx`

- [ ] **Step 1 (listagem):** adicionar `recurrence_parent_id` ao select e `recurrenceParentId: m.recurrence_parent_id ?? null` ao map; tipo `Scheduled` da página ganha o campo.
- [ ] **Step 2 (formulário):** estados `repeat` (`'none'|Frequency`), `endMode` (`'count'|'until'`), `untilDate` (string), `countTimes` (number, default 4). Campo "Repetir" como `<select>` nativo estilizado igual aos inputs (ou Tabs — seguir o mais simples já usado na página: select nativo com classes do Input). Quando `repeat !== 'none'`: dois inputs condicionais (radio simples entre "N vezes" e "até data") + resumo `Serão criadas ${n} reuniões` calculado com `computeOccurrences` num try/catch (erro → mostra a mensagem no lugar do resumo e bloqueia submit).
- [ ] **Step 3 (submit):** incluir `recurrence` no corpo quando série; toast de sucesso com o total (`json.occurrences > 1 ? \`${json.occurrences} reuniões agendadas!\` : 'Reunião agendada!'`); resetar os estados novos.
- [ ] **Step 4 (lista):** badge `<Badge variant="outline">Recorrente</Badge>` quando `m.recurrenceParentId`; diálogo de cancelamento: para série, `AlertDialogFooter` com três botões (Voltar / `Cancelar só esta` → scope single / `Cancelar esta e as futuras` → scope future, variant destructive); para avulsa, diálogo atual. `confirmCancel(scope)` envia `{ id, scope }` e no sucesso com scope future recarrega a lista (`loadList()`), senão remove só o item.
- [ ] **Step 5 (no-show):** botão `No-show` (variant outline, ícone `UserX` do lucide) visível quando `overdue`; abre AlertDialog próprio ("Marcar como no-show? A reunião ficará registrada como não comparecida."); confirma → POST `/api/meetings/no-show` → remove da lista + toast.
- [ ] **Step 6:** Typecheck + lint + commit `feat(agenda): UI de recorrência, cancelar série e no-show`.

### Task 6: Verificação final

- [ ] `npx pnpm test` verde; `npx pnpm exec tsc --noEmit` limpo; lint sem erros novos; `npx pnpm build` OK.

## Self-Review

- Spec coberta: recorrência (T2/T3/UI), teto 104 (T2), Calendar em background (T3), cancelar série (T4/UI), no-show com regras de status/horário (T4/UI), listagem com recurrenceParentId (T5), migração (T1). Tipos consistentes: `computeOccurrences` definida em T2 e consumida em T3/T5; `scope` definido em T4 e usado em T5; `recurrenceParentId` definido em T5 listagem e usado na página.
