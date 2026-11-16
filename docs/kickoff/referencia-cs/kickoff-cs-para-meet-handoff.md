# Kickoff Impulsão: handoff do Legacy CS para o Legacy Meet

**Para:** o agente do Legacy Meet que vai implementar o kickoff lá, e quem for operar o processo depois.
**Data:** 12/11/2026, horário de Brasília.
**Arquivo irmão:** [kickoff-cs-guia-tecnico.md](kickoff-cs-guia-tecnico.md), com inventário, SQL real, contratos, código do Zoom e testes. Este handoff diz **o que levar, como encaixar no Meet, em que ordem e com que cuidados**.

## Como ler

| Marca | Significa |
|---|---|
| **[APROVADO]** | Decisão da gestão. Não rediscutir; só verificar a compatibilidade |
| **[CS]** | Existe e foi testado no Legacy CS (ver o guia) |
| **[ADAPTAR]** | Mecanismo do CS que muda de forma no Meet |
| **[PROPOSTA]** | Sugestão para o Meet; ainda não existe em lugar nenhum |
| **[VERIFICAR-NO-MEET]** | Depende do modelo do Meet, que este documento **não conhece** |

Nada aqui supõe como o Meet modela eventos, empresas ou permissões. Onde isso importa, está marcado **[VERIFICAR-NO-MEET]**.

---

## 1. Decisões aprovadas [APROVADO]

1. **Calendário único no Meet.**
   - Cada **sessão coletiva** de kickoff é **um evento** da agenda existente.
   - Sem calendário paralelo.
   - Recorrência, disponibilidade, bloqueios, feriados, horários extraordinários e prevenção de conflitos vêm do Meet.
   - O evento representa a **sessão**, não uma empresa.
   - Até **5 empresas** por sessão, cada uma com quantos representantes quiser.
2. **Empresa organizadora interna "Customer Success".**
   - Vínculo organizacional do evento, **se** o Meet exigir `tenant_id` no evento.
   - As empresas participantes ficam nas **reservas**.
   - **Nunca** associar o evento a uma empresa participante.
   - A empresa interna não é cliente comercial, não ocupa vaga e não entra em indicadores.
3. **Identificação empresarial:** `client_tenants.id`, no mesmo projeto Supabase do Plan e do Meet. Sem cadastro duplicado. **CNPJ não é chave.**
4. **Permissões:**
   - funcional `kickoff_impulsao.manage`, independente de quem é o Marcelo;
   - quem administra pode conceder e revogar;
   - o resto do Meet continua igual para Executoria, Comercial etc.
5. **Interface:**
   - seção exclusiva **"Kickoffs Impulsão"** para configurar, integrada à agenda única;
   - a agenda principal mostra tudo, com filtro **visual** "Todos / Só reuniões comuns / Só kickoffs", que **não altera a disponibilidade real**;
   - quem não tem a permissão não vê as ferramentas nem os dados das empresas participantes.
6. **Videoconferência:**
   - **só Zoom**; a videochamada nativa do Meet não é usada nos kickoffs;
   - uma reunião recorrente com o mesmo Meeting ID, links individuais por registrante e identificação `Nome | Empresa #CÓDIGO`;
   - execuções separadas por Meeting UUID no futuro;
   - **app OAuth do Plan, compartilhado.**
7. **Google Agenda fora do escopo dos kickoffs:**
   - sem evento ou convite Google para participantes;
   - sem as 5 empresas como convidadas de um evento Google;
   - reuniões comuns do Meet inalteradas.
8. **Links públicos com a marca da Legacy:**
   - `https://<domínio>/impulsao/agendar/<código>` para agendar;
   - `https://<domínio>/impulsao/reuniao/<código>` para entrar, encaminhando ao Zoom;
   - convite **por empresa**, sem login; consulta da reserva pelo mesmo convite;
   - o código **não dá acesso** a dados ou links de outra empresa.
