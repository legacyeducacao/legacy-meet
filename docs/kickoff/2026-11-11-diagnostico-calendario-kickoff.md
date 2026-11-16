# Kickoff Impulsão no Legacy Meet: diagnóstico do calendário e plano de migração

Diagnóstico de 11/11/2026, feito só com leitura: código do Legacy Meet e do Legacy CS, mais consultas de estrutura e contagens no banco. Nenhum código, tabela ou dado foi alterado. Nada foi implementado.

## Resumo

**Recomendação: cada sessão de kickoff vira uma reunião da agenda do Meet, e as regras de reserva vêm do CS.**

- **Sessões.** Uma sessão é uma reunião normal da agenda: série semanal ou avulsa, mesmo calendário, conflitos, feriados, remarcação e cancelamento. Uma tabela lateral nova marca a reunião como kickoff e guarda capacidade, bloqueio e a sala do Zoom.
- **O que vem do CS.** Reservas, convites, participante principal, remanejamento, ausência e Zoom (E1 e E2), trocando `client_id`/`plan_tenant_id` por `client_tenants.id`.
- **O que não se cria.** Nenhum segundo calendário, nenhuma cópia de empresa e nenhuma sincronização com o CS.

O que levou a isso:

1. **O Meet já tem o calendário, mas não tem reservas.** Recorrência RRULE com fuso, sessões avulsas, feriados, conflitos com a agenda do anfitrião, edição de série por escopo, histórico de remarcação e cancelamento e visões Dia/Semana/Mês estão prontos. Não existe capacidade, reserva pelo cliente, convite por empresa, página pública de agendamento nem participante externo gravado (seção D).
2. **O CS tem o oposto: regras de reserva maduras e um calendário próprio simples.** São horários semanais gerados por 8 semanas, sem feriados, sem rotina automática e com o anfitrião escrito no código. As regras de reserva têm testes de banco: capacidade com trava, uma reserva ativa por empresa, convite público com limite de tentativas e registrants do Zoom (seção F).
3. **O módulo do CS nunca foi commitado e tem poucos dados.**
   - Todo o código do kickoff no repositório do CS está fora do git (arquivos `??`).
   - As migrations 1 a 5 foram aplicadas à mão no projeto `iqktumissfojrlroqspt` (não aparecem no histórico de migrations). A E2 nunca foi aplicada.
   - Dados no banco: 9 sessões, 2 reservas (nenhuma ativa), 1 convite válido e 1 sala Zoom ativa.

   Ou seja, migrar dados é simples, mas o código precisa ser preservado antes de qualquer coisa.
4. **O Zoom com Meeting ID compartilhado já roda neste mesmo banco**, nas turmas do Plan: `cohort-zoom-join`, `cohort_zoom_*`, coleta a cada 30 min. A E2 do CS segue o mesmo padrão (nome com `#TENANTCODE`). O kickoff no Meet deve continuar nesse padrão (seção E.3).
5. **As reuniões comuns ficam intactas.** A marcação é por tabela lateral. `onboarding = true` já tira a reunião do ExecScore, e o `room_name` continua sendo gerado.

---

## A. Mapa das tabelas e relacionamentos do calendário

Tudo fica no projeto Supabase `eddfdgefrwjxfafkkzls` (legacy-plan), no schema `public`. As tabelas da agenda têm o prefixo `agenda_` e RLS ligado sem policy, então só o servidor (`service_role`) lê e escreve (`integracoes/agenda/001_agenda.sql`).

```
client_tenants (Plan) ◄──────────────┬──────────────┬──────────────────┐
  │                                  │              │                  │
  │ tenant_id (obrigatório)          │ tenant_id    │ tenant_id        │ tenant_id (obrigatório)
  ▼                                  │              │                  │
meetings (compartilhada com o Plan)  │              │                  │
  ▲  ▲  ▲                            │              │                  │
  │  │  └─ meet_meeting_sector (setor, onboarding, calendar_event_id)  │
  │  └──── meet_meeting_hosts (anfitriões extras)                      │
  │                                  │              │                  │
  │ meeting_id (único)               │              │                  │
agenda_ocorrencias ──► agenda_series ┘◄── agenda_grupos ┘    agenda_jornadas ┘
  (inicio_original, rotulo,     (rrule, inicio_local,  (Impulsão: dia, hora,     │
   status, excecao)              fuso, sequencia,      sequencia F1/F2/C1/C2,    ▼
                                 politica_feriado)     ancora, substituto)  agenda_jornada_encontros
                                     ▲                                       (numero, rotulo, data,
                                     └── agenda_templates                     meeting_id, presenca)
```

