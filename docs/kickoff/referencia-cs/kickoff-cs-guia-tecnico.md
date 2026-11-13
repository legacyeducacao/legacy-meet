# Kickoff Impulsão no Legacy CS: guia técnico

**Para:** o agente do Legacy Meet que vai reconstruir o módulo de kickoff lá, sem acesso a este repositório.
**Repositório:** `legacycs` (Legacy CS), branch `main`, estado local de 12/11/2026. Os horários estão no fuso de Brasília.
**Arquivo irmão:** [kickoff-cs-para-meet-handoff.md](kickoff-cs-para-meet-handoff.md), com as decisões, o mapeamento, a matriz de reaproveitamento e o corte.

## Como ler

| Marca | Significa |
|---|---|
| **[PROD]** | Existe e está aplicado no banco de produção do CS: projeto Supabase "RH" `iqktumissfojrlroqspt`, schema `legacycs` |
| **[LOCAL]** | Código existe só na máquina de desenvolvimento, **não commitado** |
| **[PENDENTE]** | Migration escrita e testada, **não aplicada** (E2) |
| **[ADAPTAR]** | O Meet precisa ajustar ao seu modelo |
| **[PROPOSTA]** | Ideia ainda não implementada em lugar nenhum |

O código citado está incluído **literalmente**, extraído dos arquivos: assinaturas, mensagens e códigos de erro são os reais.

**Glossário.** "Sessão" é uma reunião coletiva de kickoff. "Reserva" é uma empresa inscrita em uma sessão. "Convite" é o link individual da empresa. "Sala" é a reunião recorrente do Zoom. "Inscrição" é o registrante do Zoom.

---

## 1. Inventário

### 1.1 Status do Git

Nada do kickoff foi commitado: os arquivos novos são *untracked* e alguns compartilhados estão modificados. **A transferência não depende de commit.** Para levar o código, basta copiar os arquivos da seção 1.3.

**Modificados (arquivos compartilhados do CS):**

| Arquivo | O que mudou |
|---|---|
| `.env.example` | Seção "Zoom": `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` (só nomes) |
| `package.json` / `package-lock.json` | `devDependency` `@electric-sql/pglite` 0.5.12, para testar SQL real no vitest |
| `src/components/layout/sidebar-nav.tsx` | Item de menu "Kickoffs" → `/kickoffs` |
| `src/routeTree.gen.ts` | Rotas geradas: `/kickoffs`, `/agendar/$codigo` |
| `src/routes/clients/$id.tsx` | Customer 360: cartão `ConviteDoKickoff`, só para admin e só para clientes do grupo "impulsao" |

**Não rastreados (exclusivos do kickoff):** os listados em 1.3, mais `public/kickoff/marcelo-peixoto.jpg`.

**Também não rastreados, mas fora do kickoff (não levar):**
- `supabase/migrations/20261028100100_legacycs_clients_list_view_sem_anon.sql`;
- `supabase/migrations/20261028110100_legacycs_survey_metrics_leitura.sql`.

### 1.2 Migrations do kickoff

| Migration | Estado | Conteúdo |
|---|---|---|
| `20261109120000_legacycs_impulsao_kickoffs_agenda.sql` (638 linhas) | **[PROD]** | Horários recorrentes, sessões, geração das próximas 8 semanas, edição, bloqueio, sessão extra, cancelamento |
| `20261110120000_legacycs_impulsao_kickoffs_reservas.sql` (767) | **[PROD]** | Reservas, remanejamento, cancelamento, trava de capacidade, views com ocupação |
| `20261110140000_legacycs_impulsao_kickoffs_ausencia_participante.sql` (302) | **[PROD]** | Ausência (`no_show`), edição do participante com histórico |
| `20261110160000_legacycs_impulsao_kickoffs_convite_publico.sql` (539) | **[PROD]** | Convite por empresa, contador de tentativas, funções públicas (anon) de consulta e reserva |
| `20261111120000_legacycs_impulsao_kickoffs_zoom_sala.sql` (224) | **[PROD]** (aplicada em 11/11/2026) | Sala Zoom única: cadastro, validação, histórico |
| `20261112120000_legacycs_impulsao_kickoffs_zoom_inscricoes.sql` (463) | **[PENDENTE]** | Inscrições Zoom (link individual), concorrência, estado por reserva |

Todas são **incrementais**: uma migration posterior redefine funções da anterior com o mesmo nome (`create or replace`). A versão vigente de cada função é a da migration mais recente que a define. Este guia sempre cita a vigente.

### 1.3 Arquivos por camada

Coluna "Classe":
1. Exclusivo do kickoff, candidato a levar.
2. Exclusivo do kickoff, mas **substituído pela infraestrutura do Meet**.
3. Específico do CS, não levar.

| Arquivo | Linhas | Responsabilidade | Classe |
|---|---|---|---|
| **Banco** | | | |
| as 6 migrations acima | | Ver 1.2 | regras: 1; agenda/recorrência: 2 |
| **Regras puras (TypeScript, sem rede)** | | | |
| `src/lib/kickoffs.ts` | 468 | Tipos da agenda e das reservas, validação do participante (`validarParticipante`), textos, ocupação, `hojeEmSaoPaulo`, `mensagemDeErro` | 1 (partes) |
| `src/lib/kickoffs-calendario.ts` | 274 | Grade semanal da agenda administrativa | 2 |
| `src/lib/kickoffs-publico.ts` | 233 | Tipos do que as funções públicas devolvem, textos da página, anfitrião fixo, duração por extenso, CNPJ/CPF | 1 |
| `src/lib/kickoffs-publico-calendario.ts` | 208 | Datas do calendário público Mês/Semana/Dia (sem fuso do navegador) | 1 |
| `src/lib/zoom-api.ts` | 269 | Cliente HTTP do Zoom (OAuth S2S, cache, 401, prazo, inscrições) | 1 |
| `src/lib/kickoffs-zoom.ts` | 410 | Regras da sala Zoom (E1): lê o link ou ID, valida a configuração, resumo sem segredos, avisos, credenciais | 1 |
| `src/lib/kickoffs-zoom-inscricao.ts` | 486 | Regras e orquestração da inscrição (E2), com utilitários copiados do Legacy Plan | 1 |
| **Servidor (TanStack Start `createServerFn`, só servidor)** | | | |
| `src/lib/zoom-servidor.server.ts` | 40 | Cliente Zoom único por processo e checagem de papel (`exigirPapel`) | 1 (adaptar a autorização) |
| `src/lib/kickoffs-zoom.server.ts` | 201 | E1: estado, verificar, ativar e reverificar a sala | 1 |
| `src/lib/kickoffs-zoom-acesso.server.ts` | 210 | E2: acesso pelo convite (público), estados da sessão (painel), gerar acesso (admin) | 1 |
| **Hooks** | | | |
| `src/hooks/use-agendamento-publico.tsx` | 161 | Página pública: lê o convite, agenda, busca o acesso Zoom com novas tentativas | 1 |
| `src/hooks/use-kickoffs.tsx` | 308 | Agenda administrativa: sessões, horários, reservas, empresas e contatos | 2 |
| `src/hooks/use-acessos-zoom.tsx` | 106 | Painel: estado do acesso Zoom de cada reserva; gera o acesso sozinho para admin | 1 (adaptar) |
| **Componentes** | | | |
| `src/components/kickoffs/agendamento-publico.tsx` | 756 | Página pública inteira (seção 5) | 1 |
| `src/components/kickoffs/calendario-publico.tsx` | 531 | Calendário público Mês/Semana/Dia | 1 |
| `src/components/kickoffs/acesso-zoom-publico.tsx` | 127 | Bloco "Acesso ao Zoom" na página pública | 1 |
| `src/components/kickoffs/detalhes-da-sessao.tsx` | 509 | Painel lateral da sessão: inscritos, ações, estado do Zoom | 1 (conteúdo) / 2 (casca) |
| `src/components/kickoffs/reserva-dialog.tsx` | 285 | Inscrever empresa (admin) | 1 (adaptar) |
| `src/components/kickoffs/remanejar-dialog.tsx` | 142 | Remanejar reserva | 1 (adaptar) |
| `src/components/kickoffs/participante-dialog.tsx` | 124 | Editar participante | 1 (adaptar) |
| `src/components/kickoffs/sala-zoom.tsx` | 494 | Aba "Sala Zoom" (E1) | 1 |
| `src/components/kickoffs/agenda-de-sessoes.tsx` | 311 | Lista de sessões | 2 |
| `src/components/kickoffs/calendario-semanal.tsx` | 434 | Grade semanal | 2 |
| `src/components/kickoffs/barra-da-agenda.tsx` | 140 | Navegação da agenda | 2 |
| `src/components/kickoffs/horarios-recorrentes.tsx` | 132 | Lista de horários recorrentes | 2 |
| `src/components/kickoffs/horario-dialog.tsx` | 194 | Editar horário recorrente | 2 |
| `src/components/kickoffs/sessao-dialog.tsx` | 180 | Editar sessão / criar sessão extra | 2 |
| `src/components/customer360/convite-do-kickoff.tsx` | 155 | Ficha do cliente: gerar, copiar ou trocar o link de agendamento | 3 (a função vai para o Meet) |
| **Rotas** | | | |
| `src/routes/agendar.$codigo.tsx` | 24 | Rota pública `/agendar/<código>` (`noindex`), fora do layout | 1 (vira `/impulsao/agendar/<código>`) |
| `src/routes/kickoffs.tsx` | 431 | Página administrativa `/kickoffs` com abas Agenda, Horários recorrentes e Sala Zoom | 2/3 |
| **Imagem** | | | |
| `public/kickoff/marcelo-peixoto.jpg` | | Foto do anfitrião (320×320) | 1 (ou vem do perfil no Meet) |
| **Testes** | | Seção 8 | 1 (portar cenários) |

### 1.4 Dependências compartilhadas do CS

Usadas pelo kickoff, mas não são dele:

| Dependência | Uso no kickoff | No Meet |
|---|---|---|
| `legacycs.clients` (`id`, `name`, `trading_name`, `tax_id`, `email`, `phone`, `produto`, `plan_tenant_id`, `deleted_at`) | Empresa da reserva e do convite; só leitura | **[ADAPTAR]** usar `client_tenants` direto |
| `legacycs.contacts` (`client_id`, `name`, `email`, `phone`, `is_main_sponsor`, `is_active`, `deleted_at`) | Sugestão do participante na página pública; só leitura | **[ADAPTAR]** contato equivalente no Plan/Meet |
| `legacycs.user_roles`, `has_role(uid, role)`, `current_user_role()` | Papéis `admin` (escreve), `csm`/`viewer` (lê) | **[ADAPTAR]** permissão `kickoff_impulsao.manage` |
| `legacycs.produto = 'impulsao_empresarial'` (`src/lib/produtos.ts`, grupo "impulsao") | Só empresa do Impulsão recebe convite | **[ADAPTAR]** produto no `client_tenants` |
| `extensions.gen_random_bytes` (pgcrypto) | Código do convite | Igual |
| `src/integrations/supabase/client.ts` / `client.server.ts` (service role) | Front e servidor | Equivalentes do Meet |
| `src/components/ui/*` (shadcn), `custom-toast`, `src/lib/env.ts` (`hasSupabase`), `src/lib/date-local.ts` (`addDaysLocal`), `src/lib/utils.ts` (`cn`) | Interface | Equivalentes do Meet |
| Fonte e tokens de cor do CS (`--primary`, `--accent-primary`, `--success`, `--warning`) | Visual da página pública | **[ADAPTAR]** tema do Meet |

---

## 2. Modelo de dados das reservas [PROD]

### 2.1 Tabelas

**`legacycs.impulsao_kickoff_sessions`.** Sessão coletiva. **No Meet, vira evento da agenda.**
- **Colunas:**
  - `id uuid`, `starts_at timestamptz`;
  - `duration_minutes int` (15–480), `capacity int` (1–50, padrão 5, conta **empresas**);
  - `origin` (`recurring` | `extra`), `recurrence_id`, `slot_date date` (a vaga que gerou a sessão);
  - `status` (`open` | `blocked` | `cancelled`), `adjusted bool`;
  - `cancelled_at`, `cancelled_by`, `cancel_reason`, `cancelled_by_recurrence bool`;
  - `created_by`, `updated_by`, `created_at`, `updated_at`.
- **Restrições:**
  - `unique (recurrence_id, slot_date)`;
  - `origin='recurring'` ⇔ `recurrence_id` e `slot_date` preenchidos;
  - `(status='cancelled') = (cancelled_at is not null)`.
- Gatilho `_impulsao_kickoff_no_delete`: sessão **não se apaga**.

**`legacycs.impulsao_kickoff_bookings`.** Reserva = **uma empresa** numa sessão.
- **Colunas:**
  - `id`, `session_id` (FK sessões), `client_id` (FK `clients`);
  - `plan_tenant_id text` (cópia de `clients.plan_tenant_id`, que é o `client_tenants.id` do Plan);
  - `participant_name` (2–200), `participant_email` (regex, opcional), `participant_phone` (8–15 dígitos, opcional);
  - `status` (`active` | `cancelled` | `no_show`);
  - `cancelled_at/by/reason`, `no_show_at/by`;
  - `invite_id` (FK convites; nulo = reserva feita pelo admin);
  - `created_by`, `updated_by`, `created_at`, `updated_at`.
- **Restrições:**
  - e-mail **ou** telefone;
  - `(status='cancelled') = (cancelled_at is not null)`;
  - `(status='no_show') = (no_show_at is not null)`.
- **Índices:**
  - `impulsao_kickoff_bookings_empresa_ativa_key`: **único parcial** `(client_id) where status = 'active'` (uma reserva ativa por empresa no total);
  - `idx_..._sessao (session_id, status)`.
- Gatilho: reserva **não se apaga** (`_impulsao_kickoff_history_guard`).

**`legacycs.impulsao_kickoff_booking_moves`.** Histórico de remanejamento, só inclusão.
- Colunas: `booking_id`, `from_session_id`, `to_session_id` (diferentes), `reason`, `moved_by`, `moved_at`.

**`legacycs.impulsao_kickoff_participant_edits`.** Histórico de edição do participante, só inclusão.
- Colunas: `booking_id`, `previous_name`, `previous_email`, `previous_phone`, `changed_by`, `changed_at`. Guarda os dados **anteriores**.

**`legacycs.impulsao_kickoff_recurrences`.** Horários recorrentes. **Substituídos pela recorrência do Meet.**
- Colunas: `weekday` (0=domingo), `start_time` (hora de Brasília), `duration_minutes`, `capacity`, `active`.
- Restrição: único `(weekday, start_time) where active`.

### 2.2 Views (todas `security_invoker = true`)

- **`impulsao_kickoff_sessions_view`:**
  - `s.*`;
  - `local_date`, `local_time`, `local_end_time` (Brasília);
  - `booked_count` (reservas `active` **+ `no_show`**), `spots_left = greatest(capacity - booked_count, 0)`.
- **`impulsao_kickoff_bookings_view`:**
  - colunas da reserva;
  - `client_name = coalesce(trading_name, name)`, `client_produto`;
  - `moves_count`, `edits_count`.

### 2.3 Acesso

- RLS ligada em todas as tabelas.
- **Leitura:** `authenticated` com papel no CS (`current_user_role() is not null`).
- **Escrita:** **só pelas funções** (sem grant de insert, update ou delete para `authenticated`).
- `anon` não lê nada.
- O schema `legacycs` dá privilégios a `anon` e `authenticated` por padrão em objeto novo. Por isso toda migration faz `revoke` explícito em tabelas e funções.

---

## 3. Regras de negócio e SQL [PROD]

### 3.1 Modelo de concorrência (a parte que não pode ser refeita por tentativa e erro)

1. **Fila única de escrita.** Toda função que escreve na agenda ou nas reservas chama `_impulsao_kickoff_begin_write()`, que exige admin e pega `pg_advisory_xact_lock(hashtext('legacycs.impulsao_kickoff_agenda'))`. A reserva **pública** pega a mesma trava sem exigir admin. Duas abas, dois admins e um cliente nunca escrevem ao mesmo tempo. A trava vale até o fim da transação.
2. **Trava da sessão de destino.** `_impulsao_kickoff_lock_open_session` faz `select ... for update` na sessão, confere estado e horário, **conta as ativas e só então** a função insere ou move. Quem chega depois espera e recontar já inclui a reserva anterior: a última vaga não é vendida duas vezes.
3. **Rede de segurança no índice.** O único parcial `(client_id) where status='active'` barra a segunda reserva ativa da empresa, mesmo inserida à mão. `impulsao_kickoff_book` converte `unique_violation` em mensagem.
4. **Histórico imutável.** Gatilhos impedem `delete` em sessões, reservas, remanejamentos e edições, e `update` nos dois históricos.

**[ADAPTAR] no Meet:** a trava (2) passa a ser sobre a **linha do evento** (ou da extensão de kickoff do evento). A (3) passa a ser sobre o **`tenant_id`**. A (1) pode continuar global para o kickoff (volume baixo); ela só precisa envolver todas as funções que mudam reservas ou eventos de kickoff.

*Fonte: `supabase/migrations/20261109120000_legacycs_impulsao_kickoffs_agenda.sql, linhas 170–189`*

```sql
-- Toda escrita passa por aqui: exige admin e enfileira as escritas da
-- agenda (o lock vale até o fim da transação), para duas abas gerando ao
-- mesmo tempo não criarem a mesma sessão em horários que se cruzam.
create or replace function legacycs._impulsao_kickoff_begin_write()
returns void
language plpgsql
security definer
set search_path to 'legacycs'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Faça login para alterar a agenda de kickoffs.' using errcode = '42501';
  end if;
  if not legacycs.has_role(auth.uid(), 'admin') then
    raise exception 'Somente administradores podem alterar a agenda de kickoffs.'
      using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('legacycs.impulsao_kickoff_agenda'));
end;
$function$;
```