9. **Documentação permanente no repositório do Meet:** técnica e manual operacional (seção 10). Nada pode depender de conhecimento exclusivo do Marcelo ou de um desenvolvedor.

---

## 2. O que muda de forma entre o CS e o Meet

| Tema | No CS [CS] | No Meet |
|---|---|---|
| Projeto e schema | Supabase "RH" `iqktumissfojrlroqspt`, schema `legacycs` | Projeto do Plan/Meet. Schema e convenções **[VERIFICAR-NO-MEET]** |
| Sessão | Linha própria `impulsao_kickoff_sessions` com `starts_at`, `duration_minutes`, `capacity`, `status` (`open`/`blocked`/`cancelled`) | **Evento** da agenda + o que o evento não tiver (capacidade, "aceita reservas") numa **extensão de kickoff ligada ao evento** **[PROPOSTA]** |
| Recorrência e geração | Tabela própria e geração das próximas 8 semanas (`impulsao_kickoff_sync`) | **Recorrência do Meet** (não levar a do CS) |
| Empresa | `legacycs.clients.id` (cadastro do CS); `plan_tenant_id` é cópia | **`client_tenants.id` direto** |
| Quem administra | Papel `admin` em `legacycs.user_roles` (`has_role`) | Permissão `kickoff_impulsao.manage` |
| Anfitrião | Fixo no código (`ANFITRIAO_DO_KICKOFF`: Marcelo, foto em `public/kickoff/`) | Dono ou anfitrião do evento, com nome e foto do perfil do Meet **[VERIFICAR-NO-MEET]** |
| Página pública | `/agendar/<código>` + funções `anon` do banco | `/impulsao/agendar/<código>` + `/impulsao/reuniao/<código>` |
| Runtime do servidor | TanStack Start (`createServerFn`) com service role; variáveis no app Node | **[VERIFICAR-NO-MEET]** (Edge Function, rota de servidor etc.) |

---

## 3. Mapeamento de dados

**Dados reais no CS hoje** (leitura em 12/11/2026, sem dados pessoais):

| Item | Quantidade |
|---|---|
| Sessões | 9, todas `open`/`recurring`: 1 passada e 8 futuras, de 10/11/2026 a 05/01/2027 |
| Horários recorrentes | 1 ativo |
| Reservas | 2, ambas `cancelled` e ambas **de teste** (1 feita pela página pública) |
| Reservas ativas / `no_show` | **0 / 0** |
| Remanejamentos / edições do participante | 1 / 0 |
| Convites | **1 válido** (1 empresa, de teste), 0 revogados |
| Linhas de controle de tentativa | 1 |
| Salas Zoom | 1, **ativa**: a `88672328525`, reunião de **teste** aprovada. Não é a sala de produção |
| Inscrições Zoom | **tabela inexistente** (migration E2 não aplicada) |
| Empresas referenciadas | 1. Seu `plan_tenant_id` é UUID, **existe em `client_tenants`** (conferido no projeto do Plan) e não diverge do cadastro do CS |

**Consequência:** **não há histórico real a preservar.** O corte pode ser limpo (seção 6).