| Tabela | Papel | Colunas que importam | Linhas hoje |
|---|---|---|---|
| `meetings` | Uma linha por reunião, com a sala. É compartilhada com o Planner do Plan | `tenant_id` (obrigatório), `host_id`, `room_name`, `status` (`scheduled, live, ended, canceled, no_show`), `recurrence_parent_id`, `recording_enabled`, `auto_transcribe` | 2.772 do Meet |
| `meet_meeting_sector` | Marca a reunião como "do Meet" e dá o tipo | `sector` (`executoria`/`comercial`), `onboarding`, `calendar_event_id` (Google) | 2.772 |
| `meet_meeting_hosts` | Anfitriões adicionais | `meeting_id`, `user_id` | — |
| `agenda_templates` | Modelos de produto | `produto` (`impulsao`, `legado`, `personalizado`), `sequencia`, `politica_feriado`, `encontros_total`, `limite_remarcacoes`, `campos_editaveis` | 2 |
| `agenda_series` | Regra de uma série | `rrule`, `inicio_local`, `fuso`, `duracao_min`, `sequencia`, `defasagem`, `politica_feriado`, `serie_anterior_id`, `recurrence_parent_id`, `grupo_id`, `tenant_id`, `setor` | 119 |
| `agenda_ocorrencias` | Cada ocorrência materializada | `serie_id`, `inicio_original` (único na série), `rotulo`, `status` (`agendada, movida, cancelada, pulada_feriado, realizada, no_show`), `excecao`, `executor_substituto_id`, `meeting_id` (único) | 1.294 |
| `agenda_grupos` | Grupo do Impulsão (um dia da semana) | `executor_id`, `substituto_id`, `dia_semana`, `hora`, `sequencia`, `ancora`, `politica_feriado` (`pausa`/`segue`) | 1 |
| `agenda_jornadas` | Jornada de uma empresa | `tenant_id` (obrigatório), `produto` (`impulsao`/`legado`), `grupo_id`, `serie_id`, `encontros_previstos`, `status` | 75 (0 do Impulsão) |
| `agenda_jornada_encontros` | Encontros da jornada | `jornada_id` + `numero` (chave), `meeting_id`, `rotulo`, `recuperacao`, `presenca` (`pendente, presente, faltou`) | 784 |
| `agenda_expediente`, `agenda_bloqueios`, `agenda_regras_executor`, `agenda_config` | Disponibilidade e regras | faixas por dia, bloqueios com `rrule` opcional, buffer e limites | vazias (valem os padrões) |
| `agenda_feriados` | Feriados cadastrados (os nacionais são calculados) | `data`, `escopo`, `uf`, `municipio` | 0 |
| `agenda_remarcacoes`, `agenda_cancelamentos`, `agenda_overrides_log` | Histórico | `origem` (`cliente`, `executor`, `legacy`), justificativas | 26 / 1 / — |
| `agenda_gravacoes_duracao` | Duração real das gravações (horas realizadas) | `meeting_id`, `room_name`, `duracao_seg` | 1.899 |

**Do Plan, lidas pelo Meet sem escrita:** `client_tenants`, `users`, `cohorts`, `cohort_schedules` e `cohort_sessions` (aulas das turmas do Legado, mostradas como eventos que não se editam).

**Do Plan, que o Meet ainda não usa, mas que importam para o kickoff:** a estrutura de Zoom das turmas (seção E.3).

## B. Fluxo real de criação e gestão de agendamentos

**Criar** (`POST /api/agenda/eventos`, `app/api/agenda/eventos/route.ts`):

1. A entrada da agenda confere se é equipe do Meet (`podeUsarAgendaNova`, `lib/agenda/servidor.ts`). Depois, `autorizarEmpresaDaReuniao` (`lib/meetingTenantAccess.ts`) confere a empresa: carteira para Executoria, acesso para Comercial, tudo liberado para admin. O `tenantId` usado é o do banco.
2. Uma série vira ocorrências com `expandirSerie` (`lib/agenda-engine/recorrencia.ts`), já aplicando feriados (`carregarFeriados`) e o horizonte da empresa.
3. Conflitos: `contextoExecutor` (agenda, bloqueios e expediente do anfitrião) → `validarConflitos` (`lib/agenda-engine/disponibilidade.ts`) → `decidirConflitos` (`lib/agenda/regras.ts`). Um aviso pede justificativa. Um bloqueante só um admin passa por cima. A resposta 409 tem formato fixo (`RespostaConflito`).
4. `criarReunioes` (`lib/meetingsCore.ts`) grava uma linha em `meetings` por ocorrência, cada uma com `room_name` próprio (`meet_<uuid>`), mais `meet_meeting_sector` e `meet_meeting_hosts`. Em segundo plano, cria um evento no Google Agenda por ocorrência, com o link `/rooms/<room_name>` na descrição.
5. Se for série, grava `agenda_series` e `agenda_ocorrencias`. Se houver justificativa, grava em `agenda_overrides_log`. A opção "jornada do Legado" também grava `agenda_jornadas` e os encontros.

**Ciclo de vida:** `scheduled` → `live` quando o anfitrião clica em Entrar (`POST /api/meetings/start`) → `ended` pelo webhook da LiveKit (`app/api/livekit/webhook/route.ts`). Também pode ir para `no_show` (`/api/meetings/no-show`, regra em `lib/noShow.ts`) ou `canceled`. A ocorrência repete o status em `agenda_ocorrencias.status`.

