# Controle de Acesso do Meet + NPS de Executoria — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao Legacy Meet controle de acesso próprio (admins + tag de setor por usuário, isolado do Legacy Plan) e NPS de Executoria coletado do cliente no fim da reunião, com dashboard.

**Architecture:** Duas tabelas `meet_*` aditivas no Supabase do Legacy Plan (sem tocar no schema deles). `getCurrentUser` passa a ler `meet_user_profile` (via service_role) e expor `isStaff/isAdmin/sector`; toda autorização do Meet usa isso. NPS do cliente (convidado, anônimo) é coletado no `/obrigado` via endpoints públicos e gravado em `meet_nps_responses`; dashboard `/nps` lê por papel.

**Tech Stack:** Next.js 15 (App Router), React 18, TypeScript, Tailwind v4 + shadcn/ui, `@supabase/supabase-js` + `@supabase/ssr` (service_role server-only), vitest. Gerenciador: `corepack pnpm`.

## Global Constraints

- Não alterar o schema do Legacy Plan; só adicionar tabelas `meet_*`. `users.role` é somente-leitura.
- Não reusar tabelas `nps_*`/`meeting_nps_responses` do Legacy Plan.
- `SUPABASE_SERVICE_ROLE_KEY` é server-only; nunca `NEXT_PUBLIC_`. Endpoints públicos validam entrada.
- Migrações aplicadas via MCP do Supabase (`mcp__supabase__apply_migration`), projeto `eddfdgefrwjxfafkkzls` (legacy-plan).
- `sector` ∈ `('comercial','executoria','ambos')`. Admin vê tudo independentemente do próprio setor.
- "Sem profile = não-staff = bloqueado" (logado não-staff → `/sem-acesso`). O seed mantém o staff atual com acesso.
- Datas exibidas em GMT-3 (`America/Sao_Paulo`).
- Cada task termina passando `rm -rf .next && corepack pnpm build` (exit 0). `.next` velho já causou erros falsos — sempre limpar.
- **Testing:** TDD com vitest **apenas** para lógica pura (helpers de `lib/auth.ts`). Não existe harness de teste para rotas/páginas Next neste repo — para essas, a verificação é o build + a checagem manual descrita. Não fabricar testes sem asserção.
- `@/` = raiz do repo. Branch: `feat/design-legacy-plan` (continuar nela).

---

## Parte A — Controle de acesso

### Task 1: Migração `meet_user_profile` + seed

**Files:**
- DB (MCP `apply_migration`, name: `meet_user_profile`)

**Interfaces:**
- Produces: tabela `public.meet_user_profile(user_id uuid pk, is_admin bool, sector text, created_at, updated_at)` semeada com o staff atual.

- [ ] **Step 1: Aplicar a migração via MCP**

Use `mcp__supabase__apply_migration` com `project_id: eddfdgefrwjxfafkkzls`, `name: meet_user_profile`, `query`:

```sql
create table if not exists public.meet_user_profile (
  user_id uuid primary key references public.users(id) on delete cascade,
  is_admin boolean not null default false,
  sector text not null default 'ambos' check (sector in ('comercial','executoria','ambos')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.meet_user_profile enable row level security;

insert into public.meet_user_profile (user_id, is_admin, sector)
select id, (role = 'MASTER'), 'ambos'
from public.users
where role in ('MASTER','EXECUTOR')
on conflict (user_id) do nothing;
```

- [ ] **Step 2: Verificar**

Use `mcp__supabase__execute_sql` (mesmo project_id):
```sql
select count(*) as profiles, count(*) filter (where is_admin) as admins from public.meet_user_profile;
```
Expected: `profiles` > 0 e `admins` ≥ 1 (os MASTER). Sem erro.

- [ ] **Step 3: Sem commit de código** (mudança só no banco). Registrar no ledger que a migração foi aplicada.

---

### Task 2: `getCurrentUser` novo + helpers + host-auth

**Files:**
- Modify: `lib/auth.ts` (reescreve `CurrentUser`, `getCurrentUser`; remove `isInternalRole`; adiciona helpers)
- Modify: `lib/livekitAuth.ts:50-51` (usa `isStaff`)
- Create: `lib/auth.test.ts`

**Interfaces:**
- Produces:
  - `type CurrentUser = { id: string; email: string; name: string | null; isStaff: boolean; isAdmin: boolean; sector: 'comercial'|'executoria'|'ambos'|null }`
  - `getCurrentUser(): Promise<CurrentUser | null>`
  - `canSeeExecutoria(u: CurrentUser | null): boolean`
  - `canSeeComercial(u: CurrentUser | null): boolean`
  - `canSeeNps(u: CurrentUser | null): boolean`