| Item do CS | Origem e identificador | Relações e restrições no CS | No Meet [PROPOSTA] | Regra de migração | Preservar UUID? |
|---|---|---|---|---|---|
| Sessão | `impulsao_kickoff_sessions.id` | Nunca apagada; `capacity` 1–50; estados `open/blocked/cancelled`; `unique(recurrence_id, slot_date)` | Evento do Meet + extensão `kickoff_session` (`event_id` PK/FK, `capacity`, `accepts_bookings`, `cancelled_at/by/reason`) **[VERIFICAR-NO-MEET]** | **Não migrar** (só dados de teste) | Não |
| Horário recorrente | `impulsao_kickoff_recurrences.id` | Único ativo por (dia, hora) | Recorrência do Meet | Não migrar | Não |
| Empresa organizadora | Não existe no CS | — | `client_tenants` interno "Customer Success", **só se** o evento exigir `tenant_id` **[VERIFICAR-NO-MEET]** | Criar ou reutilizar | — |
| Empresa participante | `legacycs.clients.id` → `plan_tenant_id` (= `client_tenants.id`) | `bookings.client_id` FK; cópia `plan_tenant_id` | `tenant_id` = `client_tenants.id` | Usar `plan_tenant_id` como `tenant_id` | — |
| Reserva | `impulsao_kickoff_bookings.id` | Única ativa por empresa; e-mail ou telefone; sem delete; estados `active/cancelled/no_show` | `kickoff_bookings` (`event_id`, `tenant_id`, `participant_*`, `status`, `invite_id`, datas) | Não migrar (2 de teste) | Opcional: só se migrar histórico |
| Remanejamento | `impulsao_kickoff_booking_moves` | Só inclusão; `from` ≠ `to` | `kickoff_booking_moves` (`from_event_id`, `to_event_id`) | Não migrar | — |
| Ausência | `bookings.status='no_show'`, `no_show_at/by` | Só após o fim; não libera vaga | Igual | — | — |
| Edição do participante | `impulsao_kickoff_participant_edits` | Só inclusão; guarda os dados anteriores | `kickoff_participant_edits` | Não migrar | — |
| Convite | `impulsao_kickoff_invites.code` (12 car.) | Único válido por empresa; revogável | `kickoff_invites` (`code`, `tenant_id`, `created/revoked`) | **1 convite válido de teste.** Recriar no Meet; preservar o código só se um link real já tiver sido enviado (não há) | **Preservar o `code`** se migrar; o UUID não importa |
| Controle de tentativas | `impulsao_kickoff_public_throttle` | Janela fixa por chave | Igual | Não migrar | — |
| Sala Zoom | `impulsao_kickoff_zoom_rooms` (Meeting ID único) | Uma ativa; verificação < 2 h para ativar; histórico | `kickoff_zoom_rooms` | **Não migrar a de teste.** Cadastrar a sala definitiva no Meet | Não |
| Inscrição Zoom | `impulsao_kickoff_zoom_registrants` (não existe) | Chave (sala, e-mail); `join_url` credencial | `kickoff_zoom_registrants` com `tenant_id` no lugar de `client_id` | Nada a migrar | — |
| Histórico de participação | Não existe (E3) | — | Execuções, conexões e presença (E3 no Meet) | — | — |
| Permissão | `legacycs.user_roles` (`admin`) | — | `kickoff_impulsao.manage` | Conceder a quem hoje é admin do kickoff (Marcelo) | — |

---

## 4. Matriz de transferência

### A: Reutilizar ou adaptar no Meet

| O quê | Origem no CS | Como |
|---|---|---|
| **Regras SQL de reserva e concorrência** | Guia, seção 3 (`_begin_write`, `_lock_open_session`, `book`, `move`, `cancel`, `mark_no_show`, `update_participant`) | Trocar `session_id` por `event_id` (com trava `FOR UPDATE` na linha do evento ou da extensão), `client_id` por `tenant_id` e o papel `admin` pela permissão. **Manter** a fila de escrita, a contagem depois da trava, o índice único parcial de reserva ativa por empresa, o histórico só de inclusão e os códigos de erro |
| **Convites e segurança pública** | Guia, seção 4 (`_invite_code`, `_new_invite`, `invite_for_client`, `renew_invite`, `_public_origin`, `_throttle_*`, `_public_open`, `public_invite`, `public_book`) | Mesmo alfabeto e formato de código; mesmas travas (10 códigos errados em 15 min por origem; 10 reservas em 15 min por convite); status em vez de erro nas funções públicas; empresa sempre tirada do convite |
| **Validações** | `validarParticipante` (`src/lib/kickoffs.ts`) e as checagens SQL | Igual. **Recomendação:** exigir e-mail também no banco para reserva nova (no CS ficou só na tela) |
| **Componentes da página pública** | `agendamento-publico.tsx`, `calendario-publico.tsx`, `acesso-zoom-publico.tsx`, `kickoffs-publico.ts`, `kickoffs-publico-calendario.ts` | Copiar e trocar a fonte (eventos do Meet no formato `SessaoPublica`), o anfitrião (do evento), o tema e as rotas `/impulsao/...` |
| **Cliente Zoom** | `src/lib/zoom-api.ts` (Apêndice A do guia) | Copiar como está (sem dependência do CS) |
| **Sala Zoom (E1)** | `kickoffs-zoom.ts` + migration E1 (Apêndice B) | Copiar as regras; recriar a tabela e as funções no Meet |
| **Inscrições Zoom (E2)** | `kickoffs-zoom-inscricao.ts` (Apêndice C) + migration E2 (Apêndice D, **não aplicada**) | Copiar o orquestrador; recriar a tabela com `tenant_id`; o contexto sai do **evento + reserva do Meet** |
| **Testes** | Guia, seção 8 | Portar os cenários de concorrência, convite e Zoom; o harness PGlite é um modelo reutilizável |

