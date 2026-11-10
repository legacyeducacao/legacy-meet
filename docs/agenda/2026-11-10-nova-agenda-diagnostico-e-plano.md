# Nova Agenda do Legacy Meet: diagnóstico e plano (fase 1)

Status: **aguardando aprovação**. Nada foi implementado. Nenhuma tabela foi criada.

## 1. O que existe hoje

### 1.1 Telas e código da agenda

| Peça | Onde | Observação |
|---|---|---|
| Tela da agenda | `app/agenda/page.tsx` (1.246 linhas, um arquivo só) | Lista paginada de próximas reuniões e histórico, formulário de criação, diálogo de edição, no-show, cancelar, "Última reunião". Não há visão de calendário (dia/semana/mês). |
| Criar reunião agora | `app/page.tsx` + `app/api/meetings/local` | Reunião instantânea (status `live`). |
| Agendar | `app/api/meetings/schedule` | Cria 1 linha em `meetings` por ocorrência (até 104), setor, anfitriões extras, convite no Google Agenda por ocorrência. |
| Editar / cancelar / no-show | `app/api/meetings/[id]`, `cancel`, `no-show` (`lib/noShow.ts`) | Edição é por ocorrência; cancelar tem opção de série (`recurrence_parent_id`). |
| Recorrência | `lib/recurrence.ts` (73 linhas) | Só `daily`, `weekly`, `biweekly`, `monthly`, término por data ou quantidade. Assume UTC-3 fixo. Sem exceções, sem "2ª terça do mês", sem vários dias da semana. |
| Google Agenda | `lib/calendar.ts` | Conta de integração única (mesmo OAuth do Drive) cria o evento e convida executor e cliente. |
| API para o CRM | `app/api/meetings/route.ts` (`x-api-key`) | O Legacy Plan cria salas por aqui. |
| Bibliotecas | `package.json` | Não há biblioteca de calendário nem de datas/fuso. Há `recharts` (gráficos), `tinykeys` (atalhos), `framer-motion`, `radix-ui`/shadcn, `sonner`. |
| Testes | `vitest`, 40 arquivos, 294 testes | Padrão: regra pura em `lib/*.ts` + `*.test.ts`. |

### 1.2 Banco (Supabase legacy-plan, compartilhado com o Legacy Plan/CRM)

| Tabela | Dono | Uso pela agenda |
|---|---|---|
| `public.meetings` (2.967 linhas; 2.681 criadas pelo Meet) | **compartilhada com o CRM** | Cada reunião é uma linha. Recorrência = várias linhas ligadas por `recurrence_parent_id` + texto em `recurrence_rule` (`weekly;count=12`; o CRM grava em JSON). Status: `scheduled, live, ended, canceled, no_show`. |
| `public.meet_meeting_sector` | Meet | Setor (`executoria`/`comercial`), `onboarding`, id do evento no Google. |
| `public.meet_meeting_hosts` | Meet | Anfitriões adicionais. |
| `public.meet_user_profile` | Meet | `is_admin`, `sector` por usuário. Não existe papel "gestor". |
| `public.client_tenants` (249) | CRM | Cliente. Tem `produto` (`legado_online` 162, `legado_presencial` 37, `legado_hibrido` 10, `impulsao_empresarial` 16, `in_company` 2, vazio 22), `executor_id`, `turma`, `data_assinatura_contrato`. |
| `public.cohorts`, `cohort_schedules`, `cohort_sessions` (130), check-ins (348), Zoom | CRM | **Turmas fechadas** do Legado (ex.: "Turma 20", 12 encontros semanais "Encontro 1, Cultura de Voo"... às 9h), com Zoom, RSVP, check-in e NPS. Não é o ciclo F1/F2/C1/C2 do Impulsão. |
| `public.meeting_recordings` (34), `meeting_participants` | CRM | Gravações do sistema antigo do CRM; o Meet não usa. |
| `execscore.*` | ExecScore | Executores e avaliações (integração já ligada). |

### 1.3 Como a reunião chega na gravação e na transcrição