*Fonte: `supabase/migrations/20261110120000_legacycs_impulsao_kickoffs_reservas.sql, linhas 190–226`*

```sql
-- Trava a sessão de destino e confere se ela recebe mais uma empresa.
-- A trava vale até o fim da transação: a contagem e o insert/update que vêm
-- depois não disputam com outra reserva para a mesma sessão.
create or replace function legacycs._impulsao_kickoff_lock_open_session(p_session_id uuid)
returns legacycs.impulsao_kickoff_sessions
language plpgsql
security definer
set search_path to 'legacycs'
as $function$
declare
  v_s legacycs.impulsao_kickoff_sessions%rowtype;
  v_ocupadas int;
begin
  select * into v_s from legacycs.impulsao_kickoff_sessions where id = p_session_id for update;
  if v_s.id is null then
    raise exception 'Sessão não encontrada.' using errcode = 'P0002';
  end if;
  if v_s.status = 'cancelled' then
    raise exception 'Sessão indisponível: ela foi cancelada.' using errcode = '22023';
  end if;
  if v_s.status = 'blocked' then
    raise exception 'Sessão indisponível: ela está bloqueada para novas reservas.' using errcode = '22023';
  end if;
  if v_s.starts_at <= now() then
    raise exception 'Sessão indisponível: ela já começou ou já passou.' using errcode = '22023';
  end if;

  select count(*) into v_ocupadas
    from legacycs.impulsao_kickoff_bookings
   where session_id = v_s.id and status = 'active';
  if v_ocupadas >= v_s.capacity then
    raise exception 'Sessão lotada: % de % empresas.', v_ocupadas, v_s.capacity using errcode = '22023';
  end if;

  return v_s;
end;
$function$;
```

### 3.2 Tabela de regras

| Regra | Onde | Assinatura | Retorno |
|---|---|---|---|
| Inscrever empresa (admin) | reservas | `impulsao_kickoff_book(p_session_id uuid, p_client_id uuid, p_participant_name text, p_participant_email text, p_participant_phone text)` | `jsonb` (linha da reserva) |
| Remanejar | reservas | `impulsao_kickoff_move_booking(p_booking_id uuid, p_to_session_id uuid, p_reason text)` | `jsonb` (reserva) |
| Cancelar reserva | ausência (vigente) | `impulsao_kickoff_cancel_booking(p_booking_id uuid, p_reason text)` | `jsonb` |
| Cancelar sessão (sem inscritos) | reservas | `impulsao_kickoff_cancel_session(p_id uuid, p_reason text)` | `jsonb` (sessão) |
| Cancelar sessão + reservas | reservas | `impulsao_kickoff_cancel_session_and_bookings(p_id uuid, p_reason text)` | `{"session", "bookings_cancelled"}` |
| Registrar ausência | ausência | `impulsao_kickoff_mark_no_show(p_booking_id uuid)` | `jsonb` |
| Editar participante | ausência | `impulsao_kickoff_update_participant(p_booking_id uuid, p_participant_name text, p_participant_email text, p_participant_phone text)` | `jsonb` |
| Editar sessão | reservas (vigente) | `impulsao_kickoff_update_session(p_id uuid, p_local_date date, p_local_time time, p_duration_minutes int, p_capacity int)` | `jsonb` |
| Bloquear / desbloquear | agenda | `impulsao_kickoff_set_blocked(p_id uuid, p_blocked boolean)` | `jsonb` |
| Sessão extraordinária | agenda | `impulsao_kickoff_create_extra(p_local_date date, p_local_time time, p_duration_minutes int, p_capacity int)` | `jsonb` |
| Horário recorrente | agenda | `impulsao_kickoff_save_recurrence(uuid, int, time, int, int, boolean)` | `jsonb` |
| Gerar as próximas 8 semanas | reservas (vigente) | `impulsao_kickoff_sync()` | `{"created", "updated", "cancelled", "reopened", "kept"}` |

**Códigos de erro (`raise exception ... using errcode`).** A tela mostra a mensagem do banco, que já vem em português.

| Código | Quando |
|---|---|
| `42501` | Sem login, sem papel admin, tentativa de apagar ou reescrever histórico |
| `22023` | Regra de negócio: sessão indisponível, lotada, passada, dado inválido, estado não permite |
| `P0002` | Sessão, reserva ou empresa não encontrada |
| `23505` | Empresa já inscrita; outra sessão no mesmo horário |
| `23514` | (E1) Sala sem verificação aprovada nas últimas 2 h |

### 3.3 Inscrever empresa (admin)

*Fonte: `supabase/migrations/20261110120000_legacycs_impulsao_kickoffs_reservas.sql, linhas 541–620`*

```sql
-- Inscreve uma empresa do CS numa sessão.
create or replace function legacycs.impulsao_kickoff_book(
  p_session_id uuid,
  p_client_id uuid,
  p_participant_name text,
  p_participant_email text,
  p_participant_phone text
)
returns jsonb
language plpgsql
security definer
set search_path to 'legacycs'
as $function$
declare
  v_nome text := nullif(btrim(coalesce(p_participant_name, '')), '');
  v_email text := lower(nullif(btrim(coalesce(p_participant_email, '')), ''));
  v_fone text := nullif(btrim(coalesce(p_participant_phone, '')), '');
  v_cliente record;
  v_atual record;
  v_s legacycs.impulsao_kickoff_sessions%rowtype;
  v_b legacycs.impulsao_kickoff_bookings%rowtype;
begin
  perform legacycs._impulsao_kickoff_begin_write();

  if v_nome is null or char_length(v_nome) < 2 then
    raise exception 'Informe o nome do participante principal.' using errcode = '22023';
  end if;
  if v_email is null and v_fone is null then
    raise exception 'Informe o e-mail ou o telefone do participante.' using errcode = '22023';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'E-mail do participante inválido.' using errcode = '22023';
  end if;
  if v_fone is not null
     and char_length(regexp_replace(v_fone, '\D', '', 'g')) not between 8 and 15 then
    raise exception 'Telefone do participante inválido.' using errcode = '22023';
  end if;

  -- Só leitura do cadastro: nada em clients ou contacts é alterado.
  select c.id, c.plan_tenant_id, c.deleted_at into v_cliente
    from legacycs.clients c where c.id = p_client_id;
  if v_cliente.id is null or v_cliente.deleted_at is not null then
    raise exception 'Empresa não encontrada no CS.' using errcode = 'P0002';
  end if;
  if v_cliente.plan_tenant_id is null then
    raise exception 'Esta empresa não tem vínculo com o Legacy Plan. Vincule o cadastro antes de inscrever.'
      using errcode = '22023';
  end if;

  select b.session_id,
         to_char(s.starts_at at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI') as quando
    into v_atual
    from legacycs.impulsao_kickoff_bookings b
    join legacycs.impulsao_kickoff_sessions s on s.id = b.session_id
   where b.client_id = p_client_id and b.status = 'active';
  if v_atual.session_id is not null then
    if v_atual.session_id = p_session_id then
      raise exception 'Esta empresa já está inscrita nesta sessão.' using errcode = '23505';
    end if;
    raise exception 'Esta empresa já tem kickoff marcado em %. Para trocar, remaneje a reserva existente.',
      v_atual.quando using errcode = '23505';
  end if;

  v_s := legacycs._impulsao_kickoff_lock_open_session(p_session_id);

  begin
    insert into legacycs.impulsao_kickoff_bookings
      (session_id, client_id, plan_tenant_id, participant_name, participant_email,
       participant_phone, created_by, updated_by)
    values
      (v_s.id, v_cliente.id, v_cliente.plan_tenant_id, v_nome, v_email, v_fone,
       auth.uid(), auth.uid())
    returning * into v_b;
  exception when unique_violation then
    raise exception 'Esta empresa já tem um kickoff marcado.' using errcode = '23505';
  end;

  return to_jsonb(v_b);
end;
$function$;
```

### 3.4 Remanejar

O id da reserva não muda. Muda `session_id`, e uma linha vai para o histórico. A sessão de destino passa pela mesma trava e contagem.

*Fonte: `supabase/migrations/20261110120000_legacycs_impulsao_kickoffs_reservas.sql, linhas 622–668`*

```sql
-- Leva a MESMA reserva para outra sessão e registra a troca.
create or replace function legacycs.impulsao_kickoff_move_booking(
  p_booking_id uuid,
  p_to_session_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to 'legacycs'
as $function$
declare
  v_b legacycs.impulsao_kickoff_bookings%rowtype;
  v_s legacycs.impulsao_kickoff_sessions%rowtype;
  v_origem uuid;
begin
  perform legacycs._impulsao_kickoff_begin_write();

  select * into v_b from legacycs.impulsao_kickoff_bookings where id = p_booking_id for update;
  if v_b.id is null then
    raise exception 'Reserva não encontrada.' using errcode = 'P0002';
  end if;
  if v_b.status <> 'active' then
    raise exception 'Só reservas ativas podem ser remanejadas.' using errcode = '22023';
  end if;
  if v_b.session_id = p_to_session_id then
    raise exception 'A empresa já está nesta sessão.' using errcode = '22023';
  end if;

  v_s := legacycs._impulsao_kickoff_lock_open_session(p_to_session_id);
  v_origem := v_b.session_id;

  update legacycs.impulsao_kickoff_bookings
     set session_id = v_s.id,
         updated_by = auth.uid(),
         updated_at = now()
   where id = v_b.id
  returning * into v_b;

  insert into legacycs.impulsao_kickoff_booking_moves
    (booking_id, from_session_id, to_session_id, reason, moved_by)
  values
    (v_b.id, v_origem, v_s.id, nullif(btrim(coalesce(p_reason, '')), ''), auth.uid());

  return to_jsonb(v_b);
end;
$function$;
```

### 3.5 Cancelar reserva e cancelar sessão

Versão vigente do cancelamento de reserva: recusa reserva `no_show`, para não apagar a ausência do histórico.

*Fonte: `supabase/migrations/20261110140000_legacycs_impulsao_kickoffs_ausencia_participante.sql, linhas 150–185`*

```sql
-- Igual à Fase 2 + recusa reserva com ausência registrada.
create or replace function legacycs.impulsao_kickoff_cancel_booking(p_booking_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'legacycs'
as $function$
declare
  v_b legacycs.impulsao_kickoff_bookings%rowtype;
begin
  perform legacycs._impulsao_kickoff_begin_write();

  select * into v_b from legacycs.impulsao_kickoff_bookings where id = p_booking_id for update;
  if v_b.id is null then
    raise exception 'Reserva não encontrada.' using errcode = 'P0002';
  end if;
  if v_b.status = 'cancelled' then
    raise exception 'Esta reserva já está cancelada.' using errcode = '22023';
  end if;
  if v_b.status = 'no_show' then
    raise exception 'Reserva com ausência registrada não pode ser cancelada.' using errcode = '22023';
  end if;

  update legacycs.impulsao_kickoff_bookings
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = auth.uid(),
         cancel_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         updated_by = auth.uid(),
         updated_at = now()
   where id = v_b.id
  returning * into v_b;

  return to_jsonb(v_b);
end;
$function$;
```

**`impulsao_kickoff_cancel_session(p_id, p_reason)`** (reservas, vigente):
- admin + fila;
- `for update` na sessão;
- `P0002` se não existe; `22023` se já cancelada;
- **recusa se houver reserva `active`**: "Esta sessão tem N empresa(s) inscrita(s). Remaneje ou cancele as reservas antes, ou cancele a sessão junto com as reservas.";
- caso contrário, `status='cancelled'`, `cancelled_by_recurrence=false`.

Cancelar a sessão junto com as reservas é uma **decisão explícita**, em outra função:

*Fonte: `supabase/migrations/20261110120000_legacycs_impulsao_kickoffs_reservas.sql, linhas 704–753`*

```sql
-- Decisão explícita: cancela a sessão E as reservas ativas dela (todas
-- ficam no histórico). Nada é remanejado sozinho.
create or replace function legacycs.impulsao_kickoff_cancel_session_and_bookings(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'legacycs'
as $function$
declare
  v_s legacycs.impulsao_kickoff_sessions%rowtype;
  v_motivo text := nullif(btrim(coalesce(p_reason, '')), '');
  v_reservas int;
begin
  perform legacycs._impulsao_kickoff_begin_write();

  select * into v_s from legacycs.impulsao_kickoff_sessions where id = p_id for update;
  if v_s.id is null then
    raise exception 'Sessão não encontrada.' using errcode = 'P0002';
  end if;
  if v_s.status = 'cancelled' then
    raise exception 'Esta sessão já está cancelada.' using errcode = '22023';
  end if;

  with alvo as (
    update legacycs.impulsao_kickoff_bookings
       set status = 'cancelled',
           cancelled_at = now(),
           cancelled_by = auth.uid(),
           cancel_reason = 'Sessão cancelada' || coalesce(': ' || v_motivo, ''),
           updated_by = auth.uid(),
           updated_at = now()
     where session_id = v_s.id and status = 'active'
    returning 1
  )
  select count(*) into v_reservas from alvo;

  update legacycs.impulsao_kickoff_sessions
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = auth.uid(),
         cancel_reason = v_motivo,
         cancelled_by_recurrence = false,
         updated_by = auth.uid(),
         updated_at = now()
   where id = v_s.id
  returning * into v_s;

  return jsonb_build_object('session', to_jsonb(v_s), 'bookings_cancelled', v_reservas);
end;
$function$;
```

### 3.6 Ausência e edição do participante

- **Ausência:**
  - só depois do **fim** da sessão (`starts_at + duration_minutes <= now()`);
  - nunca em cancelada; não repete;
  - `no_show` **não é `active`**: o índice único libera a empresa para agendar de novo;
  - a vaga continua contada em `booked_count`;
  - nada é marcado sozinho.
- **Edição:** valida como a reserva, recusa reserva cancelada (`no_show` pode ser corrigida), não grava histórico se nada mudou.

*Fonte: `supabase/migrations/20261110140000_legacycs_impulsao_kickoffs_ausencia_participante.sql, linhas 187–228`*

```sql
-- Registra que a empresa não compareceu. Só depois do fim da sessão.
create or replace function legacycs.impulsao_kickoff_mark_no_show(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'legacycs'
as $function$
declare
  v_b legacycs.impulsao_kickoff_bookings%rowtype;
  v_s legacycs.impulsao_kickoff_sessions%rowtype;
begin
  perform legacycs._impulsao_kickoff_begin_write();

  select * into v_b from legacycs.impulsao_kickoff_bookings where id = p_booking_id for update;
  if v_b.id is null then
    raise exception 'Reserva não encontrada.' using errcode = 'P0002';
  end if;
  if v_b.status = 'cancelled' then
    raise exception 'Reserva cancelada não pode ser marcada como ausência.' using errcode = '22023';
  end if;
  if v_b.status = 'no_show' then
    raise exception 'A ausência desta empresa já foi registrada.' using errcode = '22023';
  end if;

  select * into v_s from legacycs.impulsao_kickoff_sessions where id = v_b.session_id;
  if v_s.starts_at + make_interval(mins => v_s.duration_minutes) > now() then
    raise exception 'A ausência só pode ser registrada depois que a sessão terminar.'
      using errcode = '22023';
  end if;

  update legacycs.impulsao_kickoff_bookings
     set status = 'no_show',
         no_show_at = now(),
         no_show_by = auth.uid(),
         updated_by = auth.uid(),
         updated_at = now()
   where id = v_b.id
  returning * into v_b;

  return to_jsonb(v_b);
end;
$function$;
```

*Fonte: `supabase/migrations/20261110140000_legacycs_impulsao_kickoffs_ausencia_participante.sql, linhas 230–296`*

```sql
-- Corrige nome, e-mail e telefone do participante. Guarda os dados
-- anteriores; não muda estado, sessão, empresa nem plan_tenant_id.
create or replace function legacycs.impulsao_kickoff_update_participant(
  p_booking_id uuid,
  p_participant_name text,
  p_participant_email text,
  p_participant_phone text
)
returns jsonb
language plpgsql
security definer
set search_path to 'legacycs'
as $function$
declare
  v_nome text := nullif(btrim(coalesce(p_participant_name, '')), '');
  v_email text := lower(nullif(btrim(coalesce(p_participant_email, '')), ''));
  v_fone text := nullif(btrim(coalesce(p_participant_phone, '')), '');
  v_b legacycs.impulsao_kickoff_bookings%rowtype;
begin
  perform legacycs._impulsao_kickoff_begin_write();

  -- Mesmas regras de impulsao_kickoff_book.
  if v_nome is null or char_length(v_nome) < 2 then
    raise exception 'Informe o nome do participante principal.' using errcode = '22023';
  end if;
  if v_email is null and v_fone is null then
    raise exception 'Informe o e-mail ou o telefone do participante.' using errcode = '22023';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'E-mail do participante inválido.' using errcode = '22023';
  end if;
  if v_fone is not null
     and char_length(regexp_replace(v_fone, '\D', '', 'g')) not between 8 and 15 then
    raise exception 'Telefone do participante inválido.' using errcode = '22023';
  end if;

  select * into v_b from legacycs.impulsao_kickoff_bookings where id = p_booking_id for update;
  if v_b.id is null then
    raise exception 'Reserva não encontrada.' using errcode = 'P0002';
  end if;
  if v_b.status = 'cancelled' then
    raise exception 'Reserva cancelada não pode ser editada.' using errcode = '22023';
  end if;

  -- Nada mudou: não grava histórico à toa.
  if (v_b.participant_name, v_b.participant_email, v_b.participant_phone)
       is not distinct from (v_nome, v_email, v_fone) then
    return to_jsonb(v_b);
  end if;

  insert into legacycs.impulsao_kickoff_participant_edits
    (booking_id, previous_name, previous_email, previous_phone, changed_by)
  values
    (v_b.id, v_b.participant_name, v_b.participant_email, v_b.participant_phone, auth.uid());

  update legacycs.impulsao_kickoff_bookings
     set participant_name = v_nome,
         participant_email = v_email,
         participant_phone = v_fone,
         updated_by = auth.uid(),
         updated_at = now()
   where id = v_b.id
  returning * into v_b;

  return to_jsonb(v_b);
end;
$function$;
```

