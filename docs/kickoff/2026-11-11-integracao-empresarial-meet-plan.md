# Kickoff: investigação 6.1, banco compartilhado com o Legacy Plan

Investigação de 11/11/2026, feita só com leitura. Nenhuma migration, nenhuma mudança de RLS, de permissão ou de tabela do Plan. No banco rodaram apenas consultas de catálogo e contagens. Nenhum dado de empresa foi copiado para este documento.

## Resumo

- **Confirmado:** o Meet usa o mesmo projeto Supabase do Plan (`eddfdgefrwjxfafkkzls`, chamado "legacy-plan" na organização). É o mesmo banco, o mesmo Auth e o mesmo schema `public`.
- O Meet **já lê `client_tenants`** (nome, produto, e-mail, executor) em 14 arquivos. Também já tem chaves estrangeiras para ela: `meetings.tenant_id` e as tabelas `agenda_*`.
- **`client_tenants.id` pode ser usado direto** como identificador da empresa nas reservas do kickoff. CNPJ e nome não servem para isso, porque não são únicos.
- Razão social e nome fantasia **não são colunas**. Ficam dentro de `cnpj_dados_raw`, o JSON da Receita.
- Não existe função de busca ou autocomplete de empresas, nem no banco nem nas edge functions do Plan.
- **Recomendação: alternativa A**, leitura direta pelo backend do Meet. A busca fica só para a equipe logada. Na página pública, a empresa é decidida no servidor, pelo login do Plan ou por um link assinado, e nunca por uma lista ou busca aberta.
- **Achado de segurança que já existia:** rotas de criação de reunião aceitam qualquer usuário logado, e o login é o mesmo dos 543 usuários-cliente do Plan. Precisa ser corrigido antes de abrir o kickoff (ver 9.1).

---

## Integração empresarial entre Legacy Meet e Legacy Plan

### 1. Projeto Supabase utilizado

| Item | Valor |
|---|---|
| Projeto | `eddfdgefrwjxfafkkzls`, nome "legacy-plan", região us-west-2, Postgres 17 |
| Variáveis usadas pelo Meet | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. As três chaves têm `ref = eddfdgefrwjxfafkkzls`, conferido no JWT sem expor o valor |
| Sobras no `.env` | `NEXT_SUPABASE_URL` e `NEXT_SUPABASE_ANON_KEY` (bloco "# LegacyPlan") apontam para o mesmo projeto e nenhum código usa |
| Auth | É um só. As contas da equipe e dos clientes do Plan são as mesmas no Meet |

Essa decisão já estava registrada em `docs/superpowers/specs/2026-06-26-legacy-meet-fundacao-auth-design.md` ("reaproveitar o Supabase do Legacy Plan") e em `docs/agenda/integracao-plan-cliente.md`.

### 2. Schemas e tabelas relevantes

Os schemas do projeto são: `public` (227 tabelas, do Plan e do Meet juntas), `execscore` (9), `legacyfin` (20), `auth`, `storage`, `realtime`, `cron`, `vault`, `_audit`, `archive` e alguns schemas de backup (`_jsonb_backup`, `_dre_*`).

Não existe schema `meet`. As tabelas do Meet ficam em `public`, com os prefixos `meet_` e `agenda_`. Foi uma escolha para não mexer na configuração do PostgREST, que é compartilhada com o Plan (ver `docs/agenda/2026-11-10-nova-agenda-diagnostico-e-plano.md`).

| Tabela | Dono | Uso pelo Meet |
|---|---|---|
| `meetings` | compartilhada (Planner do Plan + Meet) | lê e escreve. As reuniões do Meet são as que têm `meet_meeting_sector` |
| `meet_meeting_sector`, `meet_meeting_hosts`, `meet_user_profile`, `meet_nps_responses` | Meet | lê e escreve |
| `agenda_*` (16 tabelas) | Meet | lê e escreve. RLS ligado e sem policy, então só `service_role` acessa |
| `execscore.meet_integracao` + funções `execscore.meet_*` | Meet, dentro do schema do ExecScore | lê e escreve |
| `client_tenants` | Plan | **só lê** |
| `users` | Plan | só lê (nome, e-mail, papel, `tenant_id`) |
| `cohorts`, `cohort_sessions`, `cohort_schedules` | Plan | só lê (turmas do Legado na agenda) |
| `collaborators` | Plan | não usa (pessoas por empresa: 294) |
| `cohort_session_zoom_attendance`, `cohort_session_zoom_presence`, `cohort_zoom_registrants` | Plan | não usa. Servem de referência para a presença (ver 8) |
| `meeting_participants`, `meeting_recordings` | Plan (sistema antigo) | não usa |