**Editar ou remarcar** (`PATCH /api/agenda/eventos/[id]`): muda horário, duração ou título com escopo `esta`, `seguintes` ou `todas`. O escopo `seguintes` divide a série (`dividirSerie`) e cria outra com `serie_anterior_id`. A remarcação fica em `agenda_remarcacoes` com a origem. Conflitos são validados de novo e o Google é atualizado. Quem pode e quais reuniões entram ficam em `resolverAlvos` (`lib/agenda/alvos.ts`).

**Cancelar** (`POST /api/agenda/eventos/[id]/cancelar`): `status = canceled` (o histórico fica), registro em `agenda_cancelamentos` com a origem, ocorrência marcada como `cancelada` e o evento do Google apagado. Também existem `POST /api/agenda/restaurar` e `POST /api/agenda/desfazer-criacao`, que alimentam o "Desfazer" da tela.

**Impulsão (grupos e jornadas):** `lib/agenda/grupos.ts`.

- `gerarGrupo` cria a série do grupo com rótulo por encontro (ex.: "Impulsão · Grupo Terça · F2"). O `tenant_id` das reuniões do grupo é a empresa sentinela Comercial (`grupos.ts:167`), porque `meetings.tenant_id` é obrigatório.
- `matricular(tenantId, …)` grava `agenda_jornadas` + `agenda_jornada_encontros`, apontando cada encontro para a reunião do grupo, e adiciona o e-mail da empresa aos eventos do Google.
- `estenderGrupos` roda a cada 6 h (`instrumentation.ts`).

## C. Recorrência, disponibilidade, bloqueios, feriados e visões

| Assunto | Como funciona | Onde |
|---|---|---|
| Recorrência | RRULE (RFC 5545) em hora local "flutuante" + fuso IANA (`America/Sao_Paulo`). Exceções e "este e os seguintes" | `lib/agenda-engine/recorrencia.ts` (`expandirSerie`, `dividirSerie`, `contagem`), `tempo.ts` |
| Ciclo F1/F2/C1/C2 | `sequencia`, `ancora` e `defasagem` decidem o rótulo de cada semana | `lib/agenda-engine/ciclo.ts`, `grupos.ts` (`ocorrenciasDoGrupo`, `sugerirEntrada`, `gerarJornada`) |
| Disponibilidade | Expediente por dia (padrão seg a sex, 08–12 e 13–18), buffer, limites por dia e semana, horários livres e blocos de foco | `disponibilidade.ts` (`EXPEDIENTE_PADRAO`, `REGRAS_PADRAO`, `horariosLivres`, `livreDoDia`); rotas `/api/agenda/disponibilidade`, `/config` |
| Bloqueios | Pontuais ou recorrentes (`rrule`), com motivo privado | `agenda_bloqueios`; `/api/agenda/bloqueios`; `listarBloqueios` |
| Feriados | Nacionais calculados (Páscoa, facultativos configuráveis) + cadastrados (estadual, municipal, Legacy). Política por série: `manter`, `pular`, `cancelar`, `pausa`, `segue`. Prévia do impacto | `feriados.ts` (`feriadosNacionais`, `feriadosValidos`); `/api/agenda/feriados`, `/feriados/previa` |
| Conflitos | Tipos: `sobreposicao`, `bloqueio`, `feriado`, `fora_expediente`, `buffer`, `preparo`, `limite_*`. Nível bloqueante ou aviso, configurável | `validarConflitos`, `NIVEIS_PADRAO`; `/api/agenda/validar` (prévia) |
| Visões | Dia, 4 dias, Semana, Mês, Lista; linha do agora; arrastar para criar, mover e redimensionar em passos de 15 min; colunas para eventos sobrepostos | `lib/agenda/visao.ts` (`diasDaVisao`, `periodoDaVisao`, `navegar`), `lib/agenda-engine/layout.ts` (`layoutDia`); `components/agenda-nova/GradeHoras.tsx`, `VisaoMes.tsx`, `VisaoLista.tsx`, `MiniCalendario.tsx` |
| Evento extraordinário | Reunião avulsa (`rrule` vazio) no mesmo `POST /api/agenda/eventos` | idem B |

## D. Participantes, empresas e capacidade