### B: Substituir pela infraestrutura do Meet

| O quê no CS | Substituído por |
|---|---|
| Calendário administrativo (`calendario-semanal`, `agenda-de-sessoes`, `barra-da-agenda`, `kickoffs-calendario.ts`, `use-kickoffs.tsx`) | Agenda do Meet + filtro visual |
| Horários recorrentes e geração de 8 semanas (`impulsao_kickoff_recurrences`, `_sync_recurrence`, `sync`, `save_recurrence`, `horarios-recorrentes`, `horario-dialog`) | Recorrência do Meet |
| Disponibilidade, feriados, bloqueios e conflitos (CS só barrava duas sessões com o mesmo `starts_at`) | Regras de agenda do Meet |
| Sessão extraordinária e edição (`create_extra`, `update_session`, `sessao-dialog`) | Evento avulso do Meet. Manter as regras de kickoff: capacidade ≥ inscritas; não mover evento com reserva ativa sem decisão explícita |
| Bloqueio de novas reservas (`set_blocked`) | Campo "aceita reservas" do kickoff, ou bloqueio da agenda **[VERIFICAR-NO-MEET]** |
| Administração de anfitriões (fixo no CS) | Usuários e anfitriões do Meet |

### C: Descontinuar no CS depois da migração (sem apagar tabelas com histórico)

| O quê | Quando | Como |
|---|---|---|
| Página `/kickoffs` e menu "Kickoffs" | Depois do Meet validado | Esconder o menu e a rota; tabelas ficam **[PROPOSTA]** |
| Criação de convites no Customer 360 (`convite-do-kickoff.tsx`) | Junto | Remover o cartão ou trocar por "Kickoffs agora no Meet" |
| Agendamento público `/agendar/<código>` | Depois de redirecionar | Redirecionar para o Meet (seção 6) |
| Aba "Sala Zoom" do CS | Junto | Desativar; a sala de teste fica só no histórico |
| Migration E2 | **Não aplicar no CS** | Implementar direto no Meet |

---

## 5. Contratos propostos para o Meet [PROPOSTA]

### 5.1 Tabelas mínimas

O formato é sugestão; os nomes e o schema seguem o Meet.