### 3.7 Estados da sessão e o que cada um permite

| Situação da sessão | Nova reserva | Remanejar para ela | Editar sessão | Cancelar sessão | Ausência |
|---|---|---|---|---|---|
| `open`, futura, com vaga | sim | sim | sim (capacidade ≥ inscritas) | só sem inscritos (ou a função "com reservas") | não |
| `open`, futura, lotada | não ("Sessão lotada: X de Y empresas.") | não | sim | idem | não |
| `blocked` | não | não | sim | idem | não |
| `cancelled` | não | não | não | não | não |
| Começou / em andamento | não | não | não ("já começou") | **sim** (não há trava de horário) | não |
| Terminou | não | não | não | sim | **sim** |

**Agenda do CS (classe 2, substituída pelo Meet), resumida:**
- `impulsao_kickoff_sync()` gera as próximas **8 semanas** de cada horário ativo. É idempotente pela vaga `(recurrence_id, slot_date)`.
- Não move nem cancela sessão **com reserva ativa** (devolve `kept`).
- Não mexe em sessão `adjusted` nem no passado.
- Sessão extra e edição recusam outra sessão **no mesmo `starts_at`**. Sobreposição de horários diferentes **não** é barrada.
- **No Meet,** recorrência, conflitos e bloqueios vêm da agenda. As regras que precisam sobreviver são: **não mexer em evento com reserva ativa sem decisão explícita** e **não apagar evento com histórico**.

### 3.8 Pseudocódigo das transações (resumo fiel)

```
book(sessao, empresa, participante):          -- admin
  begin_write()                                -- admin + advisory lock global
  validar(nome 2..200; email OU telefone; formatos)
  empresa existe, não apagada, com plan_tenant_id   (só leitura)
  se empresa tem reserva active -> 23505 (mesma sessão: "já inscrita"; outra: "remaneje")
  s := lock_open_session(sessao)               -- FOR UPDATE + estado + futuro + contagem active < capacity
  insert reserva(active, plan_tenant_id copiado)  -- unique_violation -> 23505
move(reserva, destino):
  begin_write(); reserva FOR UPDATE; deve estar active; destino != origem
  lock_open_session(destino); update session_id; insert booking_moves(origem, destino)
cancel_booking(reserva): begin_write(); FOR UPDATE; recusa cancelled e no_show; status=cancelled (libera vaga)
mark_no_show(reserva):   begin_write(); FOR UPDATE; recusa cancelled/no_show; exige sessão terminada; status=no_show
update_participant:      begin_write(); valida; FOR UPDATE; recusa cancelled; se mudou: insert edits(anteriores) + update
```

---

## 4. Convites empresariais e agendamento público [PROD]

### 4.1 Modelo

**`legacycs.impulsao_kickoff_invites`:**
- `id`, `code text unique` com `check (code ~ '^[a-hj-km-np-z2-9]{12}$')`;
- `client_id` (FK `clients`), `plan_tenant_id text` (cópia, do momento da geração);
- `created_by`, `created_at`, `revoked_at`, `revoked_by`;
- único parcial `(client_id) where revoked_at is null`: **um convite válido por empresa**;
- leitura só admin; escrita só pelas funções.

**`legacycs.impulsao_kickoff_public_throttle`:**
- `key text pk`, `window_started_at`, `hits`, numa janela fixa por chave;
- ninguém lê nem escreve direto;
- linhas com mais de 1 dia são apagadas a cada uso.

**`impulsao_kickoff_bookings.invite_id`:** qual convite fez a reserva.

**O código:**
- 12 caracteres do alfabeto `abcdefghjkmnpqrstuvwxyz23456789` (31 símbolos, sem `0/o/1/l/i`), cerca de 7,9·10¹⁷ combinações;
- sorteado com `gen_random_bytes`;
- **o código é a única coisa no link**: nada de id, CNPJ ou nome da empresa.

*Fonte: `supabase/migrations/20261110160000_legacycs_impulsao_kickoffs_convite_publico.sql, linhas 92–104`*

```sql
-- Código de 12 caracteres, do mesmo jeito que o generate_short_code faz o de 8.
create or replace function legacycs._impulsao_kickoff_invite_code()
returns text
language sql
volatile
set search_path to 'legacycs'
as $function$
  select string_agg(
           substr('abcdefghjkmnpqrstuvwxyz23456789', 1 + (get_byte(b.bytes, i) % 31), 1),
           '' order by i)
    from (select extensions.gen_random_bytes(12) as bytes) b,
         generate_series(0, 11) i;
$function$;
```

### 4.2 Gerar e trocar convite (admin)

- `impulsao_kickoff_invite_for_client(p_client_id uuid) → {"code", "created_at", "reused"}`:
  - devolve o convite válido ou cria um;
  - se o `plan_tenant_id` da empresa mudou, revoga o antigo e cria outro.
- `impulsao_kickoff_renew_invite(p_client_id uuid) → {"code", "created_at", "reused": false, "revoked": n}`: revoga o válido (o link antigo **para de abrir**) e cria outro.
- **Empresa elegível** (`_impulsao_kickoff_invite_client`): existe, não apagada, `produto = 'impulsao_empresarial'`, com `plan_tenant_id`.
- **Tela:** `src/components/customer360/convite-do-kickoff.tsx` monta `linkDoAgendamento(window.location.origin, code)` → `<origem>/agendar/<code>`.

*Fonte: `supabase/migrations/20261110160000_legacycs_impulsao_kickoffs_convite_publico.sql, linhas 106–132`*

```sql
-- Cria um convite válido para a empresa (a anterior já foi revogada ou não existe).
create or replace function legacycs._impulsao_kickoff_new_invite(p_client_id uuid, p_plan_tenant_id text)
returns legacycs.impulsao_kickoff_invites
language plpgsql
security definer
set search_path to 'legacycs'
as $function$
declare
  v_inv legacycs.impulsao_kickoff_invites%rowtype;
begin
  -- Código repetido é quase impossível; se acontecer, sorteia de novo.
  for i in 1..5 loop
    begin
      insert into legacycs.impulsao_kickoff_invites (code, client_id, plan_tenant_id, created_by)
      values (legacycs._impulsao_kickoff_invite_code(), p_client_id, p_plan_tenant_id, auth.uid())
      returning * into v_inv;
      return v_inv;
    exception when unique_violation then
      if exists (select 1 from legacycs.impulsao_kickoff_invites
                  where client_id = p_client_id and revoked_at is null) then
        raise;
      end if;
    end;
  end loop;
  raise exception 'Não foi possível gerar o convite. Tente de novo.' using errcode = 'P0001';
end;
$function$;
```

### 4.3 Abertura do convite e limite de tentativas

- **Origem do visitante:** `'ip:' || md5(primeiro IP de x-forwarded-for)`, lida do cabeçalho que o PostgREST repassa. Guarda só o hash.
- **Limite por origem:** código errado ou revogado conta tentativa. **10 em 15 minutos bloqueiam a origem**, inclusive para código certo; senão o bloqueio revelaria qual código existe.
- **Limite por convite:** 10 pedidos de reserva em 15 minutos (`'reserva:' || invite_id`).

*Fonte: `supabase/migrations/20261110160000_legacycs_impulsao_kickoffs_convite_publico.sql, linhas 163–176`*

```sql
-- Origem do pedido público: IP do visitante como o Supabase repassa
-- (x-forwarded-for, primeiro da lista), guardado só em hash. Sem cabeçalho
-- (chamada fora da API), todos caem na mesma chave.
create or replace function legacycs._impulsao_kickoff_public_origin()
returns text
language sql
stable
set search_path to 'legacycs'
as $function$
  select 'ip:' || md5(coalesce(nullif(btrim(split_part(
           coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json
             ->> 'x-forwarded-for',
           ',', 1)), ''), '?'));
$function$;
```

*Fonte: `supabase/migrations/20261110160000_legacycs_impulsao_kickoffs_convite_publico.sql, linhas 178–202`*

```sql
-- Conta uma tentativa na janela da chave. True = passou do limite.
create or replace function legacycs._impulsao_kickoff_throttle_hit(p_key text, p_limit int, p_window interval)
returns boolean
language plpgsql
security definer
set search_path to 'legacycs'
as $function$
declare
  v_hits int;
begin
  -- Janelas velhas não servem para nada: a tabela fica com as chaves do dia.
  delete from legacycs.impulsao_kickoff_public_throttle
   where window_started_at < now() - interval '1 day';

  insert into legacycs.impulsao_kickoff_public_throttle as t (key, window_started_at, hits)
  values (p_key, now(), 1)
  on conflict (key) do update
     set hits = case when t.window_started_at <= now() - p_window then 1 else t.hits + 1 end,
         window_started_at = case when t.window_started_at <= now() - p_window
                                  then now() else t.window_started_at end
  returning hits into v_hits;

  return v_hits > p_limit;
end;
$function$;
```

*Fonte: `supabase/migrations/20261110160000_legacycs_impulsao_kickoffs_convite_publico.sql, linhas 218–253`*

```sql
-- Abre o convite do link. Devolve {"status": "ok", "invite_id", "client_id"}
-- (só para as funções públicas; nunca sai para o visitante) ou o motivo.
-- Código errado ou revogado conta como tentativa da origem; 10 em 15 minutos
-- bloqueiam a origem até a janela acabar, inclusive para código certo (senão
-- o bloqueio ainda diria qual código existe).
create or replace function legacycs._impulsao_kickoff_public_open(p_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'legacycs'
as $function$
declare
  v_origem text := legacycs._impulsao_kickoff_public_origin();
  v_inv legacycs.impulsao_kickoff_invites%rowtype;
begin
  if legacycs._impulsao_kickoff_throttle_blocked(v_origem, 10, interval '15 minutes') then
    return jsonb_build_object('status', 'muitas_tentativas');
  end if;

  select * into v_inv from legacycs.impulsao_kickoff_invites
   where code = lower(btrim(coalesce(p_code, '')));
  if v_inv.id is null then
    perform legacycs._impulsao_kickoff_throttle_hit(v_origem, 10, interval '15 minutes');
    return jsonb_build_object('status', 'convite_invalido');
  end if;
  if v_inv.revoked_at is not null then
    perform legacycs._impulsao_kickoff_throttle_hit(v_origem, 10, interval '15 minutes');
    return jsonb_build_object('status', 'convite_revogado');
  end if;
  if not exists (select 1 from legacycs.clients where id = v_inv.client_id and deleted_at is null) then
    return jsonb_build_object('status', 'convite_invalido');
  end if;

  return jsonb_build_object('status', 'ok', 'invite_id', v_inv.id, 'client_id', v_inv.client_id);
end;
$function$;
```

### 4.4 Funções públicas (anon): os dois únicos pontos de entrada do visitante

**`impulsao_kickoff_public_invite(p_code text) → jsonb`**: tudo o que a página mostra, só da empresa do convite.

```
{"status": "ok",
 "empresa": {"nome": "<trading_name ou name>", "documento": "<CNPJ/CPF ou null>"},
 "vinculada": true|false,                       -- false = sem plan_tenant_id: não agenda
 "reserva": {"data","inicio","fim","starts_at","participante"} | null,   -- reserva ativa, se houver
 "participante": {"nome","email","telefone"},   -- sugestão: contato principal ativo, senão e-mail/telefone da empresa
 "sessoes": [{"id","data","inicio","fim","starts_at","vagas"}]}  -- só sem reserva e vinculada: open, futura, com vaga
ou {"status": "convite_invalido" | "convite_revogado" | "muitas_tentativas"}
```

**`impulsao_kickoff_public_book(p_code text, p_session_id uuid, p_participant_name text, p_participant_email text, p_participant_phone text) → jsonb`:**
- `{"status": "ok", "reserva": {...}}`: marcada. Também é a resposta para um pedido repetido na mesma sessão.
- `{"status": "ja_inscrita", "reserva": {...}}`: a empresa já tem kickoff em outra sessão.
- `{"status": "sessao_lotada" | "sessao_indisponivel" | "sem_vinculo" | "dados_invalidos" (+ "mensagem") | "muitas_tentativas" | "convite_invalido" | "convite_revogado"}`.
- **Casos esperados não levantam erro, devolvem status**, para a contagem de tentativas ser gravada (um erro desfaria a transação).
- A empresa sai **sempre** do convite, nunca do pedido.

*Fonte: `supabase/migrations/20261110160000_legacycs_impulsao_kickoffs_convite_publico.sql, linhas 417–516`*

```sql
-- Marca o kickoff da empresa do convite na sessão escolhida.
--   {"status": "ok", "reserva": {...}}            -- marcado (ou já estava nesta sessão)
--   {"status": "ja_inscrita", "reserva": {...}}   -- já tem kickoff em outra sessão
--   {"status": "sessao_lotada" | "sessao_indisponivel" | "sem_vinculo"
--             | "dados_invalidos" (+ "mensagem") | "muitas_tentativas"
--             | "convite_invalido" | "convite_revogado"}
create or replace function legacycs.impulsao_kickoff_public_book(
  p_code text,
  p_session_id uuid,
  p_participant_name text,
  p_participant_email text,
  p_participant_phone text
)
returns jsonb
language plpgsql
security definer
set search_path to 'legacycs'
as $function$
declare
  v_aberto jsonb := legacycs._impulsao_kickoff_public_open(p_code);
  v_invite_id uuid;
  v_client_id uuid;
  v_nome text := nullif(btrim(coalesce(p_participant_name, '')), '');
  v_email text := lower(nullif(btrim(coalesce(p_participant_email, '')), ''));
  v_fone text := nullif(btrim(coalesce(p_participant_phone, '')), '');
  v_cliente record;
  v_atual uuid;
  v_s legacycs.impulsao_kickoff_sessions%rowtype;
begin
  if v_aberto->>'status' <> 'ok' then
    return v_aberto;
  end if;
  v_invite_id := (v_aberto->>'invite_id')::uuid;
  v_client_id := (v_aberto->>'client_id')::uuid;

  -- Quem tem o link não fica martelando a reserva: 10 pedidos em 15 minutos.
  if legacycs._impulsao_kickoff_throttle_hit('reserva:' || v_invite_id, 10, interval '15 minutes') then
    return jsonb_build_object('status', 'muitas_tentativas');
  end if;

  -- Mesmas validações do impulsao_kickoff_book.
  if v_nome is null or char_length(v_nome) < 2 or char_length(v_nome) > 200 then
    return jsonb_build_object('status', 'dados_invalidos',
      'mensagem', 'Informe o nome de quem vai participar.');
  end if;
  if v_email is null and v_fone is null then
    return jsonb_build_object('status', 'dados_invalidos',
      'mensagem', 'Informe um e-mail ou um telefone.');
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('status', 'dados_invalidos', 'mensagem', 'E-mail inválido.');
  end if;
  if v_fone is not null
     and char_length(regexp_replace(v_fone, '\D', '', 'g')) not between 8 and 15 then
    return jsonb_build_object('status', 'dados_invalidos', 'mensagem', 'Telefone inválido.');
  end if;

  -- Mesma fila das funções do admin: reserva pública, reserva do admin e
  -- mudança na agenda acontecem uma de cada vez.
  perform pg_advisory_xact_lock(hashtext('legacycs.impulsao_kickoff_agenda'));

  -- Só leitura do cadastro.
  select c.id, c.plan_tenant_id, c.deleted_at into v_cliente
    from legacycs.clients c where c.id = v_client_id;
  if v_cliente.id is null or v_cliente.deleted_at is not null then
    return jsonb_build_object('status', 'convite_invalido');
  end if;
  if v_cliente.plan_tenant_id is null then
    return jsonb_build_object('status', 'sem_vinculo');
  end if;

  -- Uma reserva ativa por empresa. Pedido repetido para a mesma sessão (clique
  -- duplo, rede que reenviou) devolve a reserva que já existe.
  select b.session_id into v_atual
    from legacycs.impulsao_kickoff_bookings b
   where b.client_id = v_client_id and b.status = 'active';
  if v_atual is not null then
    return jsonb_build_object(
      'status', case when v_atual = p_session_id then 'ok' else 'ja_inscrita' end,
      'reserva', legacycs._impulsao_kickoff_public_booking(v_client_id));
  end if;

  -- Mesma trava e contagem da reserva do admin.
  begin
    v_s := legacycs._impulsao_kickoff_lock_open_session(p_session_id);
  exception when sqlstate '22023' or sqlstate 'P0002' then
    return jsonb_build_object('status',
      case when sqlerrm like 'Sessão lotada%' then 'sessao_lotada' else 'sessao_indisponivel' end);
  end;

  insert into legacycs.impulsao_kickoff_bookings
    (session_id, client_id, plan_tenant_id, participant_name, participant_email,
     participant_phone, invite_id)
  values
    (v_s.id, v_client_id, v_cliente.plan_tenant_id, v_nome, v_email, v_fone, v_invite_id);

  return jsonb_build_object('status', 'ok',
    'reserva', legacycs._impulsao_kickoff_public_booking(v_client_id));
end;
$function$;
```

Função que a página usa para mostrar a reserva existente:

*Fonte: `supabase/migrations/20261110160000_legacycs_impulsao_kickoffs_convite_publico.sql, linhas 255–272`*

