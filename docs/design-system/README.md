# Legacy Plan — Design System (starter kit)

Snapshot do estilo visual do **Legacy Plan** (plan.legacyexecutoria.com.br), extraído do repo `bsc-legacy` — última atualização **2026-08-24**. Copie esta pasta para qualquer projeto React + Tailwind v4 e você replica a identidade completa: tokens de cor claro/escuro, fonte Urbanist, componentes ui, tela de login, shell com sidebar dark navy (arquitetura compartilhada), celebração de etapa, preloader pós-login, skeletons, micro-interações, fluidez percebida (prefetch, progress bar, scroll restoration) e animações.

## Conteúdo

```
design-system/
├── tokens/tokens.css          # TODA a identidade: cores, fonte, radius, glass, animações (incl. keyframes mi-* e ::view-transition)
├── lib/
│   ├── utils.ts                # cn() — merge de classes (clsx + tailwind-merge)
│   ├── normalizeForSearch.ts   # normalização/matching de busca (sem acento, sem caixa)
│   ├── parseAmountBR.ts        # parse de valor monetário digitado em pt-BR (vírgula decimal)
│   ├── useMicroFeedback.ts     # useShake, useFlashOnChange, useCrossedGoal
│   ├── useCondensedHeader.ts   # header condensa ao rolar (com histerese anti-flicker)
│   ├── useNumberScrub.ts       # Alt+arrastar ajusta um valor numérico (estilo Figma)
│   ├── useAppReducedMotion.ts  # sinal único de reduced-motion (SO + toggle in-app opcional)
│   ├── useDensity.ts           # densidade confortável/compacta em grids pesados (localStorage)
│   ├── useScrollRestoration.ts # restaura/zera scroll de um container interno por tipo de navegação
│   ├── routePrefetch.ts        # SNIPPET: prefetch de chunk lazy no hover/foco de nav (adapte ao seu router)
│   └── viewTransition.ts       # withViewTransition() + canUseViewTransition() + markRouteVisited() — View Transitions API + fallback
├── assets/
│   ├── Logo-Dark.svg          # wordmark + seta gradiente (marca Legacy Plan)
│   └── Colapsed-logo-dark.svg # só a seta, para o trilho colapsado da sidebar
├── components/
│   └── TopProgressBar.tsx      # barra de progresso global (requer @tanstack/react-query, ou troque por outro sinal de "atividade em voo")
├── components/motion/          # primitivos de micro-interação (framer-motion)
│   ├── NumberTicker.tsx        # número que conta até o valor com easing
│   ├── MorphingActionButton.tsx # botão loading → check verde (+ hook useSuccessMorph)
│   ├── AutosaveIndicator.tsx   # pill "Salvando… / Salvo ✓ / Erro" com retry
│   ├── MiniBurst.tsx           # confete contido num card (sem portal/backdrop)
│   ├── TiltCard.tsx            # tilt 3D sutil + brilho especular seguindo o ponteiro
│   ├── Coachmark.tsx           # balão de dica de uma-vez-só (localStorage + timeout + gesto real)
│   └── FadeInContent.tsx       # crossfade sutil skeleton → conteúdo (150ms, só na entrada)
├── components/ui/              # componentes base (estilo shadcn/ui)
│   ├── tooltip-balao.tsx      # balão com seta e direção (top/right/bottom/left) — mesma linguagem visual do tooltip da sidebar
│   ├── money-input.tsx        # campo de valor monetário com máscara no blur, guarda texto cru
│   ├── custom-toast.tsx       # toast do sistema (success/error/warning/info/loading + toast.undo)
│   ├── select-search-core.tsx # motor de busca compartilhado por select.tsx e searchable-select.tsx
│   ├── tabs.tsx                # Tabs com indicador de fundo deslizante (layoutId compartilhado)
│   ├── scroll-shadow.tsx      # wrapper de scroll horizontal com sombras de borda (mede scrollLeft/scrollWidth)
│   └── copy-button.tsx        # botão de copiar com morph Copy → Check
├── components/sidebar/        # peças compartilhadas da sidebar (usadas por AppLayout.tsx)
│   ├── SidebarNavItem.tsx     # NavItem + NavQueryContext + normalize() + TooltipBalao no colapsado
│   ├── SidebarSearch.tsx      # busca (colapsada = botão-lupa; expandida = input real)
│   ├── SidebarCollapseButton.tsx # botão recolher/expandir (2 estados finais)
│   └── tenantBranding.ts      # cache de logo/nome do tenant em sessionStorage
├── components/patterns/
│   ├── LoginPage.tsx          # tela de login (auth plugável via props)
│   ├── AppLayout.tsx          # sidebar navy + header + bottom nav mobile (importa components/sidebar/)
│   ├── StepCompletedCelebration.tsx # confetes radiais ao concluir uma etapa (title/subtitle plugáveis)
│   ├── PostLoginPreloader.tsx # preloader de marca pós-login (flag em sessionStorage)
│   ├── skeletons.tsx          # PageSkeleton, CardSkeleton, TableSkeleton, StatCardSkeleton
│   ├── EmptyState.tsx         # estado vazio padrão
│   └── PageHeader.tsx         # cabeçalho de página padrão
└── docs/
    ├── TOKENS.md              # paleta com HSL/hex, espaçamento, tipografia, radius, sombras
    └── PATTERNS.md            # sidebar, celebração, preloader, glass-card, micro-interações, micro-copy, convenções de layout
```

