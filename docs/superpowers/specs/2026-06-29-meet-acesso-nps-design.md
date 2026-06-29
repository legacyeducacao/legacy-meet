# Controle de acesso do Meet + NPS de Executoria — Design

**Data:** 2026-06-29
**Branch base:** `feat/design-legacy-plan` (inclui a fundação auth + redesign Legacy Plan)

## Objetivo

Dar ao Legacy Meet um **controle de acesso próprio** (admins e tag de setor por usuário, isolado do Legacy Plan) e um **NPS de Executoria**: ao fim de uma reunião de Executoria o cliente avalia a entrega do anfitrião (nota 0–10 + Observações); cada anfitrião vê o seu NPS e o admin vê o de todos.

## Princípios / Restrições globais

- **Não alterar o schema do Legacy Plan.** Só adicionar tabelas `meet_*` (aditivas, como `meet_meeting_sector`). `users.role` (enum NOT NULL) é somente-leitura.
- **Não reusar** as tabelas de NPS do Legacy Plan (`nps_*`, `meeting_nps_responses`) — reuso poluiria os dashboards deles. NPS do Meet vai em tabela própria.
- Stack já montada: Next.js 15 (App Router), Tailwind v4 + shadcn, Supabase (`@supabase/ssr` + service_role server-only). pnpm via `corepack pnpm`.
- `SUPABASE_SERVICE_ROLE_KEY` é server-only (nunca `NEXT_PUBLIC_`). Endpoints públicos validam entrada.
- Build deve passar (`rm -rf .next && corepack pnpm build`).
- Datas exibidas em GMT-3 (America/Sao_Paulo).
- Migrações via MCP do Supabase (`apply_migration`).

---

## Parte A — Controle de acesso do Meet

### A.1 Tabela `meet_user_profile`

```sql
create table public.meet_user_profile (
  user_id uuid primary key references public.users(id) on delete cascade,
  is_admin boolean not null default false,
  sector text not null default 'ambos' check (sector in ('comercial','executoria','ambos')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.meet_user_profile enable row level security;
-- sem policies: acesso apenas via service_role (server). RLS bloqueia o resto.
```

**Semântica**
- **Staff do Meet** = tem linha em `meet_user_profile`. Sem linha → não é staff (só acessa como convidado).
- **Admin do Meet** = `is_admin = true` (independe do MASTER do Legacy Plan).
- **Setor**:
  - `comercial` → só Comercial. **Não vê/cria Executoria nem NPS.**
  - `executoria` → só Executoria (+ NPS).
  - `ambos` → Comercial e Executoria (+ NPS).
- **Admin vê tudo** (todos os setores, todas as gravações/NPS), independente do próprio `sector`.

### A.2 Migração de seed (não quebrar acesso atual)

Na migração que cria a tabela, semear uma linha para cada staff atual:

```sql
insert into public.meet_user_profile (user_id, is_admin, sector)
select id, (role = 'MASTER'), 'ambos'
from public.users
where role in ('MASTER','EXECUTOR')
on conflict (user_id) do nothing;
```

Assim todo staff atual mantém acesso (setor `ambos`); MASTERs viram admin do Meet. Depois o admin ajusta (marca comerciais, define/retira admins).

### A.3 `getCurrentUser` (novo formato)

`lib/auth.ts` passa a devolver:

```ts
export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  isStaff: boolean;     // tem meet_user_profile
  isAdmin: boolean;     // meet_user_profile.is_admin
  sector: 'comercial' | 'executoria' | 'ambos' | null; // null se não-staff
};
```

Implementação: após `auth.getUser()`, buscar `meet_user_profile` por `user_id` (via service_role / admin client, pois RLS bloqueia). Sem linha → `isStaff=false, isAdmin=false, sector=null`. Em erro/sem sessão → `null` (como hoje).

Helpers:
- `canSeeExecutoria(u)` = `u.isAdmin || u.sector === 'executoria' || u.sector === 'ambos'`.
- `canSeeComercial(u)` = `u.isAdmin || u.sector === 'comercial' || u.sector === 'ambos'`.
- `canSeeNps(u)` = `canSeeExecutoria(u)`.

### A.4 Pontos que mudam de `role`/`isInternalRole` para o novo modelo

- `lib/auth.ts`: remove `isInternalRole`; adiciona helpers acima.
- `lib/livekitAuth.ts` (`authorizeHostAction`): "usuário interno" → `user && user.isStaff`.
- `middleware.ts`: mantém o gate por sessão. Rotas internas continuam exigindo sessão; a checagem de **staff** é feita nas páginas/endpoints (abaixo), não no middleware (evita query por request no edge).
- `/api/me`: passa a devolver `{ user: { name, isAdmin, sector, isStaff } }`.
- **Não-staff logado** (ex.: cliente do Legacy Plan que loga): páginas internas (`getCurrentUser().isStaff === false`) redirecionam para **`/sem-acesso`** (página mínima, sem shell, com botão Sair). Convidados (sem sessão) seguem usando `/rooms` e `/obrigado` normalmente.
- `/admin/usuarios`: gate por `isAdmin` (era `role==='MASTER'`).
- `/api/admin/users`: gate por `isAdmin`. **Estende** para gerenciar o profile: ao listar, traz `is_admin`/`sector`; ganha um `PATCH`/`POST` para definir `is_admin` e `sector` de um usuário (upsert em `meet_user_profile`). Criar usuário continua criando a conta + (novo) cria o `meet_user_profile` com o setor escolhido.
- **Gravações** (`/api/recordings`): visibilidade atual (admin vê todas; senão `host_id == user.id`) **+ gate de setor**: usuário `comercial` vê apenas gravações de setor `comercial`. `executoria`/`ambos`/admin: sem restrição de setor adicional.
- **Agenda** (`/api/meetings/scheduled`): hoje filtra por `host_id == user.id`. Mantém; o gate de setor aparece no formulário (A.5).

