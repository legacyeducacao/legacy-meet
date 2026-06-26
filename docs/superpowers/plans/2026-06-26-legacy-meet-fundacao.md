# Legacy Meet — Fundação (Auth + Usuários + Reunião↔Usuário) — Plano de Implementação

> **Para workers agênticos:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para implementar tarefa a tarefa. Os passos usam checkbox (`- [ ]`).

**Goal:** Trocar a senha fixa por login multiusuário (Supabase Auth, contas do Legacy Plan), com papéis MASTER/EXECUTOR, e mapear cada reunião/gravação ao host — com dois setores (Comercial/Executoria).

**Architecture:** Next 15 (App Router) + Supabase (projeto `eddfdgefrwjxfafkkzls`). Login via `@supabase/ssr` (sessão em cookie). Reuniões gravadas na tabela `meetings` do Legacy Plan (insert server-side com `service_role`, checagem de papel no nosso código), setor em `meet_meeting_sector` (tabela própria). MinIO/worker de gravação **inalterados**; ligação por `room_name`.

**Tech Stack:** Next.js 15.5, React 18, TypeScript, pnpm, @supabase/supabase-js, @supabase/ssr, livekit, @aws-sdk/client-s3.

## Global Constraints

- Package manager: **`corepack pnpm`** (não use npm).
- Sem framework de testes no repo → cada tarefa **verifica com `corepack pnpm exec tsc --noEmit` + `corepack pnpm build` + verificação manual descrita** e termina em commit. (Adaptação do TDD ao padrão já usado no projeto.)
- Supabase project id: **`eddfdgefrwjxfafkkzls`**.
- `room_name` das reuniões do meet: **`meet_<uuid>`** (formato já usado no Legacy Plan).
- `service_role` **só** em código server (nunca em `NEXT_PUBLIC_*` nem no bundle do cliente).
- Papéis (enum `users.role`): MASTER, EXECUTOR (CLIENT/COLLABORATOR/CUSTOMER_SUCCESS não são criados pelo meet).
- `meetings` é tabela de PRODUÇÃO do Legacy Plan: **não** alterar seu schema; só inserir linhas do meet e ler.
- Setores: `comercial` | `executoria`. **Comercial não pede cliente e não tem NPS.**
- Convidados entram **sem login** em `/rooms/...`.

---

### Task 1: Dependências, clientes Supabase e variáveis de ambiente

**Files:**
- Modify: `package.json` (deps)
- Create: `lib/supabase/server.ts`, `lib/supabase/client.ts`, `lib/supabase/admin.ts`
- Modify: `.env.example` (criar se não existir) e `README.md` (documentar envs)

**Interfaces:**
- Produces:
  - `createServerSupabase()` → cliente SSR (lê/escreve cookies) p/ Server Components, Route Handlers, middleware.
  - `createBrowserSupabase()` → cliente de browser.
  - `createAdminSupabase()` → cliente com `service_role` (server-only).

- [ ] **Passo 1: Instalar deps**

Run: `corepack pnpm add @supabase/supabase-js @supabase/ssr`

- [ ] **Passo 2: Documentar envs em `.env.example`**

```
NEXT_PUBLIC_SUPABASE_URL=https://eddfdgefrwjxfafkkzls.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key do projeto>
SUPABASE_SERVICE_ROLE_KEY=<service_role key — server only>
MEET_COMMERCIAL_TENANT_ID=<uuid do tenant sentinela "Comercial" (definido na Task 2)>
```

- [ ] **Passo 3: `lib/supabase/client.ts`**

```ts
'use client';
import { createBrowserClient } from '@supabase/ssr';

export function createBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

- [ ] **Passo 4: `lib/supabase/server.ts`**

```ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            /* chamado de um Server Component — ignorar (o middleware renova) */
          }
        },
      },
    },
  );
}
```

- [ ] **Passo 5: `lib/supabase/admin.ts`**

```ts
import { createClient } from '@supabase/supabase-js';

