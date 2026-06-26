# Legacy Meet — Fundação (Auth + Usuários + Reunião↔Usuário)

Data: 2026-06-26
Status: design aprovado para virar plano de implementação
Subprojeto: **1 de 3** (Fundação → Agendamento → NPS)

## Contexto

Hoje o **legacy-meet** (fork do LiveKit Meet) é **stateless**: gravações no MinIO
(+ manifestos + worker de transcrição), autenticação por **senha fixa única**
(cookie `staff_auth` validado contra `STAFF_PASSWORD`), reuniões criadas por
link/hostKey. Não há usuários nem banco.

O **Legacy Plan** já tem um Supabase (projeto `eddfdgefrwjxfafkkzls`) com um
**sistema de reuniões completo e em uso** (265 usuários no Auth, 286 reuniões,
230 agendadas, 26 ao vivo). As tabelas relevantes já existem e mapeiam o que
queremos:

- `auth.users` + `public.users` — Supabase Auth + perfil. `users.role` é enum:
  **MASTER, EXECUTOR, CLIENT, COLLABORATOR, CUSTOMER_SUCCESS**.
- `public.meetings` — `id, tenant_id, host_id, title, scheduled_start_at,
  scheduled_end_at, timezone, status (scheduled/live/ended/canceled), room_name,
  livekit_room_sid, lobby_enabled, recording_enabled, auto_transcribe, ...`.
- `public.meeting_recordings` — `meeting_id, egress_id, storage_*, gdrive_*,
  transcription_status, ...` (usado no subprojeto futuro de gravação).
- `public.meeting_nps_responses` — `meeting_id, respondent_user_id,
  executor_user_id, score, feedback, answered_at` (usado no subprojeto de NPS).

O usuário **joao.gaspar@legacyeducacaocorp.com.br já existe** no Auth e no
`public.users` (MASTER). Login deve **reaproveitar as contas existentes**.

## Decisões já tomadas (brainstorming)

1. **Backbone:** reaproveitar o Supabase do Legacy Plan (`eddfdgefrwjxfafkkzls`).
2. **Telas no legacy-meet**, lendo/gravando nas tabelas existentes.
3. **Login = contas existentes** (Supabase Auth). Sem criar/definir senha do master.
4. **Gravações = integração leve:** MinIO continua como está; o vínculo
   reunião↔usuário é por uma linha em `meetings` (`host_id`) ligada por `room_name`.

## Objetivo da Fundação

Trocar a senha fixa por **login multiusuário real** e passar a **mapear cada
reunião/gravação ao usuário (host)**, com visibilidade por papel (EXECUTOR vê as
suas, MASTER vê todas). É a base que destrava Agendamento e NPS.

## Escopo

**Dentro:**
1. Login Supabase Auth (email/senha) + sessão SSR (cookie) + logout.
2. Proteção de rotas por sessão (substitui `STAFF_PASSWORD`) + gate por papel
   (MASTER vs EXECUTOR).
3. Convidados continuam **sem login** em `/rooms/...`.
4. Tela de **cadastro/edição de usuários** (somente MASTER).
5. **Criação de linha `meetings`** (`host_id`) ao criar/iniciar uma reunião logada.
6. `/gravacoes` **filtrado por usuário** (join manifesto↔`meetings` por `room_name`).

**Fora (próximos subprojetos):**
- Tela de agendamento (criar reuniões futuras com `scheduled_start_at`).
- Formulário de NPS + dashboards de NPS.
- Migrar metadados de gravação para `meeting_recordings` no Supabase.

## Arquitetura