```sql
-- Extensão de kickoff de um evento da agenda (1:1). O evento continua dono de data,
-- hora, recorrência, anfitrião e conflitos; aqui só o que é de kickoff.
kickoff_sessions (event_id pk/fk -> eventos, capacity int 1..50 default 5,
                  accepts_bookings bool default true,           -- "bloqueada para novas reservas"
                  cancelled_at, cancelled_by, cancel_reason, created_at, updated_at)

kickoff_bookings (id uuid pk, event_id fk, tenant_id uuid fk client_tenants(id),
                  participant_name, participant_email, participant_phone,
                  status in (active|cancelled|no_show), cancelled_at/by/reason, no_show_at/by,
                  invite_id fk, created_by, updated_by, created_at, updated_at)
  unique (tenant_id) where status = 'active'                     -- uma ativa por empresa
  sem delete (gatilho); e-mail obrigatório para reserva nova [recomendado]

kickoff_booking_moves (booking_id, from_event_id, to_event_id, reason, moved_by, moved_at)  -- só inclusão
kickoff_participant_edits (booking_id, previous_name/email/phone, changed_by, changed_at)     -- só inclusão
kickoff_invites (id, code unique check ^[a-hj-km-np-z2-9]{12}$, tenant_id, created_by/at, revoked_at/by)
  unique (tenant_id) where revoked_at is null
kickoff_public_throttle (key pk, window_started_at, hits)
kickoff_zoom_rooms        -- = impulsao_kickoff_zoom_rooms (Apêndice B do guia)
kickoff_zoom_registrants  -- = Apêndice D, com tenant_id no lugar de client_id e event via booking
```

### 5.2 Invariantes que o Meet precisa garantir (lista de aceite)

1. Capacidade conta **empresas** com reserva `active` no evento, contadas **depois** de travar a linha do evento ou da extensão (`FOR UPDATE`) e na mesma transação do insert ou move.
2. **Uma reserva ativa por empresa** no total, por índice único parcial, mesmo com pedidos simultâneos.
3. Só reserva em evento de kickoff que aceita reservas, não cancelado e **futuro**.
4. Remanejar mantém o id da reserva e grava o histórico; o destino passa pela mesma trava.
5. Cancelar reserva libera a vaga; reserva com ausência não se cancela.
6. Ausência só depois do fim do evento; libera a empresa, mas a vaga continua contada.
7. Cancelar evento com inscritos exige decisão explícita (remanejar, cancelar uma a uma, ou "cancelar com as reservas").
8. Mudar a recorrência do Meet **não pode** mover nem cancelar um evento com reserva ativa sem decisão explícita. **[VERIFICAR-NO-MEET]**: como a recorrência do Meet trata exceções.
9. Nada com histórico se apaga.
10. O visitante só chega aos dados da **empresa do convite**; a empresa sai do convite, nunca do pedido.
11. Os filtros visuais da agenda **não** mudam a disponibilidade: o evento de kickoff ocupa a agenda do anfitrião como qualquer reunião.

### 5.3 Rotas públicas

**`/impulsao/agendar/<código>`:** a mesma página do CS, consumindo o equivalente de `public_invite` e `public_book`.
- `sessoes` = eventos de kickoff futuros, que aceitam reservas, com vaga, no formato `SessaoPublica` (`{id, data, inicio, fim, starts_at, vagas}`, datas em Brasília).
- O `id` exposto é o do evento ou da extensão; nenhum outro dado do evento sai.

**`/impulsao/reuniao/<código>`** (novo; o CS mostra o `join_url` direto na página de agendamento):
1. resolve convite → reserva **ativa** → inscrição Zoom (cria, se não houver, como na E2);
2. se pronta: **redireciona (302)** ao `join_url` com `Cache-Control: no-store`, `Referrer-Policy: no-referrer` e `noindex`;
3. se não: página "preparando / tentar novamente / fale com a Legacy";
4. aplica as mesmas travas de tentativa;
5. o `join_url` nunca aparece em listagem nem em log.

Assim o cliente guarda **um** link da Legacy, que continua valendo se a sala Zoom for renovada.

### 5.4 Funções (assinaturas sugeridas, espelhando as do CS)