### Command palette (padrão, não incluído)

O app original tem um `CommandPalette` (Ctrl/Cmd+K) construído sobre [`cmdk`](https://cmdk.paco.me/) — não entra neste kit porque a lista de comandos é acoplada a rotas e dados de cliente específicos do app (navegação por `react-router`, busca de clientes via Supabase). Para replicar: `npm i cmdk`, monte um `<Command.Dialog>` controlado por um listener global de teclado (`⌘K`/`Ctrl+K`), e alimente os itens com a navegação/dados do SEU app.

## Instalação num projeto novo

1. **Criar o projeto** (se ainda não existe):

```bash
npm create vite@latest meu-app -- --template react-ts
cd meu-app
```

2. **Instalar as dependências:**

```bash
npm i tailwindcss @tailwindcss/vite radix-ui class-variance-authority clsx tailwind-merge lucide-react sonner framer-motion
```

3. **Ativar o Tailwind v4 no `vite.config.ts`:**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
});
```

4. **Copiar esta pasta** para `src/design-system/`.

5. **Importar os tokens** no seu CSS raiz (ex.: `src/index.css`), substituindo o conteúdo padrão do Vite:

```css
@import './design-system/tokens/tokens.css';
```

6. **Adicionar a fonte Urbanist** no `<head>` do `index.html`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Urbanist:ital,wght@0,100..900;1,100..900&display=swap" rel="stylesheet">
```

7. **Dark mode:** adicione/remova a classe `dark` no `<html>` (`document.documentElement.classList.toggle('dark')`). Não há dependência de provider de tema.

## Uso — exemplo mínimo

```tsx
import { useState } from 'react';
import { LayoutDashboard, Users, Settings } from 'lucide-react';
import LoginPage from './design-system/components/patterns/LoginPage';
import AppLayout from './design-system/components/patterns/AppLayout';
import { PageSkeleton } from './design-system/components/patterns/skeletons';
import { PageHeader } from './design-system/components/patterns/PageHeader';

export default function App() {
  const [user, setUser] = useState<{ name: string } | null>(null);
  const [page, setPage] = useState('dashboard');
  const [loading] = useState(false);

  if (!user) {
    return (
      <LoginPage
        onLogin={async (email, _password) => {
          // Plugue sua autenticação aqui; rejeite com Error para exibir a mensagem.
          setUser({ name: email.split('@')[0] });
        }}
        onForgotPassword={async (email) => {
          console.log('reset para', email);
        }}
        backgroundImageUrl="/Login-bg.svg"
      />
    );
  }

  return (
    <AppLayout
      title={page === 'dashboard' ? 'Dashboard' : page === 'usuarios' ? 'Usuários' : 'Ajustes'}
      activeKey={page}
      onNavigate={setPage}
      onLogout={() => setUser(null)}
      user={{ name: user.name, role: 'MASTER' }}
      appName="Meu App"
      sections={[
        {
          items: [
            { key: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={19} />, showInBottomNav: true },
            { key: 'usuarios', label: 'Usuários', icon: <Users size={19} />, showInBottomNav: true },
          ],
        },
        {
          label: 'Sistema',
          items: [
            { key: 'ajustes', label: 'Ajustes', icon: <Settings size={19} />, showInBottomNav: true },
          ],
        },
      ]}
    >
      {loading ? (
        <PageSkeleton />
      ) : (
        <div className="space-y-6 animate-in-fade">
          <PageHeader title="Dashboard" subtitle="Visão geral do sistema" />
          {/* conteúdo */}
        </div>
      )}
    </AppLayout>
  );
}
```

Com roteador (react-router etc.), mapeie `key` → rota dentro de `onNavigate` e derive `activeKey` da rota atual.

## Celebração de etapa (confetes)

```tsx
import { useState } from 'react';
import StepCompletedCelebration from './design-system/components/patterns/StepCompletedCelebration';

function Workflow() {
  const [celebratingStep, setCelebratingStep] = useState<number | null>(null);

  const completeStep = (stepId: number) => {
    // ... persiste a conclusão da etapa ...
    setCelebratingStep(stepId);
  };

  return (
    <>
      {/* ... conteúdo do workflow ... */}
      <StepCompletedCelebration
        stepId={celebratingStep}
        onDone={() => setCelebratingStep(null)}
        // title/subtitle são opcionais — sem eles, usa "Etapa N Concluída!" / "Excelente trabalho 🎉"
      />
    </>
  );
}
```