### Autenticação
- Libs: `@supabase/supabase-js` + `@supabase/ssr`.
- Envs novas: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` e
  `SUPABASE_SERVICE_ROLE_KEY` (server-only, nunca exposto ao cliente).
- Clientes Supabase em `lib/supabase/`:
  - `server.ts` — cliente SSR (lê/escreve cookies de sessão) para Server
    Components, Route Handlers e middleware.
  - `client.ts` — cliente de browser (login/logout).
  - `admin.ts` — cliente com `service_role` (somente em código server, p/ admin).
- `/login` (existente, hoje senha única) vira form **email + senha** →
  `supabase.auth.signInWithPassword`. Em erro, mensagem clara.
- `/api/staff/login` e o cookie `staff_auth` são **removidos/aposentados**.
- `middleware.ts`: usa o cliente SSR para checar sessão. Sem sessão → redireciona
  para `/login`. Rotas protegidas: `/`, `/gravacoes/:path*`, `/admin/:path*`,
  `/api/recordings/:path*`, e (futuro) `/agendamentos`. **Públicas:** `/login`,
  `/rooms/:path*`, `/obrigado`, `/api/connection-details`, `/api/room/*`,
  `/api/meetings` (CRM, x-api-key), `/api/record/*`.
- Papel: helper `getCurrentUser()` (server) → sessão + `select role,name from
  public.users where id = auth.uid()`. `role === 'MASTER'` libera admin e visão
  global; demais (EXECUTOR) veem o próprio escopo.

**Migração da autorização de host (importante).** Hoje o cookie `staff_auth`
também é uma das vias de autorização de **host** em:
- `connection-details` (define `isHost` → token com `roomAdmin` etc.);
- `lib/livekitAuth.authorizeHostAction` (usada por `/api/room/admit|reject|mute|promote`).

Com o novo login, a via "equipe logada" passa a ser a **sessão Supabase** (usuário
interno autenticado = host). As outras vias **continuam**: `hostKey` assinado (links
do CRM) e co-anfitrião (token do participante + atributo `cohost`). Removemos apenas
a dependência de `STAFF_PASSWORD`/cookie `staff_auth`. Resultado:
`isHost = (sessão Supabase de usuário interno) || hostKey válido`; `authorizeHostAction
= sessão Supabase || hostKey || co-anfitrião`. Sem `STAFF_PASSWORD` configurado em
dev, mantém-se o fallback "todos host" para não travar o desenvolvimento.

### Cadastro de usuários (somente MASTER)
- Tela `/admin/usuarios`: lista usuários (nome, email, role) e form de criar/editar.
- `POST /api/admin/users` (server): valida que o solicitante é MASTER (via sessão),
  usa **service_role** para `supabase.auth.admin.createUser({ email, password,
  email_confirm: true })` e insere/atualiza `public.users` (id = uid do Auth,
  name, email, role). Editar role idem.
- **Limite de escopo:** criar com role **EXECUTOR** (ou MASTER) — papéis internos
  do meet. Não mexe em CLIENT/COLLABORATOR/tenant de clientes do Legacy Plan.

### Reunião ↔ usuário (reuso das tabelas do Legacy Plan)
**Decisão (pós-análise do banco):** reusamos a tabela `meetings` do Legacy Plan.
Ela é **multi-tenant** — `tenant_id` é NOT NULL, além de `title`,
`scheduled_start_at`, `scheduled_end_at`, `room_name`. Logo, **toda reunião do
meet pertence a um cliente (tenant)**: ao criar/agendar, o executor escolhe o
cliente.
- Padrão de sala: `room_name = 'meet_' || uuid` (mesmo formato já usado).
- Insert na `meetings` (server-side, **service_role**, com checagem de papel/posse
  no nosso código — evita lutar com a RLS multi-tenant): `tenant_id` (cliente
  escolhido), `host_id = uid`, `title`, `room_name`, `scheduled_start_at`/
  `scheduled_end_at` (instant: now / now+1h), `status` ('live' instant, 'scheduled'
  no agendamento), `recording_enabled`, `auto_transcribe`.
- Cliente disponível ao executor: `client_tenants` onde `executor_id = uid` (ou via
  `client_executor_assignments`); MASTER vê todos.
- A gravação no MinIO segue idêntica; `room_name` é a chave de ligação. **Sem**
  mudança no worker/egress.
- Fluxo do **CRM** (`/api/meetings`, x-api-key) também insere a linha `meetings`
  (host opcional, tenant via payload), mantendo `hostUrl/guestUrl`.

> Nota p/ o subprojeto de NPS: `meeting_nps_responses.respondent_user_id` é NOT
> NULL (exige um usuário). Como os convidados do meet entram sem login, o NPS
> anônimo provavelmente usará o caminho `nps_public_links`/`nps_public_responses`
> (que já existe) — a decidir no design do NPS.

### Dois setores: Comercial e Executoria
O meet tem **dois setores**, escolhidos no fluxo de criação/agendamento:
- **Executoria** — reunião com um **cliente** do Plan. O fluxo pede o cliente;
  `meetings.tenant_id` = tenant do cliente escolhido.
- **Comercial** — **call de venda**, sem cliente. O fluxo **não** pede cliente;
  `meetings.tenant_id` = um **tenant sentinela "Comercial"** (fixo, definido em env
  `MEET_COMMERCIAL_TENANT_ID`). O nome do prospect vai em `title`/`description`.

Como `meetings` é do Legacy Plan e não devemos alterá-la, o **setor** é registrado
numa **tabela própria do meet**: `meet_meeting_sector (meeting_id uuid PK
references meetings(id) on delete cascade, sector text check (sector in
('comercial','executoria')), created_at timestamptz default now())`. Assim o setor
fica explícito e confiável para filtros/relatórios, sem tocar no schema deles.

Tenant sentinela "Comercial": no início do plano, confirmar se reusamos um tenant
interno existente (ex.: "Legacy Educação Corporativa") ou criamos um dedicado —
cuidando para **não** poluir as listas de clientes do Legacy Plan.

**NPS por setor:** o formulário de NPS (subprojeto 3) é **obrigatório apenas em
reuniões de Executoria**. **Comercial não tem NPS** (call de venda). O setor
(`meet_meeting_sector`) decide se o NPS é exigido no fim da reunião.

### `/gravacoes` por usuário
- A listagem (hoje lê manifestos do MinIO) passa a:
  1. listar manifestos (como hoje);
  2. para os `roomName` correspondentes, buscar em `meetings` o `host_id` (e nome
     do host via `users`);
  3. **filtrar por papel:** EXECUTOR → só onde `host_id = uid`; MASTER → todas.
- Manifestos **sem** `meetings` correspondente (gravações antigas/avulsas): só
  MASTER vê (ou seção "sem dono"), para não vazar entre executores.

## Segurança / RLS
- O Supabase é **produção do Legacy Plan** (RLS ligado, multi-tenant). Princípios:
  - **Leituras** scoped ao usuário usam a **sessão** (RLS do Legacy Plan decide o
    que o usuário pode ver). Se as policies existentes não permitirem o que o meet
    precisa, ajustamos/adicionamos policies **aditivas** (sem afrouxar as deles).
  - **service_role** só no servidor, só para ações de admin (criar usuário) — nunca
    no bundle do cliente.
  - **Não** alterar fluxos/escritas do Legacy Plan; só inserir linhas `meetings`
    do meet e ler o necessário.
- `tenant_id` das reuniões do meet = NULL (ou um tenant "interno" se exigido por
  constraint NOT NULL — a verificar no plano).

## Tratamento de erros
- Login inválido → mensagem amigável; sem vazar detalhes.
- Sessão expirada → redireciona p/ `/login` (middleware + refresh de token via SSR).
- Falha ao criar usuário (email já existe etc.) → erro claro na tela admin.
- Falha ao inserir `meetings` **não** bloqueia a entrada na reunião (degrada
  gracioso: a reunião funciona; só o mapeamento fica pendente, logado p/ correção).

## Testes / verificação
- Login com conta existente (joao.gaspar MASTER) entra; conta inexistente falha.
- Rota protegida sem sessão → redireciona p/ `/login`.
- Convidado entra em `/rooms/<sala>` sem login.
- MASTER cria um EXECUTOR de teste; o EXECUTOR loga.
- Reunião criada por um EXECUTOR gera linha `meetings` com `host_id` correto.
- `/gravacoes`: EXECUTOR vê só as suas; MASTER vê todas.

## Riscos
- Escrever no Supabase de produção do Legacy Plan: mitigado por service_role
  server-only, escopo restrito (só `meetings` do meet + criar usuários internos),
  e respeito ao RLS deles.
- Possível sobreposição com a UI/fluxos do Legacy Plan (eles têm telas próprias):
  no plano, confirmar formato esperado de `room_name`/`status` para não conflitar.
- `meetings.tenant_id`/enums com constraints: validar no início do plano.

## Itens a confirmar no início do plano
- `meetings.tenant_id` é NOT NULL? (define se precisamos de tenant "interno").
- Formato/contrato de `room_name` e `status` esperado pelo Legacy Plan.
- Policies de RLS relevantes em `meetings`/`users` (o que a sessão lê/escreve).