```sql
-- Reserva ativa da empresa, no formato da página (sem ids).
create or replace function legacycs._impulsao_kickoff_public_booking(p_client_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'legacycs'
as $function$
  select jsonb_build_object(
           'data', s.local_date,
           'inicio', s.local_time,
           'fim', s.local_end_time,
           'starts_at', s.starts_at,
           'participante', b.participant_name)
    from legacycs.impulsao_kickoff_bookings b
    join legacycs.impulsao_kickoff_sessions_view s on s.id = b.session_id
   where b.client_id = p_client_id and b.status = 'active';
$function$;
```

### 4.5 Front da página pública (contratos)

`src/hooks/use-agendamento-publico.tsx` chama o banco direto com a chave anônima.
- `useConviteDoKickoff(codigo) → { resposta: RespostaDoConvite | null, carregando, erro, recarregar }`:
  - código fora do formato `ehCodigoDeConvite` nem vai ao banco e não gasta tentativa;
  - erro técnico vira texto genérico.
- `agendarKickoff(codigo, sessaoId, participante) → RespostaDoAgendamento`.
- `useAcessoAoZoom(codigo)` (E2, seção 7).

Os tipos estão em `src/lib/kickoffs-publico.ts`:

*Fonte: `src/lib/kickoffs-publico.ts, linhas 12–110`*

```ts
/** Mesmo alfabeto do código curto dos links (sem 0/o, 1/l/i), 12 caracteres. */
const CODIGO_DO_CONVITE = /^[a-hj-km-np-z2-9]{12}$/i;

export function ehCodigoDeConvite(trecho: string): boolean {
  return CODIGO_DO_CONVITE.test(trecho.trim());
}

/** Link que o admin copia na ficha do cliente. */
export function linkDoAgendamento(origem: string, codigo: string): string {
  return `${origem.replace(/\/+$/, "")}/agendar/${codigo}`;
}

export interface ReservaPublica {
  /** YYYY-MM-DD, Brasília. */
  data: string;
  /** HH:MM, Brasília. */
  inicio: string;
  fim: string;
  starts_at: string;
  participante: string;
}

export interface SessaoPublica {
  id: string;
  data: string;
  inicio: string;
  fim: string;
  starts_at: string;
  vagas: number;
}

export interface PaginaDoConvite {
  status: "ok";
  empresa: { nome: string; documento: string | null };
  /** false = empresa sem vínculo com o Legacy Plan: não agenda por aqui. */
  vinculada: boolean;
  reserva: ReservaPublica | null;
  participante: Participante;
  sessoes: SessaoPublica[];
}

export type RecusaDoConvite = "convite_invalido" | "convite_revogado" | "muitas_tentativas";

export type RespostaDoConvite = PaginaDoConvite | { status: RecusaDoConvite };

export type StatusDoAgendamento =
  | "ok"
  | "ja_inscrita"
  | "sessao_lotada"
  | "sessao_indisponivel"
  | "sem_vinculo"
  | "dados_invalidos"
  | RecusaDoConvite;

export interface RespostaDoAgendamento {
  status: StatusDoAgendamento;
  mensagem?: string;
  reserva?: ReservaPublica;
}

/** O link não abre: título e explicação para o visitante. */
export const AVISO_DA_RECUSA: Record<RecusaDoConvite, { titulo: string; texto: string }> = {
  convite_invalido: {
    titulo: "Link inválido",
    texto:
      "Não encontramos este link de agendamento. Confira se ele foi copiado inteiro ou peça um novo ao time da Legacy.",
  },
  convite_revogado: {
    titulo: "Este link foi substituído",
    texto: "Ele não vale mais. Peça o link atualizado ao time da Legacy.",
  },
  muitas_tentativas: {
    titulo: "Muitas tentativas seguidas",
    texto: "Por segurança, aguarde 15 minutos e abra o link de novo.",
  },
};

export const SEM_VINCULO =
  "Não é possível concluir o agendamento por este link. Fale com o time da Legacy para marcar o kickoff da sua empresa.";

/**
 * Mensagem para o que a confirmação recusou e a página continua aberta.
 * Null = a página troca de tela (agendado, já inscrita ou link recusado).
 */
export function avisoDoAgendamento(r: RespostaDoAgendamento): string | null {
  switch (r.status) {
    case "sessao_lotada":
      return "Este horário acabou de lotar. Escolha outro.";
    case "sessao_indisponivel":
      return "Este horário não está mais disponível. Escolha outro.";
    case "dados_invalidos":
      return r.mensagem ?? "Confira os dados de quem vai participar.";
    case "sem_vinculo":
      return SEM_VINCULO;
    default:
      return null;
  }
}
```

**Regra do participante** (`src/lib/kickoffs.ts`):
- nome com 2 caracteres ou mais;
- e-mail **ou** telefone; e-mail válido; telefone com 8 a 15 dígitos;
- desde a E2, **reserva nova exige e-mail**: `validarParticipante(p, { exigirEmail: true })`, na página pública e na reserva pelo admin;
- **o banco ainda aceita só telefone** (a função pública não mudou);
- edição de reserva antiga continua aceitando só telefone.

### 4.6 O que depende de `clients.id` do CS e como adaptar

| No CS | Por quê | No Meet **[ADAPTAR]** |
|---|---|---|
| `bookings.client_id`, `invites.client_id` (FK `legacycs.clients`) | O CS tem cadastro próprio de cliente | **Trocar por `tenant_id` = `client_tenants.id`.** Hoje `plan_tenant_id` já é cópia desse id: conferido por leitura em 12/11/2026, o único `plan_tenant_id` referenciado existe em `client_tenants` |
| Índice "uma reserva ativa por empresa" em `client_id` | Unicidade | Em `tenant_id` |
| Empresa elegível: `clients.produto = 'impulsao_empresarial'` e `plan_tenant_id` não nulo | Filtro do CS | Produto equivalente no `client_tenants` (**verificar** o campo e os valores) |
| Nome exibido: `coalesce(trading_name, name)`; documento: `tax_id` | Cadastro do CS | Campos de `client_tenants` (**verificar**) |
| Sugestão de participante: `legacycs.contacts` | Contatos do CS | Contatos ou usuários da empresa no Plan (**verificar**) |
| Convite revalida o vínculo (`plan_tenant_id` mudou → revoga) | `clients.plan_tenant_id` pode ser trocado na sincronização da carteira | Desnecessário com `tenant_id` direto |

**Não usar CNPJ como chave.** O CS mostra o CNPJ ou CPF só como informação; o vínculo é sempre o id.

---

## 5. Interface pública (reaproveitar o visual, trocar a fonte dos dados)

**Fluxo:** a rota pública (sem login, `noindex`) carrega o convite.
- **Estados possíveis:**
  - carregando;
  - erro de rede (com "Tentar de novo");
  - recusa: inválido, substituído ou muitas tentativas;
  - **reserva existente:** confirmação;
  - sem vínculo ou sem horários;
  - **formulário em 2 etapas:** ① "Dia e horário" (calendário) → ② "Confirmação" (resumo e participante).
- **Depois de agendar:** confirmação e "Acesso ao Zoom" (E2).
- **Anfitrião:** o bloco "Reunião conduzida por", com foto, nome e papel, vem de `ANFITRIAO_DO_KICKOFF` em `src/lib/kickoffs-publico.ts`. É **fixo nesta etapa**: o banco do CS não guarda anfitrião por sessão.

| Componente (arquivo) | Responsabilidade | Props / contrato | Reaproveitar no Meet |
|---|---|---|---|
| `AgendamentoPublico` (`agendamento-publico.tsx`) | Orquestra os estados da página | `{ codigo }` | **Sim, adaptando a fonte:** troca o RPC do CS pelo endpoint ou RPC do Meet com o **mesmo formato** `RespostaDoConvite` |
| `Moldura`, `PainelDuplo` | Cabeçalho da marca; painel em 2 colunas (≥1024 px), empilhado no celular | `{ largo?, children }`; `{ lateral, children }` | Sim (visual) |
| `PainelDoAnfitriao`, `FotoDoAnfitriao`, `Empresa` | Anfitrião, duração, fuso e empresa | `{ pagina, duracao, convidando? }` | Sim. **Anfitrião vem do evento ou perfil do Meet**, não da constante |
| `Etapas`, `Titulo` | Indicador de etapa; título focável | `{ atual: "horario" \| "confirmar" }` | Sim |
| `Formulario` | Escolha de horário, participante e confirmação; trata lotada ou indisponível (volta à etapa 1 e relê) | `{ codigo, pagina, atualizando, onAgendado, onRecusa, onRecarregar }` | Sim. Chamar o agendar do Meet |
| `BarraDaEscolha` | Barra fixa no pé com o horário escolhido e "Continuar" | `{ sessao, onContinuar }` | Sim |
| `ResumoDoHorario` | Resumo com "Trocar horário" | `{ pagina, sessao, onTrocar }` | Sim |
| `Confirmacao` | Tela de agendado ou reserva existente + bloco Zoom | `{ codigo, reserva, acabouDeAgendar }` | Sim |
| `CalendarioPublico` (`calendario-publico.tsx`) | Abas **Mês / Semana / Dia**, navegação, seleção, acessibilidade (`aria-pressed`, `aria-live`) | `{ sessoes: SessaoPublica[], hoje, visao, onVisao, dia, onDia, escolhida, onEscolher }` | **Sim, como está.** Só precisa de `SessaoPublica[]` (`id`, `data` YYYY-MM-DD, `inicio`/`fim` HH:MM em Brasília, `starts_at`, `vagas`) |
| Funções de `kickoffs-publico-calendario.ts` | Grade do mês (semana começa no domingo), limites de navegação, "Hoje/Amanhã", visão inicial (Mês ≥768 px, Dia no celular), `mostrarNaTela` (rola respeitando `prefers-reduced-motion`) | Funções puras de string de data, sem fuso do navegador | Sim |
| `AcessoAoZoom` (`acesso-zoom-publico.tsx`) | "Entrar na reunião pelo Zoom", "Copiar link do Zoom" (com campo para copiar à mão), estados preparando, sem e-mail e indisponível | `{ codigo, participante }` | Sim. No Meet, o botão pode apontar para `/impulsao/reuniao/<código>` em vez do `join_url` (ver handoff) |

**O que adaptar:**
1. **Fonte das sessões.** No CS, `sessoes` vem de `impulsao_kickoff_public_invite`. No Meet, deve vir dos **eventos de kickoff** com vaga, sem expor dados de outras empresas.
2. **Fuso.** Datas e horas chegam **já em Brasília** como texto, e o navegador nunca converte fuso para gravar. Manter.
3. **Tema e fontes** do Meet.
4. **Anfitrião** do evento.

**Não levar** o calendário administrativo do CS (`calendario-semanal`, `agenda-de-sessoes`, `barra-da-agenda`, `horarios-recorrentes`, `horario-dialog`, `sessao-dialog`, `kickoffs-calendario.ts`): a agenda do Meet substitui.

---

## 6. Zoom E1: cliente OAuth e sala [PROD]

### 6.1 App, variáveis e escopos

- **App:** **Server-to-Server OAuth do Legacy Plan** ("Legacy Plan - Zoom Integration"). Decisão da gestão: compartilhado, sem app novo.
- **Variáveis do servidor (só nomes):** `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`. Sem as três, a integração fica "não configurada" e nada é chamado. **Nunca no front.**
- **Escopos usados:**
  - E1: `meeting:read:meeting:admin`;
  - E2: `meeting:write:registrant:admin`, `meeting:read:registrant:admin`, `meeting:read:list_registrants:admin`.
  - Os da E3 (`meeting:read:list_past_instances:admin`, `report:read:meeting:admin`, `report:read:list_meeting_participants:admin`) **já estão habilitados** no app e ainda não são usados.
- **Tokens:**
  - pela doc oficial do Zoom, um app S2S pode ter vários tokens válidos ao mesmo tempo (pedir um novo não invalida os anteriores);
  - o token dura 1 hora e não há *refresh token*;
  - o Plan e o CS convivem com caches próprios;
  - não existe chamada de revogação; os tokens param se o app for desativado ou apagado;
  - **regenerar o Client Secret** obriga a atualizar o Plan e o CS juntos.
- **Limites da API:** valem **por conta Zoom**, somados entre todos os apps.

### 6.2 Cliente HTTP: `src/lib/zoom-api.ts`

Adaptado do Plan (`supabase/functions/_shared/zoom.ts`).
- **Token:** `grant_type=account_credentials`, guardado em memória até `expires_in − 60 s`; pedidos simultâneos esperam a mesma promise.
- **401:** descarta o token e repete **uma** vez.
- **Prazo:** 15 s por chamada; falha de rede ou prazo vira `ZoomApiError(0)`.
- **Erros:** `ZoomApiError{status, code}`.
- **Codificação:** Meeting ID com `encodeURIComponent`.
- **Logs:** nunca escreve nada. Sem dependência de Node ou Deno: `fetch` e relógio são injetáveis.

| Método | Chamada Zoom |
|---|---|
| `getAccessToken()` | `POST https://zoom.us/oauth/token?grant_type=account_credentials&account_id=…` (Basic `client_id:secret`) |
| `getMeeting(id)` | `GET /v2/meetings/{id}` |
| `addRegistrant(id, {email, first_name, last_name, org})` | `POST /v2/meetings/{id}/registrants` |
| `getRegistrant(id, registrantId)` | `GET /v2/meetings/{id}/registrants/{registrantId}` |
| `findRegistrantByEmail(id, email)` | `GET /v2/meetings/{id}/registrants?status=approved\|pending&page_size=300[&next_page_token]` (até 50 páginas por status) |

O código completo está no Apêndice A.

### 6.3 Regras da sala: `src/lib/kickoffs-zoom.ts`

- **`lerEntradaDaSala(texto)`:** aceita link `zoom.us/j|w|s|wc/join/<id>` ou ID com espaços, pontos ou hífens (9 a 12 dígitos). Se colarem o **link de inscrição** (`/meeting/register/`), explica que ele não traz o ID.
- **`avaliarSalaDoKickoff(meeting)`:** regras do Plan (`evaluateMeetingConfig`) **mais** a exigência da sala única, que precisa ser recorrente **com horário fixo** (tipo 8).
  - Problemas detectados: `instant_meeting`, `not_recurring` (tipo 2), `no_fixed_time` (tipo 3, não aceita inscrição), `registration_off`, `manual_approval`, `per_occurrence_registration`.
  - Aprovação exigida: `settings.approval_type = 0` e `settings.registration_type = 1`.
- **`resumoDaSala(meeting, agora)`:** **lista fechada** de campos gravados: tipo, aprovação, inscrição, fuso, duração, recorrência, quantidade de ocorrências futuras, próxima e última. **Nunca** `start_url`, `join_url` ou senha.
- **`avisosDaSala(resumo, agora)`:** sem ocorrências futuras, ou última ocorrência em até 30 dias. Não impede o uso; o comportamento depois da última ocorrência ainda não foi validado.
- **`describeCheckError`:** 404 ou código 3001 → "não encontrada"; 0, 429, 401/403 e outros → mensagem de nova tentativa, sem texto do Zoom.
- **`verificarSala(entrada, acesso, agora)`:** `entrada_invalida` | `nao_configurada` (+ nomes que faltam) | `erro` | `verificada{meetingId, ok, problemas, topic, resumo}`. **Não grava nada.**

**Validação real (11/11/2026):**
- a reunião de teste `88672328525` retornou "Configuração aprovada", recorrência semanal, inscrição única, aprovação automática e 6 ocorrências futuras;
- ela é a sala de uma **turma antiga de testes do Plan** e **não** é a sala de produção do Impulsão.

### 6.4 Banco da sala (aplicado)

- **Tabela `legacycs.impulsao_kickoff_zoom_rooms`:** uma sala ativa por vez; trocar desativa a anterior, que fica no histórico.
- **Ativar** exige verificação aprovada há menos de 2 h (gatilho, código `23514`). O Meeting ID de uma linha não muda e a linha não se apaga.
- **Permissões:** leitura para a equipe do CS; escrita só pelas funções `impulsao_kickoff_zoom_room_activate` e `impulsao_kickoff_zoom_room_record_check`, executáveis **só por `service_role`**. O servidor chama depois de consultar o Zoom.

SQL completo no Apêndice B.

### 6.5 Servidor e tela

`src/lib/kickoffs-zoom.server.ts` (server functions; o front manda o token da sessão e o servidor confere o papel em `legacycs.user_roles`):

| Função | Quem | Faz |
|---|---|---|
| `estadoDaSalaZoom({token})` | qualquer papel do CS | `{credenciais:{configuradas, faltando[]}, estrutura:"ok"\|"pendente", sala, podeEditar}` |
| `verificarSalaZoom({token, entrada})` | admin | Consulta o Zoom, sem gravar |
| `ativarSalaZoom({token, entrada})` | admin | **Verifica de novo** e, se aprovada, grava via RPC |
| `reverificarSalaZoom({token})` | admin | Verifica a sala ativa e grava o resultado, aprovado ou não; falha temporária não grava |

- **Tela:** aba "Sala Zoom" (`sala-zoom.tsx`) em `/kickoffs`.
- **No Meet:** essa configuração vai para a seção "Kickoffs Impulsão" e passa a exigir a permissão `kickoff_impulsao.manage` **[ADAPTAR]**.

---

## 7. Zoom E2: link individual por empresa [PENDENTE / LOCAL]

### 7.1 Ideia

- **Ao agendar:** a reserva é confirmada primeiro. Depois o servidor **procura ou cria** a inscrição do **participante principal** na sala ativa e devolve o `join_url` individual.
- **Ao reabrir o convite:** o mesmo link aparece.
- **Painel:** mostra o estado de cada reserva. Só admin copia o link.
- **Se o Zoom falhar:** a reserva continua; a página mostra "preparando", com nova tentativa.