| Pergunta | Situação no Meet |
|---|---|
| Empresa da reunião | `meetings.tenant_id` (uma por reunião, obrigatória). Comercial e grupos usam a empresa sentinela |
| Várias empresas no mesmo evento | Só de forma indireta: várias `agenda_jornadas` (uma por empresa) apontando o mesmo `meeting_id` em `agenda_jornada_encontros`. Foi construído, mas em produção nenhuma reunião tem mais de uma empresa |
| Empresa x pessoa | Empresa = `client_tenants.id`. Pessoa da equipe = `users` (anfitrião e co-anfitriões). Convidados externos são só e-mails do convite do Google (`guestEmails`), sem gravar no banco. Na sala, a pessoa digita o nome; os nomes vão para o JSON da reunião no MinIO (`meta.participants`, webhook `participant_joined`), não para o banco |
| Presença | Por empresa e por encontro: `agenda_jornada_encontros.presenca`, marcada à mão (`PATCH /api/agenda/jornadas/[id]`). Não há presença por pessoa |
| Capacidade / vagas | **Não existe.** Nem limite por sessão, nem "uma reserva ativa por empresa" |
| Reserva pelo cliente | **Não existe.** A matrícula é feita pela equipe (`matricular`) |
| Links | O convidado entra por `/rooms/<room_name>` (sem login) e digita o nome. O anfitrião usa a sessão ou um link assinado (`lib/hostLink.ts`, HMAC por sala). A tabela `meeting_guest_invites` é do Plan e o Meet não usa |
| Fluxos públicos sem login | `/rooms/*`, `/obrigado`, `/api/connection-details`, `/api/room/*`, `/api/nps/context`, `/api/nps/submit`, `/api/meetings` (CRM, `x-api-key`), webhooks (`middleware.ts`). **Não há página pública de agendamento** |

## E. Infraestrutura de reuniões e pontos de extensão para Zoom

### E.1 Reunião nativa do Meet

`room_name` é a chave de tudo. `POST /api/meetings/start` marca a reunião como `live`. `/api/connection-details` gera o token da LiveKit. O egress grava `<room_name>__<ts>.mp4`, o worker transcreve e manda "transcrição pronta" para resumo, ExecScore e `agenda_gravacoes_duracao`. O webhook da LiveKit fecha o ciclo (`live` → `ended`) e registra quem entrou.

### E.2 Como o tipo é decidido hoje

| Camada | Campo | Valores |
|---|---|---|
| Banco | `meet_meeting_sector.sector` + `onboarding` | `executoria`, `comercial`; onboarding não vai para o ExecScore |
| Calendário | `calendarioDe(setor, produto)` (`lib/agenda/servidor.ts:78`) | `impulsao`, `legado`, `comercial`, `outros` (+ `turmas`, `bloqueios`, `feriados`) em `lib/agenda/tipos.ts` |
| Tela | `EventoDTO.tipo` | `reuniao`, `bloqueio`, `turma` (aula do Plan, só leitura, com `link` do Zoom) |

### E.3 Zoom que já existe no mesmo projeto (do Plan)

O Plan já tem, em produção, a arquitetura "uma reunião recorrente do Zoom com Meeting ID compartilhado entre sessões": 22 aulas usam só 3 Meeting IDs.

| Peça | O que faz |
|---|---|
| `cohort_schedules.zoom_meeting_id`, `cohort_sessions.zoom_meeting_id` | Meeting ID compartilhado por cronograma ou sessão |
| Edge function `cohort-zoom-join` | Link individual do Zoom: autentica pela sessão do Plan, resolve a empresa no servidor, cria ou reaproveita o registrant (`cohort_zoom_registrants`, um por reunião e usuário), grava quem assiste (`cohort_session_zoom_attendance`) e devolve `join_url`, ou `start_url` para a equipe |
| `cohort_zoom_occurrences` | Cada instância da reunião recorrente casada com a sessão (`match_status`, `candidate_session_ids`, auditoria em `cohort_zoom_occurrence_match_audit`) |
| `cohort_zoom_connections` | Cada conexão de participante, casada com empresa e usuário pelo registrant |
| `cohort_session_zoom_presence` | Presença por sessão e empresa (`effective_seconds`, `first_join_at`, `last_leave_at`) |
| Cron `zoom-presence-collect` | Chama `cohort-zoom-collect` a cada 30 min |
| `_shared/zoom.ts` | Cliente Server-to-Server OAuth (`getMeeting`, `addRegistrant`, `getRegistrant`, `findRegistrantByEmail`); os segredos `ZOOM_*` ficam nas edge functions do projeto |

Limite para o kickoff: `cohort_zoom_registrants.user_id` é obrigatório (a pessoa tem login no Plan), e tudo está ligado a `cohort_sessions`. Um kickoff com reserva pública sem login não cabe nessas tabelas sem mudança no Plan.

### E.4 Onde um tipo `kickoff_impulsao` com Zoom encaixa sem mexer nas reuniões comuns