`meetings.room_name` é a chave de tudo. O egress do LiveKit grava `<room_name>__<timestamp>.mp4`; o worker transcreve e grava o manifesto em `manifests/<id>.json` no MinIO (com `durationSeconds`), arquiva no Drive e avisa o app (resumo + ExecScore). **A duração real da gravação não está no banco**, só no manifesto do MinIO.

### 1.4 Dados que já dizem algo (últimos 90 dias, Executoria)

- 1.257 reuniões; seg a qui concentram 88%; sábado e domingo quase nada.
- Recorrência mais comum: `weekly;count=12` (456 linhas), depois 10, 14, 15. Ou seja, o Legado hoje é **semanal, ~12 encontros**.
- `ended_at - started_at` não serve como "hora realizada": a média de terça dá 200 min por causa de salas que ficam abertas. Por isso o KPI tem que usar a duração da gravação (como o prompt pede).
- O Impulsão **não aparece no Meet** hoje (nenhum encontro em grupo com F1/F2/C1/C2). Só 16 clientes têm `produto = impulsao_empresarial`, quase todos "SEM TURMA".

## 2. Riscos e decisões de arquitetura

1. **`meetings` é compartilhada com o CRM.** Nada da nova agenda altera colunas ou significado de `meetings`. O modelo novo fica num schema próprio `agenda` (como foi feito com `execscore`). Cada ocorrência materializada continua virando **uma linha em `meetings`** com `room_name`, criada pelo mesmo caminho de hoje (setor, anfitriões, Google Agenda). Resultado: gravação, transcrição, resumo e ExecScore não mudam.
2. **Feature flag.** A agenda nova nasce em `/agenda/nova`, visível só para quem estiver liberado (coluna `agenda_nova` em `meet_user_profile` ou variável `AGENDA_NOVA_USERS`). `/agenda` atual continua igual até a validação.
3. **Motor de regras puro** em `lib/agenda-engine/` (sem React, sem Supabase, sem `Date.now()` escondido: o "agora" entra por parâmetro). Pronto para virar pacote e ser usado pelo CRM depois.
4. **Fuso.** O código atual assume UTC-3 fixo. O motor novo trabalha com fuso IANA (`America/Sao_Paulo`) via biblioteca, para não quebrar se o horário de verão voltar e para os testes de DST pedidos (feitos com um fuso que tem DST).
5. **Bibliotecas propostas** (minha recomendação, posso trocar):
   - `rrule` (RFC 5545, MIT) para expandir recorrências em hora local "flutuante", e `date-fns` + `@date-fns/tz` para converter fuso.
   - Visões de calendário **feitas por nós** sobre o design system atual (grade de horas, coluna de sobreposição, arrastar, redimensionar). Motivo: o algoritmo de colunas e o comportamento "estilo Google" ficam testáveis no motor, sem brigar com o CSS de uma biblioteca pronta. Alternativa mais rápida e menos fiel: FullCalendar (núcleo MIT).
   - Feriados nacionais: BrasilAPI (`/api/feriados/v1/{ano}`), carregados uma vez por ano e guardados no banco.
6. **Horas realizadas** precisam de uma tabela com a duração de cada gravação. Proposta: o aviso "transcrição pronta" (que já existe) grava `agenda.gravacoes_duracao`, e um script faz a carga do histórico a partir dos manifestos.

## 3. Modelo de dados proposto (schema `agenda`)

Nomes em português para casar com `execscore`. Todas as datas em `timestamptz` (UTC); horários de regra em hora local + fuso.

