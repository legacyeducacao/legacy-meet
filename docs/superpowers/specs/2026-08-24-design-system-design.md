# Aplicar o Design System Legacy Plan no Meet — Design

Aprovado em 2026-08-24 ("prossiga, é isso mesmo").

## Objetivo

Alinhar o front do Legacy Meet ao kit `design-system/` (snapshot do Legacy Plan,
2026-08-24): tokens, componentes `ui/`, shell com sidebar, login, toasts,
padrões de página e micro-interações — mantendo a **marca Legacy Meet**.

## Decisões

- **Marca:** logo/nome Legacy Meet na sidebar e no login (não os SVGs do Plan).
- **Login + preloader pós-login:** entram nesta leva.
- **Dark mode:** toggle claro/escuro no header do shell (classe `dark` no
  `<html>`, preferência em `localStorage`, padrão claro). A sala de reunião
  (LiveKit) segue com o tema próprio.
- **Sala de reunião:** UI do LiveKit (`/rooms/*`, `/custom`) NÃO muda.
- **Estratégia de integração:** o kit é *copiado para dentro* da estrutura do
  app (como o README dele orienta), vira o código do Meet e a pasta
  `design-system/` some do repo (docs vão para `docs/design-system/`). Sem duas
  cópias para divergir.

## Mapeamento kit → app

| Kit | App (Next) | Observação |
|---|---|---|
| `tokens/tokens.css` | `styles/tokens.css`, importado no topo de `styles/globals.css` no lugar do bloco de tokens atual | `--font-sans` passa a `var(--font-urbanist), "Urbanist"` (fonte via `next/font`). O CSS do LiveKit/PreJoin em `globals.css` é preservado. |
| `components/ui/*` (32) | `components/ui/*` (substitui os 21 atuais) | `'use client'` no topo de cada arquivo (Next App Router). Imports relativos `../../lib/*` continuam válidos (raiz `lib/`). |
| `components/sidebar/*`, `patterns/*`, `motion/*` | `components/sidebar/*`, `components/patterns/*`, `components/motion/*` | idem `'use client'`. |
| `components/TopProgressBar.tsx` | `components/TopProgressBar.tsx` adaptado | sinal de "em voo" = mudança de rota (`usePathname`) em vez de react-query. |
| `lib/*` (hooks/utils) | `lib/*` | Não entram: `routePrefetch.ts` (snippet) e `useScrollRestoration.ts` (react-router). |
| `assets/*.svg` (marca Plan) | não copiados | Meet usa `public/logo-legacy-meet.svg` e `public/favicon.svg`. |
| `docs/*`, `README.md` | `docs/design-system/` | referência. |

Dependências novas: `framer-motion`, `sonner`. Removida: `react-hot-toast`.

## Shell (`components/AppShell.tsx`)

Reescrito como wrapper do `AppLayout` do kit:
- `sections` = mesma navegação de hoje (Início, Agenda, Gravações, NPS se
  permitido, Usuários se admin), com `showInBottomNav`.
- `activeKey` derivado de `usePathname()`; `onNavigate(key)` → `router.push`.
- `user` de `/api/me` (nome + papel Admin/Equipe); `onLogout` = fluxo atual
  (`POST /api/auth/logout` + redirect).
- `logo` = `{ full: <Image logo-legacy-meet>, collapsed: <Image favicon> }`.
- `headerActions` = toggle de tema (`ThemeToggle`, novo, em `components/`).
- `title` = rótulo da rota ativa.

## Login (`app/login/page.tsx`)

Usa `LoginPage` do kit: `onLogin` → `supabase.auth.signInWithPassword`
(rejeita com `Error('E-mail ou senha inválidos')`), grava
`POST_LOGIN_PRELOADER_FLAG` e faz `window.location.href = '/'` (reload
completo, como o kit pede). `onForgotPassword` →
`supabase.auth.resetPasswordForEmail`. `backgroundImageUrl="/Login-bg.svg"`
(já existe). `<PostLoginPreloader />` montado uma vez no `app/layout.tsx`
(via componente client `AppProviders`).

## Toasts

`app/layout.tsx` monta `<Toaster theme={tema atual} />` de
`components/ui/sonner`. Todos os usos de `react-hot-toast` (6 arquivos, incl.
a sala) passam a `import { toast } from '@/components/ui/custom-toast'`.
Contrato exigido: `toast.success/error/loading(...)` retornando id e
`toast.dismiss(id)` (usado na sala em "reconectando…"); se `custom-toast` não
expuser `dismiss`, ele é adicionado delegando ao `sonner`.

## Páginas internas

Agenda, Gravações (lista e detalhe), NPS, Usuários e Início: `PageHeader` no
topo, `EmptyState` nos vazios, skeletons do kit no carregamento, classes
`animate-in-fade`/`stagger-*` nos blocos. Sem mudança de comportamento.

## Fora do escopo

- Command palette (Ctrl+K), celebração de etapa, densidade, scrub numérico —
  disponíveis no kit, sem uso no Meet por ora.
- Redesign das telas da sala/PreJoin.