| Ponto | Hoje | Extensão (aditiva) |
|---|---|---|
| Marcar o tipo | `meet_meeting_sector.sector`, que só aceita `comercial` ou `executoria` (check no banco) | Tabela lateral nova, chave `meeting_id` (`agenda_kickoff_sessoes`, seção J), no mesmo padrão aditivo de `meet_meeting_sector`, sem coluna nova em `meetings`. Reunião sem linha nela = reunião nativa, como hoje |
| Calendário | `calendarioDe` | Calendário `kickoff` em `CALENDARIOS` e ramo em `calendarioDe`/`reuniaoParaEvento` |
| Entrar | `entrar()` em `AgendaNova.tsx:431` chama `/api/meetings/start` → `/rooms/<room_name>` | Para Zoom: pedir o `start_url` ao servidor (como `cohort-zoom-join` com `as: 'staff'`) e abrir no Zoom |
| Copiar link | `copiarLink()` em `AgendaNova.tsx:441` copia `/rooms/<room_name>` | Para Zoom: o convite é por empresa ou pessoa (link individual do registrant), não um link único |
| Google Agenda | `lib/meetingsCore.ts` põe `/rooms/<room_name>` na descrição | Parâmetro de link na criação, para o kickoff levar o link certo |
| Gravação e transcrição | Pipeline por `room_name` (LiveKit) | Não se aplica ao Zoom. Criar a sessão com `onboarding = true`: `motivoForaDoScore` (`lib/execscore.ts:128`) já tira essas reuniões do ExecScore, sem mudar código. As "horas realizadas" por gravação não contam o kickoff. A presença vem do Zoom (E.3) |
| `room_name` | Obrigatório e único em `meetings` | Continua sendo gerado (`meet_<uuid>`), só não é usado. Assim nada que lê `meetings` quebra |
| Status | `live` pelo Entrar, `ended` pelo webhook da LiveKit | Sem LiveKit, o webhook não fecha a reunião. A sessão de kickoff fica `scheduled` até a ausência ou presença ser registrada, ou a equipe marca o encerramento. Não chamar `/api/meetings/start` para Zoom |

As reuniões comuns ficam intactas: elas não têm linha na tabela lateral e seguem o caminho de hoje.

## F. Comparação com os requisitos do kickoff

Referências do CS: repositório `legacycs` (schema `legacycs`, projeto `iqktumissfojrlroqspt`). Migrations em `supabase/migrations/2026110912…` a `2026111212…`; código em `src/lib/kickoffs*.ts`, `src/components/kickoffs/*` e `src/routes/kickoffs.tsx` / `agendar.$codigo.tsx`.