```sql
-- Templates de produto
agenda.templates (
  id uuid pk, nome text, produto text check (produto in ('impulsao','legado','personalizado')),
  duracao_min int, rrule_padrao text,                 -- ex.: 'FREQ=WEEKLY;BYDAY=TU'
  hora_local time, fuso text default 'America/Sao_Paulo',
  sequencia text[],                                   -- ex.: {F1,F2,C1,C2}; vazio = sem rótulo
  politica_feriado text check (in ('pausa','segue','pular')),
  regras jsonb,                                       -- encontros_total, frequencia, limite_remarcacoes, preparo_min...
  ativo bool, criado_em, atualizado_em)

-- Séries recorrentes
agenda.series (
  id uuid pk, template_id fk, executor_id uuid -> public.users, titulo text,
  tenant_id uuid null -> public.client_tenants,       -- Legado 1 a 1
  grupo_id uuid null -> agenda.grupos,                -- Impulsão
  rrule text, inicio_local timestamp, fuso text, duracao_min int,
  sequencia text[], defasagem int default 0, ancora date,
  horizonte_meses int default 6, gravar bool, transcrever bool, onboarding bool,
  serie_anterior_id uuid null,                        -- "este e os seguintes" fecha a série e abre outra
  encerrada_em timestamptz null, criado_por uuid, criado_em, atualizado_em)

-- Ocorrências materializadas dentro do horizonte (exceções ficam aqui também)
agenda.ocorrencias (
  id uuid pk, serie_id fk, inicio_original timestamptz,   -- RECURRENCE-ID: identifica a ocorrência mesmo se movida
  inicio timestamptz, fim timestamptz,
  indice_ciclo int, rotulo text,                      -- F1, F2...
  status text check (in ('agendada','movida','cancelada','pulada_feriado','realizada','no_show')),
  excecao bool default false, motivo_excecao text,
  executor_substituto_id uuid null,
  meeting_id uuid unique null -> public.meetings,     -- a sala de verdade (gravação/transcrição)
  unique (serie_id, inicio_original))

-- Impulsão
agenda.grupos (id, nome, template_id, executor_id, rrule, hora_local, fuso,
               defasagem int, ancora date, sequencia text[], serie_id, ativo)
agenda.jornadas (id, tenant_id, produto, grupo_id null, executor_id,
                 inicio date, fim_previsto date, encontros_previstos int,
                 status text check (in ('ativa','concluida','pausada','cancelada')))
agenda.jornada_encontros (jornada_id, ocorrencia_id, numero int, rotulo text,
                          presenca text check (in ('pendente','presente','faltou')))

-- Disponibilidade do executor
agenda.expediente (executor_id, dia_semana smallint, inicio time, fim time)       -- várias faixas por dia
agenda.bloqueios (id, executor_id, inicio, fim, dia_inteiro bool, rrule null,
                  motivo text,                        -- privado (RLS: dono + gestor)
                  criado_em)
agenda.regras_executor (executor_id pk, buffer_min int, max_reunioes_dia int,
                        max_horas_dia numeric, max_horas_semana numeric)
agenda.feriados (id, data date, nome, escopo text check (in ('nacional','estadual','municipal','legacy')),
                 uf text null, municipio text null, origem text)

-- Auditoria e KPIs
agenda.overrides_log (id, regra text, nivel text, ocorrencia_id, serie_id,
                      usuario_id, justificativa text, criado_em)
agenda.cancelamentos (ocorrencia_id/meeting_id, origem text check (in ('cliente','executor','legacy')),
                      remarcada_para uuid null, usuario_id, criado_em)
agenda.gravacoes_duracao (recording_id pk, meeting_id, room_name, inicio, duracao_seg, fonte)
```

Diferenças em relação ao prompt: `event_exceptions` virou colunas em `ocorrencias` (`inicio_original` + `excecao`), que é como o RFC 5545 faz e evita juntar duas tabelas a cada leitura. `availability_rules` virou três tabelas (expediente, bloqueios, regras) para a privacidade do motivo do bloqueio ficar simples no RLS.

**RLS:** executor lê e escreve o que é dele (`executor_id = auth.uid()`); gestor lê tudo; `bloqueios.motivo` sai por uma view que mostra "Indisponível" para quem não é dono nem gestor. O app continua usando `service_role` nas rotas, com a checagem de permissão no servidor (padrão atual do Meet).

## 4. Motor de regras (`lib/agenda-engine/`)

Módulos puros, cada um com teste:

