# Agenda: reuniões recorrentes + No-show — Design

Aprovado em 2026-07-31 (decisões tomadas em brainstorming com o usuário).

## Objetivo

1. Agendar reuniões que se repetem (ex.: toda semana por 12 meses) criando as ocorrências em massa.
2. Marcar reuniões em que o cliente não compareceu como **No-show**, mantendo o registro para métricas.

## Decisões (com o usuário)

- **Link por ocorrência:** cada ocorrência é uma reunião independente com sala/link próprios (mantém o vínculo 1-para-1 sala↔reunião usado por gravações/donos).
- **Recorrência:** frequências diária, semanal, quinzenal e mensal; término por **data limite** OU **número de ocorrências**.
- **Gestão da série:** ao cancelar uma ocorrência de série, escolher entre "só esta" e "esta e as futuras". Sem edição em massa (v2 se precisar).
- **No-show:** botão na agenda (disponível quando o horário de início já passou), vira status próprio no banco, sai da lista de próximas; sem tela de histórico por ora (o dado fica para métricas futuras).
- **Google Agenda:** um evento por ocorrência (link daquela semana), criados em segundo plano após salvar.

## Modelo de dados

- Enum `meeting_status` ganha o valor **`no_show`** (migração: `ALTER TYPE meeting_status ADD VALUE 'no_show'`). Nenhum sistema atual quebra: consultas do Meet filtram por valores explícitos; o Planner (Legacy Plan) não gera reuniões do Meet.
- Recorrência usa colunas **já existentes** em `meetings` (nunca usadas até aqui):
  - `recurrence_parent_id uuid` — todas as ocorrências da série (inclusive a primeira) apontam para o id da **primeira** ocorrência. Presença de valor = "faz parte de série".
  - `recurrence_rule text` — resumo informativo da regra, ex.: `weekly;count=52` ou `monthly;until=2027-07-31`.
- Nenhuma coluna nova; nenhuma tabela nova.

## API

### `POST /api/meetings/schedule` (estendido)

Corpo ganha campo opcional:

```ts
recurrence?: {
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  until?: string;   // ISO date — término por data (inclusive)
  count?: number;   // término por nº de ocorrências (1ª inclusa)
}
```

- Exatamente um de `until`/`count` é obrigatório quando `recurrence` presente.
- Datas calculadas por `computeOccurrences` (função pura em `lib/recurrence.ts`, testada): mesma hora local em todas; mensal com dia 29/30/31 ajusta para o último dia do mês quando necessário (sem pular mês).
- **Teto: 104 ocorrências.** Acima disso → 400 com mensagem clara.
- Inserção em lote: um insert com todas as linhas de `meetings` (cada uma com `room_name` próprio) + um insert com as linhas de `meet_meeting_sector`. Falha no setor desfaz as meetings criadas (mesma proteção de hoje).
- Eventos do Google Agenda: criados **após a resposta** via `after()` do Next (um evento por ocorrência, sequencial, erros logados e não-fatais; `calendar_event_id` salvo por ocorrência como hoje).
- Resposta: `{ id, roomName, occurrences: number }` (id/room da primeira).

### `POST /api/meetings/cancel` (estendido)

- Corpo ganha `scope?: 'single' | 'future'` (default `single` = comportamento atual).
- `future` (válido só para reunião com `recurrence_parent_id`): cancela (status `canceled`) esta ocorrência e todas as da mesma série com `scheduled_start_at >=` o desta. Eventos do Calendar removidos em segundo plano (`after()`), erros não-fatais.

### `POST /api/meetings/no-show` (novo)

- Corpo `{ id }`. Autorização idêntica ao cancel (host dono ou admin).
- Regra: só permite se `scheduled_start_at <= now()` (não faz sentido no-show de reunião futura) e status atual `scheduled`.
- Efeito: `status = 'no_show'`. Não mexe no Calendar (evento já passou). Não mexe em gravações.

### `GET /api/meetings/scheduled` (estendido)

- Passa a retornar também `recurrenceParentId` por reunião (para a UI mostrar o badge e oferecer o cancelamento em série).

## UI — `app/agenda/page.tsx`

**Formulário:**
- Novo campo "Repetir" (select): `Não se repete` (default) | `Todo dia` | `Toda semana` | `A cada 2 semanas` | `Todo mês`.
- Quando repetir ≠ "não": aparece o término — toggle entre "Até uma data" (input date) e "Número de vezes" (input number, min 2, max 104) — e um resumo calculado no cliente: "Serão criadas N reuniões".
- Submit envia `recurrence` no corpo; toast de sucesso mostra o total criado.

**Lista:**
- Reunião com `recurrenceParentId` ganha badge `Recorrente`.
- Botão X (cancelar) numa reunião de série abre diálogo com duas ações: "Cancelar só esta" / "Cancelar esta e as futuras" (reunião avulsa mantém o diálogo atual).
- Reunião com horário já passado (mesma condição do badge "Atrasada") ganha botão **"No-show"** com diálogo de confirmação; sucesso remove da lista.

## Testes

`lib/recurrence.test.ts` (vitest): semanal com count; quinzenal; diária com until (inclusive); mensal dia 31 → ajusta para fim de mês curto e volta ao dia 31 quando o mês permite; teto de 104 (lança/trunca com erro); until e count juntos → erro; nenhum → erro.

## Adendo (2026-07-31, aprovado): Histórico com toggle de No-show

Reuniões realizadas somem da Agenda ao virar `ended` — sem lugar para marcar
no-show depois. Incremento:

- **Abas** na lista da Agenda: "Próximas" (atual) e "Histórico".
- **`GET /api/meetings/history`**: reuniões do host com status `ended` ou
  `no_show`, mais recente primeiro, limite 100. Campos dos cards atuais +
  `status`.
- **Cards do histórico**: badge "Realizada" (`ended`) ou "No-show" (`no_show`) +
  botão de toggle — "Marcar no-show" / "Desfazer no-show".
- **`POST /api/meetings/no-show` estendido**: aceita `undo: boolean`.
  - Marcar: permitido de `scheduled` (só após o horário) **e de `ended`** (host
    entrou na sala, cliente não veio).
  - Desfazer (`undo`): exige `no_show`; restaura `ended` se `started_at` tem
    valor, senão `scheduled` (volta para "Próximas" como atrasada).
- Sem mudança de banco.

## Fora do escopo (v2)

- Edição em massa da série (horário/título de todas as futuras).
- Métricas/relatórios de no-show (o dado persiste; a tela fica para depois).
- Exceções de série ("pular a semana X"), dias da semana múltiplos, "a cada N".