### 3. Caminhos reais dos serviços de acesso ao banco

O Meet tem três clientes Supabase, todos em `lib/supabase/`:

| Cliente | Arquivo | Chave | Onde roda | Para quê |
|---|---|---|---|---|
| Navegador | `lib/supabase/client.ts` | anon | só em `app/login/page.tsx` | fazer o login |
| Servidor com sessão | `lib/supabase/server.ts` | anon + cookie | `lib/auth.ts`, `middleware.ts` | saber quem está logado. Aqui vale a RLS do Plan |
| Servidor admin | `lib/supabase/admin.ts` | `service_role` | todas as rotas de dados | ignora a RLS. A autorização é feita no código (`getCurrentUser`, `isAdmin`, filtro por `executor_id`) |

- A `service_role` não chega ao navegador: a variável não tem `NEXT_PUBLIC_` e nenhum arquivo `'use client'` importa `admin.ts` (conferido).
- Quem é equipe: `lib/auth.ts` marca `isStaff` quando a pessoa tem `meet_user_profile` ou um e-mail `@legacyeducacao(corp).com.br`. As páginas usam `lib/requireStaff.ts`. A maioria das APIs só confere se há sessão (ver 9.1).

Onde o Meet lê dados do Plan hoje:

- `app/api/clients/route.ts`: lista de empresas (`id, name`). Admin vê todas. Os demais veem só as que têm `executor_id` igual ao usuário.
- `lib/meetingsCore.ts:103`: e-mail da empresa para o convite do Google Agenda. Se não houver, usa os e-mails dos usuários `CLIENT` da empresa.
- `lib/agenda/grupos.ts:322`: e-mail da empresa.
- `app/api/agenda/jornadas/route.ts:40`: `executor_id` da empresa.
- Joins `client_tenants:tenant_id(name, produto)` em `lib/agenda/servidor.ts:82`, `lib/agenda/painel.ts:55`, `lib/agenda/migracao.ts:42`, `lib/execscore.ts:150`, `lib/meetingSummary.ts:50`, `lib/recordings.ts:255`, `app/api/meetings/scheduled/route.ts`, `app/api/meetings/history/route.ts`, `app/api/nps/route.ts` e `app/api/agenda/grupos/route.ts`.
- `lib/auth.ts`: perfil em `users`, lido pela sessão.

### 4. Relações existentes entre Meet e Plan

**Do Meet para o Plan (chaves estrangeiras):**

| Tabela do Meet | Coluna | Aponta para | Ao apagar a empresa |
|---|---|---|---|
| `meetings` | `tenant_id` (obrigatória) | `client_tenants.id` | apaga junto |
| `agenda_jornadas` | `tenant_id` (obrigatória) | `client_tenants.id` | apaga junto |
| `agenda_series`, `agenda_grupos` | `tenant_id` | `client_tenants.id` | fica nulo |
| `agenda_*` | `executor_id`, `substituto_id` | `users.id` | — |

As reuniões comerciais usam uma empresa sentinela, "Comercial" (`MEET_COMMERCIAL_TENANT_ID`), porque `meetings.tenant_id` é obrigatório.

**Do Plan para o Meet:** o Plan lê a agenda do Meet por duas funções, `agenda_do_cliente()` e `jornadas_do_cliente()`. Estão em `integracoes/agenda/003_agenda_cliente.sql`, são `SECURITY DEFINER` e só o papel `authenticated` executa. Cada cliente recebe apenas os dados da própria empresa. O guia para o time do Plan é `docs/agenda/integracao-plan-cliente.md`.