| Módulo | Faz |
|---|---|
| `ciclo.ts` | `conteudo(grupo, data)` = `sequencia[(semanasDesde(ancora, data) - semanasPausadas(ate data) - defasagem) mod n]`. Funciona antes da âncora (mod positivo) e com qualquer sequência, defasagem e dia. |
| `entrada.ts` | Próxima ocorrência que é "Aula 1" em qualquer grupo, ou só no dia escolhido; gera os N encontros da jornada. "Aula 1" é configuração (`entradas_permitidas` no template), não código. |
| `recorrencia.ts` | Expande RRULE em hora local, aplica exceções, "somente este", "este e os seguintes" (fecha a série na data e cria outra, preservando o passado), "todos". |
| `feriados.ts` | Política `pausa` (o ciclo anda junto) e `segue` (semana perdida; clientes afetados recebem a aula na próxima vez dela) + prévia do impacto. |
| `conflitos.ts` | Valida todas as ocorrências no horizonte contra expediente, bloqueios, buffer, limites, feriados e outras reuniões; devolve lista com nível (bloqueante/aviso) e ação sugerida. |
| `disponibilidade.ts` | Horários livres para o Legado; tempo de foco (blocos de 2h+). |
| `layout.ts` | Colunas de eventos sobrepostos (mesma regra do Google: grupos de colisão, mais longos à esquerda). |
| `kpis.ts` | Todas as fórmulas da seção 4 do prompt sobre um conjunto de dados de entrada. |

Os testes obrigatórios do prompt (tabela de 5 semanas e além, datas antes da âncora, entrada com espera máxima de 1 semana, pausa e segue, virada de ano, DST, "este e os seguintes", conflitos, cada KPI) entram na fase 2.

## 5. Fases

| Fase | Entrega | Mexe em produção? |
|---|---|---|
| 1 | Este documento + respostas às perguntas | Não |
| 2 | Motor de regras com todos os testes, sem tela | Não (só código novo) |
| 3 | Migração do schema `agenda` + tela `/agenda/nova` atrás da flag: dia, 4 dias, semana, mês, lista, linha do agora, minicalendário, criar arrastando, mover/redimensionar, popover, desfazer, atalhos, modo escuro, celular | Tabelas novas; `/agenda` antiga intacta |
| 4 | Templates Impulsão e Legado, grupos, jornadas, bloqueios, expediente, feriados, validação de conflitos, materialização das ocorrências em `meetings` | Cria reuniões reais só para usuários liberados |
| 5 | Duração real das gravações no banco (+ carga do histórico) e painel de KPIs executor/gestor | Tabela nova + aviso do worker |
| 6 | Migração das séries atuais (`recurrence_parent_id`) para `agenda.series`, com script reversível e relatório | Só leitura das reuniões atuais + tabelas novas |

## 5.1 Andamento

- **Fase 2 concluída (10/11/2026):** `lib/agenda-engine/` com 79 testes (ciclo, grupos/entrada/jornada, recorrência RRULE com exceções e "este e os seguintes", feriados nacionais calculados, conflitos e disponibilidade, layout de sobreposição, KPIs). Dependência nova: `rrule@2.8.1`. Nenhuma tela, rota ou tabela mudou.
- **Fase 3 concluída (10/11/2026):**
  - Banco: migração `integracoes/agenda/001_agenda.sql` aplicada. As tabelas ficaram em `public` com prefixo `agenda_` (em vez do schema `agenda`) para não mexer na configuração do PostgREST compartilhada com o Plan. RLS ligado, só `service_role`. Flag `meet_user_profile.agenda_nova` (admin sempre vê; `AGENDA_NOVA_TODOS=1` libera todos).
  - Servidor: `lib/meetingsCore.ts` (criação de reuniões comum à Agenda antiga e à nova), `lib/agenda/servidor.ts`, rotas `/api/agenda/eventos` (listar/criar), `/api/agenda/eventos/[id]` (mover/editar por escopo), `/cancelar`, `/api/agenda/restaurar`, `/api/agenda/desfazer-criacao`, `/api/agenda/validar`. Conflitos validados no servidor em toda gravação; aviso exige justificativa e bloqueante só admin passa por cima (tudo em `agenda_overrides_log`). Remarcações e cancelamentos guardam a origem.
  - Tela `/agenda/nova` (item "Agenda nova" no menu só para liberados; interruptor na tela de Usuários): Dia, 4 dias, Semana, Mês, Lista; linha do agora; minicalendário; calendários com liga/desliga; outros executores (admin); arrastar para criar, mover e redimensionar (15 min), também mover entre dias no mês; popovers de criação e detalhes; formulário completo com repetição RRULE e prévia de conflitos; pergunta de escopo em série; Desfazer em criar, mover e cancelar; mudanças otimistas com volta em erro; atalhos (C, T, D, X, W, M, A, J/K, setas, /, Esc, Delete, ?); celular com Lista/Dia e botão flutuante; modo escuro pelo tema do Meet.
  - Semana começa na segunda. A tela usa o fuso do navegador; séries são ancoradas em `America/Sao_Paulo`.