| Requisito | 1. O Meet já tem | 2. Pode ser adaptado | 3. Vem do CS | 4. Deixa de existir |
|---|---|---|---|---|
| Sessões recorrentes | `agenda_series` + RRULE + `expandirSerie`, com feriados, horizonte e conflitos com a agenda do anfitrião | Modelo "Kickoff Impulsão" (`agenda_templates`, produto `personalizado`, sem migration). Incluir as séries de kickoff na rotina de 6 h (hoje só `estenderGrupos`) | Regra do sync do CS: mudança na recorrência não mexe em sessão com reserva; sessão ajustada à mão fica como está (`adjusted`, que no Meet é `excecao`) | `impulsao_kickoff_recurrences`, `_impulsao_kickoff_sync_recurrence`, horizonte fixo de 8 semanas gerado ao abrir a tela |
| Sessões extraordinárias | Reunião avulsa (`POST /api/agenda/eventos` sem `rrule`) | Marcar como kickoff na tabela lateral | — | `impulsao_kickoff_create_extra`, coluna `origin` |
| Bloquear sessão (sem novas reservas) | Não | — | Flag `bloqueada` na tabela lateral + regra (`set_blocked`) | — |
| Limite de 5 empresas | Não há capacidade | — | `capacidade` por sessão (padrão 5, 1 a 50) + `_impulsao_kickoff_lock_open_session` (trava de transação + `FOR UPDATE` + contagem) + "capacidade não abaixo das reservas" | — |
| Uma reserva ativa por empresa | Não | — | Índice único parcial `(…) WHERE status = 'active'`, trocando `client_id` por `tenant_id` | Chave por `client_id` |
| Remanejar | Remarcar a sessão inteira (`PATCH /api/agenda/eventos/[id]` + `agenda_remarcacoes`). Mover a sessão leva as reservas junto, porque a reserva aponta para a reunião | — | `move_booking` (destino aberto, futuro, com vaga e diferente do atual) + `impulsao_kickoff_booking_moves` (só inclusão) | — |
| Cancelar | Cancelar sessão com origem (`/cancelar` + `agenda_cancelamentos`) e Desfazer | Gancho em `/cancelar` e no `PATCH`: sessão de kickoff com reservas ativas exige decisão explícita, como no CS (`cancel_session` x `cancel_session_and_bookings`) | `cancel_booking` (libera a vaga e guarda o histórico) | `impulsao_kickoff_cancel_session` |
| Ausência | No-show por reunião (`lib/noShow.ts`) e presença por empresa marcada à mão (`agenda_jornada_encontros.presenca`) | Presença automática pelo Zoom no padrão do Plan (`cohort-zoom-collect`), numa fase posterior (o CS chama de "E3") | `mark_no_show` por reserva (só depois do fim; libera a empresa para reservar de novo; a vaga continua contada) | — |
| Convite empresarial individual | Não. `lib/hostLink.ts` assina link de anfitrião, não de empresa | — | `impulsao_kickoff_invites`: código de 12 caracteres, um válido por empresa, renovar revoga, só `produto = impulsao_empresarial` | Card no Customer360 do CS (o lugar no Meet é decisão) |
| Agendamento público sem login | Não. Só `/rooms` é público | Rotas públicas no `middleware.ts` + rotas Next no servidor (`service_role`), no padrão do Meet. Nada de chamada direta ao banco com a chave anon | `public_invite`, `public_book`, limite de tentativas (`public_throttle`: 10 códigos errados por IP e 10 tentativas por convite em 15 min) | Chamada pelo navegador ao PostgREST com a chave anon |
| Interface pública Mês, Semana, Dia | As visões da equipe (`GradeHoras`, `VisaoMes`) estão presas à edição. As funções puras `lib/agenda/visao.ts` e `layout.ts` servem | Estilo do Meet | `calendario-publico.tsx` + `src/lib/kickoffs-publico-calendario.ts` (puro, testado) + `agendamento-publico.tsx` | — |
| Participante principal (nome, e-mail, WhatsApp) | Não grava pessoa externa | Sugestão vinda do Plan (`client_tenants.owner/email/phone`, `users` CLIENT/COLLABORATOR, `collaborators`) em vez de `legacycs.contacts` | Colunas na reserva + `participant_edits` + `validarParticipante` (e-mail obrigatório em reserva nova) | Leitura de `legacycs.contacts` |
| Zoom E1 (sala) | Não tem cliente Zoom no app. O projeto tem o app S2S do Plan nas edge functions | Segredos `ZOOM_*` no servidor do Meet (mesmo app S2S, sem regenerar o secret) | `src/lib/zoom-api.ts`, `avaliarSalaDoKickoff` (tipo 8, aprovação automática, inscrição única), `zoom_rooms` + guarda (checagem com menos de 2 h, Meeting ID imutável), aba "Sala Zoom" | — |
| Zoom E2 (inscrições) | — | Migration da E2 adaptada (`tenant_id` uuid, FK para a reserva nova). Aplicar só no Meet | `garantirInscricao`, `kickoffs-zoom-inscricao.ts`, acesso público e painel; nome `… \| Empresa #TENANTCODE`, igual ao Plan | Migration E2 no CS: não precisa ser aplicada |
| Identificação pela empresa do Plan | `client_tenants.id` (uuid, FK), já usado em `meetings`, `agenda_*` e no Plan (`agenda_do_cliente`) | — | — | `plan_tenant_id text` copiado, espelho `legacycs.clients` e dependência de `portfolio-sync` para o kickoff |
| Anfitrião | `meetings.host_id` real, com conflito contra a agenda dele | Página pública mostra o anfitrião da sessão | — | `ANFITRIAO_DO_KICKOFF` escrito no código |
| Feriados | Nacionais calculados + cadastrados, com política por série | Política do modelo de kickoff (`pular` ou `manter`) | — | Cancelamento manual de sessão por feriado |
| Rotina automática | `instrumentation.ts` (6 h) | Estender as séries de kickoff | — | Sincronizar ao abrir a tela |
| Cliente vê o kickoff no Plan | `agenda_do_cliente()` mostra reuniões e encontros | Incluir a reserva de kickoff na função (fase posterior) | — | — |
| Testes de regra no banco | Testes do Meet são de regra pura | Trazer o banco em memória do CS (`kickoffs-banco-ambiente.ts`, PGlite) | `kickoffs-*-banco.test.ts` como especificação | — |

## G. O que reutilizar do Meet

| Peça | Para quê no kickoff |
|---|---|
| `agenda_series` + `agenda_ocorrencias` + `meetings` + `criarReunioes` | Sessões recorrentes e extraordinárias do kickoff, sem segundo calendário |
| `lib/agenda-engine` (`expandirSerie`, `dividirSerie`, `feriados`, `validarConflitos`, `layoutDia`) | Geração, feriados, conflitos do anfitrião e layout |
| `PATCH /api/agenda/eventos/[id]`, `/cancelar`, `restaurar`, `desfazer-criacao` | Mover ou cancelar uma sessão inteira, com histórico (`agenda_remarcacoes`, `agenda_cancelamentos`) |
| Tela da agenda (`components/agenda-nova/*`) | Sessões do kickoff no calendário da equipe, com filtro próprio |
| `client_tenants.id` + `autorizarEmpresaDaReuniao` | Empresa da reserva e quem da equipe pode agir por ela |
| `lib/agenda/visao.ts` e `layout.ts` (puros) | Base das visões Mês, Semana e Dia da página pública |
| `lib/hostLink.ts` (HMAC) e o padrão de rotas públicas do `middleware.ts` | Convite assinado e rotas públicas sem login |
| `agenda_jornadas` (`produto = impulsao`) | Depois do kickoff, a empresa entra no ciclo F1/F2/C1/C2 pela matrícula que já existe |

## H. O que vem do CS