```
kickoff_book(p_event_id, p_tenant_id, p_name, p_email, p_phone)            -- permissão
kickoff_move_booking(p_booking_id, p_to_event_id, p_reason)                -- permissão
kickoff_cancel_booking(p_booking_id, p_reason)                             -- permissão
kickoff_cancel_session_and_bookings(p_event_id, p_reason)                  -- permissão
kickoff_mark_no_show(p_booking_id)                                         -- permissão
kickoff_update_participant(p_booking_id, p_name, p_email, p_phone)         -- permissão
kickoff_invite_for_tenant(p_tenant_id) / kickoff_renew_invite(p_tenant_id) -- permissão
kickoff_public_invite(p_code) / kickoff_public_book(p_code, p_event_id, ...)  -- anon (ou via servidor com IP repassado)
kickoff_zoom_* (sala e inscrições)                                         -- service_role, chamadas pelo servidor
```

**Detalhe de trava que já custou caro:** se a página pública chamar o banco **pelo servidor** (e não direto do navegador), o servidor tem de **repassar o IP do visitante**. Senão todos os visitantes caem na mesma chave de tentativas. A E2 do CS já faz isso: `impulsao_kickoff_zoom_public_booking(p_code, p_origem)`.

### 5.5 Zoom no Meet

- **Variáveis do servidor:** `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, com os **mesmos valores do app do Plan**.
- **Escopos:** os da E1 e E2 já estão habilitados; não pedir alteração.
- **Sala definitiva:** precisa ser **exclusiva do Impulsão**. Nunca usar um Meeting ID cadastrado em turma do Plan: a coleta do Plan passaria a vigiá-la.
  - A `88672328525` é sala oficial de uma turma **antiga de teste** do Plan. Serve só para desenvolvimento.
  - Antes de abrir execução real nela, confirmar que a coleta do Plan não a vigia mais.
- **Configuração exigida da sala:**
  - recorrente **com horário fixo** (tipo 8);
  - inscrição obrigatória com aprovação automática;
  - "inscrever-se uma vez para todas as ocorrências";
  - sem sala de espera, sem autenticação obrigatória, sem entrada antes do anfitrião.
- **Renovação:** no máximo 50 ocorrências; o ID expira 365 dias depois do último início. A tela da E1 avisa quando faltam 30 dias ou menos para a última ocorrência.
- **Nome no Zoom:** `Nome | Empresa #CÓDIGO`, com `CÓDIGO = 8 primeiros hex de client_tenants.id` em maiúsculas. É o **mesmo** do Plan, então os relatórios dos dois sistemas falam a mesma língua.

---

## 6. Estratégia de corte

Hoje só há dados de teste no CS: 0 reservas ativas e 1 convite de teste. Isso permite um **corte limpo**:

1. **Congelar o CS.** Não aplicar a migration E2 no CS e não evoluir o kickoff lá.
2. **Implementar no Meet** (seção 7) e validar com uma **empresa de teste** e um e-mail da equipe.
3. **Evitar dois sistemas agendando ao mesmo tempo.** No dia do corte, antes de liberar os links do Meet:
   - revogar no CS o convite válido (há 1);
   - esconder a criação de convites no Customer 360;
   - deixar `/kickoffs` só leitura, ou escondido **[PROPOSTA]**.
4. **Redirecionar as URLs antigas.**
   - `/agendar/<código>` do CS → `https://<domínio>/impulsao/agendar/<código>`, **se** os códigos forem preservados no Meet;
   - caso contrário, uma página "Este link foi atualizado. Fale com o time da Legacy".
   - Como não há link real enviado, a recomendação é **gerar códigos novos no Meet** e usar o aviso.
5. **Preservar o histórico.** Não apagar tabelas do CS: elas ficam como registro. Se algum dia houver dado real a levar:
   - reservas e convites: copiar com `tenant_id = plan_tenant_id`, `event_id` mapeado da sessão e o mesmo `code`;
   - remanejamentos e edições: só se as reservas forem levadas.
6. **Desligar a interface antiga** (menu, rota, aba Sala Zoom, cartão do Customer 360) **só depois** de validar o fluxo novo de ponta a ponta: agendar, reabrir, entrar no Zoom e o painel.