- **Fase 4 concluída (10/11/2026):**
  - Configurações em `/agenda/nova/configuracoes` (engrenagem na agenda): Grupos do Impulsão, Minha disponibilidade, Feriados, Regras da empresa, Modelos.
  - Modelos padrão criados na primeira abertura: "Impulsão" (F1, F2, C1, C2; entrada em F1/C1; feriado = ciclo pausa; 120 min às 19h; executor ajusta dia, hora, primeira aula e defasagem) e "Legado: jornada 1 a 1" (semanal, 12 encontros, 60 min, feriado = pular para o fim, 2 remarcações). **Duração e horário do Impulsão são palpites: ajustar na aba Modelos.**
  - Grupo: dia, horário e "data da primeira F1" (vira a âncora; a defasagem fica 0 porque a data já carrega o atraso da quinta). "Gerar agenda" cria os encontros até o horizonte com rótulo no título (ex.: "Impulsão · Grupo Terça · F2"), pula feriados pela política, manda para o substituto o que cair em bloqueio do executor e pede justificativa/admin para o resto. Rotina a cada 6 h estende os grupos (`AGENDA_EXTENSAO=0` desliga).
  - Matrícula: prévia da entrada (sempre Aula 1) e dos 4 encontros, grava `agenda_jornadas` + encontros e convida o cliente nos eventos do Google. Presença por encontro na lista do grupo.
  - Encontro em grupo não vai para o ExecScore (`EXECSCORE_AVALIAR_GRUPOS=1` liga) e aparece no calendário "Impulsão".
  - Bloqueios pessoais pontuais ou semanais (criação rápida "Bloquear horário" ou na aba), com lista das reuniões atingidas; motivo só para o dono e admin.
  - Regras da empresa e limites por executor só admin; expediente e buffer (nunca abaixo do mínimo) o próprio executor.
  - Feriados: nacionais calculados + cadastrados (estadual, municipal, recesso) com prévia do impacto nos grupos.
- Decisões tomadas pelo motor (configuráveis):
  - Carnaval e Corpus Christi são pontos facultativos e **contam como feriado por padrão** (`considerarFacultativos`). Ex.: a terça de Carnaval de 2026 pausa o grupo da terça.
  - Na política "segue", a aula perdida é recuperada na próxima ocorrência dela **em qualquer grupo** (o cliente continua no grupo onde recuperou). Dá para restringir ao mesmo grupo (`recuperarEmOutroGrupo: false`).
  - Hora que não existe por horário de verão é empurrada para frente; hora repetida usa o primeiro instante (igual ao Google Agenda).

## 6. Decisões do usuário (10/11/2026)