### 7.2 Tabela `impulsao_kickoff_zoom_registrants`

- **Chave lógica:** `unique (zoom_meeting_id, email normalizado)`. A inscrição é da **sala**, não da sessão: remanejar mantém o link; trocar o e-mail gera outra chave e a antiga fica no histórico.
- **Vínculos:** `client_id`, `plan_tenant_id`, `tenant_code` (8 hex), `first_booking_id`, `last_booking_id`.
- **Dados da inscrição:** `participant_name`, `zoom_registrant_id` (único por sala), `join_url` (**credencial**), nome que o Zoom guardou, `zoom_name_matches`.
- **Controle:**
  - `status` `creating` | `ready` | `error` | `conflict`;
  - `attempts`, `claimed_at` (presente ⇔ `creating`), `last_attempt_at`;
  - `last_error` (texto seguro, ≤ 300);
  - `verified_at`, `ready_at`, `join_request_count`.
- **Acesso:** RLS ligada e **sem política**. Nem a equipe lê direto; só `service_role`. Nenhuma linha se apaga.

### 7.3 Funções (só `service_role`)

| Função | Contrato |
|---|---|
| `impulsao_kickoff_zoom_public_booking(p_code text, p_origem text)` | Convite → `{"status":"ok","booking_id"}` \| `sem_reserva` \| `convite_invalido` \| `convite_revogado` \| `muitas_tentativas`. Mesma trava de origem da página pública (`'ip:'+md5(ip)`), com o IP **repassado pelo servidor**; além disso, 60 pedidos por convite em 15 min |
| `impulsao_kickoff_zoom_registrant_decide(p_booking_id uuid, p_mode text)` | Antes de chamar o Zoom, com trava por sala+e-mail. Modos: `normal` \| `tentar_de_novo` \| `refazer`. Devolve `indisponivel(+motivo)` \| `conflito(+motivo)` \| `aguardar` \| `aguardar_erro(+erro)` \| `reaproveitar(+inscricao, contexto)` \| `criar(+inscricao{id}, contexto)` |
| `impulsao_kickoff_zoom_registrant_finish(p_id, p_status, p_zoom_registrant_id, p_join_url, p_first_name, p_last_name, p_org, p_name_matches, p_error) → boolean` | Grava o resultado; só conclui quem está em `creating` |
| `impulsao_kickoff_zoom_registrant_verified(p_id)` | Marca a conferência |
| `impulsao_kickoff_zoom_session_access(p_session_id)` | `[{booking_id, estado, email, join_url (só pronto), erro, nome_confere, atualizado_em}]`, com estados `pronto` \| `preparando` \| `pendente` \| `sem_email` \| `sem_sala` \| `conflito` \| `erro` \| `sem_acesso` |

**Decisão do banco (`decide`), na ordem:**
1. Reserva inexistente ou não `active` → `indisponivel: reserva_inativa`.
2. Sem e-mail válido → `sem_email`. Sem sala ativa → `sem_sala`. `plan_tenant_id` fora do formato UUID → `empresa_sem_codigo`.
3. Trava `pg_advisory_xact_lock(hashtext('...registrant:' || sala || ':' || email))` e `select ... for update` da inscrição.
4. Sem inscrição: se a sala tem problemas → `sala_com_problemas`; senão **insere em `creating`** → `criar`.
5. Inscrição de **outra empresa** → `conflito: outra_empresa`, sem escrever.
6. `ready` (e modo ≠ `refazer`) → atualiza `last_booking_id` e contadores → `reaproveitar`.
7. `creating` há menos de **2 min** → `aguardar` (outro pedido está criando).
8. `conflict` em modo `normal` → `conflito: zoom`. `error` em modo `normal` há menos de **15 s** → `aguardar_erro`.
9. Senão volta para `creating` (tentativas +1) → `criar`.

### 7.4 Orquestração: `garantirInscricao` (`src/lib/kickoffs-zoom-inscricao.ts`)

**Nunca lança.** Falha do Zoom vira `{estado:"erro", mensagem}` com texto seguro, gravado para a equipe.

1. **Reaproveitar:** se a inscrição foi verificada há menos de 6 h, devolve o link. Senão, lê a inscrição no Zoom:
   - 404 ou status não utilizável → **refaz**;
   - Zoom fora do ar → **entrega o link guardado**.
2. **Criar:**
   - `GET /meetings/{id}` + `checkMeetingConfig`; se falhar, grava erro;
   - `buildRegistrantIdentity` monta **`Nome | Empresa #CÓDIGO`**, com `CÓDIGO = tenantCode(plan_tenant_id)`, o mesmo do Plan;
   - `POST registrants`; se der erro 4xx comum, `findRegistrantByEmail` (Plan);
   - depois, **`GET` da inscrição para conferir o código no nome**. Se o Zoom já tinha o e-mail com o código de **outra empresa** → `conflict`, **sem entregar o link**;
   - grava `ready`.
3. **Utilitários do Plan** (cópia da lógica, só os textos mudaram): `tenantCode`, `isValidEmail`, `buildRegistrantIdentity` (nome padrão "Participante"), `extractTenantCode`, `checkMeetingConfig`, `describeZoomError`, `registrantStillUsable`, `shouldLookupExistingAfterAddError`.

Código completo no Apêndice C.

### 7.5 Servidor: `src/lib/kickoffs-zoom-acesso.server.ts`

| Server function | Quem | Contrato |
|---|---|---|
| `acessoZoomDoConvite({codigo})` | **público** (sem login) | Só o código vai do navegador. O IP do visitante sai de `cf-connecting-ip`, `x-forwarded-for` ou `x-real-ip`. Resposta: `{status:"ok", estado:"pronto", joinUrl}` \| `{status:"ok", estado:"preparando"\|"sem_email"\|"indisponivel"}` \| `{status:"sem_reserva"\|"convite_invalido"\|"convite_revogado"\|"muitas_tentativas"}`. Erro, conflito e problema de sala **nunca** são detalhados ao cliente |
| `acessosZoomDaSessao({token, sessionId})` | qualquer papel do CS | `{integracao:{configurada, faltando[]}, estrutura, podeGerar, acessos[]}`. **`join_url` só para admin** |
| `gerarAcessoZoom({token, bookingId, tentarDeNovo?})` | admin | `ResultadoDaInscricao` |

**Telas:**
- **Página pública:** e-mail obrigatório, com o motivo ("é por ele que criamos o acesso individual ao Zoom"). Na confirmação, o bloco `AcessoAoZoom`, com 4 novas tentativas automáticas a cada 5 s e depois "Tentar novamente".
- **Painel (`detalhes-da-sessao.tsx`):**
  - cada reserva mostra o e-mail e o estado;
  - copiar e gerar ou tentar de novo só para admin;
  - **ao abrir a sessão, gera sozinho o acesso de reservas ativas com e-mail que ainda não têm**, uma vez por abertura.

### 7.6 Segurança dos links

- O navegador público manda **só o código do convite**. A empresa e a reserva saem do convite no banco; nunca se aceita `client_id`, `booking_id`, `plan_tenant_id` ou Meeting ID vindos do navegador.
- A tabela de inscrições é fechada; o servidor decide quem vê o link (o visitante da própria empresa ou um admin).
- Nada é logado: nem token, nem secret, nem e-mail, nem `join_url`.
- **Verificado no navegador (com fakes):**
  - respostas e tela sem credenciais nem dados da reunião (`start_url`, senha);
  - a página de uma empresa não mostra o link de outra;
  - o viewer não recebe nenhum `join_url`.
- **Bundle do navegador:** confirmado, no build, que ele não contém o cliente do Zoom nem os nomes das funções do servidor.

### 7.7 Limitações conhecidas

- **E-mail obrigatório só na tela.** Um pedido montado por fora ainda grava reserva só com telefone; ela fica com o acesso pendente.
- **O CS não cancela inscrições no Zoom.** E-mail trocado e reserva cancelada mantêm o link antigo **funcionando no Zoom**. A coleta de presença (E3) precisará sinalizar "sem reserva".
- **Nome no Zoom não muda:** trocar o nome do participante não altera a inscrição (comportamento do Plan).
- **Representantes:** só o principal tem link individual. Os demais usam o mesmo link (depende da opção "vários dispositivos" da sala) ou entram sem identificação.
- **Gerar sozinho no painel:** com a migration aplicada e uma sala ativa, abrir uma sessão gera inscrições reais. Com a sala de **teste** ativa, reservas reais iriam para ela.
- **Pendências na sala única (E3, não validado com dados reais):** separação de várias execuções; sessões próximas no mesmo dia (2 por dia previstas, a janela −30/+60 do Plan não serve com menos de 90 min entre sessões); comportamento depois da última ocorrência (limite de 50 ocorrências; o ID expira 365 dias após o último uso).

SQL completo da migration pendente no Apêndice D.

---

## 8. Testes

O repositório usa vitest. **PGlite** (Postgres 18 em memória) roda as **migrations reais** com um ambiente mínimo do banco RH (`src/lib/kickoffs-banco-ambiente.ts`): papéis `anon`/`authenticated`/`service_role`, `auth.uid()` lido de `request.jwt.claim.sub`, `has_role` e `current_user_role` iguais ao banco, `clients` e `contacts` reduzidos, e privilégios padrão do schema. Sem rede.

**Comandos:**
- `npx vitest run --maxWorkers=2 src/lib/kickoffs*.test.ts src/lib/zoom-api.test.ts`;
- suíte inteira: 524 testes, 24 arquivos, todos passando em 12/11/2026.

| Arquivo | Testes | Cobre |
|---|---|---|
| `kickoffs-banco.test.ts` | 36 | Agenda: geração 8 semanas, idempotência, edição, bloqueio, extra, cancelamento, permissões |
| `kickoffs-reservas-banco.test.ts` | 31 | Capacidade, **disputa pela última vaga**, uma ativa por empresa (inclusive simultânea), remanejar, cancelar, sessão com inscritos, permissões |
| `kickoffs-ausencia-banco.test.ts` | 17 | Ausência só após o fim, libera a empresa, histórico; edição do participante |
| `kickoffs-convite-banco.test.ts` | 25 | Código, revogação, elegibilidade, página pública, reserva pública, **limites de tentativa**, isolamento entre empresas |
| `kickoffs-zoom-sala-banco.test.ts` | 13 | Sala: ativar, trocar, reativar, travas, permissões |
| `kickoffs-zoom-inscricao-banco.test.ts` | 24 | Inscrição com banco real + Zoom falso: criar, reaproveitar, **simultâneos**, falha e nova tentativa, conflito, troca de e-mail, remanejamento, convite → reserva, painel, permissões |
| `zoom-api.test.ts` | 20 | Token, cache, renovação, 401, prazo, erros, inscrições |
| `kickoffs-zoom.test.ts` | 30 | Regras da sala, resumo sem segredos, avisos, credenciais |
| `kickoffs-zoom-inscricao.test.ts` | 14 | `tenantCode`, nome no Zoom, regras do Plan, o que o público vê |
| `kickoffs.test.ts` / `kickoffs-calendario.test.ts` / `kickoffs-publico*.test.ts` | 20 / 13 / 11 + 21 | Validações, textos, datas dos calendários |

**Cenários a portar para o Meet.** Os nomes dos testes do CS são o roteiro:
- disputa pela última vaga: só uma entra;
- a mesma empresa em duas sessões ao mesmo tempo: só uma reserva fica;
- o banco barra a segunda reserva ativa mesmo inserida à mão;
- recusa destino lotado, bloqueado, cancelado, passado ou a própria sessão;
- cancelar sessão com inscritos exige decisão explícita;
- mudar a recorrência não mexe em sessão com inscritos;
- ausência só depois do fim e libera a empresa sem abrir vaga;
- 10 códigos errados bloqueiam a origem por 15 min, até para código certo;
- mais de 10 pedidos de reserva em 15 min pelo mesmo convite são recusados;
- o visitante não chama funções de admin nem lê tabelas;
- dois pedidos de acesso Zoom simultâneos → uma inscrição só;
- e-mail de outra empresa → conflito, sem chamar o Zoom;
- Zoom fora → reserva mantida, erro seguro, nova tentativa.

---

## Apêndice A: `src/lib/zoom-api.ts` (completo)

*Fonte: `src/lib/zoom-api.ts (arquivo completo)`*