| Peça do CS | Destino no Meet | Adaptação |
|---|---|---|
| `impulsao_kickoff_bookings`, `_booking_moves`, `_participant_edits` (migrations 2 e 3) | Tabelas de reserva, remanejamento e histórico do participante | `session_id` → `meeting_id`; `client_id` + `plan_tenant_id` → `tenant_id uuid` com FK para `client_tenants`; manter os bloqueios de apagar e de reescrever o histórico |
| Funções `book`, `move_booking`, `cancel_booking`, `mark_no_show`, `update_participant`, `_lock_open_session` | Funções SQL `SECURITY DEFINER` chamadas só pelo servidor | Trocar `_begin_write` (papel `admin` do CS) pela checagem do servidor do Meet (`isStaff`/admin), como as outras rotas da agenda |
| `impulsao_kickoff_invites`, `_public_throttle`, `public_invite`, `public_book` (migration 4) | Convite e reserva pública | Elegibilidade por `client_tenants.produto = 'impulsao_empresarial'`; manter os códigos existentes, para o link já enviado continuar valendo |
| `impulsao_kickoff_zoom_rooms` + guarda (migration 5, E1) | Sala Zoom do kickoff | Nenhuma além dos nomes |
| `impulsao_kickoff_zoom_registrants` + 5 funções (migration 6, E2, não aplicada) | Inscrições Zoom | `tenant_id uuid`; FK para a reserva nova |
| `src/lib/zoom-api.ts`, `kickoffs-zoom.ts`, `kickoffs-zoom-inscricao.ts` | `lib/zoom/*`, `lib/kickoff/*` | Os `.server.ts` (funções do TanStack) viram rotas Next |
| `src/lib/kickoffs.ts`, `kickoffs-publico.ts`, `kickoffs-publico-calendario.ts` | `lib/kickoff/*` (regra pura, com os testes) | Nenhuma |
| `agendamento-publico.tsx`, `calendario-publico.tsx`, `acesso-zoom-publico.tsx` | Página pública `/agendar/[codigo]` | Design system do Meet |
| `reserva-dialog.tsx`, `remanejar-dialog.tsx`, `participante-dialog.tsx`, a parte de reservas de `detalhes-da-sessao.tsx`, `sala-zoom.tsx` | Detalhes do evento de kickoff na agenda + aba de configuração | Escolha de empresa sobre `/api/clients` |
| `kickoffs-banco-ambiente.ts` + `kickoffs-*-banco.test.ts` | Testes de banco do kickoff | Banco simulado do Plan em vez do banco do RH |

## I. O que se torna redundante no CS

| Peça | Substituída por |
|---|---|
| `impulsao_kickoff_recurrences`, `_sync_recurrence`, `save_recurrence`, `impulsao_kickoff_sync` | `agenda_series` + RRULE + rotina de 6 h |
| `impulsao_kickoff_sessions` e `_sessions_view`, `create_extra`, `update_session`, `cancel_session` | `meetings` + `agenda_ocorrencias` + tabela lateral; rotas `/api/agenda/eventos*` |
| `calendario-semanal.tsx`, `agenda-de-sessoes.tsx`, `barra-da-agenda.tsx`, `kickoffs-calendario.ts` | Agenda do Meet (`GradeHoras`, `VisaoLista`, `layoutDia`) com o calendário "Kickoff" |
| `horarios-recorrentes.tsx`, `horario-dialog.tsx`, `sessao-dialog.tsx` | `FormularioEvento` com o modelo "Kickoff Impulsão" |
| Rota `/kickoffs` e item no menu do CS | Calendário "Kickoff" na `/agenda` + aba nas configurações |
| `plan_tenant_id` copiado, `legacycs.clients`/`contacts` e `portfolio-sync` para o kickoff | `client_tenants.id` e dados do Plan lidos na hora |
| Anfitrião escrito no código e feriado por cancelamento manual | `meetings.host_id` e o motor de feriados |

Nada disso deve ser removido agora. O CS fica como está até o corte (J, passo 7).

## J. Arquitetura recomendada e sequência de migração

### J.1 Opções comparadas

| Critério | A. Copiar as tabelas do CS para o banco do Meet | **B. Sessão = reunião da agenda + reservas do CS (recomendada)** | C. Reservas como jornadas (`agenda_jornadas`) |
|---|---|---|---|
| Reaproveita o calendário do Meet | Não: mostra as sessões como as turmas, só leitura | Sim: série, avulsa, conflitos, feriados, edição e visões | Sim |
| Regras de reserva | Prontas | Portadas com os testes | Faltam capacidade, participante e convite; `produto` aceita só `impulsao`/`legado` |
| Calendário paralelo | **Sim** (o que se quer evitar) | Não | Não |
| Duplicidade de sessões | Duas fontes de sessão | Uma só (`meetings`) | Uma só |
| Zoom | Igual ao CS | Igual ao CS, com o anfitrião real | Igual ao B |
| Novas migrations | Muitas (cópia inteira) | Aditivas: tabela lateral + reservas, convites e Zoom | Mudar o check de `produto` + colunas novas em tabela em uso |
| Impacto no calendário da equipe | Nenhum, mas sem integração | Calendário "Kickoff" novo e ganchos em Entrar, Copiar link e Cancelar para sessões de kickoff | Mistura reserva com jornada e distorce o painel do Impulsão |