**Quem pode ler `client_tenants`:**

| Quem | O que vê |
|---|---|
| `service_role` (backend do Meet) | todas as linhas e colunas |
| `MASTER`, `EXECUTOR`, `CUSTOMER_SUCCESS` logados | **todas as 249 empresas e todas as colunas**, inclusive valor de contrato |
| `CLIENT`, `COLLABORATOR` logados | só a própria empresa (`get_my_tenant_id() = id`) |
| `anon` (sem login) | nada. Tem `GRANT`, mas a policy depende de `get_my_role()`, que fica nulo |

Não há permissão por coluna: quem vê a linha vê todas as colunas. A mesma condição vale para `UPDATE`, então executores e o próprio cliente podem alterar a linha. Isso é do desenho do Plan. O Meet não deve escrever em `client_tenants`.

### 5. Campos empresariais disponíveis

Contagens de 11/11/2026 (249 empresas):

| Dado | Onde está | Preenchido | Observação |
|---|---|---|---|
| Identificador | `id` (uuid) | 249 | chave estável, usada como FK em 134 tabelas |
| Nome no sistema | `name` | 249 | é o nome que o Plan e o Meet mostram. Igual ao nome fantasia em 108 empresas, igual à razão social em 44 e diferente dos dois em 72 |
| Razão social | `cnpj_dados_raw->>'razao_social'` | 222 | não há coluna própria. É o JSON da BrasilAPI salvo no cadastro |
| Nome fantasia | `cnpj_dados_raw->>'nome_fantasia'` | 139 não vazios | mesma origem |
| CPF/CNPJ | `cnpj` | 244 | 232 com 14 dígitos (CNPJ) e 12 com 11 dígitos (CPF). **Não é único:** 2 CNPJs aparecem em mais de uma empresa. Não tem índice |
| E-mail | `email` | 248 | o Meet já usa no convite |
| Telefone | `phone` | 220 | |
| Responsável | `owner` | 245 | |
| Situação | `inativo` (5), `inadimplente` (14), `access_blocked` (1) | | considerar na reserva |

Contatos por pessoa: `users` (papel `CLIENT`/`COLLABORATOR`, com `name`, `email`, `phone`, `cpf_cnpj` e `tenant_id`) tem 543 usuários, ligados a 244 empresas. `collaborators` tem 294 pessoas.

**Nunca podem ir para uma página pública:** `valor_contrato`, `valor_entrada`, `condicoes_pagamento`, `forma_pagamento`, `percentual_desconto`, `observacoes_comercial`, `inadimplente`, `onboarding_data` (faturamento, metas) e `cnpj_dados_raw.qsa` (sócios).

### 6. Uso direto de `client_tenants.id` nas reservas

**Pode e deve ser usado.** É uma chave estável e já é a chave da empresa em todo o Plan (134 tabelas) e no Meet (`meetings`, `agenda_*`). A função `agenda_do_cliente()` já filtra por ela. CNPJ e nome não servem como chave, porque se repetem.

Para a migration que vier depois (não criada nesta investigação), seguir o padrão de `agenda_series`:

- `tenant_id uuid null references public.client_tenants(id) on delete set null`, com índice.
- Não copiar nome, CNPJ, e-mail ou telefone da empresa para a reserva. Na hora de mostrar, buscar em `client_tenants`.
- Guardar na reserva apenas o que a pessoa digitou ao reservar (nome, e-mail e telefone de quem reservou). Isso é dado da reserva, não da empresa.

**A confirmar com a equipe:** a empresa já existe em `client_tenants` quando o kickoff é marcado? Há um sinal de que sim: 132 empresas têm `_pipedriveDealId` em `onboarding_data`, o que indica que o cadastro nasce no fechamento, pelo `pipedrive-webhook`. Se for sempre assim, a reserva sai sempre com `tenant_id`. Se o kickoff puder acontecer antes do cadastro, a reserva fica com `tenant_id` nulo e a equipe faz o vínculo depois.

### 7. Estratégia para autocomplete e pré-preenchimento

**O que já existe:**