- Consumes: `createServerSupabase` (sessão), `createAdminSupabase` (lê `meet_user_profile`, pois RLS bloqueia a sessão).

- [ ] **Step 1: Escrever os testes (lógica pura)**

`lib/auth.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { canSeeExecutoria, canSeeComercial, canSeeNps } from './auth';

const mk = (over: Partial<import('./auth').CurrentUser> = {}) => ({
  id: 'u', email: 'e', name: 'n', isStaff: true, isAdmin: false, sector: 'ambos' as const, ...over,
});

describe('gates de setor', () => {
  it('admin vê tudo', () => {
    const u = mk({ isAdmin: true, sector: 'comercial' });
    expect(canSeeExecutoria(u)).toBe(true);
    expect(canSeeComercial(u)).toBe(true);
    expect(canSeeNps(u)).toBe(true);
  });
  it('comercial não vê executoria nem nps', () => {
    const u = mk({ sector: 'comercial' });
    expect(canSeeExecutoria(u)).toBe(false);
    expect(canSeeNps(u)).toBe(false);
    expect(canSeeComercial(u)).toBe(true);
  });
  it('executoria vê executoria/nps, não comercial', () => {
    const u = mk({ sector: 'executoria' });
    expect(canSeeExecutoria(u)).toBe(true);
    expect(canSeeNps(u)).toBe(true);
    expect(canSeeComercial(u)).toBe(false);
  });
  it('ambos vê os dois', () => {
    const u = mk({ sector: 'ambos' });
    expect(canSeeExecutoria(u)).toBe(true);
    expect(canSeeComercial(u)).toBe(true);
  });
  it('null/não-staff não vê nada', () => {
    expect(canSeeExecutoria(null)).toBe(false);
    expect(canSeeComercial(mk({ isStaff: false, sector: null }))).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `corepack pnpm exec vitest run lib/auth.test.ts`
Expected: FAIL (funções não exportadas ainda / arquivo não compila).

- [ ] **Step 3: Reescrever `lib/auth.ts`**

```ts
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';

export type Sector = 'comercial' | 'executoria' | 'ambos';

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  isStaff: boolean;
  isAdmin: boolean;
  sector: Sector | null;
};

export function canSeeComercial(u: CurrentUser | null): boolean {
  if (!u || !u.isStaff) return false;
  return u.isAdmin || u.sector === 'comercial' || u.sector === 'ambos';
}

export function canSeeExecutoria(u: CurrentUser | null): boolean {
  if (!u || !u.isStaff) return false;
  return u.isAdmin || u.sector === 'executoria' || u.sector === 'ambos';
}

export function canSeeNps(u: CurrentUser | null): boolean {
  return canSeeExecutoria(u);
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: row } = await supabase
      .from('users')
      .select('name, email')
      .eq('id', user.id)
      .maybeSingle();

    // meet_user_profile via service_role (RLS bloqueia a sessão)
    const admin = createAdminSupabase();
    const { data: profile } = await admin
      .from('meet_user_profile')
      .select('is_admin, sector')
      .eq('user_id', user.id)
      .maybeSingle();

    return {
      id: user.id,
      email: row?.email ?? user.email ?? '',
      name: row?.name ?? null,
      isStaff: !!profile,
      isAdmin: profile?.is_admin ?? false,
      sector: (profile?.sector as Sector | undefined) ?? null,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Rodar os testes**

Run: `corepack pnpm exec vitest run lib/auth.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Atualizar `lib/livekitAuth.ts`**

Trocar (linhas ~50-51):
```ts
  const user = await getCurrentUser();
  if (user && isInternalRole(user.role)) return true;
```
por:
```ts
  const user = await getCurrentUser();
  if (user?.isStaff) return true;
```
Remover o import de `isInternalRole` (manter o import de `getCurrentUser`).

- [ ] **Step 6: Build**

Run: `rm -rf .next && corepack pnpm build`
Expected: exit 0. (Se algum arquivo ainda importar `isInternalRole`/`user.role`, corrigir — serão tratados nas próximas tasks; aqui só `lib/livekitAuth.ts`.)

- [ ] **Step 7: Commit**

```bash
git add lib/auth.ts lib/auth.test.ts lib/livekitAuth.ts
git commit -m "feat(acesso): getCurrentUser le meet_user_profile (isStaff/isAdmin/sector) + helpers de setor"
```

---

### Task 3: `/api/me`, página `/sem-acesso`, gate de staff e AppShell

**Files:**
- Modify: `app/api/me/route.ts`
- Create: `app/sem-acesso/page.tsx`
- Create: `lib/requireStaff.ts`
- Modify: `components/AppShell.tsx` (tipo `Me` + esconder NPS por setor — o item NPS em si entra na Task 9; aqui só preparar o tipo/sector)

**Interfaces:**
- Consumes: `getCurrentUser`, `canSeeNps`, `canSeeComercial`, `canSeeExecutoria` (Task 2).
- Produces:
  - `GET /api/me` → `{ user: { name: string|null; isStaff: boolean; isAdmin: boolean; sector: 'comercial'|'executoria'|'ambos'|null } | null }`
  - `requireStaff(): Promise<CurrentUser>` — server helper; se não-staff, `redirect('/sem-acesso')`.

- [ ] **Step 1: Atualizar `app/api/me/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ user: null });
  return NextResponse.json({
    user: {
      name: user.name,
      isStaff: user.isStaff,
      isAdmin: user.isAdmin,
      sector: user.sector,
    },
  });
}
```

- [ ] **Step 2: Criar `lib/requireStaff.ts`**

```ts
import { redirect } from 'next/navigation';
import { getCurrentUser, type CurrentUser } from '@/lib/auth';