// service_role: ignora RLS. SOMENTE em código server.
export function createAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
```

- [ ] **Passo 6: Verificar**

Run: `corepack pnpm exec tsc --noEmit` → sem erros.
Run: `corepack pnpm build` → build OK.

- [ ] **Passo 7: Commit**

```bash
git add package.json pnpm-lock.yaml lib/supabase .env.example README.md
git commit -m "feat(auth): clientes Supabase (ssr/browser/admin) + envs"
```

---

### Task 2: Migração do banco — `meet_meeting_sector` + tenant sentinela "Comercial"

**Files:** (migração no Supabase via MCP `apply_migration`; nenhuma mudança de código)

- [ ] **Passo 1: Confirmar/definir o tenant sentinela "Comercial"**

Rodar (MCP `execute_sql`, projeto `eddfdgefrwjxfafkkzls`):
```sql
select id, name from public.client_tenants where name ilike '%comercial%' or name ilike '%legacy educa%';
```
Se existir um tenant interno adequado, anotar o `id`. Senão, criar um dedicado:
```sql
insert into public.client_tenants (name, status)
values ('Legacy Meet — Comercial', 'active')
returning id;
```
Anotar o `id` retornado → vai em `MEET_COMMERCIAL_TENANT_ID` (Task 1 / env do deploy).
> Cuidado: confirmar que esse tenant **não** aparece indevidamente nas listas de clientes do Legacy Plan (checar com o time se necessário).

- [ ] **Passo 2: Criar a tabela de setor (MCP `apply_migration`, name `meet_meeting_sector`)**

```sql
create table if not exists public.meet_meeting_sector (
  meeting_id uuid primary key references public.meetings(id) on delete cascade,
  sector text not null check (sector in ('comercial','executoria')),
  created_at timestamptz not null default now()
);
alter table public.meet_meeting_sector enable row level security;
-- leitura/escrita só via service_role (server). Sem policies p/ anon/authenticated:
-- service_role ignora RLS; ninguém mais acessa direto.
```

- [ ] **Passo 3: Verificar**

```sql
select * from information_schema.tables where table_schema='public' and table_name='meet_meeting_sector';
```
Esperado: 1 linha.

- [ ] **Passo 4: Registrar no spec/README o `MEET_COMMERCIAL_TENANT_ID` definido.** (sem commit de código; doc/commit opcional)

---

### Task 3: Login com Supabase + logout (aposenta a senha fixa)

**Files:**
- Modify: `app/login/page.tsx` (form de email+senha)
- Create: `app/api/auth/logout/route.ts`
- Modify/Remove: `app/api/staff/login/route.ts` (deixar de usar; pode remover)

**Interfaces:**
- Consumes: `createBrowserSupabase()` (Task 1).

- [ ] **Passo 1: `app/login/page.tsx` — form email+senha**

```tsx
'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabase } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const supabase = createBrowserSupabase();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      setError('E-mail ou senha inválidos.');
      return;
    }
    router.push('/');
    router.refresh();
  };

  return (
    <main data-lk-theme="default" style={{ height: '100%', display: 'flex' }}>
      <form onSubmit={onSubmit} className="prejoin-card" style={{ margin: 'auto', width: 'min(100%,420px)' }}>
        <div className="prejoin-header">
          <img src="/favicon.svg" alt="Legacy Meet" width={52} height={52} />
          <h1>Entrar</h1>
          <p>Acesse com sua conta Legacy.</p>
        </div>
        <input className="lk-form-control" type="email" placeholder="E-mail" value={email}
          onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        <input className="lk-form-control" type="password" placeholder="Senha" value={password}
          onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password"
          style={{ marginTop: '0.75rem' }} />
        {error && <p style={{ color: '#ff8a8a', marginTop: '0.5rem' }}>{error}</p>}
        <button className="lk-button lk-join-button" type="submit" disabled={busy} style={{ marginTop: '1rem', width: '100%' }}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Passo 2: `app/api/auth/logout/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';

export async function POST() {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
```

- [ ] **Passo 3: Remover o login de senha fixa**

Apagar `app/api/staff/login/route.ts`. (A proteção por sessão entra na Task 4.)

- [ ] **Passo 4: Verificar**

Run: `corepack pnpm exec tsc --noEmit` e `corepack pnpm build` → OK.
Manual (após deploy/local com envs): abrir `/login`, entrar com **joao.gaspar@legacyeducacaocorp.com.br** (conta existente) → redireciona p/ `/`. Senha errada → "E-mail ou senha inválidos."

- [ ] **Passo 5: Commit**

```bash
git add app/login/page.tsx app/api/auth/logout/route.ts
git rm app/api/staff/login/route.ts
git commit -m "feat(auth): login Supabase (email/senha) + logout; remove senha fixa"
```

---

### Task 4: Middleware (sessão) + helper de usuário/papel

**Files:**
- Modify: `middleware.ts`
- Create: `lib/auth.ts`

**Interfaces:**
- Produces: `getCurrentUser()` → `{ id: string; email: string; name: string | null; role: 'MASTER'|'EXECUTOR'|string } | null` (server).
- Consumes: `createServerSupabase()` (Task 1).

- [ ] **Passo 1: `lib/auth.ts`**

```ts
import { createServerSupabase } from '@/lib/supabase/server';

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  role: string; // 'MASTER' | 'EXECUTOR' | ...
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: row } = await supabase
    .from('users')
    .select('name, email, role')
    .eq('id', user.id)
    .maybeSingle();
  return {
    id: user.id,
    email: row?.email ?? user.email ?? '',
    name: row?.name ?? null,
    role: (row?.role as string) ?? 'EXECUTOR',
  };
}
```

- [ ] **Passo 2: `middleware.ts` — proteger rotas por sessão**

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Rotas PÚBLICAS (sem login): login, sala, obrigado, e APIs usadas por convidados/CRM/worker.
const PUBLIC_PREFIXES = ['/login', '/rooms', '/obrigado'];
const PUBLIC_API_PREFIXES = [
  '/api/connection-details', '/api/room/', '/api/meetings', '/api/record/', '/api/auth/',
];

function isPublic(path: string) {
  if (PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p + '/') || path === '/login')) return true;
  if (path.startsWith('/api/')) return PUBLIC_API_PREFIXES.some((p) => path.startsWith(p));
  return false;
}

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (toSet) => toSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options)),
      },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();

  const path = req.nextUrl.pathname;
  if (!isPublic(path) && !user) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|mp3|ico)$).*)'],
};
```

- [ ] **Passo 3: Verificar**

Run: `corepack pnpm exec tsc --noEmit` e `corepack pnpm build` → OK.
Manual: sem sessão, abrir `/gravacoes` → redireciona p/ `/login`. Abrir `/rooms/teste` → carrega (público). Logado → `/gravacoes` abre.

- [ ] **Passo 4: Commit**

```bash
git add middleware.ts lib/auth.ts
git commit -m "feat(auth): protecao de rotas por sessao Supabase + getCurrentUser"
```

---

### Task 5: Migrar autorização de host para a sessão Supabase

**Files:**
- Modify: `app/api/connection-details/route.ts`
- Modify: `lib/livekitAuth.ts`

**Interfaces:**
- Consumes: `getCurrentUser()` (Task 4), `verifyHostKey` (existente), `createServerSupabase` (Task 1).

- [ ] **Passo 1: `connection-details` — isHost por sessão**

Substituir o bloco que hoje usa `STAFF_PASSWORD`/cookie `staff_auth` por:
```ts
import { getCurrentUser } from '@/lib/auth';
// ...
const hostKey = request.nextUrl.searchParams.get('hostKey');
const user = await getCurrentUser();
const isHost = !!user || verifyHostKey(roomName, hostKey);
```
(Remover a leitura de `STAFF_PASSWORD`/cookie `staff_auth`.)

- [ ] **Passo 2: `lib/livekitAuth.authorizeHostAction` — aceitar sessão**

Trocar a checagem de `staff_auth`/`STAFF_PASSWORD` por sessão Supabase:
```ts
import { getCurrentUser } from '@/lib/auth';
// ... dentro de authorizeHostAction:
if (await getCurrentUser()) return true;          // usuário interno logado = host
if (verifyHostKey(roomName, body.hostKey)) return true;
if (!allowCohost) return false;
// ... (resto: token do participante + atributo cohost — inalterado)
```
Manter o fallback dev: se não houver `NEXT_PUBLIC_SUPABASE_URL`/sessão e nem STAFF config, **não** liberar geral em produção; em dev pode-se manter um curto-circuito por env `MEET_DEV_OPEN=1` (opcional).

- [ ] **Passo 3: Verificar**

Run: `corepack pnpm exec tsc --noEmit` e `corepack pnpm build` → OK.
Manual: logado, criar/entrar numa sala → você é host (vê os painéis); admitir/mutar funciona. Convidado (sem login, via guestUrl) → não é host. Link assinado do CRM (`hostKey`) → host.

- [ ] **Passo 4: Commit**

```bash
git add app/api/connection-details/route.ts lib/livekitAuth.ts
git commit -m "feat(auth): host autorizado pela sessao Supabase (alem de hostKey/cohost)"
```

---

### Task 6: Criar reunião com setor → linha em `meetings` + `meet_meeting_sector`

**Files:**
- Modify: `app/page.tsx` (home: escolher setor; executoria → cliente; comercial → nome do prospect)
- Create: `app/api/meetings/local/route.ts` (insert server-side)
- Modify: `app/api/meetings/route.ts` (CRM: também inserir linha + setor='executoria' por padrão)

**Interfaces:**
- Consumes: `getCurrentUser()`, `createAdminSupabase()`.
- Produces: `POST /api/meetings/local` body `{ sector: 'comercial'|'executoria', title: string, tenantId?: string, record: boolean, transcribe: boolean }` → `{ roomName: string }`.

- [ ] **Passo 1: Endpoint de criação `app/api/meetings/local/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Não autorizado', { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    sector?: 'comercial' | 'executoria';
    title?: string;
    tenantId?: string;
    record?: boolean;
    transcribe?: boolean;
  };
  const sector = body.sector === 'comercial' ? 'comercial' : 'executoria';
  const title = (body.title ?? '').trim() || (sector === 'comercial' ? 'Reunião Comercial' : 'Reunião Executoria');
  const tenantId = sector === 'comercial' ? process.env.MEET_COMMERCIAL_TENANT_ID! : body.tenantId;
  if (!tenantId) return new NextResponse('Cliente (tenant) obrigatório para Executoria', { status: 400 });

  const roomName = `meet_${crypto.randomUUID()}`;
  const now = new Date();
  const end = new Date(now.getTime() + 60 * 60 * 1000);

  const admin = createAdminSupabase();
  const { data: meeting, error } = await admin
    .from('meetings')
    .insert({
      tenant_id: tenantId,
      host_id: user.id,
      title,
      room_name: roomName,
      scheduled_start_at: now.toISOString(),
      scheduled_end_at: end.toISOString(),
      status: 'live',
      recording_enabled: body.record !== false,
      auto_transcribe: body.transcribe !== false,
    })
    .select('id')
    .single();
  if (error || !meeting) return new NextResponse('Falha ao criar reunião: ' + (error?.message ?? ''), { status: 500 });

  await admin.from('meet_meeting_sector').insert({ meeting_id: meeting.id, sector });

  return NextResponse.json({ roomName });
}
```

- [ ] **Passo 2: Home (`app/page.tsx`) — setor + cliente/prospect**

Adicionar: um seletor de **Setor** (Comercial / Executoria). Se Executoria → `<select>` de cliente (carregar via um endpoint `GET /api/clients` que retorna os tenants do executor — clientes onde `executor_id = user.id`, ou todos se MASTER). Se Comercial → campo "Nome do prospect" (vai em `title`). Ao enviar, chamar `POST /api/meetings/local` e navegar para `router.push('/rooms/' + roomName + '?rec=...&tx=...')`.

> Detalhe: criar `app/api/clients/route.ts` (GET) usando `getCurrentUser()` + `createAdminSupabase()`:
> `select id,name from client_tenants where executor_id = <uid>` (MASTER: sem filtro), ordenado por nome.

- [ ] **Passo 3: CRM (`app/api/meetings/route.ts`)**

Após gerar `roomName`, inserir também a linha em `meetings` (service_role) com `tenant_id` do payload (ou sentinela) e `meet_meeting_sector` (`'executoria'` por padrão; aceitar `sector` no payload). Manter `hostUrl/guestUrl`.

- [ ] **Passo 4: Verificar**

Run: `tsc --noEmit` + `build` → OK.
Manual: logado como EXECUTOR, criar reunião **Executoria** escolhendo um cliente → confere no Supabase que há linha em `meetings` (host_id = você, tenant = cliente) e em `meet_meeting_sector` (`executoria`). Criar **Comercial** (sem cliente) → linha com tenant sentinela + setor `comercial`.

```sql
select m.room_name, m.host_id, m.tenant_id, s.sector
from meetings m join meet_meeting_sector s on s.meeting_id = m.id
order by m.created_at desc limit 5;
```

- [ ] **Passo 5: Commit**

```bash
git add app/api/meetings/local/route.ts app/api/clients/route.ts app/page.tsx app/api/meetings/route.ts
git commit -m "feat: criar reuniao com setor (comercial/executoria) gravando em meetings + meet_meeting_sector"
```

---

### Task 7: Cadastro de usuários (somente MASTER)

**Files:**
- Create: `app/admin/usuarios/page.tsx`
- Create: `app/api/admin/users/route.ts`

**Interfaces:**
- Consumes: `getCurrentUser()`, `createAdminSupabase()`.

- [ ] **Passo 1: Endpoint `app/api/admin/users/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  const me = await getCurrentUser();
  if (me?.role !== 'MASTER') return new NextResponse('Não autorizado', { status: 401 });
  const admin = createAdminSupabase();
  const { data } = await admin.from('users').select('id,name,email,role').in('role', ['MASTER', 'EXECUTOR']).order('name');
  return NextResponse.json({ users: data ?? [] });
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (me?.role !== 'MASTER') return new NextResponse('Não autorizado', { status: 401 });
  const { email, password, name, role } = (await req.json().catch(() => ({}))) as
    { email?: string; password?: string; name?: string; role?: string };
  if (!email || !password || !name) return new NextResponse('email, password e name são obrigatórios', { status: 400 });
  const finalRole = role === 'MASTER' ? 'MASTER' : 'EXECUTOR';
  const admin = createAdminSupabase();
  const { data: created, error } = await admin.auth.admin.createUser({
    email: email.trim(), password, email_confirm: true, user_metadata: { name },
  });
  if (error || !created.user) return new NextResponse('Falha ao criar: ' + (error?.message ?? ''), { status: 400 });
  const { error: e2 } = await admin.from('users').insert({ id: created.user.id, email: email.trim(), name, role: finalRole });
  if (e2) return new NextResponse('Conta criada, mas falha no perfil: ' + e2.message, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Passo 2: Tela `app/admin/usuarios/page.tsx`**

Server Component: chama `getCurrentUser()`; se `role !== 'MASTER'` → `notFound()` ou redireciona p/ `/`. Renderiza um client component com a lista (GET `/api/admin/users`) e um form (nome, email, senha, role EXECUTOR/MASTER) que faz POST e dá refresh.

- [ ] **Passo 3: Verificar**

Run: `tsc --noEmit` + `build` → OK.
Manual: logado como MASTER, abrir `/admin/usuarios`, criar um EXECUTOR de teste; sair; logar com o EXECUTOR (deve entrar). Logado como EXECUTOR, `/admin/usuarios` → bloqueado.

- [ ] **Passo 4: Commit**

```bash
git add app/admin/usuarios/page.tsx app/api/admin/users/route.ts
git commit -m "feat(admin): MASTER cadastra/lista usuarios (EXECUTOR/MASTER)"
```

---

### Task 8: `/gravacoes` filtrado por usuário

**Files:**
- Modify: `lib/recordings.ts` (anexar dono/sector por `room_name`)
- Modify: `app/gravacoes/page.tsx` (filtro por papel) e `app/api/recordings/route.ts`

**Interfaces:**
- Consumes: `getCurrentUser()`, `createAdminSupabase()`, `listRecordings()` (existente).

- [ ] **Passo 1: Helper para mapear room_name → host/sector**

Em `lib/recordings.ts`, adicionar (usando admin client):
```ts
import { createAdminSupabase } from '@/lib/supabase/admin';

export type RoomOwner = { roomName: string; hostId: string | null; hostName: string | null; sector: string | null };

export async function getRoomOwners(roomNames: string[]): Promise<Map<string, RoomOwner>> {
  const out = new Map<string, RoomOwner>();
  if (!roomNames.length) return out;
  const admin = createAdminSupabase();
  const { data } = await admin
    .from('meetings')
    .select('room_name, host_id, users:host_id(name), meet_meeting_sector(sector)')
    .in('room_name', roomNames);
  for (const m of data ?? []) {
    out.set(m.room_name, {
      roomName: m.room_name,
      hostId: m.host_id,
      hostName: (m as any).users?.name ?? null,
      sector: (m as any).meet_meeting_sector?.sector ?? null,
    });
  }
  return out;
}
```

- [ ] **Passo 2: Filtrar a listagem por papel**

Em `app/api/recordings/route.ts` (ou onde `listRecordings` é servido): após `listRecordings()`, extrair os `roomName` (de cada `id` = `<roomName>__<stamp>`), chamar `getRoomOwners`, anexar `hostName`/`sector`, e **filtrar**: se `getCurrentUser().role !== 'MASTER'`, manter só onde `hostId === user.id`. Manifests sem dono → só MASTER vê.

- [ ] **Passo 3: UI**

Em `app/gravacoes/page.tsx`, mostrar o **host** e o **setor** em cada card.

- [ ] **Passo 4: Verificar**

Run: `tsc --noEmit` + `build` → OK.
Manual: criar 1 reunião como EXECUTOR A e 1 como EXECUTOR B; em `/gravacoes`, A vê só a sua; MASTER vê as duas (com nome do host + setor).

- [ ] **Passo 5: Commit**

```bash
git add lib/recordings.ts app/gravacoes/page.tsx app/api/recordings/route.ts
git commit -m "feat: /gravacoes filtrado por usuario (host) + setor"
```

---

## Self-Review (cobertura do spec)

- Login Supabase (substitui senha fixa) → Task 3. ✓
- Proteção de rotas por sessão + papéis → Task 4. ✓
- Convidados sem login em /rooms → Task 4 (rota pública). ✓
- Migração da autorização de host (connection-details + authorizeHostAction) → Task 5. ✓
- Cadastro de usuários (MASTER) → Task 7. ✓
- Reunião↔usuário (meetings + setor) com 2 setores → Task 6 (+ Task 2 tabela/tenant). ✓
- /gravacoes por usuário → Task 8. ✓
- Riscos (service_role server-only, RLS via service_role + checagem própria, não alterar schema deles) → refletidos em Global Constraints e nas tasks. ✓

**Fora do escopo (próximos planos):** tela de Agendamento (reuniões futuras `scheduled`), NPS (form obrigatório em Executoria + dashboards), eventual migração de gravações p/ `meeting_recordings`.