## Preloader pós-login

```tsx
// pages/Login.tsx — antes do redirect pós-login (idealmente reload completo, não navegação client-side)
import { POST_LOGIN_PRELOADER_FLAG } from '../design-system/components/patterns/PostLoginPreloader';

async function handleLogin() {
  await signIn(email, password);
  try { sessionStorage.setItem(POST_LOGIN_PRELOADER_FLAG, '1'); } catch { /* ignore */ }
  window.location.href = '/';
}
```

```tsx
// main.tsx / App.tsx — montado uma vez no boot, fora de rotas; sem a flag, renderiza null
import PostLoginPreloader from './design-system/components/patterns/PostLoginPreloader';

<PostLoginPreloader />
```

## O que NÃO vem junto (e onde se pluga)

| Do app original | Aqui | Onde plugar |
|---|---|---|
| Supabase Auth | removido | `LoginPage.onLogin` / `onForgotPassword` |
| react-router | removido | `AppLayout.onNavigate` / `activeKey` |
| Notificações, switchers de contexto | removidos | slot `AppLayout.headerActions` |
| ThemeContext | removido | classe `dark` no `<html>`; `Toaster` do sonner recebe `theme` por prop |
| react-query, zustand | não usados | — |

## Toasts

Monte `<Toaster />` (de `components/ui/sonner.tsx`) uma vez no root e dispare com o helper `toast` de `components/ui/custom-toast.tsx` — é ele que dá o visual do Legacy Plan (não use o `toast` cru do sonner):

```tsx
import { Toaster } from './design-system/components/ui/sonner';
import { toast } from './design-system/components/ui/custom-toast';

toast.success('Salvo com sucesso');
toast.error('Algo deu errado');

// Remoção otimista reversível: anel regressivo + único botão "Desfazer".
// onCommit dispara sozinho (mesmo se a tela desmontar) quando o tempo esgota.
toast.undo({
  title: 'Item removido',
  onUndo: () => restoreItem(item),
  onCommit: () => persistRemoval(item.id),
});
```

## Observações

- A imagem de fundo do login (`Login-bg.svg`) **não** foi copiada — forneça a sua via prop (`backgroundImageUrl`).
- `assets/Logo-Dark.svg` e `assets/Colapsed-logo-dark.svg` SÃO a marca Legacy Plan (wordmark "Legacy Plan" + seta gradiente azul, usados por `AppLayout.logo` e como fallback dentro de `PostLoginPreloader.tsx`) — em outro produto, substitua os dois arquivos e o SVG embutido no preloader pelos seus.
- Origem do snapshot: repo `bsc-legacy`, última atualização **2026-08-24** — docs: espaçamento e tipografia derivados dos usos reais em `TOKENS.md`; seções de micro-copy, descoberta (Ctrl+K/coachmark), desfazer (`toast.undo`/`pendingDelete`), densidade, dark elevation, tema suave e "Fluidez percebida" em `PATTERNS.md`. Snapshot de código em si também é de **2026-08-24** (plano de fluidez percebida): `TopProgressBar.tsx`, `motion/FadeInContent.tsx`, `ui/scroll-shadow.tsx`, `ui/copy-button.tsx`, `lib/useScrollRestoration.ts`, `lib/routePrefetch.ts` (snippet), `lib/viewTransition.ts` ganhou `markRouteVisited()`, keyframes `mi-shake`/`mi-copy-check`/`mi-progress-slide`/`mi-collapse-row-in` em `tokens.css` — além do snapshot anterior de **2026-08-23** (polimento UX): `select-search-core.tsx` (motor de busca único de `select.tsx`/`searchable-select.tsx`), `Coachmark.tsx`, `lib/useAppReducedMotion.ts`, `lib/useDensity.ts`, `canUseViewTransition()`, tokens dark de `--popover`/`--accent` mais claros que `--card` + sombra reforçada de dialog/popover/dropdown, crossfade de tema (`mi-theme-fade-*`/`.theme-switching`) — além das micro-interações anteriores (`components/motion/`, hooks `useMicroFeedback`/`useCondensedHeader`/`useNumberScrub`, `toast.undo`, tabs com indicador deslizante, de **2026-08-21**). Mudanças posteriores no app não se propagam para cá.
- Detalhes de cor/espaçamento/tipografia em [docs/TOKENS.md](docs/TOKENS.md); animações, convenções e micro-copy em [docs/PATTERNS.md](docs/PATTERNS.md).