// Para páginas internas (server). Logado não-staff → /sem-acesso. Sem sessão → /login.
export async function requireStaff(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!user.isStaff) redirect('/sem-acesso');
  return user;
}
```

- [ ] **Step 3: Criar `app/sem-acesso/page.tsx`**

```tsx
import Image from 'next/image';
import { LogoutButton } from './LogoutButton';

export default function SemAcessoPage() {
  return (
    <main className="flex h-full items-center justify-center overflow-y-auto bg-gradient-to-b from-background to-muted/40 p-4 text-foreground [color-scheme:light]">
      <div className="max-w-md text-center">
        <Image src="/favicon.svg" alt="Legacy Meet" width={56} height={56} className="mx-auto" />
        <h1 className="mt-4 text-2xl font-bold">Sem acesso ao Legacy Meet</h1>
        <p className="mt-2 text-muted-foreground">
          Sua conta não tem acesso a esta área. Fale com um administrador do Meet.
        </p>
        <div className="mt-6">
          <LogoutButton />
        </div>
      </div>
    </main>
  );
}
```

Create `app/sem-acesso/LogoutButton.tsx`:
```tsx
'use client';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function LogoutButton() {
  const router = useRouter();
  const sair = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    router.push('/login');
    router.refresh();
  };
  return (
    <Button variant="outline" onClick={sair}>
      Sair
    </Button>
  );
}
```

- [ ] **Step 4: Atualizar o tipo `Me` no `components/AppShell.tsx`**

Trocar `type Me = { name: string | null; role: string } | null;` por:
```ts
type Me = { name: string | null; isStaff: boolean; isAdmin: boolean; sector: 'comercial' | 'executoria' | 'ambos' | null } | null;
```
No rodapé da sidebar, trocar a exibição de `me.role` por um rótulo amigável:
```tsx
{me && (
  <p className="text-[11px] uppercase tracking-wide text-sidebar-foreground/50">
    {me.isAdmin ? 'ADMIN' : (me.sector ?? '').toUpperCase()}
  </p>
)}
```
O array `nav` (a inclusão condicional de "Usuários") muda de `me?.role === 'MASTER'` para `me?.isAdmin`. (O item "Agenda"/"Gravações" continuam; "NPS" entra na Task 9.)

- [ ] **Step 5: Aplicar `requireStaff` nas páginas internas server-side**

Em `app/page.tsx` e `app/agenda/page.tsx` são client components — o gate de staff vem do middleware (sessão) + do AppShell. Para o gate de **não-staff**, adicionar uma checagem no client: no `AppShell`, após carregar `/api/me`, se `me === null` (sem sessão) ou `me.isStaff === false`, redirecionar:
```tsx
React.useEffect(() => {
  // ... fetch /api/me ...
  .then((j) => {
    const u = j?.user ?? null;
    if (!u || !u.isStaff) {
      router.push(u ? '/sem-acesso' : '/login');
      return;
    }
    setMe(u);
  })
}, []);
```
(`app/admin/usuarios/page.tsx` é server e usa seu próprio gate — Task 4.)

- [ ] **Step 6: Build**

Run: `rm -rf .next && corepack pnpm build`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add app/api/me/route.ts lib/requireStaff.ts app/sem-acesso components/AppShell.tsx
git commit -m "feat(acesso): /api/me com isStaff/isAdmin/sector + pagina /sem-acesso + gate de staff no AppShell"
```

---

### Task 4: Admin gerencia profiles (`/api/admin/users` + `/admin/usuarios`)

**Files:**
- Modify: `app/api/admin/users/route.ts`
- Modify: `app/admin/usuarios/page.tsx` (gate por isAdmin)
- Modify: `app/admin/usuarios/UsuariosClient.tsx`