1. **O Impulsão passa a acontecer no Legacy Meet.** Cada encontro em grupo vira uma reunião do Meet (gravação, transcrição, resumo).
2. **O executor configura o ciclo na agenda:** escolhe a regra (template, dia, horário, sequência F1/F2/C1/C2, defasagem, semana inicial) e o sistema gera as ocorrências. Nada fixo no código.
3. **Feriados nacionais (e os cadastrados) entram na geração da agenda**, com a política do template e prévia do impacto.
4. **Toda a agenda passa a viver no Legacy Meet**, incluindo o que hoje está em `cohort_sessions` no Plan (turmas do Legado). Migração na fase 6.
5. **O cliente acompanha a própria agenda pelo Legacy Plan.** O Meet é o dono dos dados; o Plan só lê. Entrega do Meet: uma view `agenda.v_agenda_cliente` (por `tenant_id`, sem dados internos como bloqueios e motivos) e RLS para o usuário do cliente. A tela no Plan fica com o time do Plan.
6. **Impulsão não tem turma.** A jornada do cliente é por grupo (dia) + ciclo; a metodologia continua aplicada no Plan.

### Valores padrão adotados (configuráveis; usuário não definiu ainda)

| Item | Padrão |
|---|---|
| Gestor (visão de todos no painel) | admin do Meet (`meet_user_profile.is_admin`) |
| Legado 1 a 1 | semanal, 12 encontros, 60 min, até 2 remarcações (é o padrão dos dados) |
| Expediente | seg a sex, 08h às 12h e 13h às 18h |
| Buffer entre reuniões | 15 min |
| Limites | 8 reuniões/dia, 6 h/dia, 30 h/semana (aviso, não bloqueio) |
| Horizonte de validação | 6 meses |
| Feriado | Impulsão: ciclo pausa; Legado: ocorrência pulada (vai para o fim da jornada) |
| Cancelamento | o executor escolhe a origem (cliente, executor, Legacy) ao cancelar |

### Quem configura o quê (decisão de 10/11/2026: tudo configurável na tela, o sensível só admin)

| Configuração | Admin | Executor |
|---|---|---|
| Templates de produto (sequência F1/F2/C1/C2, defasagem padrão, duração, nº de encontros, política de feriado, limite de remarcações) | cria e edita | só usa |
| Quais campos do template o executor pode ajustar (ex.: dia, horário, semana de início) | define por template (`campos_editaveis`) | ajusta só esses |
| Grupos do Impulsão: abrir/encerrar grupo, executor responsável, substituto | sim | gera a série do grupo dele a partir do template, nos campos liberados |
| Feriados estaduais, municipais e recessos Legacy (nacionais entram sozinhos) | cadastra | vê |
| Padrões da empresa: expediente padrão, buffer mínimo, limites de reuniões/horas, horizonte de validação | define | não altera |
| Nível de cada regra (bloqueante ou aviso) | define | não altera |
| Passar por cima de regra **bloqueante** | só com justificativa (fica no log) | não pode |
| Passar por cima de **aviso** | com justificativa | com justificativa (fica no log) |
| Próprio expediente | edita de qualquer executor | edita o seu, dentro do padrão da empresa |
| Bloqueios pessoais | vê e edita de todos, vê o motivo | os seus; os outros só veem "Indisponível" |
| Buffer pessoal | edita | pode aumentar o seu, nunca abaixo do mínimo |
| Matricular cliente no Impulsão / abrir jornada Legado | de qualquer executor | dos clientes dele |
| Reuniões: criar, mover, remarcar, cancelar (com origem) | de todos | as suas, dentro do limite de remarcações |
| Painel de KPIs | todos os executores + comparativo | só o seu |
| Liberar a agenda nova (flag) e rodar migração | sim | não |

A regra vale no servidor (cada rota confere o papel) e no banco (RLS), não só escondendo botão na tela. Papel de "admin" = `meet_user_profile.is_admin`.

### Pontos para decidir antes da fase 6 (não bloqueiam as fases 2 a 5)

- As turmas do Legado no Plan têm check-in, RSVP, NPS e integração com Zoom ligados a `cohort_sessions`. Ao trazer a agenda delas para o Meet, ou o Meet passa a gravar também em `cohort_sessions` (o Plan continua funcionando como hoje), ou o Plan passa a ler de `agenda.*`. Recomendação: o Meet escreve nas duas durante a transição.
