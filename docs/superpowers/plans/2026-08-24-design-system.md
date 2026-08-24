# Design System no Meet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar o kit `design-system/` ao front do Meet conforme `docs/superpowers/specs/2026-08-24-design-system-design.md`.

**Architecture:** Kit copiado para a estrutura do app (ui/patterns/sidebar/motion/lib), tokens no CSS raiz, shell reescrito sobre `AppLayout`, login sobre `LoginPage`, toasts em `sonner`+`custom-toast`, páginas internas com os padrões do kit. Sala LiveKit intocada.

**Tech Stack:** Next 15 App Router, Tailwind v4, radix-ui, framer-motion, sonner.

## Global Constraints

- Cada arquivo copiado do kit que use hooks/framer recebe `'use client'` na 1ª linha.
- `npx pnpm exec tsc --noEmit`, lint sem erros novos, `npx pnpm test`, `npx pnpm build` verdes ao fim de cada task.
- Commits `feat(ui): ...` em pt-BR.

### Task 1: Dependências, tokens e biblioteca de componentes

- [ ] `npx pnpm add framer-motion sonner` e `npx pnpm remove react-hot-toast` (só após a Task 4 trocar os imports — até lá manter).
- [ ] Copiar `design-system/tokens/tokens.css` → `styles/tokens.css`; trocar `--font-sans: "Urbanist", sans-serif;` por `--font-sans: var(--font-urbanist), "Urbanist", sans-serif;`.
- [ ] `styles/globals.css`: substituir tudo ANTES da linha `/* ─── Existing Meet / LiveKit CSS below` por `@import './tokens.css';` (mantendo scrollbars minimalistas se não existirem no kit — conferir; se o kit não tiver, manter o bloco de scrollbars).
- [ ] Copiar `design-system/lib/*.ts` → `lib/` exceto `routePrefetch.ts` e `useScrollRestoration.ts`; comparar `utils.ts` (manter o do app se idêntico).
- [ ] Copiar `design-system/components/ui/*` → `components/ui/` (sobrescrevendo), `components/sidebar/*`, `components/patterns/*`, `components/motion/*` → mesmos caminhos em `components/`. Prefixar `'use client';` em todos os `.tsx` copiados.
- [ ] `components/TopProgressBar.tsx`: versão Next — `usePathname()`; ao mudar, mostra a barra por ~600ms (mesma animação); sem react-query.
- [ ] Remover `design-system` do `exclude` do `tsconfig.json`; mover `design-system/docs/*` e `README.md` para `docs/design-system/`; apagar o restante de `design-system/`.
- [ ] tsc + build; commit `feat(ui): tokens e biblioteca de componentes do design system Legacy Plan`.

### Task 2: Shell (`AppShell` sobre `AppLayout`) + tema

- [ ] `components/ThemeToggle.tsx` (client): lê/grava `localStorage['meet.theme']`, aplica/remove classe `dark` no `<html>`, ícones Sun/Moon; exporta hook `useTheme()` para o Toaster.
- [ ] Reescrever `components/AppShell.tsx`: `AppLayout` com `sections` (nav atual + `showInBottomNav`), `activeKey` por `usePathname`, `onNavigate` → `router.push`, `user` de `/api/me`, `onLogout` atual, `logo` com `next/image` (`/logo-legacy-meet.svg` full, `/favicon.svg` collapsed), `appName="Legacy Meet"`, `headerActions={<ThemeToggle />}`, `title` = rótulo ativo.
- [ ] Script inline no `app/layout.tsx` (antes da hidratação) aplicando a classe `dark` conforme `localStorage` para não piscar.
- [ ] tsc + build; commit `feat(ui): shell com sidebar do design system e tema claro/escuro`.

### Task 3: Login + preloader

- [ ] `app/login/page.tsx` → `LoginPage` do kit (`onLogin`, `onForgotPassword`, `backgroundImageUrl="/Login-bg.svg"`, `title="Legacy Meet"`), gravando `POST_LOGIN_PRELOADER_FLAG` e `window.location.href = '/'`.
- [ ] `components/AppProviders.tsx` (client): monta `<PostLoginPreloader />` + `<Toaster theme={useTheme()} />`; usado em `app/layout.tsx`.
- [ ] tsc + build; commit `feat(ui): login e preloader pós-login do design system`.

### Task 4: Toasts

- [ ] Conferir `components/ui/custom-toast.tsx`: garantir `toast.loading(msg)` retorna id e `toast.dismiss(id)` existe (adicionar delegando ao `sonner` se faltar).
- [ ] Trocar `import toast from 'react-hot-toast'` por `import { toast } from '@/components/ui/custom-toast'` em: `app/admin/usuarios/UsuariosClient.tsx`, `app/agenda/page.tsx`, `app/gravacoes/[id]/RecordingDetail.tsx`, `app/gravacoes/page.tsx`, `app/rooms/[roomName]/PageClientImpl.tsx`; remover `<Toaster />` do react-hot-toast no `app/layout.tsx`.
- [ ] `npx pnpm remove react-hot-toast`; tsc + build; commit `feat(ui): toasts do design system (sonner + custom-toast)`.

### Task 5: Páginas internas

- [ ] Agenda, Gravações (lista/detalhe), NPS, Usuários, Início: `PageHeader` (título/subtítulo atuais), `EmptyState` nos vazios, skeletons do kit no loading, `animate-in-fade` + `stagger-*` nos blocos/cards.
- [ ] tsc + lint + build; commit `feat(ui): padrões de página do design system nas telas internas`.

### Task 6: Verificação final

- [ ] `npx pnpm test`, `npx pnpm exec tsc --noEmit`, lint, `npx pnpm build`; merge na main + push.