### A.5 Gates de UI por setor

- **Home (`app/page.tsx`)** e **Agenda (`app/agenda/page.tsx`)**: as abas de setor dependem do `sector` do usuário — `comercial` → só "Comercial"; `executoria` → só "Executoria"; `ambos` → ambas (comportamento atual). (Lê o sector via `/api/me`.)
- **Sidebar (`AppShell`)**: item **NPS** só aparece para quem `canSeeNps` (esconde para `comercial`).
- **Gravações**: para `comercial`, não mostra o filtro/registros de Executoria (coberto pelo gate de A.4).

---

## Parte B — NPS de Executoria

### B.1 Tabela `meet_nps_responses`

```sql
create table public.meet_nps_responses (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid references public.meetings(id) on delete cascade,
  room_name text not null,
  host_id uuid references public.users(id),
  score int not null check (score between 0 and 10),
  comment text,
  respondent_name text,
  created_at timestamptz not null default now()
);
create index on public.meet_nps_responses (host_id);
create index on public.meet_nps_responses (meeting_id);
alter table public.meet_nps_responses enable row level security;
-- sem policies: acesso via service_role (server). O submit público passa pela API.
```

Permite múltiplas respostas por reunião (vários clientes). Dashboard agrega.

### B.2 Coleta no `/obrigado` (automático)

1. Ao desconectar da sala, o cliente é levado a **`/obrigado?room=<roomName>`** (ajustar a navegação de saída em `app/rooms/[roomName]/...` para incluir `?room=`).
2. **`GET /api/nps/context?room=<roomName>`** (público): resolve a reunião pelo `room_name` (via service_role), consulta `meet_meeting_sector`. Responde:
   - `{ needsNps: true, meetingId, hostName }` se setor = `executoria` **e** o visitante **não é staff logado** (`getCurrentUser()?.isStaff !== true`).
   - `{ needsNps: false }` caso contrário (Comercial, sem setor, ou staff logado).
3. `/obrigado`: se `needsNps`, mostra o formulário — **nota 0–10** (botões/escala) + **Observações** (textarea, opcional) com o texto "Como foi a entrega do anfitrião{hostName ? ` (${hostName})` : ''}?". Senão, mantém o agradecimento atual.
4. **`POST /api/nps/submit`** (público): body `{ room, score, comment?, respondentName? }`. Valida `score` inteiro 0–10 e que a reunião existe e é `executoria`; resolve `meeting_id` e `host_id` (de `meetings`); insere em `meet_nps_responses`. Retorna `{ ok: true }`. Após enviar, `/obrigado` mostra "Obrigado pela avaliação!".

Endpoints públicos novos entram na allowlist do `middleware.ts`: `/api/nps/context`, `/api/nps/submit` (e `/obrigado` já é público).

### B.3 Dashboard `/nps`

- Item **NPS** na sidebar (escondido para `comercial`; bloqueado server-side por `canSeeNps`).
- **`GET /api/nps`** (staff): admin → todas as respostas; senão → apenas `host_id == user.id`. Junta título/data da reunião (`meetings`) e setor. Para admin, suporta filtro por usuário (host).
- Página `/nps` (client, dentro do `AppShell`): 
  - Cartão de resumo: **média** das notas e total de respostas (no recorte visível).
  - Lista por reunião: título, data (GMT-3), nota, Observações, e (para admin) nome do anfitrião + filtro por usuário (mesmo `SearchableSelect` das Gravações).
  - Estados de loading com **Skeleton**; vazio com mensagem.

---

## Componentes / arquivos (resumo)

**Banco (migração via MCP):** `meet_user_profile` (+ seed), `meet_nps_responses`.

**lib:** `lib/auth.ts` (novo `CurrentUser` + helpers), `lib/livekitAuth.ts` (isStaff), `lib/recordings.ts` (gate de setor em quem chama, ou parâmetro de sector).

**API:** `/api/me` (novos campos), `/api/admin/users` (gate isAdmin + gerir profile), `/api/recordings` (gate de setor), `/api/nps/context` (público), `/api/nps/submit` (público), `/api/nps` (staff).

**Páginas:** `/obrigado` (form NPS condicional), `/nps` (nova), `/admin/usuarios` (toggle admin + setor), `app/page.tsx` e `app/agenda` (abas por setor), `AppShell` (item NPS condicional), `/sem-acesso` (nova, mínima).

## Fora de escopo (YAGNI)

E-mail/lembrete de NPS; link público assíncrono; multi-pergunta/templates de NPS; recorrência; editar histórico de NPS; migrar dados antigos. NPS é nota única (0–10) + comentário.

## Ordem de implementação sugerida

Parte A (acesso) antes da Parte B (NPS), pois o gate de setor/admin e o `getCurrentUser` novo são pré-requisitos do NPS e dos dashboards.