### J.2 Modelo proposto (ilustrativo; a migration fica para a implementação)

```sql
-- Sessão = linha em meetings (criada por criarReunioes, via série ou avulsa),
--   com meet_meeting_sector (sector 'executoria', onboarding = true) e host_id = anfitrião.
agenda_kickoff_sessoes (meeting_id pk -> meetings on delete cascade,
  capacidade int default 5 check (capacidade between 1 and 50),
  bloqueada bool default false, sala_zoom_id -> agenda_kickoff_salas_zoom, ...)
agenda_kickoff_reservas (id, meeting_id -> agenda_kickoff_sessoes,
  tenant_id uuid not null -> client_tenants,
  participante_nome, participante_email, participante_whatsapp,
  status check (status in ('ativa','cancelada','ausente')), convite_id, cancelada_*, ausencia_*, ...)
  -- unique (tenant_id) where status = 'ativa'   (uma reserva ativa por empresa)
agenda_kickoff_remanejamentos, agenda_kickoff_participante_historico   -- só inclusão
agenda_kickoff_convites (codigo unique, tenant_id, revogado_em, ...)     -- um válido por empresa
agenda_kickoff_limite_publico                                             -- limite de tentativas da página pública
agenda_kickoff_salas_zoom, agenda_kickoff_inscricoes_zoom                 -- E1 e E2
```

Como nas outras tabelas `agenda_*`: RLS ligado sem policy, só `service_role`, e a regra conferida no servidor.

### J.3 Sequência incremental

Cada passo pode ir para produção sozinho e não muda as reuniões comuns.

| Passo | Entrega | Toca em produção? |
|---|---|---|
| 0 | Commitar o módulo de kickoff no repositório do CS (hoje está todo fora do git) e responder às decisões abaixo | Não |
| 1 | Migration aditiva `integracoes/kickoff/001` (tabelas acima + funções portadas) + testes de banco portados (PGlite) | Tabelas novas, vazias |
| 2 | `lib/kickoff/*` (regra pura portada) + rotas da equipe (reservar, remanejar, cancelar, ausência, participante, convite), atrás de `usuarioAgenda` e admin | Rotas novas |
| 3 | Agenda: calendário "Kickoff", modelo "Kickoff Impulsão", ocupação (n/5) e reservas nos detalhes do evento, ganchos de cancelar e mover sessão com reservas, extensão das séries na rotina de 6 h | Tela da equipe (aditivo) |
| 4 | Página pública `/agendar/[codigo]` + rotas públicas (middleware) + limite de tentativas + calendário Mês/Semana/Dia | Rota pública nova |
| 5 | Zoom E1 no Meet: cliente S2S, sala, Entrar e Copiar link pelo Zoom para sessões de kickoff, link do Zoom no Google Agenda | Segredos `ZOOM_*` no servidor do Meet |
| 6 | Zoom E2 no Meet: inscrições por e-mail, acesso na página pública e no painel | Migration `002` |
| 7 | Corte: recriar o horário recorrente; trazer a sala Zoom ativa (verificar de novo) e o código do convite válido; redirecionar `/agendar/<código>` do CS para o Meet; parar a escrita no CS. O histórico do CS fica onde está (2 reservas, nenhuma ativa) | Sim, com janela combinada |
| 8 | Depois: presença automática pelo Zoom no padrão `cohort-zoom-collect`; kickoff visível ao cliente no Plan (`agenda_do_cliente`); remover as telas do CS | — |

### J.4 Decisões que dependem da equipe

1. **Empresa das reuniões de kickoff.** `meetings.tenant_id` é obrigatório. Dá para usar a sentinela Comercial, como os grupos do Impulsão já fazem (`grupos.ts:167`), ou criar uma sentinela própria, o que grava uma linha em `client_tenants` do Plan. As empresas da sessão vêm das reservas.
2. **Quem opera o kickoff no Meet.** No CS, só admin age. A equipe de CS que opera hoje precisa de perfil no Meet.
3. **O que a página pública mostra.** O CS mostra CNPJ/CPF e o contato sugerido (nome, e-mail, telefone) a quem tem o link. Recomendo mostrar só o nome da empresa e pré-preencher só o que a pessoa digitar.
4. **Convite do Google Agenda para participantes.** Com até 5 empresas num evento só, cada uma pode ver os e-mails das outras. Ou não convidar pelo Google, ou desligar a lista de convidados.
5. **Anfitrião.** Fixo, como no CS, ou por sessão, que é o padrão do Meet.
6. **Feriado.** Pular a sessão ou manter (política do modelo).
7. **Depois do kickoff.** Matricular a empresa no ciclo do Impulsão (`matricular`) de forma automática ou manual.