---

## 7. Sequência incremental recomendada

Cada etapa só começa depois do critério da anterior.

| Etapa | Entrega | Critério de aceite |
|---|---|---|
| **M0: verificações no Meet** | Mapear o modelo de eventos (campos, `tenant_id` obrigatório?, recorrência e exceções, conflitos, cancelamento), permissões, rotas públicas, runtime do servidor, domínio, sincronização com o Google | Respostas aos **[VERIFICAR-NO-MEET]** deste documento, por escrito |
| **M1: permissão e organizador** | `kickoff_impulsao.manage` (conceder e revogar); empresa interna "Customer Success" só se necessária, **fora** de indicadores e capacidade | Um usuário sem a permissão não vê nada do kickoff; com ela, vê |
| **M2: evento de kickoff** | Marcar o tipo de evento + extensão (capacidade, aceita reservas); filtro visual Todos / Comuns / Kickoffs; **sem** sincronização Google para kickoff | Criar e recorrer kickoffs na agenda do Marcelo; disponibilidade inalterada pelo filtro |
| **M3: reservas** | Tabelas e funções da seção 5, com os invariantes 5.2; cenários de teste portados (guia, seção 8) | Disputa pela última vaga e reserva simultânea da mesma empresa passam |
| **M4: convites e página pública** | Convite por empresa; `/impulsao/agendar/<código>` com o visual do CS (Mês/Semana/Dia, 2 etapas, anfitrião do evento) | Agendar, reabrir, convite revogado ou inválido, limite de tentativas |
| **M5: Zoom E1** | Cliente (Apêndice A), regras e tabela da sala (Apêndice B), tela de configuração na seção Kickoffs | Sala de teste aprovada no Zoom real |
| **M6: Zoom E2** | Inscrições (Apêndices C e D com `tenant_id`), `/impulsao/reuniao/<código>`, estados no painel | Link criado uma vez, reaproveitado ao reabrir, sem vazamento; Zoom fora não perde a reserva |
| **M7: corte** | Seção 6 | Nenhum agendamento possível no CS; links antigos com destino |
| **M8: documentação e operação** | Manual (seção 10); depois, a E3 (presença) | Outra pessoa consegue operar só com o manual |

---

## 8. Cuidados para não afetar as reuniões comuns do Meet

- **O kickoff é um tipo de evento**, e as regras de reserva valem só para ele. Reuniões comuns, convites, agendamento de executores e comercial, e a videochamada nativa ficam como estão.
- **Google Agenda:** não sincronizar eventos de kickoff nem convidar participantes **[APROVADO]**. Se o Meet sincroniza a agenda do anfitrião, decidir se o kickoff aparece no Google do Marcelo como bloqueio **sem convidados** **[VERIFICAR-NO-MEET]**.
- **Disponibilidade:** o evento de kickoff ocupa a agenda do anfitrião. Os filtros são só visuais.
- **Permissões:** as ferramentas e os dados das empresas do kickoff ficam atrás de `kickoff_impulsao.manage`. Ninguém perde acesso ao que já usa.
- **Indicadores:** a empresa interna "Customer Success" e as reservas não entram em métricas comerciais.
- **Tabelas separadas:** reservas, convites e Zoom do kickoff em tabelas próprias, sem colunas novas obrigatórias nas tabelas de eventos comuns.

---

## 9. Dependências e decisões pendentes