- No banco não há função de busca de empresa. A extensão `pg_trgm` está instalada; `unaccent` não.
- No Meet, `/api/clients` devolve a lista inteira (`id, name`) dentro do escopo do usuário, e o navegador filtra. O filtro é o `Select` com busca (`components/ui/select.tsx`) e `lib/normalizeForSearch.ts`. É usado em `app/page.tsx:72`, `components/agenda-nova/AgendaNova.tsx:125`, `components/agenda-nova/painel/Painel.tsx:119` e `components/agenda-nova/config/AbaGrupos.tsx:76`.
- No Plan, a edge function `cnpj-proxy` consulta a Receita pelo CNPJ (BrasilAPI, com cnpj.ws de reserva). Ela não busca na base de clientes. Exige o JWT de qualquer usuário do Plan e só aceita o domínio do Plan no CORS. Serve para completar um CNPJ novo, não para achar um cliente existente.
- Também no Plan, a edge function `cohort-zoom-join` resolve a empresa só no servidor, pela sessão (`users.tenant_id` → `client_tenants`). Ela bloqueia inadimplentes, lista as pessoas da empresa a partir do servidor e grava a presença por `tenant_id`. A regra está no próprio código: "A empresa NUNCA vem do cliente".

**Regras para o kickoff:**

1. Ler `client_tenants` só no backend do Meet, com `createAdminSupabase()` e uma lista explícita de colunas. Nunca pela sessão no navegador, porque a RLS deixa executores verem todas as colunas de todas as empresas.
2. A empresa da reserva é decidida no servidor. Nunca usar o `tenantId` que vem do navegador sem conferir.
3. A página pública não tem busca nem lista de empresas.

**Para a equipe logada (CS, executor, comercial):**

- Ampliar `/api/clients` ou criar uma rota irmã que exija `isStaff` e devolva só `id`, `name`, razão social, nome fantasia, `cnpj`, `email`, `phone` e `owner`.
- Com 249 empresas, a lista inteira filtrada no navegador continua boa (é o padrão atual). Se passar de alguns milhares, trocar por uma busca no servidor (`?q=`, mínimo de 3 caracteres, limite de 10, sem acento normalizado no código, `ilike` ou `pg_trgm`).
- Escopo: o executor vê as dele (`executor_id`) e o admin vê todas. Falta decidir se quem agenda o kickoff (CS ou comercial) vê todas. A tabela `client_executor_assignments` existe, mas está vazia: hoje `executor_id` é a única fonte.

**Para a página pública (o cliente agenda o próprio kickoff), em ordem de preferência:**

1. **O cliente entra com o login do Plan.** O Auth é o mesmo e 244 das 249 empresas já têm pelo menos um usuário `CLIENT`/`COLLABORATOR`. O backend lê o `users.tenant_id` do usuário logado (a mesma regra de `agenda_tenant_do_usuario()`) e pré-preenche nome da empresa, responsável, e-mail e telefone. Nenhuma outra empresa é consultada e não há sincronização.
2. **Link de reserva assinado, enviado pela equipe.** Um token HMAC com `tenant_id` e validade, no padrão de `lib/hostLink.ts` (`signHostKey`). O servidor valida o token e pré-preenche só o nome da empresa. Serve para quem ainda não tem login no Plan.
3. **Sem login e sem link:** formulário com CNPJ e contato. O servidor tenta casar o CNPJ exato (14 dígitos) sem avisar na tela se a empresa é cliente, para não permitir descobrir a carteira testando CNPJs (que são públicos). Se não houver resultado, ou se houver mais de um, a reserva fica com `tenant_id` nulo para a equipe vincular. Usar limite de tentativas.

Na página pública, o pré-preenchimento só pode trazer o nome da empresa, o responsável e os contatos do próprio usuário logado. Bloquear empresas `inativo` ou `access_blocked`. Falta decidir o caso `inadimplente`: o `cohort-zoom-join` bloqueia.

### 8. Identificação empresarial e futura integração de presença

**Como está hoje:**