**Interfaces:**
- Consumes: `getCurrentUser` (isAdmin), `createAdminSupabase`.
- Produces:
  - `GET /api/admin/users` → `{ users: { id, name, email, isAdmin, sector }[] }`
  - `POST /api/admin/users` body `{ email, password, name, sector }` → cria conta (Auth) + `users` + `meet_user_profile`.
  - `PATCH /api/admin/users` body `{ userId, isAdmin, sector }` → upsert em `meet_user_profile`.

- [ ] **Step 1: Reescrever `app/api/admin/users/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const SECTORS = ['comercial', 'executoria', 'ambos'] as const;
type Sector = (typeof SECTORS)[number];
const asSector = (s: unknown): Sector => (SECTORS.includes(s as Sector) ? (s as Sector) : 'ambos');

export async function GET() {
  const me = await getCurrentUser();
  if (!me?.isAdmin) return new NextResponse('Não autorizado', { status: 401 });
  const admin = createAdminSupabase();
  const { data } = await admin
    .from('users')
    .select('id, name, email, role, meet_user_profile(is_admin, sector)')
    .order('name');
  const users = ((data ?? []) as any[]).map((u) => {
    const p = Array.isArray(u.meet_user_profile) ? u.meet_user_profile[0] : u.meet_user_profile;
    return {
      id: u.id as string,
      name: u.name as string,
      email: u.email as string,
      isAdmin: p?.is_admin ?? false,
      sector: (p?.sector as Sector | undefined) ?? null,
    };
  });
  return NextResponse.json({ users });
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me?.isAdmin) return new NextResponse('Não autorizado', { status: 401 });
  const { email, password, name, sector } = (await req.json().catch(() => ({}))) as {
    email?: string; password?: string; name?: string; sector?: string;
  };
  const cleanEmail = (email ?? '').trim();
  const cleanName = (name ?? '').trim();
  if (!cleanEmail || !password || !cleanName)
    return new NextResponse('email, password e name são obrigatórios', { status: 400 });
  const admin = createAdminSupabase();
  const { data: created, error } = await admin.auth.admin.createUser({
    email: cleanEmail, password, email_confirm: true, user_metadata: { name: cleanName },
  });
  if (error || !created.user)
    return new NextResponse('Falha ao criar: ' + (error?.message ?? ''), { status: 400 });
  const { error: e2 } = await admin
    .from('users')
    .insert({ id: created.user.id, email: cleanEmail, name: cleanName, role: 'EXECUTOR' });
  if (e2) {
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    return new NextResponse('Falha ao criar o perfil do usuário: ' + e2.message, { status: 500 });
  }
  await admin
    .from('meet_user_profile')
    .upsert({ user_id: created.user.id, is_admin: false, sector: asSector(sector) });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me?.isAdmin) return new NextResponse('Não autorizado', { status: 401 });
  const { userId, isAdmin, sector } = (await req.json().catch(() => ({}))) as {
    userId?: string; isAdmin?: boolean; sector?: string;
  };
  if (!userId) return new NextResponse('userId obrigatório', { status: 400 });
  const admin = createAdminSupabase();
  const { error } = await admin
    .from('meet_user_profile')
    .upsert({ user_id: userId, is_admin: !!isAdmin, sector: asSector(sector), updated_at: new Date().toISOString() });
  if (error) return new NextResponse('Falha ao salvar: ' + error.message, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

Nota: o embed `meet_user_profile(is_admin, sector)` resolve pela FK `meet_user_profile.user_id → users.id`.

- [ ] **Step 2: Gate por isAdmin em `app/admin/usuarios/page.tsx`**

A página chama `notFound()` quando não-admin. Trocar a checagem atual (`role !== 'MASTER'`) por:
```ts
import { getCurrentUser } from '@/lib/auth';
// ...
const me = await getCurrentUser();
if (!me?.isAdmin) notFound();
```

- [ ] **Step 3: Atualizar `UsuariosClient.tsx`**

- Lista: adicionar colunas **Admin** (toggle `Switch`) e **Setor** (`Select` com comercial/executoria/ambos), persistindo via `PATCH /api/admin/users` `{ userId, isAdmin, sector }` e recarregando a lista. Tipos da lista: `{ id, name, email, isAdmin, sector }`.
- Form de criação: substituir o `Select` de papel (MASTER/EXECUTOR) por um `Select` de **Setor** (comercial/executoria/ambos, default ambos); enviar `{ email, password, name, sector }` no POST.
- Manter loading com `Skeleton` e estados de erro/sucesso já existentes.

- [ ] **Step 4: Build**

Run: `rm -rf .next && corepack pnpm build`
Expected: exit 0.

- [ ] **Step 5: Verificação manual (descrita)**

Como admin: abrir `/admin/usuarios`, alternar Admin e mudar Setor de um usuário → recarregar a lista e confirmar persistência (no banco, `select * from meet_user_profile where user_id=...`). Criar usuário com setor escolhido → confirmar linha em `meet_user_profile`.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/users/route.ts app/admin/usuarios
git commit -m "feat(admin): gerir meet_user_profile (admin + setor) por usuario"
```