```ts
// Cliente mínimo da API do Zoom (v2) com Server-to-Server OAuth.
//
// Adaptado do Legacy Plan (supabase/functions/_shared/zoom.ts, commit
// 2a8c0c84; guia técnico da integração, seção 1 e Apêndice B.1) com só o que já
// é usado: o token, a leitura da reunião (E1) e as inscrições (E2). Relatórios
// entram na E3 como métodos novos sobre o mesmo `request`.
// Diferença em relação ao Plan: cada chamada tem prazo (`timeoutMs`), e falha
// de rede ou prazo esgotado vira ZoomApiError com status 0.
//
// Não lê process.env nem fala com o Supabase: credenciais, fetch e relógio
// chegam de fora, e tudo é testado no vitest. Quem monta o cliente com as
// credenciais do ambiente é o servidor (kickoffs-zoom.server.ts).
//
// Token: grant_type=account_credentials. Fica em memória até `expires_in`
// menos uma folga; um 401 da API invalida o cache e repete a chamada UMA vez
// com token novo (token revogado ou trocado antes da hora). Pedidos
// simultâneos durante a renovação esperam a mesma promise.
//
// Nunca loga nada. As mensagens de erro levam só o status HTTP e o código do
// Zoom: nunca token, secret, e-mail ou link.

export interface ZoomCredentials {
  accountId: string;
  clientId: string;
  clientSecret: string;
}

export interface ZoomClientOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  apiBase?: string;
  oauthUrl?: string;
  /** Prazo de cada chamada ao Zoom. Padrão: 15 s. */
  timeoutMs?: number;
}

/**
 * Erro da API do Zoom com status HTTP e `code` do corpo ({code, message}).
 * Status 0 = não houve resposta (rede ou prazo esgotado).
 */
export class ZoomApiError extends Error {
  readonly status: number;
  readonly code: number | null;

  constructor(status: number, code: number | null, message: string) {
    super(message);
    this.name = "ZoomApiError";
    this.status = status;
    this.code = code;
  }
}

export interface ZoomMeetingOccurrence {
  occurrence_id?: string;
  start_time?: string;
  duration?: number;
  /** available | deleted */
  status?: string;
}

export interface ZoomMeeting {
  id: number;
  topic?: string;
  /** 1 instantânea, 2 agendada, 3 recorrente sem horário fixo, 8 recorrente com horário fixo. */
  type: number;
  timezone?: string;
  duration?: number;
  recurrence?: {
    /** 1 diária, 2 semanal, 3 mensal. */
    type?: number;
    repeat_interval?: number;
    end_times?: number;
    end_date_time?: string;
  };
  /** Ocorrências que ainda vão acontecer (o Zoom não lista as passadas por padrão). */
  occurrences?: ZoomMeetingOccurrence[];
  /** Link de início do anfitrião (contém ZAK, expira ~2 h). Nunca guardar nem logar. */
  start_url?: string;
  /** Link genérico da reunião. Nunca guardar nem logar. */
  join_url?: string;
  /** Senha em texto. Nunca guardar nem logar. */
  password?: string;
  settings?: {
    /** 0 aprovação automática, 1 manual, 2 sem inscrição. */
    approval_type?: number;
    /** Só recorrentes: 1 inscreve uma vez p/ todas, 2 inscreve em cada, 3 escolhe ocorrências. */
    registration_type?: number;
  };
}

export interface ZoomRegistrantInput {
  email: string;
  first_name: string;
  last_name?: string;
  org?: string;
}

export interface ZoomRegistrantCreated {
  registrant_id: string;
  /** Link individual da inscrição: credencial, nunca logar. */
  join_url: string;
  id?: number;
  topic?: string;
}

export interface ZoomRegistrant {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  /** approved | pending | denied */
  status?: string;
  join_url?: string;
}

// Folga antes do vencimento: evita usar um token que expira no meio da chamada.
const TOKEN_SKEW_MS = 60_000;

export function createZoomClient(creds: ZoomCredentials, opts: ZoomClientOptions = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => Date.now());
  const apiBase = opts.apiBase ?? "https://api.zoom.us/v2";
  const oauthUrl = opts.oauthUrl ?? "https://zoom.us/oauth/token";
  const timeoutMs = opts.timeoutMs ?? 15_000;

  let cached: { token: string; expiresAt: number } | null = null;
  let inFlight: Promise<string> | null = null;

  /** fetch com prazo; sem resposta vira ZoomApiError(0) sem detalhes internos. */
  async function chamar(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const prazo =
        err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new ZoomApiError(
        0,
        null,
        prazo ? "O Zoom não respondeu a tempo." : "Falha de rede ao falar com o Zoom.",
      );
    }
  }

  async function fetchToken(): Promise<string> {
    const basic = btoa(`${creds.clientId}:${creds.clientSecret}`);
    const url = `${oauthUrl}?grant_type=account_credentials&account_id=${encodeURIComponent(creds.accountId)}`;
    const resp = await chamar(url, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}` },
    });
    const body = await safeJson(resp);
    if (!resp.ok || typeof body?.access_token !== "string") {
      // O corpo do OAuth traz {reason, error}; nada sensível, mas não repassamos.
      throw new ZoomApiError(
        resp.status,
        null,
        `Falha ao obter token do Zoom (HTTP ${resp.status})`,
      );
    }
    const expiresInSec = typeof body.expires_in === "number" ? body.expires_in : 3600;
    cached = { token: body.access_token, expiresAt: now() + expiresInSec * 1000 };
    return body.access_token;
  }

  async function getAccessToken(): Promise<string> {
    if (cached && now() < cached.expiresAt - TOKEN_SKEW_MS) return cached.token;
    if (!inFlight) {
      inFlight = fetchToken().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

  function invalidateToken() {
    cached = null;
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await getAccessToken();
      const resp = await chamar(`${apiBase}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (resp.status === 401 && attempt === 0) {
        invalidateToken();
        continue;
      }
      if (resp.status === 204) return undefined as T;
      const data = await safeJson(resp);
      if (!resp.ok) {
        const code = typeof data?.code === "number" ? data.code : null;
        const msg = typeof data?.message === "string" ? data.message : `HTTP ${resp.status}`;
        throw new ZoomApiError(resp.status, code, msg);
      }
      return data as T;
    }
    throw new ZoomApiError(401, null, "Zoom recusou o token renovado");
  }

  return {
    getAccessToken,
    invalidateToken,

    getMeeting(meetingId: string): Promise<ZoomMeeting> {
      return request<ZoomMeeting>("GET", `/meetings/${encodeURIComponent(meetingId)}`);
    },

    // ── Inscrições (E2) ── Plan, Apêndice B.1, sem alteração de lógica.
    // Scopes: meeting:write:registrant:admin, meeting:read:registrant:admin,
    // meeting:read:list_registrants:admin.

    addRegistrant(meetingId: string, input: ZoomRegistrantInput): Promise<ZoomRegistrantCreated> {
      return request<ZoomRegistrantCreated>(
        "POST",
        `/meetings/${encodeURIComponent(meetingId)}/registrants`,
        input,
      );
    },

    getRegistrant(meetingId: string, registrantId: string): Promise<ZoomRegistrant> {
      return request<ZoomRegistrant>(
        "GET",
        `/meetings/${encodeURIComponent(meetingId)}/registrants/${encodeURIComponent(registrantId)}`,
      );
    },

    /** Procura uma inscrição pelo e-mail (sem diferenciar maiúsculas) entre aprovadas e pendentes. */
    async findRegistrantByEmail(meetingId: string, email: string): Promise<ZoomRegistrant | null> {
      const target = email.trim().toLowerCase();
      for (const status of ["approved", "pending"]) {
        let pageToken = "";
        // Limite de páginas: defesa contra laço se o Zoom repetir o token.
        for (let page = 0; page < 50; page++) {
          const qs = new URLSearchParams({ status, page_size: "300" });
          if (pageToken) qs.set("next_page_token", pageToken);
          const data = await request<{ registrants?: ZoomRegistrant[]; next_page_token?: string }>(
            "GET",
            `/meetings/${encodeURIComponent(meetingId)}/registrants?${qs.toString()}`,
          );
          const hit = (data?.registrants ?? []).find(
            (r) => (r.email ?? "").trim().toLowerCase() === target,
          );
          if (hit) return { ...hit, status: hit.status ?? status };
          pageToken = data?.next_page_token ?? "";
          if (!pageToken) break;
        }
      }
      return null;
    },
  };
}

export type ZoomClient = ReturnType<typeof createZoomClient>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function safeJson(resp: Response): Promise<any> {
  try {
    const text = await resp.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}
```

## Apêndice B: migration da sala Zoom (E1, aplicada)

*Fonte: `supabase/migrations/20261111120000_legacycs_impulsao_kickoffs_zoom_sala.sql (arquivo completo)`*

```sql
-- Kickoffs coletivos do Impulsão - sala Zoom única (E1 da integração Zoom).
--
-- Incremental sobre as migrations da agenda, reservas, ausência e convite
-- público. Nada delas é redefinido.
--
-- O que entra:
--   * impulsao_kickoff_zoom_rooms: a sala Zoom (Meeting ID) usada por TODAS as
--     sessões de kickoff, com o resultado da última verificação no Zoom. Só
--     uma fica ativa por vez; trocar de sala desativa a anterior, que fica
--     guardada (as execuções e inscrições das próximas etapas apontam para o
--     Meeting ID que estava em uso).
--   * Duas funções só do servidor (service_role), chamadas depois de o servidor
--     consultar o Zoom com as credenciais que só ele tem:
--     impulsao_kickoff_zoom_room_activate (passa a usar a sala) e
--     impulsao_kickoff_zoom_room_record_check (guarda uma nova verificação).
--
-- Regras no banco, não só na tela:
--   * Ativar exige verificação aprovada há menos de 2 horas (mesma trava do
--     Legacy Plan, require_zoom_meeting_check - guia técnico, seção 2.6).
--   * O Meeting ID de uma linha não muda e a linha não é apagada.
--   * Leitura para quem tem papel no CS (como a agenda); escrita só pelas
--     funções. O resumo guardado é uma lista fechada de campos: nunca link do
--     anfitrião, link de entrada nem senha da reunião.
--
-- Ainda NÃO validado com dados reais (piloto controlado): separação de várias
-- execuções da mesma sala, presença em sessões próximas no mesmo dia e o
-- comportamento da sala depois da última ocorrência configurada no Zoom.

-- ---------------------------------------------------------------------------
-- Sala
-- ---------------------------------------------------------------------------
create table if not exists legacycs.impulsao_kickoff_zoom_rooms (
  id uuid primary key default gen_random_uuid(),
  zoom_meeting_id text not null check (zoom_meeting_id ~ '^[0-9]{9,12}$'),
  -- Título da reunião no Zoom, só para reconhecer na tela.
  topic text,
  active boolean not null default true,
  -- Última verificação no Zoom (a de ativação ou a de "verificar de novo").
  check_ok boolean not null,
  check_issues jsonb not null default '[]'::jsonb
    check (jsonb_typeof(check_issues) = 'array'),
  -- Tipo, inscrição, recorrência e ocorrências futuras lidos do Zoom.
  check_summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(check_summary) = 'object'),
  checked_at timestamptz not null,
  checked_by uuid,
  activated_at timestamptz not null default now(),
  activated_by uuid,
  deactivated_at timestamptz,
  deactivated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint impulsao_kickoff_zoom_rooms_meeting_key unique (zoom_meeting_id),
  constraint impulsao_kickoff_zoom_rooms_ativa_ck check (active = (deactivated_at is null))
);

create unique index if not exists impulsao_kickoff_zoom_rooms_uma_ativa
  on legacycs.impulsao_kickoff_zoom_rooms (active) where active;

-- Ativar só com verificação aprovada e recente; Meeting ID fixo.
create or replace function legacycs._impulsao_kickoff_zoom_room_guard()
returns trigger
language plpgsql
set search_path to 'legacycs'
as $function$
begin
  if tg_op = 'UPDATE' and new.zoom_meeting_id is distinct from old.zoom_meeting_id then
    raise exception 'O Meeting ID de uma sala não muda: cadastre a nova sala.'
      using errcode = '42501';
  end if;
  if new.active and (tg_op = 'INSERT' or not old.active)
     and not (new.check_ok and new.checked_at > now() - interval '2 hours') then
    raise exception 'Sala Zoom % sem verificação aprovada nas últimas 2 horas.', new.zoom_meeting_id
      using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists trg_impulsao_kickoff_zoom_rooms_guard on legacycs.impulsao_kickoff_zoom_rooms;
create trigger trg_impulsao_kickoff_zoom_rooms_guard
  before insert or update on legacycs.impulsao_kickoff_zoom_rooms
  for each row execute function legacycs._impulsao_kickoff_zoom_room_guard();

create or replace function legacycs._impulsao_kickoff_zoom_room_no_delete()
returns trigger
language plpgsql
set search_path to 'legacycs'
as $function$
begin
  raise exception 'Salas Zoom dos kickoffs não são apagadas: cadastre outra sala para trocar.'
    using errcode = '42501';
end;
$function$;

drop trigger if exists trg_impulsao_kickoff_zoom_rooms_no_delete on legacycs.impulsao_kickoff_zoom_rooms;
create trigger trg_impulsao_kickoff_zoom_rooms_no_delete
  before delete on legacycs.impulsao_kickoff_zoom_rooms
  for each row execute function legacycs._impulsao_kickoff_zoom_room_no_delete();

alter table legacycs.impulsao_kickoff_zoom_rooms enable row level security;

drop policy if exists impulsao_kickoff_zoom_rooms_read on legacycs.impulsao_kickoff_zoom_rooms;
create policy impulsao_kickoff_zoom_rooms_read on legacycs.impulsao_kickoff_zoom_rooms
  for select to authenticated
  using ((select legacycs.current_user_role()) is not null);

-- O schema dá insert/update/delete a anon e authenticated por padrão em
-- tabela nova. Aqui a escrita é só pelas funções do servidor.
revoke all on table legacycs.impulsao_kickoff_zoom_rooms from anon, authenticated;
grant select on table legacycs.impulsao_kickoff_zoom_rooms to authenticated;
grant all on table legacycs.impulsao_kickoff_zoom_rooms to service_role;

-- ---------------------------------------------------------------------------
-- Funções do servidor
-- ---------------------------------------------------------------------------

-- Passa a usar a sala. O servidor só chama depois de o Zoom aprovar a
-- configuração; a trava de 2 horas confere de novo aqui. Desativa a sala que
-- estava em uso; se o Meeting ID já foi usado antes, reativa a mesma linha.
create or replace function legacycs.impulsao_kickoff_zoom_room_activate(
  p_zoom_meeting_id text,
  p_topic text,
  p_summary jsonb,
  p_checked_at timestamptz,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'legacycs'
as $function$
declare
  v_id text := btrim(coalesce(p_zoom_meeting_id, ''));
  v_sala legacycs.impulsao_kickoff_zoom_rooms;
begin
  if v_id !~ '^[0-9]{9,12}$' then
    raise exception 'Meeting ID inválido (9 a 12 dígitos).' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('legacycs.impulsao_kickoff_zoom_room'));

  update legacycs.impulsao_kickoff_zoom_rooms
     set active = false, deactivated_at = now(), deactivated_by = p_user_id
   where active and zoom_meeting_id <> v_id;

  insert into legacycs.impulsao_kickoff_zoom_rooms as r
    (zoom_meeting_id, topic, active, check_ok, check_issues, check_summary,
     checked_at, checked_by, activated_at, activated_by)
  values
    (v_id, nullif(btrim(coalesce(p_topic, '')), ''), true, true, '[]'::jsonb,
     coalesce(p_summary, '{}'::jsonb), p_checked_at, p_user_id, now(), p_user_id)
  on conflict (zoom_meeting_id) do update
     set topic = excluded.topic,
         active = true,
         check_ok = true,
         check_issues = '[]'::jsonb,
         check_summary = excluded.check_summary,
         checked_at = excluded.checked_at,
         checked_by = excluded.checked_by,
         -- Já ativa: continua contando de quando passou a ser usada.
         activated_at = case when r.active then r.activated_at else now() end,
         activated_by = case when r.active then r.activated_by else excluded.activated_by end,
         deactivated_at = null,
         deactivated_by = null
  returning * into v_sala;

  return to_jsonb(v_sala);
end;
$function$;

-- Guarda uma nova verificação da sala (aprovada ou não). Não ativa nem
-- desativa: se o Zoom mudou e a sala deixou de servir, a tela mostra os
-- problemas e o admin decide.
create or replace function legacycs.impulsao_kickoff_zoom_room_record_check(
  p_room_id uuid,
  p_ok boolean,
  p_issues jsonb,
  p_topic text,
  p_summary jsonb,
  p_checked_at timestamptz,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'legacycs'
as $function$
declare
  v_sala legacycs.impulsao_kickoff_zoom_rooms;
begin
  if p_ok is null then
    raise exception 'Resultado da verificação ausente.' using errcode = '22023';
  end if;
  update legacycs.impulsao_kickoff_zoom_rooms
     set check_ok = p_ok,
         check_issues = coalesce(p_issues, '[]'::jsonb),
         -- Sala não encontrada no Zoom: mantém o último título e resumo lidos.
         topic = coalesce(nullif(btrim(coalesce(p_topic, '')), ''), topic),
         check_summary = coalesce(p_summary, check_summary),
         checked_at = p_checked_at,
         checked_by = p_user_id
   where id = p_room_id
  returning * into v_sala;
  if v_sala.id is null then
    raise exception 'Sala Zoom não encontrada.' using errcode = 'P0002';
  end if;
  return to_jsonb(v_sala);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Permissões das funções (função nova nasce executável por anon neste schema)
-- ---------------------------------------------------------------------------
revoke all on function legacycs._impulsao_kickoff_zoom_room_guard() from public, anon, authenticated;
revoke all on function legacycs._impulsao_kickoff_zoom_room_no_delete() from public, anon, authenticated;
revoke all on function legacycs.impulsao_kickoff_zoom_room_activate(text, text, jsonb, timestamptz, uuid)
  from public, anon, authenticated;
revoke all on function legacycs.impulsao_kickoff_zoom_room_record_check(uuid, boolean, jsonb, text, jsonb, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function legacycs.impulsao_kickoff_zoom_room_activate(text, text, jsonb, timestamptz, uuid)
  to service_role;
grant execute on function legacycs.impulsao_kickoff_zoom_room_record_check(uuid, boolean, jsonb, text, jsonb, timestamptz, uuid)
  to service_role;
```

## Apêndice C: `src/lib/kickoffs-zoom-inscricao.ts` (completo)

*Fonte: `src/lib/kickoffs-zoom-inscricao.ts (arquivo completo)`*

```ts
// Inscrição do participante na sala Zoom dos kickoffs (E2): o link individual.
//
// Sem rede, banco ou ambiente: o Zoom e o banco chegam por parâmetro, e tudo é
// testado no vitest (com o banco de verdade no PGlite e um Zoom falso).
//
// Reaproveita do Legacy Plan (cohort-zoom-join/logic.ts, Apêndice B.3, e
// cohort-zoom-collect/logic.ts, B.6): tenantCode, isValidEmail,
// buildRegistrantIdentity, checkMeetingConfig, describeZoomError,
// registrantStillUsable, shouldLookupExistingAfterAddError e extractTenantCode.
// A lógica é a mesma; só os textos falam com a equipe do CS (e não com o aluno)
// e o nome padrão é "Participante".
//
// O que muda em relação ao Plan:
//   * A chave é (sala, e-mail), ligada à EMPRESA (client_id) e à reserva - não
//     a um usuário com login.
//   * Antes de chamar o Zoom, o banco "reserva" a inscrição (estado creating)
//     numa transação com trava. Dois pedidos ao mesmo tempo para o mesmo
//     e-mail: só um fala com o Zoom; o outro responde "preparando".
//   * Depois de criar (ou achar pelo e-mail), lê a inscrição no Zoom e confere
//     o código da empresa no nome: se o e-mail já estava inscrito com o código
//     de OUTRA empresa, não entrega o link e marca para revisão.
import {
  ZoomApiError,
  type ZoomClient,
  type ZoomMeeting,
  type ZoomRegistrant,
} from "@/lib/zoom-api";

// ---------------------------------------------------------------------------
// Utilitários do Plan (B.3 / B.6)
// ---------------------------------------------------------------------------

/** Limite do Zoom para first_name e last_name do registrante. */
export const ZOOM_NAME_MAX = 64;

/**
 * Código curto e estável da empresa no Zoom: os 8 primeiros hexadecimais do
 * plan_tenant_id (o client_tenants.id do Plan), em maiúsculas. É o MESMO
 * código que o Plan põe nas turmas: um prefixo, não um hash.
 */
export function tenantCode(tenantId: string): string {
  const hex = tenantId.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error("tenant_id inválido");
  return hex.slice(0, 8).toUpperCase();
}

export function isValidEmail(email: string | null | undefined): email is string {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

// Separadores do formato não podem aparecer dentro das partes.
const clean = (s: string | null | undefined) =>
  (s ?? "")
    .replace(/[|#[\]<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const truncate = (s: string, max: number) => {
  if (s.length <= max) return s;
  if (max <= 1) return s.slice(0, Math.max(0, max));
  return s.slice(0, max - 1).trimEnd() + "…";
};

export interface RegistrantIdentity {
  first_name: string;
  last_name: string;
  org: string;
  tenantCode: string;
  /** Como o Zoom vai exibir: first_name + ' ' + last_name. */
  displayName: string;
}

/**
 * Nome que vai para o Zoom: "Maria Silva | Padaria Pão Bom #1A2B3C4D".
 * Passando de 64 caracteres: o código nunca é cortado; a empresa guarda até 32
 * caracteres; o sobrenome cede primeiro.
 */
export function buildRegistrantIdentity(input: {
  userName: string | null | undefined;
  email: string;
  companyName: string | null | undefined;
  tenantId: string;
}): RegistrantIdentity {
  const code = tenantCode(input.tenantId);
  const fullName = clean(input.userName) || clean(input.email.split("@")[0]) || "Participante";
  const [firstRaw, ...restParts] = fullName.split(" ");
  const first = truncate(firstRaw, ZOOM_NAME_MAX);
  let rest = restParts.join(" ");
  let company = clean(input.companyName) || "Empresa";

  const tail = ` #${code}`;
  const sep = "| ";
  const MIN_COMPANY = 32;

  const build = () => `${rest ? `${rest} ` : ""}${sep}${company}${tail}`;

  if (build().length > ZOOM_NAME_MAX) {
    const room = ZOOM_NAME_MAX - tail.length - sep.length;
    const companyKeep = Math.min(
      company.length,
      Math.max(MIN_COMPANY, room - (rest ? rest.length + 1 : 0)),
    );
    const restRoom = room - companyKeep - 1;
    rest = restRoom > 0 ? truncate(rest, restRoom) : "";
    company = truncate(company, room - (rest ? rest.length + 1 : 0));
  }

  const last = build();
  return {
    first_name: first,
    last_name: last,
    org: truncate(company, ZOOM_NAME_MAX),
    tenantCode: code,
    displayName: `${first} ${last}`,
  };
}

const CODE_RE = /#([0-9A-F]{8})(?![0-9A-F])/i;

/** Código "#XXXXXXXX" no nome exibido (Plan, B.6). */
export function extractTenantCode(name?: string | null): string | null {
  const m = CODE_RE.exec(name ?? "");
  return m ? m[1].toUpperCase() : null;
}

export interface ConfigProblem {
  status: number;
  error: string;
}

/**
 * A sala precisa estar como o modelo assume antes de inscrever alguém
 * (aprovação manual deixaria o participante "pendente"). Regras do Plan.
 */
export function checkMeetingConfig(meeting: ZoomMeeting): ConfigProblem | null {
  const approval = meeting.settings?.approval_type;
  if (approval === 2 || approval === undefined) {
    return {
      status: 409,
      error: "A sala Zoom não está com inscrição obrigatória. Confira a aba Sala Zoom.",
    };
  }
  if (approval === 1) {
    return {
      status: 409,
      error: "A sala Zoom está com aprovação manual de inscrição. Confira a aba Sala Zoom.",
    };
  }
  const isRecurring = meeting.type === 3 || meeting.type === 8;
  const regType = meeting.settings?.registration_type;
  if (isRecurring && regType !== undefined && regType !== 1) {
    return {
      status: 409,
      error: "A sala Zoom pede inscrição por ocorrência. Confira a aba Sala Zoom.",
    };
  }
  return null;
}

/** Falha do Zoom -> mensagem segura para a equipe (nunca vai ao cliente). */
export function describeZoomError(err: unknown): ConfigProblem {
  if (err instanceof ZoomApiError) {
    if (err.status === 404 || err.code === 3001) {
      return {
        status: 409,
        error: "Reunião da sala Zoom não encontrada. Confira a aba Sala Zoom.",
      };
    }
    if (err.status === 0) {
      return { status: 503, error: "Não foi possível falar com o Zoom agora." };
    }
    if (err.status === 429) {
      return { status: 503, error: "O Zoom está ocupado agora. Tente de novo em alguns segundos." };
    }
    if (err.status === 401 || err.status === 403) {
      return {
        status: 502,
        error: "A integração com o Zoom está sem permissão para inscrever. Confira as credenciais.",
      };
    }
    return { status: 502, error: `O Zoom recusou a inscrição (código ${err.code ?? err.status}).` };
  }
  return { status: 502, error: "Não foi possível gerar o acesso ao Zoom agora." };
}

/** A inscrição guardada ainda serve? Só aprovada (ou sem status). */
export function registrantStillUsable(status: string | undefined): boolean {
  return status === undefined || status === "approved";
}

/** Falha do POST que vale a pena resolver procurando a inscrição pelo e-mail. */
export function shouldLookupExistingAfterAddError(err: unknown): boolean {
  if (!(err instanceof ZoomApiError)) return false;
  if (err.status === 404 || err.status === 429 || err.status >= 500) return false;
  if (err.status === 401 || err.status === 403) return false;
  return err.status >= 400;
}

// ---------------------------------------------------------------------------
// Contrato com o banco (funções impulsao_kickoff_zoom_* da migration da E2)
// ---------------------------------------------------------------------------

export type MotivoIndisponivel =
  | "reserva_inativa"
  | "sem_email"
  | "sem_sala"
  | "sala_com_problemas"
  | "empresa_sem_codigo";

export interface ContextoDaInscricao {
  booking_id: string;
  client_id: string;
  plan_tenant_id: string;
  empresa: string;
  participante: string;
  email: string;
  zoom_meeting_id: string;
}

/** O que o banco decide antes de qualquer chamada ao Zoom. */
export type DecisaoDoBanco =
  | { acao: "indisponivel"; motivo: MotivoIndisponivel }
  | { acao: "conflito"; motivo: "outra_empresa" | "zoom" }
  | { acao: "aguardar" }
  | { acao: "aguardar_erro"; erro: string | null }
  | {
      acao: "reaproveitar";
      inscricao: {
        id: string;
        zoom_registrant_id: string;
        join_url: string;
        verified_at: string | null;
      };
      contexto: ContextoDaInscricao;
    }
  | { acao: "criar"; inscricao: { id: string }; contexto: ContextoDaInscricao };

/**
 * normal: o pedido de sempre (página pública, painel).
 * tentar_de_novo: a equipe pediu de novo - ignora a espera depois de um erro
 *   e reavalia um conflito; nunca refaz uma inscrição pronta.
 * refazer: a inscrição pronta sumiu ou deixou de valer no Zoom - cria outra.
 */
export type ModoDoPedido = "normal" | "tentar_de_novo" | "refazer";

export type ConclusaoDaInscricao =
  | {
      status: "ready";
      zoomRegistrantId: string;
      joinUrl: string;
      firstName: string | null;
      lastName: string | null;
      org: string | null;
      nomeConfere: boolean;
    }
  | { status: "error" | "conflict"; erro: string };

export interface BancoDaInscricao {
  decidir(bookingId: string, modo: ModoDoPedido): Promise<DecisaoDoBanco>;
  /** Só conclui quem está com a inscrição em creating. */
  concluir(inscricaoId: string, conclusao: ConclusaoDaInscricao): Promise<void>;
  marcarVerificada(inscricaoId: string): Promise<void>;
}

export type ZoomDaInscricao = Pick<
  ZoomClient,
  "getMeeting" | "addRegistrant" | "getRegistrant" | "findRegistrantByEmail"
>;

export type ResultadoDaInscricao =
  | { estado: "pronto"; joinUrl: string; reaproveitada: boolean }
  | { estado: "erro"; mensagem: string }
  | { estado: "preparando" }
  | { estado: "conflito" }
  | { estado: MotivoIndisponivel };

/**
 * O que a página pública mostra. Erro, conflito e problema de sala nunca são
 * detalhados para o cliente: ou "preparando" (vale tentar de novo) ou
 * "indisponível" (o time da Legacy resolve).
 */
export type AcessoNaPagina =
  | { estado: "pronto"; joinUrl: string }
  | { estado: "preparando" | "sem_email" | "indisponivel" };

export function acessoParaAPagina(r: ResultadoDaInscricao): AcessoNaPagina {
  switch (r.estado) {
    case "pronto":
      return { estado: "pronto", joinUrl: r.joinUrl };
    case "preparando":
    case "erro":
      return { estado: "preparando" };
    case "sem_email":
      return { estado: "sem_email" };
    default:
      return { estado: "indisponivel" };
  }
}

/** Estado do acesso de cada reserva no painel (impulsao_kickoff_zoom_session_access). */
export type EstadoNoPainel =
  | "pronto"
  | "preparando"
  | "pendente"
  | "sem_email"
  | "sem_sala"
  | "conflito"
  | "erro"
  | "sem_acesso";

export const ROTULO_DO_ACESSO: Record<EstadoNoPainel, string> = {
  pronto: "Acesso Zoom pronto",
  preparando: "Preparando o acesso Zoom",
  pendente: "Acesso Zoom ainda não gerado",
  sem_email: "Sem e-mail: acesso Zoom pendente",
  sem_sala: "Sem sala Zoom ativa",
  conflito: "Conflito no Zoom: revisar",
  erro: "Falha ao gerar o acesso Zoom",
  sem_acesso: "Sem acesso Zoom",
};

/** Inscrição pronta é conferida no Zoom no máximo a cada 6 horas. */
export const VERIFICAR_A_CADA_MS = 6 * 60 * 60 * 1000;

const MSG_CONFLITO_ZOOM =
  "Este e-mail já está inscrito na sala Zoom com o código de outra empresa. Revise o e-mail do participante.";
const MSG_NAO_APROVADA = "A inscrição no Zoom não está aprovada.";

/**
 * Garante o acesso individual do participante principal da reserva: devolve o
 * link da inscrição existente ou cria uma. Nunca lança: falha do Zoom vira
 * { estado: "erro" } com mensagem segura, gravada para a equipe ver.
 */
export async function garantirInscricao(
  bookingId: string,
  deps: { zoom: ZoomDaInscricao; banco: BancoDaInscricao; agora?: () => number },
  modo: ModoDoPedido = "normal",
): Promise<ResultadoDaInscricao> {
  const agora = deps.agora ?? (() => Date.now());
  const decisao = await deps.banco.decidir(bookingId, modo);

  switch (decisao.acao) {
    case "indisponivel":
      return { estado: decisao.motivo };
    case "conflito":
      return { estado: "conflito" };
    case "aguardar":
      return { estado: "preparando" };
    case "aguardar_erro":
      return { estado: "erro", mensagem: decisao.erro ?? describeZoomError(null).error };
    case "reaproveitar":
      return reaproveitar(decisao, bookingId, deps, agora);
    case "criar":
      return criar(decisao.inscricao.id, decisao.contexto, deps);
  }
}

async function reaproveitar(
  d: Extract<DecisaoDoBanco, { acao: "reaproveitar" }>,
  bookingId: string,
  deps: { zoom: ZoomDaInscricao; banco: BancoDaInscricao },
  agora: () => number,
): Promise<ResultadoDaInscricao> {
  const pronto = { estado: "pronto" as const, joinUrl: d.inscricao.join_url, reaproveitada: true };
  const verificada = d.inscricao.verified_at ? Date.parse(d.inscricao.verified_at) : NaN;
  if (Number.isFinite(verificada) && agora() - verificada < VERIFICAR_A_CADA_MS) return pronto;

  let reg: ZoomRegistrant;
  try {
    reg = await deps.zoom.getRegistrant(d.contexto.zoom_meeting_id, d.inscricao.zoom_registrant_id);
  } catch (err) {
    // Sumiu no Zoom: cria outra. Zoom fora do ar: o link guardado continua
    // valendo (reconexão não depende do Zoom responder agora).
    if (err instanceof ZoomApiError && err.status === 404) return refazer(bookingId, deps);
    return pronto;
  }
  if (!registrantStillUsable(reg.status)) return refazer(bookingId, deps);
  await deps.banco.marcarVerificada(d.inscricao.id);
  return pronto;
}

async function refazer(
  bookingId: string,
  deps: { zoom: ZoomDaInscricao; banco: BancoDaInscricao },
): Promise<ResultadoDaInscricao> {
  const d = await deps.banco.decidir(bookingId, "refazer");
  if (d.acao === "criar") return criar(d.inscricao.id, d.contexto, deps);
  if (d.acao === "reaproveitar") {
    return { estado: "pronto", joinUrl: d.inscricao.join_url, reaproveitada: true };
  }
  if (d.acao === "indisponivel") return { estado: d.motivo };
  if (d.acao === "conflito") return { estado: "conflito" };
  return { estado: "preparando" };
}

async function criar(
  inscricaoId: string,
  ctx: ContextoDaInscricao,
  deps: { zoom: ZoomDaInscricao; banco: BancoDaInscricao },
): Promise<ResultadoDaInscricao> {
  const falhar = async (status: "error" | "conflict", erro: string) => {
    await deps.banco.concluir(inscricaoId, { status, erro });
    return status === "conflict"
      ? ({ estado: "conflito" } as const)
      : ({ estado: "erro", mensagem: erro } as const);
  };

  try {
    // A sala pode ter mudado no Zoom depois de cadastrada: confere antes.
    const meeting = await deps.zoom.getMeeting(ctx.zoom_meeting_id);
    const problema = checkMeetingConfig(meeting);
    if (problema) return await falhar("error", problema.error);

    const identity = buildRegistrantIdentity({
      userName: ctx.participante,
      email: ctx.email,
      companyName: ctx.empresa,
      tenantId: ctx.plan_tenant_id,
    });

    let registrantId: string | undefined;
    let joinUrl: string | undefined;
    try {
      const criado = await deps.zoom.addRegistrant(ctx.zoom_meeting_id, {
        email: ctx.email,
        first_name: identity.first_name,
        last_name: identity.last_name,
        org: identity.org,
      });
      registrantId = criado.registrant_id;
      joinUrl = criado.join_url;
    } catch (err) {
      if (!shouldLookupExistingAfterAddError(err)) throw err;
      const achado = await deps.zoom.findRegistrantByEmail(ctx.zoom_meeting_id, ctx.email);
      if (!achado?.join_url || !registrantStillUsable(achado.status)) throw err;
      registrantId = achado.id;
      joinUrl = achado.join_url;
    }
    if (!registrantId || !joinUrl) {
      throw new ZoomApiError(502, null, "O Zoom não devolveu o link");
    }

    // Confere no Zoom quem está inscrito com este e-mail (pode ser uma
    // inscrição antiga, feita por fora do CS).
    let noZoom: ZoomRegistrant | null = null;
    try {
      noZoom = await deps.zoom.getRegistrant(ctx.zoom_meeting_id, registrantId);
    } catch {
      noZoom = null; // conferência indisponível: vale o nome que mandamos
    }
    if (noZoom && !registrantStillUsable(noZoom.status)) {
      return await falhar("error", MSG_NAO_APROVADA);
    }
    const nomeNoZoom = noZoom
      ? `${noZoom.first_name ?? ""} ${noZoom.last_name ?? ""}`.trim()
      : identity.displayName;
    const codigoNoZoom = extractTenantCode(nomeNoZoom);
    if (codigoNoZoom && codigoNoZoom !== identity.tenantCode) {
      return await falhar("conflict", MSG_CONFLITO_ZOOM);
    }

    await deps.banco.concluir(inscricaoId, {
      status: "ready",
      zoomRegistrantId: registrantId,
      joinUrl,
      firstName: noZoom ? (noZoom.first_name ?? null) : identity.first_name,
      lastName: noZoom ? (noZoom.last_name ?? null) : identity.last_name,
      org: identity.org,
      nomeConfere: nomeNoZoom === identity.displayName,
    });
    return { estado: "pronto", joinUrl, reaproveitada: false };
  } catch (err) {
    const erro =
      err instanceof Error && err.message === "tenant_id inválido"
        ? "Código da empresa inválido: confira o vínculo com o Legacy Plan."
        : describeZoomError(err).error;
    try {
      return await falhar("error", erro);
    } catch {
      // Nem gravar o erro deu: a inscrição fica "creating" e é retomada
      // depois de 2 minutos pelo próximo pedido.
      return { estado: "erro", mensagem: erro };
    }
  }
}
```

## Apêndice D: migration das inscrições Zoom (E2, **NÃO aplicada**)

> Referência para o Meet adaptar. **Não aplicar no CS.**

*Fonte: `supabase/migrations/20261112120000_legacycs_impulsao_kickoffs_zoom_inscricoes.sql (arquivo completo)`*

```sql
-- Kickoffs coletivos do Impulsão - inscrições na sala Zoom (E2): o link
-- individual de cada empresa.
--
-- Incremental sobre a sala Zoom (20261111120000). Nada das migrations
-- anteriores é redefinido: reserva, capacidade, convite e sala continuam como
-- estão.
--
-- O que entra:
--   * impulsao_kickoff_zoom_registrants: a inscrição de um e-mail na sala Zoom
--     (chave: Meeting ID + e-mail normalizado), da EMPRESA que a pediu
--     (client_id, plan_tenant_id e o código #XXXXXXXX que vai no nome), com a
--     primeira e a última reserva atendidas, o id do registrante no Zoom e o
--     join_url (credencial individual). Como a inscrição é da sala e não da
--     sessão, remanejar não cria outra; trocar o e-mail do participante leva a
--     outra chave (a antiga fica no histórico).
--   * Funções só do servidor (service_role), que tem as credenciais do Zoom:
--       impulsao_kickoff_zoom_public_booking   - convite -> reserva ativa, com
--                                                a mesma trava de tentativas
--                                                das funções públicas;
--       impulsao_kickoff_zoom_registrant_decide - antes de chamar o Zoom:
--                                                reaproveitar, criar, esperar
--                                                ou recusar (com trava);
--       impulsao_kickoff_zoom_registrant_finish - grava o resultado;
--       impulsao_kickoff_zoom_registrant_verified - marca a conferência;
--       impulsao_kickoff_zoom_session_access    - estado do acesso de cada
--                                                reserva da sessão (painel).
--
-- Concorrência: decide() trava (pg_advisory_xact_lock) a chave sala+e-mail e
-- marca a inscrição como "creating" antes de qualquer chamada ao Zoom. Outro
-- pedido para o mesmo e-mail nesse meio-tempo recebe "aguardar" e não chama o
-- Zoom. Uma criação interrompida (servidor caiu) é retomada depois de 2 min.
--
-- Mesmo e-mail já inscrito na sala por OUTRA empresa: não reaproveita
-- (conflito para revisão). Nada aqui apaga inscrição.
--
-- Leitura e escrita só pelo servidor: nem a equipe lê a tabela direto (o link
-- é credencial; o servidor confere o papel antes de mostrar).

-- ---------------------------------------------------------------------------
-- Inscrições
-- ---------------------------------------------------------------------------
create table if not exists legacycs.impulsao_kickoff_zoom_registrants (
  id uuid primary key default gen_random_uuid(),
  zoom_meeting_id text not null
    references legacycs.impulsao_kickoff_zoom_rooms (zoom_meeting_id),
  email text not null check (
    email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ),
  client_id uuid not null references legacycs.clients (id),
  plan_tenant_id text not null,
  -- tenantCode(plan_tenant_id): o mesmo código do Legacy Plan.
  tenant_code text not null check (tenant_code ~ '^[0-9A-F]{8}$'),
  first_booking_id uuid not null references legacycs.impulsao_kickoff_bookings (id),
  last_booking_id uuid not null references legacycs.impulsao_kickoff_bookings (id),
  participant_name text not null,
  -- creating: um pedido está falando com o Zoom agora (claimed_at).
  -- ready: link pronto. error: última tentativa falhou (last_error).
  -- conflict: o Zoom tem este e-mail com o código de outra empresa.
  status text not null default 'creating'
    check (status in ('creating', 'ready', 'error', 'conflict')),
  zoom_registrant_id text,
  join_url text,
  -- Nome que o Zoom guardou (pode ser de uma inscrição feita fora do CS).
  registrant_first_name text,
  registrant_last_name text,
  registrant_org text,
  zoom_name_matches boolean,
  attempts int not null default 0 check (attempts >= 0),
  claimed_at timestamptz,
  last_attempt_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  verified_at timestamptz,
  ready_at timestamptz,
  join_request_count int not null default 0 check (join_request_count >= 0),
  last_join_requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint impulsao_kickoff_zoom_registrants_sala_email_key unique (zoom_meeting_id, email),
  constraint impulsao_kickoff_zoom_registrants_pronta_ck
    check (status <> 'ready' or (zoom_registrant_id is not null and join_url is not null)),
  constraint impulsao_kickoff_zoom_registrants_criando_ck
    check ((status = 'creating') = (claimed_at is not null))
);

create unique index if not exists impulsao_kickoff_zoom_registrants_registrante_key
  on legacycs.impulsao_kickoff_zoom_registrants (zoom_meeting_id, zoom_registrant_id)
  where zoom_registrant_id is not null;
create index if not exists idx_impulsao_kickoff_zoom_registrants_empresa
  on legacycs.impulsao_kickoff_zoom_registrants (client_id);

create or replace function legacycs._impulsao_kickoff_zoom_registrant_touch()
returns trigger
language plpgsql
set search_path to 'legacycs'
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists trg_impulsao_kickoff_zoom_registrants_touch on legacycs.impulsao_kickoff_zoom_registrants;
create trigger trg_impulsao_kickoff_zoom_registrants_touch
  before update on legacycs.impulsao_kickoff_zoom_registrants
  for each row execute function legacycs._impulsao_kickoff_zoom_registrant_touch();

create or replace function legacycs._impulsao_kickoff_zoom_registrant_no_delete()
returns trigger
language plpgsql
set search_path to 'legacycs'
as $function$
begin
  raise exception 'Inscrições Zoom dos kickoffs não são apagadas: são o histórico do acesso.'
    using errcode = '42501';
end;
$function$;

drop trigger if exists trg_impulsao_kickoff_zoom_registrants_no_delete on legacycs.impulsao_kickoff_zoom_registrants;
create trigger trg_impulsao_kickoff_zoom_registrants_no_delete
  before delete on legacycs.impulsao_kickoff_zoom_registrants
  for each row execute function legacycs._impulsao_kickoff_zoom_registrant_no_delete();

-- O join_url é credencial: nem a equipe lê a tabela direto. RLS ligada e sem
-- política; só o servidor (service_role) lê e grava.
alter table legacycs.impulsao_kickoff_zoom_registrants enable row level security;
revoke all on table legacycs.impulsao_kickoff_zoom_registrants from anon, authenticated;
grant all on table legacycs.impulsao_kickoff_zoom_registrants to service_role;

-- ---------------------------------------------------------------------------
-- Convite -> reserva ativa (página pública, via servidor)
-- ---------------------------------------------------------------------------

-- O servidor repassa a origem do visitante (IP), porque quem chama esta
-- função é ele, não o navegador. Mesma chave ('ip:' + md5) e mesmos limites de
-- _impulsao_kickoff_public_open: código errado ou revogado conta tentativa da
-- origem. Além disso, no máximo 60 pedidos de acesso por convite em 15 min.
--   {"status": "ok", "booking_id"} | {"status": "sem_reserva"}
--   | {"status": "convite_invalido" | "convite_revogado" | "muitas_tentativas"}
create or replace function legacycs.impulsao_kickoff_zoom_public_booking(p_code text, p_origem text)
returns jsonb
language plpgsql
security definer
set search_path to 'legacycs'
as $function$
declare
  v_origem text := 'ip:' || md5(coalesce(nullif(btrim(split_part(coalesce(p_origem, ''), ',', 1)), ''), '?'));
  v_inv legacycs.impulsao_kickoff_invites%rowtype;
  v_booking uuid;
begin
  if legacycs._impulsao_kickoff_throttle_blocked(v_origem, 10, interval '15 minutes') then
    return jsonb_build_object('status', 'muitas_tentativas');
  end if;

  select * into v_inv from legacycs.impulsao_kickoff_invites
   where code = lower(btrim(coalesce(p_code, '')));
  if v_inv.id is null then
    perform legacycs._impulsao_kickoff_throttle_hit(v_origem, 10, interval '15 minutes');
    return jsonb_build_object('status', 'convite_invalido');
  end if;
  if v_inv.revoked_at is not null then
    perform legacycs._impulsao_kickoff_throttle_hit(v_origem, 10, interval '15 minutes');
    return jsonb_build_object('status', 'convite_revogado');
  end if;
  if not exists (select 1 from legacycs.clients where id = v_inv.client_id and deleted_at is null) then
    return jsonb_build_object('status', 'convite_invalido');
  end if;

  if legacycs._impulsao_kickoff_throttle_hit('zoom:' || v_inv.id, 60, interval '15 minutes') then
    return jsonb_build_object('status', 'muitas_tentativas');
  end if;

  select b.id into v_booking
    from legacycs.impulsao_kickoff_bookings b
   where b.client_id = v_inv.client_id and b.status = 'active';
  if v_booking is null then
    return jsonb_build_object('status', 'sem_reserva');
  end if;
  return jsonb_build_object('status', 'ok', 'booking_id', v_booking);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Antes de chamar o Zoom: o que fazer com a inscrição desta reserva
-- ---------------------------------------------------------------------------

-- p_mode:
--   normal          - pedido comum (página pública, painel);
--   tentar_de_novo  - a equipe pediu de novo: ignora a espera de 15 s depois
--                     de um erro e reavalia conflito; não refaz inscrição pronta;
--   refazer         - a inscrição pronta deixou de valer no Zoom: cria outra.
-- Devolve {"acao": ...}:
--   indisponivel (+ motivo: reserva_inativa | sem_email | sem_sala |
--                 sala_com_problemas | empresa_sem_codigo)
--   conflito (+ motivo: outra_empresa | zoom)
--   aguardar                         - outro pedido está criando agora
--   aguardar_erro (+ erro)           - falhou há menos de 15 s
--   reaproveitar (+ inscricao {id, zoom_registrant_id, join_url, verified_at}, contexto)
--   criar (+ inscricao {id}, contexto) - a inscrição ficou "creating" para este pedido
create or replace function legacycs.impulsao_kickoff_zoom_registrant_decide(
  p_booking_id uuid,
  p_mode text
)
returns jsonb
language plpgsql
security definer
set search_path to 'legacycs'
as $function$
declare
  v_b legacycs.impulsao_kickoff_bookings%rowtype;
  v_sala legacycs.impulsao_kickoff_zoom_rooms%rowtype;
  v_r legacycs.impulsao_kickoff_zoom_registrants%rowtype;
  v_email text;
  v_hex text;
  v_empresa text;
  v_ctx jsonb;
begin
  if p_mode is null or p_mode not in ('normal', 'tentar_de_novo', 'refazer') then
    raise exception 'Modo inválido.' using errcode = '22023';
  end if;

  select * into v_b from legacycs.impulsao_kickoff_bookings where id = p_booking_id;
  if v_b.id is null or v_b.status <> 'active' then
    return jsonb_build_object('acao', 'indisponivel', 'motivo', 'reserva_inativa');
  end if;

  -- Sem e-mail válido não há inscrição (reservas antigas só com telefone
  -- continuam válidas e ficam com o acesso pendente).
  v_email := lower(nullif(btrim(coalesce(v_b.participant_email, '')), ''));
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('acao', 'indisponivel', 'motivo', 'sem_email');
  end if;

  select * into v_sala from legacycs.impulsao_kickoff_zoom_rooms where active;
  if v_sala.id is null then
    return jsonb_build_object('acao', 'indisponivel', 'motivo', 'sem_sala');
  end if;

  v_hex := lower(replace(coalesce(v_b.plan_tenant_id, ''), '-', ''));
  if v_hex !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('acao', 'indisponivel', 'motivo', 'empresa_sem_codigo');
  end if;

  select coalesce(nullif(btrim(c.trading_name), ''), c.name) into v_empresa
    from legacycs.clients c where c.id = v_b.client_id;
  v_ctx := jsonb_build_object(
    'booking_id', v_b.id,
    'client_id', v_b.client_id,
    'plan_tenant_id', v_b.plan_tenant_id,
    'empresa', v_empresa,
    'participante', v_b.participant_name,
    'email', v_email,
    'zoom_meeting_id', v_sala.zoom_meeting_id);

  perform pg_advisory_xact_lock(
    hashtext('legacycs.impulsao_kickoff_zoom_registrant:' || v_sala.zoom_meeting_id || ':' || v_email));

  select * into v_r from legacycs.impulsao_kickoff_zoom_registrants
   where zoom_meeting_id = v_sala.zoom_meeting_id and email = v_email
   for update;

  if v_r.id is null then
    if not v_sala.check_ok then
      return jsonb_build_object('acao', 'indisponivel', 'motivo', 'sala_com_problemas');
    end if;
    insert into legacycs.impulsao_kickoff_zoom_registrants
      (zoom_meeting_id, email, client_id, plan_tenant_id, tenant_code, first_booking_id,
       last_booking_id, participant_name, status, attempts, claimed_at, last_attempt_at)
    values
      (v_sala.zoom_meeting_id, v_email, v_b.client_id, v_b.plan_tenant_id,
       upper(substr(v_hex, 1, 8)), v_b.id, v_b.id, v_b.participant_name, 'creating', 1, now(), now())
    returning * into v_r;
    return jsonb_build_object('acao', 'criar', 'inscricao', jsonb_build_object('id', v_r.id),
                              'contexto', v_ctx);
  end if;

  -- O mesmo e-mail já é de outra empresa nesta sala: nunca reaproveita.
  if v_r.client_id <> v_b.client_id then
    return jsonb_build_object('acao', 'conflito', 'motivo', 'outra_empresa');
  end if;

  if v_r.status = 'ready' and p_mode <> 'refazer' then
    update legacycs.impulsao_kickoff_zoom_registrants
       set last_booking_id = v_b.id,
           join_request_count = join_request_count + 1,
           last_join_requested_at = now()
     where id = v_r.id;
    return jsonb_build_object('acao', 'reaproveitar',
      'inscricao', jsonb_build_object('id', v_r.id, 'zoom_registrant_id', v_r.zoom_registrant_id,
                                      'join_url', v_r.join_url, 'verified_at', v_r.verified_at),
      'contexto', v_ctx);
  end if;

  if v_r.status = 'creating' and v_r.claimed_at > now() - interval '2 minutes' then
    return jsonb_build_object('acao', 'aguardar');
  end if;
  if v_r.status = 'conflict' and p_mode = 'normal' then
    return jsonb_build_object('acao', 'conflito', 'motivo', 'zoom');
  end if;
  if v_r.status = 'error' and p_mode = 'normal'
     and v_r.last_attempt_at > now() - interval '15 seconds' then
    return jsonb_build_object('acao', 'aguardar_erro', 'erro', v_r.last_error);
  end if;
  if not v_sala.check_ok then
    return jsonb_build_object('acao', 'indisponivel', 'motivo', 'sala_com_problemas');
  end if;

  update legacycs.impulsao_kickoff_zoom_registrants
     set status = 'creating',
         claimed_at = now(),
         attempts = attempts + 1,
         last_attempt_at = now(),
         last_booking_id = v_b.id,
         participant_name = v_b.participant_name
   where id = v_r.id;
  return jsonb_build_object('acao', 'criar', 'inscricao', jsonb_build_object('id', v_r.id),
                            'contexto', v_ctx);
end;
$function$;

-- Grava o resultado da chamada ao Zoom. Só vale para a inscrição que está
-- "creating" (quem a reservou); devolve false se outro pedido já concluiu.
create or replace function legacycs.impulsao_kickoff_zoom_registrant_finish(
  p_id uuid,
  p_status text,
  p_zoom_registrant_id text,
  p_join_url text,
  p_first_name text,
  p_last_name text,
  p_org text,
  p_name_matches boolean,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path to 'legacycs'
as $function$
begin
  if p_status is null or p_status not in ('ready', 'error', 'conflict') then
    raise exception 'Resultado inválido.' using errcode = '22023';
  end if;

  if p_status = 'ready' then
    begin
      update legacycs.impulsao_kickoff_zoom_registrants
         set status = 'ready',
             zoom_registrant_id = p_zoom_registrant_id,
             join_url = p_join_url,
             registrant_first_name = p_first_name,
             registrant_last_name = p_last_name,
             registrant_org = p_org,
             zoom_name_matches = p_name_matches,
             last_error = null,
             claimed_at = null,
             verified_at = now(),
             ready_at = now()
       where id = p_id and status = 'creating';
    exception when unique_violation then
      update legacycs.impulsao_kickoff_zoom_registrants
         set status = 'error',
             last_error = 'Esta inscrição do Zoom já está ligada a outro e-mail nesta sala.',
             claimed_at = null
       where id = p_id and status = 'creating';
      return false;
    end;
  else
    update legacycs.impulsao_kickoff_zoom_registrants
       set status = p_status,
           last_error = left(coalesce(nullif(btrim(coalesce(p_error, '')), ''),
                                      'Falha ao gerar o acesso ao Zoom.'), 300),
           claimed_at = null
     where id = p_id and status = 'creating';
  end if;
  return found;
end;
$function$;

-- A inscrição pronta foi conferida no Zoom agora.
create or replace function legacycs.impulsao_kickoff_zoom_registrant_verified(p_id uuid)
returns void
language sql
security definer
set search_path to 'legacycs'
as $function$
  update legacycs.impulsao_kickoff_zoom_registrants
     set verified_at = now()
   where id = p_id and status = 'ready';
$function$;

-- ---------------------------------------------------------------------------
-- Painel: estado do acesso de cada reserva da sessão (sem chamar o Zoom)
-- ---------------------------------------------------------------------------

-- [{"booking_id", "estado", "email", "join_url", "erro", "nome_confere", "atualizado_em"}]
-- estado: pronto | preparando | pendente | sem_email | sem_sala | conflito
--         | erro | sem_acesso (reserva que não está ativa e nunca teve acesso)
-- join_url só quando pronto; o servidor ainda decide quem pode vê-lo.
create or replace function legacycs.impulsao_kickoff_zoom_session_access(p_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'legacycs'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'booking_id', x.booking_id,
           'estado', x.estado,
           'email', x.email,
           'join_url', case when x.estado = 'pronto' then x.join_url end,
           'erro', case when x.estado in ('erro', 'conflito') then x.erro end,
           'nome_confere', x.nome_confere,
           'atualizado_em', x.atualizado_em) order by x.criada_em), '[]'::jsonb)
    from (
      select b.id as booking_id,
             b.created_at as criada_em,
             lower(nullif(btrim(coalesce(b.participant_email, '')), '')) as email,
             r.join_url,
             r.zoom_name_matches as nome_confere,
             r.updated_at as atualizado_em,
             case
               when r.id is not null and r.client_id <> b.client_id
                 then 'Este e-mail já tem acesso de outra empresa nesta sala.'
               when r.status = 'creating'
                 then 'A última tentativa foi interrompida.'
               else r.last_error
             end as erro,
             case
               when lower(nullif(btrim(coalesce(b.participant_email, '')), '')) is null then 'sem_email'
               when s.id is null then 'sem_sala'
               when r.id is null then case when b.status = 'active' then 'pendente' else 'sem_acesso' end
               when r.client_id <> b.client_id then 'conflito'
               when r.status = 'ready' then 'pronto'
               when r.status = 'creating' and r.claimed_at > now() - interval '2 minutes' then 'preparando'
               when r.status = 'conflict' then 'conflito'
               else 'erro'
             end as estado
        from legacycs.impulsao_kickoff_bookings b
        left join legacycs.impulsao_kickoff_zoom_rooms s on s.active
        left join legacycs.impulsao_kickoff_zoom_registrants r
          on r.zoom_meeting_id = s.zoom_meeting_id
         and r.email = lower(nullif(btrim(coalesce(b.participant_email, '')), ''))
       where b.session_id = p_session_id and b.status <> 'cancelled'
    ) x;
$function$;

-- ---------------------------------------------------------------------------
-- Permissões das funções (função nova nasce executável por anon neste schema)
-- ---------------------------------------------------------------------------
revoke all on function legacycs._impulsao_kickoff_zoom_registrant_touch() from public, anon, authenticated;
revoke all on function legacycs._impulsao_kickoff_zoom_registrant_no_delete() from public, anon, authenticated;
revoke all on function legacycs.impulsao_kickoff_zoom_public_booking(text, text) from public, anon, authenticated;
revoke all on function legacycs.impulsao_kickoff_zoom_registrant_decide(uuid, text) from public, anon, authenticated;
revoke all on function legacycs.impulsao_kickoff_zoom_registrant_finish(uuid, text, text, text, text, text, text, boolean, text)
  from public, anon, authenticated;
revoke all on function legacycs.impulsao_kickoff_zoom_registrant_verified(uuid) from public, anon, authenticated;
revoke all on function legacycs.impulsao_kickoff_zoom_session_access(uuid) from public, anon, authenticated;

grant execute on function legacycs.impulsao_kickoff_zoom_public_booking(text, text) to service_role;
grant execute on function legacycs.impulsao_kickoff_zoom_registrant_decide(uuid, text) to service_role;
grant execute on function legacycs.impulsao_kickoff_zoom_registrant_finish(uuid, text, text, text, text, text, text, boolean, text)
  to service_role;
grant execute on function legacycs.impulsao_kickoff_zoom_registrant_verified(uuid) to service_role;
grant execute on function legacycs.impulsao_kickoff_zoom_session_access(uuid) to service_role;
```