- No Meet, quem entra na sala vai para o JSON da reunião no MinIO (lista `participants`), pelo webhook da LiveKit (`app/api/livekit/webhook/route.ts`). São só nomes, sem empresa, e nada vai para o banco.
- No Meet, `agenda_jornada_encontros.presenca` (`pendente`, `presente`, `faltou`) é marcada à mão pelo executor (`app/api/agenda/jornadas/[id]/route.ts`) e está ligada à empresa pela jornada.
- No Plan, as aulas no Zoom já têm presença por empresa: `cohort_session_zoom_attendance` (quem assistiu, por `session_id` + `user_id` + `tenant_id`) e `cohort_session_zoom_presence` (segundos efetivos por `session_id` + `tenant_id`). Essas tabelas estão ligadas a `cohort_sessions`, não às reuniões do Meet.

**Recomendação (para depois, com migration em `integracoes/`):**

- Criar uma tabela de presença do Meet com chave (`meeting_id`, `tenant_id`) e as mesmas colunas de `cohort_session_zoom_presence` (`first_join_at`, `last_leave_at`, `effective_seconds`, `connections_count`). Assim os relatórios do Plan juntam as duas fontes sem conversão.
- A empresa vem do servidor. Quem entra pela reserva logada ou pelo link assinado recebe um token da LiveKit gerado em `app/api/connection-details/route.ts`, com o `tenant_id` nos metadados. O webhook `participant_joined`/`participant_left` lê esse campo e soma o tempo. Atenção: hoje `metadata` vem da URL (`app/api/connection-details/route.ts:37`) e por isso não serve para presença sem essa mudança.
- Quando o kickoff fizer parte de uma jornada, marcar também `agenda_jornada_encontros.presenca` automaticamente.
- O Plan lê por uma função `SECURITY DEFINER`, no padrão de `agenda_do_cliente()`. Sem cópia, sem sincronização e sem escrever nas tabelas `cohort_*`.

### 9. Limitações de acesso e segurança

1. **Rotas que aceitam qualquer usuário logado (problema que já existia).** O login do Meet é o mesmo do Plan, então os 543 usuários-cliente do Plan conseguem entrar no Meet. As páginas barram essas pessoas (`requireStaff` → `/sem-acesso`), mas estas rotas só conferem se há sessão:
   - `app/api/meetings/schedule/route.ts:17` e `app/api/meetings/local/route.ts:8` aceitam qualquer `tenantId` vindo do corpo, sem conferir se o usuário é da equipe nem se a empresa é dele. No agendamento da Executoria, `lib/meetingsCore.ts:103` manda o convite do Google Agenda para o e-mail dessa empresa. Ou seja, um cliente logado consegue criar uma reunião em nome de outra empresa e fazer o convite chegar a ela.
   - `app/api/clients/route.ts:9` filtra por `executor_id` para quem não é admin, então um cliente recebe lista vazia e não há vazamento. Mesmo assim, a checagem certa é `isStaff`.
   - Correção só no código, sem migration: exigir `isStaff` nessas rotas e, para quem não é admin, conferir `client_tenants.executor_id = user.id` antes de usar o `tenantId`. Fazer antes de abrir o kickoff.
2. A RLS do Plan dá a `EXECUTOR`, `MASTER` e `CUSTOMER_SUCCESS` leitura de todas as empresas e todas as colunas. Por isso, nenhuma leitura de `client_tenants` pela sessão no navegador.
3. Não há permissão por coluna. O backend precisa listar as colunas, nunca usar `select('*')` em `client_tenants` numa rota que responde ao navegador.
4. O CNPJ não é único (2 repetidos) e 12 cadastros têm CPF. Casar por documento precisa tratar 0, 1 ou mais resultados.
5. Razão social e nome fantasia dependem de `cnpj_dados_raw`, que falta em 27 empresas. Usar `name` como rótulo principal e os outros dois como complemento.
6. A `service_role` continua só em `lib/supabase/admin.ts`, em código de servidor.
7. O Meet depende das colunas de `client_tenants`. Se o Plan renomear uma delas, o Meet quebra. Para reduzir o risco, juntar a leitura num único módulo (por exemplo `lib/empresas.ts`) em vez de selects espalhados.

---

## Avaliação arquitetural: A × B