---

### Task 5: Gates de setor (Gravações + Home + Agenda)

**Files:**
- Modify: `app/api/recordings/route.ts`
- Modify: `app/page.tsx` (abas de setor por `sector`)
- Modify: `app/agenda/page.tsx` (abas de setor por `sector`)

**Interfaces:**
- Consumes: `getCurrentUser`/`canSeeComercial`/`canSeeExecutoria` (server); `/api/me` `sector` (client).

- [ ] **Step 1: Gate de setor em `/api/recordings`**

Após montar `enriched` e antes de `visible`, aplicar o gate de setor para `comercial`:
```ts
const isMaster = user.isAdmin;
let scoped = isMaster ? enriched : enriched.filter((r) => r.hostId !== null && r.hostId === user.id);
// comercial não vê Executoria: restringe a setor 'comercial'
if (!user.isAdmin && user.sector === 'comercial') {
  scoped = scoped.filter((r) => r.sector === 'comercial');
}
return NextResponse.json(scoped);
```
(Trocar a referência anterior a `user.role === 'MASTER'` por `user.isAdmin`.)

- [ ] **Step 2: Abas de setor na Home (`app/page.tsx`)**

Carregar o setor do usuário via `/api/me` (novo `useEffect`), guardar em `meSector`. Derivar as abas disponíveis:
```ts
const canCom = meIsAdmin || meSector === 'comercial' || meSector === 'ambos';
const canExe = meIsAdmin || meSector === 'executoria' || meSector === 'ambos';
```
- Se só uma é permitida, fixar `sector` nela e **não** mostrar as abas (mostrar só o conteúdo do setor permitido).
- Se ambas, manter as abas atuais.
- Garantir que o `useEffect` que carrega clientes só roda quando `sector==='executoria'` e o usuário pode ver Executoria.

- [ ] **Step 3: Mesmas abas por setor na Agenda (`app/agenda/page.tsx`)**

Aplicar a mesma lógica de `meSector`/`canCom`/`canExe` para as abas de setor do formulário de agendamento.

- [ ] **Step 4: Build**

Run: `rm -rf .next && corepack pnpm build`
Expected: exit 0.

- [ ] **Step 5: Verificação manual**

Definir um usuário como `comercial` (via /admin) e logar com ele: Home/Agenda mostram só "Comercial"; `/gravacoes` não traz gravações de Executoria. Usuário `ambos`/admin: vê os dois.

- [ ] **Step 6: Commit**

```bash
git add app/api/recordings/route.ts app/page.tsx app/agenda/page.tsx
git commit -m "feat(acesso): gates de setor em gravacoes/home/agenda (comercial nao ve executoria)"
```

---

## Parte B — NPS de Executoria

### Task 6: Migração `meet_nps_responses`

**Files:**
- DB (MCP `apply_migration`, name: `meet_nps_responses`)

**Interfaces:**
- Produces: tabela `public.meet_nps_responses`.

- [ ] **Step 1: Aplicar a migração via MCP**

`mcp__supabase__apply_migration`, `project_id: eddfdgefrwjxfafkkzls`, `name: meet_nps_responses`, `query`:
```sql
create table if not exists public.meet_nps_responses (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid references public.meetings(id) on delete cascade,
  room_name text not null,
  host_id uuid references public.users(id),
  score int not null check (score between 0 and 10),
  comment text,
  respondent_name text,
  created_at timestamptz not null default now()
);
create index if not exists meet_nps_host_idx on public.meet_nps_responses (host_id);
create index if not exists meet_nps_meeting_idx on public.meet_nps_responses (meeting_id);
alter table public.meet_nps_responses enable row level security;
```

- [ ] **Step 2: Verificar**

`mcp__supabase__execute_sql`: `select count(*) from public.meet_nps_responses;` → 0, sem erro.

- [ ] **Step 3: Registrar no ledger** (sem commit de código).

---

### Task 7: Endpoints públicos de NPS + saída da sala

**Files:**
- Create: `app/api/nps/context/route.ts`
- Create: `app/api/nps/submit/route.ts`
- Modify: `middleware.ts` (allowlist `/api/nps/context`, `/api/nps/submit`)
- Modify: a navegação de saída da sala para `/obrigado?room=<roomName>` (em `app/rooms/[roomName]/...` — localizar onde hoje redireciona para `/obrigado`)

**Interfaces:**
- Produces:
  - `GET /api/nps/context?room=<roomName>` → `{ needsNps: boolean; meetingId?: string; hostName?: string }`
  - `POST /api/nps/submit` body `{ room: string; score: number; comment?: string; respondentName?: string }` → `{ ok: true }` ou erro 400/404.