| # | Tema | Situação |
|---|---|---|
| 1 | O evento do Meet exige `tenant_id`? Como modelar o organizador "Customer Success"? | **[VERIFICAR-NO-MEET]** |
| 2 | Como a recorrência do Meet trata exceções em evento com reservas | **[VERIFICAR-NO-MEET]** |
| 3 | Modelo de permissão do Meet (onde mora `kickoff_impulsao.manage`, quem concede) | **[VERIFICAR-NO-MEET]** |
| 4 | Domínio das URLs públicas | A definir |
| 5 | Preservar códigos de convite | Recomendo **não** (só há teste) |
| 6 | E-mail obrigatório também no banco | Recomendo sim |
| 7 | Gerar o acesso Zoom sozinho no painel (como no CS) ou só por botão | Decidir. Com a sala de teste ativa, gerar sozinho inscreve reservas reais nela |
| 8 | Vários representantes por empresa (inscrição individual para cada um) | Fora da primeira versão |
| 9 | Cancelar inscrições no Zoom quando a reserva é cancelada ou o e-mail muda | Decidir na E3 |
| 10 | Sala definitiva do Impulsão (criar, ciclo de 50 ocorrências, comportamento depois da última) | A criar; o comportamento depois da última ocorrência não foi testado |
| 11 | Regra de associação execução → sessão com 2 kickoffs no mesmo dia | E3; a janela do Plan (−30/+60 min) não serve com menos de 90 min entre sessões |
| 12 | Runtime e origem do IP do visitante no servidor do Meet | **[VERIFICAR-NO-MEET]** |
| 13 | Projeto Supabase do CS (RH) excedeu a cota de uso; restrição prevista a partir de 08/12/2026 | Aviso operacional; não afeta o Meet se o kickoff sair do CS antes |

---

## 10. Documentação e operação futura (a criar no repositório do Meet)

**Documento técnico:**
- modelo de dados, invariantes da seção 5.2, funções e permissões;
- o fluxo do Zoom (E1, E2 e depois a E3);
- testes e como rodá-los.

**Manual operacional (para quem não é desenvolvedor):**
1. Conceder e revogar `kickoff_impulsao.manage`.
2. Definir o anfitrião dos kickoffs (e trocar quando o responsável mudar).
3. Criar e alterar a recorrência; sessão extra; feriado e bloqueio; o que acontece com quem já reservou.
4. Gestão de reservas: inscrever, remanejar, cancelar, registrar ausência, corrigir participante.
5. Gerar, copiar e trocar o convite de uma empresa (o link antigo para de abrir).
6. Sala Zoom: configuração exigida; verificar; trocar pela sala nova e quando renovar (aviso de última ocorrência).
7. Erros de acesso Zoom: "sem e-mail" (editar o participante), "falha" (tentar de novo), "conflito" (e-mail já usado por outra empresa).
8. Identificação empresarial: `client_tenants.id` e o código `#XXXXXXXX` no nome do Zoom.
9. Futuro: coleta de presença (E3) e como ler os resultados.

---

## 11. Referências

**Guia técnico deste pacote** ([kickoff-cs-guia-tecnico.md](kickoff-cs-guia-tecnico.md)):

| Seção | Assunto |
|---|---|
| 3 | Reservas e concorrência |
| 4 | Convites |
| 5 | Interface pública |
| 6 | Zoom E1 |
| 7 | Zoom E2 |
| 8 | Testes |
| Apêndices A–D | Código e SQL |

**Documentos do Plan sobre a integração Zoom** (`zoom-legacy-plan-guia-tecnico.md` e `zoom-legacy-cs-handoff.md`):
- origem do cliente S2S, das regras de inscrição e do nome `#CÓDIGO`;
- limitações L1–L19 da sala recorrente.

**Pacote de arquivos para copiar literalmente**, levado por uma pessoa com acesso aos dois repositórios:
- `src/lib/zoom-api.ts`
- `src/lib/kickoffs-zoom.ts`
- `src/lib/kickoffs-zoom-inscricao.ts`
- `src/lib/kickoffs-publico.ts`
- `src/lib/kickoffs-publico-calendario.ts`
- `src/components/kickoffs/agendamento-publico.tsx`
- `src/components/kickoffs/calendario-publico.tsx`
- `src/components/kickoffs/acesso-zoom-publico.tsx`
- os testes correspondentes
- as 6 migrations, como referência; a E2 **não aplicada**