| Critério | A: banco compartilhado | B: API do Plan |
|---|---|---|
| Já existe? | Sim. O Meet já lê `client_tenants` em 14 arquivos e já tem FK para ela | Não. Não há endpoint de consulta ou busca de empresa. O `cnpj-proxy` só consulta a Receita |
| Desenvolvimento | Uma rota no Meet (ou ampliar `/api/clients`) e a tabela de reservas com FK | Nova edge function no Plan (time do Plan), liberar o domínio do Meet no CORS, autenticação entre sistemas, mais a rota no Meet que chama a função |
| Arquitetura | Segue o desenho atual: o Meet é dono da agenda, o Plan é dono das empresas, na mesma base | Acrescenta uma chamada de rede para ler a mesma tabela no mesmo banco |
| Isolamento de permissões | Autorização no backend do Meet, com `service_role` só no servidor. Depende de corrigir o item 9.1 | A edge function também usaria `service_role` para ler a mesma tabela. O isolamento é o mesmo, só muda quem escreve a regra |
| Consistência | A FK garante que a empresa existe, e a leitura está sempre atualizada | Sem FK se o Meet guardar só ids vindos da API. A leitura é a mesma, com mais latência |
| Acoplamento | O Meet depende de poucas colunas do Plan, uma dependência que já existe | Contrato explícito, que protege contra renomear colunas |

**Conclusão: A.** Exige menos desenvolvimento (nada novo no Plan), segue a arquitetura atual e isola as permissões tão bem quanto B. A única vantagem de B, um contrato estável, pode ser obtida dentro de A mais tarde com um módulo único no Meet ou com uma view/função de leitura, se o time do Plan quiser. Hoje não é necessário. No sentido contrário (o Plan lendo reservas e presença do kickoff), seguir o padrão que já existe: uma função `SECURITY DEFINER`, como `agenda_do_cliente()`.

## Respostas diretas às perguntas da investigação

| # | Pergunta | Resposta | Seção |
|---|---|---|---|
| 1 | Mesmo projeto Supabase? | Sim, `eddfdgefrwjxfafkkzls` ("legacy-plan") | 1 |
| 2 | Schemas de cada aplicação | Os dois usam `public`. O Meet usa os prefixos `meet_` e `agenda_` e a tabela `execscore.meet_integracao` | 2 |
| 3 | O Meet já consulta tabelas do Plan? | Sim: `client_tenants`, `users` e `cohort_*` | 3, 4 |
| 4 | Autenticação e permissões | Sessão (anon + cookie) para saber quem é. `service_role` no servidor para os dados, com autorização no código | 3 |
| 5 | `client_tenants` acessível ao backend? | Sim, via `service_role`. Pela sessão, quem decide é a RLS do Plan | 4 |
| 6 | Campos empresariais | `id`, `name`, `cnpj`, `email`, `phone` e `owner` em colunas. Razão social e nome fantasia dentro de `cnpj_dados_raw` | 5 |
| 7 | Busca ou autocomplete existente? | No banco, não. No Meet, lista inteira com filtro no navegador. No Plan, só o `cnpj-proxy` (Receita) | 7 |
| 8 | Usar `client_tenants.id` nas reservas? | Sim, como FK que pode ficar nula | 6 |
| 9 | Consulta segura na página pública | Empresa decidida no servidor (login do Plan ou link assinado), sem busca nem lista | 7, 9 |
| 10 | Presença empresarial futura | Tabela do Meet por (`meeting_id`, `tenant_id`), no formato da presença do Zoom do Plan, lida pelo Plan via função | 8 |

## Próximos passos sugeridos

1. Corrigir as rotas do item 9.1 (só código).
2. Confirmar com a equipe: a empresa existe em `client_tenants` antes do kickoff? Quem agenda (o cliente, o CS ou o comercial)? Empresa inadimplente pode agendar?
3. Criar `lib/empresas.ts` (leitura centralizada com colunas explícitas) e a rota interna de busca.
4. Desenhar a tabela de reservas (migration em `integracoes/kickoff/`) com `tenant_id` apontando para `client_tenants(id)`.
5. Página pública: login do Plan como caminho principal e link assinado como alternativa.
