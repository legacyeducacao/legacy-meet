# Agenda: Histórico + toggle de No-show — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aba "Histórico" na Agenda listando reuniões `ended`/`no_show` com toggle de no-show nos dois sentidos, conforme o adendo da spec `2026-07-31-agenda-recorrencia-noshow-design.md`.

**Architecture:** Rota nova de listagem (espelho da `/scheduled` com filtro de status), extensão da rota `/no-show` com `undo`, e abas na página da Agenda. Sem mudança de banco.

**Tech Stack:** Next.js 15, Supabase.

## Global Constraints

- pt-BR; commits `feat(agenda): ...`; typecheck/lint/build limpos.

### Task 1: `GET /api/meetings/history`

**Files:** Create `app/api/meetings/history/route.ts`

- [ ] Espelho da `/api/meetings/scheduled`, trocando o filtro por `.in('status', ['ended', 'no_show'])`, ordenação `descending`, `.limit(100)`, e acrescentando `status` e `started_at` ao select/map (`status: m.status`, demais campos iguais, incluindo `recurrenceParentId`).

### Task 2: `POST /api/meetings/no-show` com `undo` e suporte a `ended`

**Files:** Modify `app/api/meetings/no-show/route.ts`

- [ ] Corpo `{ id, undo?: boolean }`; select ganha `started_at`.
- [ ] `undo === true`: exige `status === 'no_show'`; update `status = meeting.started_at ? 'ended' : 'scheduled'`.
- [ ] Marcar: aceita `status` `'scheduled'` (com a checagem de horário atual) **ou** `'ended'` (sem checagem de horário — já aconteceu).

### Task 3: UI — abas e cards do histórico

**Files:** Modify `app/agenda/page.tsx`

- [ ] Tipo `HistoryItem = { id; title; startAt; status: 'ended' | 'no_show'; hostName; clientName; sector; recurrenceParentId }`.
- [ ] Estado `view: 'upcoming' | 'history'` (Tabs já importado), `history: HistoryItem[]`, `loadingHistory`, paginação própria (`PAGE_SIZE` reutilizado); `loadHistory()` chamado ao abrir a aba pela 1ª vez e após toggles.
- [ ] Card do histórico: título + badges (setor, Recorrente, e `Realizada` [secondary] / `No-show` [destructive]) + data/cliente/host + botão único: `Marcar no-show` (quando `ended`) ou `Desfazer no-show` (quando `no_show`).
- [ ] Diálogo de confirmação próprio (`pendingHistToggle: HistoryItem | null`; `undo = status === 'no_show'`): confirmar → POST `{ id, undo }` → recarrega histórico e, se o undo restaurou `scheduled`, também `loadList()`.
- [ ] Aba "Próximas" permanece intacta (inclusive o No-show das atrasadas — que após sucesso também invalida o histórico carregado, basta `setHistory([])`+flag para recarregar na próxima abertura ou chamar `loadHistory()` se já carregado).

### Task 4: Verificação

- [ ] `npx pnpm exec tsc --noEmit`, lint sem erros novos, `npx pnpm test`, `npx pnpm build`; merge na main + push.