- Consumes: `createAdminSupabase`, `getCurrentUser` (para detectar staff logado).

- [ ] **Step 1: `app/api/nps/context/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const room = req.nextUrl.searchParams.get('room') ?? '';
  if (!room) return NextResponse.json({ needsNps: false });

  // staff logado não responde NPS
  const me = await getCurrentUser();
  if (me?.isStaff) return NextResponse.json({ needsNps: false });

  const admin = createAdminSupabase();
  const { data } = await admin
    .from('meetings')
    .select('id, title, users:host_id(name), meet_meeting_sector!inner(sector)')
    .eq('room_name', room)
    .maybeSingle();
  const sector = Array.isArray((data as any)?.meet_meeting_sector)
    ? (data as any).meet_meeting_sector[0]?.sector
    : (data as any)?.meet_meeting_sector?.sector;
  if (!data || sector !== 'executoria') return NextResponse.json({ needsNps: false });
  const hostName = Array.isArray((data as any).users)
    ? (data as any).users[0]?.name
    : (data as any).users?.name;
  return NextResponse.json({ needsNps: true, meetingId: (data as any).id, hostName: hostName ?? null });
}
```

- [ ] **Step 2: `app/api/nps/submit/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    room?: string; score?: number; comment?: string; respondentName?: string;
  };
  const room = (body.room ?? '').trim();
  const score = Number(body.score);
  if (!room) return new NextResponse('room obrigatório', { status: 400 });
  if (!Number.isInteger(score) || score < 0 || score > 10)
    return new NextResponse('score deve ser inteiro 0–10', { status: 400 });

  const admin = createAdminSupabase();
  const { data: meeting } = await admin
    .from('meetings')
    .select('id, host_id, meet_meeting_sector!inner(sector)')
    .eq('room_name', room)
    .maybeSingle();
  const sector = Array.isArray((meeting as any)?.meet_meeting_sector)
    ? (meeting as any).meet_meeting_sector[0]?.sector
    : (meeting as any)?.meet_meeting_sector?.sector;
  if (!meeting || sector !== 'executoria')
    return new NextResponse('Reunião de Executoria não encontrada', { status: 404 });

  const { error } = await admin.from('meet_nps_responses').insert({
    meeting_id: (meeting as any).id,
    room_name: room,
    host_id: (meeting as any).host_id,
    score,
    comment: (body.comment ?? '').trim() || null,
    respondent_name: (body.respondentName ?? '').trim() || null,
  });
  if (error) return new NextResponse('Falha ao registrar: ' + error.message, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Allowlist no `middleware.ts`**

Adicionar `/api/nps/context` e `/api/nps/submit` à lista de rotas públicas (junto com `/api/connection-details`, `/api/room/`, etc.).

- [ ] **Step 4: Saída da sala com `?room=`**

Localizar onde o app navega para `/obrigado` ao sair/encerrar (em `app/rooms/[roomName]/`). Acrescentar a query: `/obrigado?room=${roomName}`. (O `roomName` já está disponível no contexto da página da sala.)

- [ ] **Step 5: Build**

Run: `rm -rf .next && corepack pnpm build`
Expected: exit 0.

- [ ] **Step 6: Verificação manual**

`GET /api/nps/context?room=<sala_executoria>` deslogado → `{ needsNps: true, ... }`; logado como staff → `{ needsNps:false }`; sala comercial → `{ needsNps:false }`. `POST /api/nps/submit` com score 7 → grava (conferir `select * from meet_nps_responses`). score 11 → 400.

- [ ] **Step 7: Commit**

```bash
git add app/api/nps middleware.ts app/rooms
git commit -m "feat(nps): endpoints publicos de contexto/submit + saida da sala com ?room="
```

---

### Task 8: Formulário de NPS no `/obrigado`

**Files:**
- Modify: `app/obrigado/page.tsx` (vira server component que lê `?room=` e decide; delega o form a um client component)
- Create: `app/obrigado/NpsForm.tsx`

**Interfaces:**
- Consumes: `GET /api/nps/context`, `POST /api/nps/submit`.

- [ ] **Step 1: `app/obrigado/page.tsx`**

Manter o agradecimento atual quando não há NPS. Como `searchParams` chega no server component, decidir lá e renderizar o form (client) quando `room` existir:
```tsx
import Image from 'next/image';
import { CheckCircle2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { NpsForm } from './NpsForm';

export const dynamic = 'force-dynamic';

export default async function ObrigadoPage(ctx: { searchParams: Promise<{ room?: string }> }) {
  const { room } = await ctx.searchParams;
  return (
    <main className="flex h-full items-center justify-center overflow-y-auto bg-gradient-to-b from-background to-muted/40 p-4 text-foreground [color-scheme:light]">
      {room ? (
        <NpsForm room={room} />
      ) : (
        <Card className="w-full max-w-md text-center">
          <CardContent className="flex flex-col items-center gap-4 py-10">
            <Image src="/favicon.svg" alt="Legacy Meet" width={64} height={64} />
            <CheckCircle2 className="h-10 w-10 text-primary" />
            <h1 className="text-2xl font-bold">Obrigado pela sua participação!</h1>
            <p className="text-muted-foreground">A reunião foi encerrada. Você já pode fechar esta janela.</p>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
```

- [ ] **Step 2: `app/obrigado/NpsForm.tsx`**

Client component que: ao montar, chama `/api/nps/context?room=`; se `!needsNps`, mostra o agradecimento simples; se `needsNps`, mostra a escala 0–10 (11 botões) + `Textarea` Observações + nome (opcional) + botão Enviar (`POST /api/nps/submit`). Após enviar, "Obrigado pela avaliação!".
```tsx
'use client';
import * as React from 'react';
import Image from 'next/image';
import { CheckCircle2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export function NpsForm({ room }: { room: string }) {
  const [state, setState] = React.useState<'loading' | 'thanks' | 'form' | 'done'>('loading');
  const [hostName, setHostName] = React.useState<string | null>(null);
  const [score, setScore] = React.useState<number | null>(null);
  const [comment, setComment] = React.useState('');
  const [name, setName] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    fetch(`/api/nps/context?room=${encodeURIComponent(room)}`)
      .then((r) => r.json())
      .then((j) => {
        if (j?.needsNps) { setHostName(j.hostName ?? null); setState('form'); }
        else setState('thanks');
      })
      .catch(() => setState('thanks'));
  }, [room]);

  const enviar = async () => {
    if (score == null) return;
    setBusy(true);
    try {
      await fetch('/api/nps/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room, score, comment, respondentName: name }),
      });
      setState('done');
    } finally {
      setBusy(false);
    }
  };

  if (state === 'loading') return null;
  if (state === 'thanks' || state === 'done')
    return (
      <Card className="w-full max-w-md text-center">
        <CardContent className="flex flex-col items-center gap-4 py-10">
          <Image src="/favicon.svg" alt="Legacy Meet" width={64} height={64} />
          <CheckCircle2 className="h-10 w-10 text-primary" />
          <h1 className="text-2xl font-bold">
            {state === 'done' ? 'Obrigado pela avaliação!' : 'Obrigado pela sua participação!'}
          </h1>
          <p className="text-muted-foreground">A reunião foi encerrada. Você já pode fechar esta janela.</p>
        </CardContent>
      </Card>
    );

  return (
    <Card className="w-full max-w-lg">
      <CardContent className="space-y-5 py-8">
        <div className="text-center">
          <h1 className="text-xl font-bold">Como foi a entrega{hostName ? ` de ${hostName}` : ''}?</h1>
          <p className="text-sm text-muted-foreground">Dê uma nota de 0 a 10.</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {Array.from({ length: 11 }).map((_, n) => (
            <button
              key={n}
              type="button"
              onClick={() => setScore(n)}
              className={cn(
                'h-10 w-10 rounded-md border text-sm font-semibold transition-colors',
                score === n ? 'border-primary bg-primary text-primary-foreground' : 'border-input hover:bg-muted',
              )}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          <Label htmlFor="obs">Observações</Label>
          <Textarea id="obs" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Conte como foi…" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="nome">Seu nome (opcional)</Label>
          <Input id="nome" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <Button className="w-full" disabled={score == null || busy} onClick={enviar}>
          {busy ? 'Enviando…' : 'Enviar avaliação'}
        </Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Build**

Run: `rm -rf .next && corepack pnpm build`
Expected: exit 0.

- [ ] **Step 4: Verificação manual**

Abrir `/obrigado?room=<sala_executoria>` deslogado → form aparece; enviar nota → "Obrigado pela avaliação!" e linha em `meet_nps_responses`. `/obrigado` sem `room` → agradecimento simples.

- [ ] **Step 5: Commit**

```bash
git add app/obrigado
git commit -m "feat(nps): formulario de NPS no /obrigado (Executoria, convidado)"
```

---

### Task 9: API + Dashboard `/nps` + item na sidebar

**Files:**
- Create: `app/api/nps/route.ts`
- Create: `app/nps/page.tsx`
- Create: `app/nps/NpsClient.tsx`
- Modify: `components/AppShell.tsx` (item NPS condicional)

**Interfaces:**
- Consumes: `getCurrentUser`/`canSeeNps`, `createAdminSupabase`.
- Produces: `GET /api/nps` → `{ responses: { id, meetingId, title, createdAt, score, comment, respondentName, hostName, hostId }[] }`.

- [ ] **Step 1: `app/api/nps/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getCurrentUser, canSeeNps } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Não autorizado', { status: 401 });
  if (!canSeeNps(user)) return new NextResponse('Sem acesso ao NPS', { status: 403 });

  const admin = createAdminSupabase();
  let q = admin
    .from('meet_nps_responses')
    .select('id, meeting_id, host_id, score, comment, respondent_name, created_at, meetings:meeting_id(title), users:host_id(name)')
    .order('created_at', { ascending: false });
  if (!user.isAdmin) q = q.eq('host_id', user.id);
  const { data, error } = await q;
  if (error) return new NextResponse('Erro ao buscar NPS: ' + error.message, { status: 500 });

  const responses = ((data ?? []) as any[]).map((r) => ({
    id: r.id as string,
    meetingId: r.meeting_id as string | null,
    title: (Array.isArray(r.meetings) ? r.meetings[0]?.title : r.meetings?.title) ?? null,
    createdAt: r.created_at as string,
    score: r.score as number,
    comment: (r.comment as string) ?? null,
    respondentName: (r.respondent_name as string) ?? null,
    hostName: (Array.isArray(r.users) ? r.users[0]?.name : r.users?.name) ?? null,
    hostId: r.host_id as string | null,
  }));
  return NextResponse.json({ responses });
}
```

- [ ] **Step 2: `app/nps/page.tsx`** (gate server + render client)

```tsx
import { requireStaff } from '@/lib/requireStaff';
import { canSeeNps } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { NpsClient } from './NpsClient';

export const dynamic = 'force-dynamic';

export default async function NpsPage() {
  const user = await requireStaff();
  if (!canSeeNps(user)) redirect('/');
  return <NpsClient isAdmin={user.isAdmin} />;
}
```

- [ ] **Step 3: `app/nps/NpsClient.tsx`**

Client dentro do `AppShell`. Carrega `/api/nps`; mostra **média** e total; lista por resposta (título, data GMT-3, nota como `Badge`, Observações, e — se admin — nome do anfitrião + `SearchableSelect` de filtro por usuário, como em Gravações). Loading com `Skeleton`; vazio com mensagem. Formatar data:
```ts
new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
```
Média: `media = respostas.length ? (soma(score)/n).toFixed(1) : '—'`. Estrutura visual: `AppShell` > título "NPS" + subtítulo > card de resumo (média + nº respostas) > (admin) filtro > lista de cards.

- [ ] **Step 4: Item NPS na sidebar (`components/AppShell.tsx`)**

Incluir no array `nav`, condicional ao setor, usando o `me` já carregado:
```ts
const canNps = !!me && (me.isAdmin || me.sector === 'executoria' || me.sector === 'ambos');
// ...dentro do array nav, após 'Gravações':
...(canNps ? [{ href: '/nps', label: 'NPS', icon: ClipboardList }] : []),
```
Importar `ClipboardList` de `lucide-react`.

- [ ] **Step 5: Build**

Run: `rm -rf .next && corepack pnpm build`
Expected: exit 0.

- [ ] **Step 6: Verificação manual**

Logado como anfitrião com NPS recebido: `/nps` mostra só os seus, com média. Como admin: vê todos + filtro por usuário. Como `comercial`: item NPS some da sidebar e `/nps` redireciona para `/`.

- [ ] **Step 7: Commit**

```bash
git add app/api/nps/route.ts app/nps components/AppShell.tsx
git commit -m "feat(nps): dashboard /nps (anfitriao ve o seu, admin ve tudo) + item na sidebar"
```

---

## Self-review (preenchido)

- **Cobertura da spec:** A.1 (Task 1), A.2 seed (Task 1), A.3 getCurrentUser (Task 2), A.4 consumidores (Tasks 2,3,4,5), A.5 gates UI (Tasks 3,5,9), B.1 tabela (Task 6), B.2 coleta (Tasks 7,8), B.3 dashboard (Task 9). `/sem-acesso` (Task 3). Tudo coberto.
- **Tipos consistentes:** `CurrentUser`/`Sector` (Task 2) usados em 3–5,7,9; `Me` de `/api/me` (Task 3) usado no AppShell (3,9) e Home/Agenda (5); shapes de `/api/nps` (9) e `/api/nps/context|submit` (7) batem com os consumidores (8,9).
- **Placeholders:** nenhum "TBD"; código completo nos passos de backend/migração/novas páginas; edições em arquivos existentes descritas com o código a inserir.
- **Decisão de teste:** unit tests só nos helpers puros (Task 2); demais via build + verificação manual (não há harness de rota/página no repo) — declarado nas Global Constraints.
