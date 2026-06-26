# Design System Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install and wire Tailwind v4 + shadcn/ui (new-york, slate, CSS variables) so the Legacy Plan design tokens and Urbanist font are available across legacy-meet without touching any page.

**Architecture:** Prepend the token CSS to `styles/globals.css` (keeping LiveKit CSS below), copy shadcn components directly into `components/ui/`, add `lib/utils.ts`, and wire the Urbanist font via `next/font/google` in `app/layout.tsx`. No page-level restyling — this task only installs the system.

**Tech Stack:** Next.js 15, Tailwind CSS v4 (`@tailwindcss/postcss`), shadcn/ui new-york style, radix-ui ^1.4, class-variance-authority ^0.7, tailwind-merge ^3.5, clsx ^2.1, lucide-react ^0.564, Urbanist via next/font/google.

## Global Constraints

- Package manager: `corepack pnpm` — NEVER use npm or yarn.
- Branch: `feat/design-legacy-plan` — stay on it.
- CSS file: `styles/globals.css` — prepend tokens to top, leave existing LiveKit CSS untouched below.
- Import order in `app/layout.tsx`: `styles/globals.css` FIRST, then `@livekit/components-styles` — do NOT reorder.
- Keep `react-hot-toast` / `<Toaster>` — do NOT add sonner.
- Keep `data-lk-theme="default"` on `<body>`.
- TS path alias `@/*` maps to `./*` (already set in tsconfig).
- Do NOT copy: sonner.tsx, custom-toast.tsx, digit-only-number-input.tsx, searchable-select.tsx, @xyflow import in index.css.
- Do NOT install: framer-motion, recharts, @xyflow.
- Dep major versions to match bsc-legacy: radix-ui ^1, class-variance-authority ^0.7, tailwind-merge ^3, clsx ^2, lucide-react ^0.564.

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json` (via pnpm add)
- Modify: `pnpm-lock.yaml` (auto-updated)

**Interfaces:**
- Produces: `tailwindcss`, `@tailwindcss/postcss`, `radix-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react` available in node_modules.

- [ ] **Step 1: Install all required deps**

```powershell
corepack pnpm add tailwindcss @tailwindcss/postcss radix-ui class-variance-authority clsx tailwind-merge lucide-react
```

Expected output: something like `+ tailwindcss 4.x.x`, `+ radix-ui 1.x.x`, etc. No error.

- [ ] **Step 2: Verify they appear in package.json**

```powershell
(Get-Content package.json | Select-String "tailwindcss|radix-ui|class-variance|clsx|tailwind-merge|lucide-react")
```

Expected: each dep visible in dependencies or devDependencies.

- [ ] **Step 3: Commit**

```powershell
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): add tailwind v4 + shadcn/ui base deps"
```

---

### Task 2: PostCSS config

**Files:**
- Create: `postcss.config.mjs`

**Interfaces:**
- Produces: PostCSS configured to use `@tailwindcss/postcss` so Next.js processes Tailwind v4 directives.

- [ ] **Step 1: Check if postcss.config already exists**

```powershell
Test-Path postcss.config.mjs; Test-Path postcss.config.js; Test-Path postcss.config.cjs
```

Expected: all three `False` (no existing config).

- [ ] **Step 2: Create postcss.config.mjs**

Create file at `C:/Users/JoaoGaspar/Documents/Projetos/legacy-meet/postcss.config.mjs`:

```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

- [ ] **Step 3: Commit**

```powershell
git add postcss.config.mjs
git commit -m "feat(build): add postcss config for tailwind v4"
```

---

### Task 3: lib/utils.ts

**Files:**
- Create: `lib/utils.ts`

**Interfaces:**
- Produces: `cn(...inputs: ClassValue[]): string` — exported from `@/lib/utils`.
- Consumes: `clsx` and `tailwind-merge` (installed in Task 1).

- [ ] **Step 1: Check if lib/utils.ts already exists**

```powershell
Test-Path lib/utils.ts
```

Expected: `False` (does not exist; lib/ dir has other files like supabase helpers).

- [ ] **Step 2: Create lib/utils.ts**

Create file at `C:/Users/JoaoGaspar/Documents/Projetos/legacy-meet/lib/utils.ts`:

```ts
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 3: Commit**

```powershell
git add lib/utils.ts
git commit -m "feat(lib): add cn() utility from shadcn"
```

---

### Task 4: components.json

**Files:**
- Create: `components.json`

**Interfaces:**
- Produces: shadcn/ui config pointing to `styles/globals.css`, aliases matching `@/`, new-york style.

- [ ] **Step 1: Create components.json**

Create file at `C:/Users/JoaoGaspar/Documents/Projetos/legacy-meet/components.json`:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "styles/globals.css",
    "baseColor": "slate",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

Note: `rsc: true` because this is Next.js App Router (bsc-legacy uses `false` because it's Vite).

- [ ] **Step 2: Commit**

```powershell
git add components.json
git commit -m "feat(config): add components.json for shadcn new-york"
```

---

### Task 5: CSS tokens in styles/globals.css

**Files:**
- Modify: `styles/globals.css` — prepend Tailwind imports and token blocks above existing content.

**Interfaces:**
- Produces: `--color-*`, `--radius-*`, `--font-sans` CSS custom properties available globally; `:root` HSL token values set; `@layer base` sets border defaults and Urbanist font.

**Critical:** Do NOT remove any existing LiveKit CSS. Do NOT set `background`/`color` on body (that would fight the LiveKit dark theme). The `@layer base` block must only set `border-color` default and `font-family`.

- [ ] **Step 1: Read current styles/globals.css to know its full content**

The current file starts at line 1 with `* { box-sizing: border-box; }` and contains LiveKit theme overrides, prejoin styles, control-bar media queries, chat CSS. All of this must remain.

- [ ] **Step 2: Prepend token blocks to styles/globals.css**

The file at `C:/Users/JoaoGaspar/Documents/Projetos/legacy-meet/styles/globals.css` should become (existing content appended after — shown abbreviated):

```css
/* ─── Tailwind v4 + design tokens (Legacy Plan) ─────────────────────────── */
@import "tailwindcss";

@theme {
  --color-background: hsl(var(--background));
  --color-foreground: hsl(var(--foreground));
  --color-card: hsl(var(--card));
  --color-card-foreground: hsl(var(--card-foreground));
  --color-popover: hsl(var(--popover));
  --color-popover-foreground: hsl(var(--popover-foreground));
  --color-primary: hsl(var(--primary));
  --color-primary-foreground: hsl(var(--primary-foreground));
  --color-secondary: hsl(var(--secondary));
  --color-secondary-foreground: hsl(var(--secondary-foreground));
  --color-muted: hsl(var(--muted));
  --color-muted-foreground: hsl(var(--muted-foreground));
  --color-accent: hsl(var(--accent));
  --color-accent-foreground: hsl(var(--accent-foreground));
  --color-destructive: hsl(var(--destructive));
  --color-destructive-foreground: hsl(var(--destructive-foreground));
  --color-border: hsl(var(--border));
  --color-input: hsl(var(--input));
  --color-ring: hsl(var(--ring));

  --color-sidebar-background: hsl(var(--sidebar-background));
  --color-sidebar-foreground: hsl(var(--sidebar-foreground));
  --color-sidebar-border: hsl(var(--sidebar-border));
  --color-sidebar-accent: hsl(var(--sidebar-accent));
  --color-sidebar-accent-foreground: hsl(var(--sidebar-accent-foreground));
  --color-sidebar-primary: hsl(var(--sidebar-primary));
  --color-sidebar-primary-foreground: hsl(var(--sidebar-primary-foreground));
  --color-sidebar-ring: hsl(var(--sidebar-ring));

  --color-chart-1: hsl(var(--chart-1));
  --color-chart-2: hsl(var(--chart-2));
  --color-chart-3: hsl(var(--chart-3));
  --color-chart-4: hsl(var(--chart-4));
  --color-chart-5: hsl(var(--chart-5));

  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --radius-2xl: calc(var(--radius) + 8px);

  --font-sans: "Urbanist", sans-serif;
}

@variant dark (&:where(.dark, .dark *));

:root {
  --background: 0 0% 100%;
  --foreground: 222 47% 11%;
  --card: 0 0% 100%;
  --card-foreground: 222 47% 11%;
  --popover: 0 0% 100%;
  --popover-foreground: 222 47% 11%;
  --primary: 216 63% 30%;
  --primary-foreground: 0 0% 100%;
  --secondary: 210 40% 96%;
  --secondary-foreground: 222 47% 11%;
  --muted: 210 40% 96%;
  --muted-foreground: 215 16% 47%;
  --accent: 210 40% 96%;
  --accent-foreground: 222 47% 11%;
  --destructive: 0 72% 51%;
  --destructive-foreground: 0 0% 100%;
  --border: 220 13% 91%;
  --input: 220 13% 91%;
  --ring: 216 63% 30%;
  --radius: 0.75rem;

  --sidebar-background: 222 47% 11%;
  --sidebar-foreground: 210 40% 98%;
  --sidebar-border: 218 33% 18%;
  --sidebar-accent: 218 33% 18%;
  --sidebar-accent-foreground: 210 40% 98%;
  --sidebar-primary: 201 98% 54%;
  --sidebar-primary-foreground: 0 0% 100%;
  --sidebar-ring: 201 98% 54%;

  --chart-1: 216 63% 30%;
  --chart-2: 201 98% 54%;
  --chart-3: 142 71% 45%;
  --chart-4: 38 92% 50%;
  --chart-5: 0 84% 60%;

  /* Glassmorphism Tokens - Premium Blue Tint */
  --glass-bg: rgba(255, 255, 255, 0.55);
  --glass-bg-dark: rgba(10, 25, 60, 0.4);
  --glass-border: rgba(255, 255, 255, 0.3);
  --glass-border-dark: rgba(255, 255, 255, 0.08);
}

.dark {
  --background: 224 71% 3%;
  --foreground: 210 40% 98%;
  --card: 222 47% 11%;
  --card-foreground: 210 40% 98%;
  --popover: 222 47% 11%;
  --popover-foreground: 210 40% 98%;
  --primary: 201 98% 54%;
  --primary-foreground: 224 71% 3%;
  --secondary: 217 33% 15%;
  --secondary-foreground: 210 40% 98%;
  --muted: 217 33% 15%;
  --muted-foreground: 215 20% 65%;
  --accent: 217 33% 15%;
  --accent-foreground: 210 40% 98%;
  --destructive: 0 84% 60%;
  --destructive-foreground: 0 0% 100%;
  --border: 217 33% 18%;
  --input: 217 33% 15%;
  --ring: 201 98% 54%;

  --sidebar-background: 222 84% 5%;
  --sidebar-foreground: 210 40% 98%;
  --sidebar-border: 218 33% 18%;
  --sidebar-accent: 218 33% 18%;
  --sidebar-accent-foreground: 210 40% 98%;
  --sidebar-primary: 201 98% 54%;
  --sidebar-primary-foreground: 222 84% 5%;
  --sidebar-ring: 201 98% 54%;

  --chart-1: 201 98% 54%;
  --chart-2: 216 63% 30%;
  --chart-3: 142 71% 45%;
  --chart-4: 38 92% 50%;
  --chart-5: 0 84% 60%;
}

@layer base {
  * {
    @apply border-border/40;
  }
  body {
    font-family: var(--font-sans, 'Urbanist', system-ui, sans-serif);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    /* NOTE: NO bg-background / text-foreground here — would fight LiveKit dark theme */
  }
}

/* ─── Existing Meet / LiveKit CSS below — do NOT modify ─────────────────── */
* {
  box-sizing: border-box;
}
/* ... rest of existing globals.css content ... */
```

The actual implementation must use the Write tool to set the FULL file: all new token CSS prepended, then the entire existing content (239 lines) appended below.

- [ ] **Step 3: Verify file structure**

```powershell
(Get-Content styles/globals.css -TotalCount 5)
```

Expected: first line is a comment `/* ─── Tailwind v4 ...` and second line is `@import "tailwindcss";`.

- [ ] **Step 4: Commit**

```powershell
git add styles/globals.css
git commit -m "feat(styles): prepend Tailwind v4 tokens + Legacy Plan design tokens"
```

---

### Task 6: Copy shadcn/ui components

**Files:**
- Create: `components/ui/button.tsx`
- Create: `components/ui/card.tsx`
- Create: `components/ui/input.tsx`
- Create: `components/ui/label.tsx`
- Create: `components/ui/badge.tsx`
- Create: `components/ui/select.tsx`
- Create: `components/ui/textarea.tsx`
- Create: `components/ui/tabs.tsx`
- Create: `components/ui/table.tsx`
- Create: `components/ui/avatar.tsx`
- Create: `components/ui/separator.tsx`
- Create: `components/ui/skeleton.tsx`
- Create: `components/ui/dialog.tsx`
- Create: `components/ui/dropdown-menu.tsx`
- Create: `components/ui/switch.tsx`
- Create: `components/ui/checkbox.tsx`
- Create: `components/ui/tooltip.tsx`
- Create: `components/ui/scroll-area.tsx`

**Interfaces:**
- Consumes: `radix-ui`, `class-variance-authority`, `lucide-react`, `@/lib/utils` (Task 3).
- Produces: all listed components importable as `@/components/ui/<name>`.

Note: The dialog component imports `@/components/ui/button` — copy button first or copy all at once; there are no circular deps.

- [ ] **Step 1: Create components/ui directory if needed**

```powershell
if (-not (Test-Path components/ui)) { New-Item -ItemType Directory -Path components/ui }
```

- [ ] **Step 2: Copy each component file from bsc-legacy**

Copy the following files verbatim from `C:/Users/JOAOGA~1/AppData/Local/Temp/claude/c--Users-JoaoGaspar-Documents-Projetos-legacy-meet/e454ef69-b1c7-47b4-8798-686e6be7b9d6/scratchpad/bsc-legacy/components/ui/` to `C:/Users/JoaoGaspar/Documents/Projetos/legacy-meet/components/ui/`:

- `button.tsx` → `components/ui/button.tsx`
- `card.tsx` → `components/ui/card.tsx`
- `input.tsx` → `components/ui/input.tsx`
- `label.tsx` → `components/ui/label.tsx`
- `badge.tsx` → `components/ui/badge.tsx`
- `select.tsx` → `components/ui/select.tsx`
- `textarea.tsx` → `components/ui/textarea.tsx`
- `tabs.tsx` → `components/ui/tabs.tsx`
- `table.tsx` → `components/ui/table.tsx`
- `avatar.tsx` → `components/ui/avatar.tsx`
- `separator.tsx` → `components/ui/separator.tsx`
- `skeleton.tsx` → `components/ui/skeleton.tsx`
- `dialog.tsx` → `components/ui/dialog.tsx`
- `dropdown-menu.tsx` → `components/ui/dropdown-menu.tsx`
- `switch.tsx` → `components/ui/switch.tsx`
- `checkbox.tsx` → `components/ui/checkbox.tsx`
- `tooltip.tsx` → `components/ui/tooltip.tsx`
- `scroll-area.tsx` → `components/ui/scroll-area.tsx`

Use PowerShell Copy-Item for each, or Read+Write for each file. Do NOT copy: sonner.tsx, custom-toast.tsx, searchable-select.tsx, digit-only-number-input.tsx, collapsible.tsx, popover.tsx, sheet.tsx, progress.tsx, alert-dialog.tsx (not required by spec).

- [ ] **Step 3: Verify 18 files exist**

```powershell
(Get-ChildItem components/ui/*.tsx).Count
```

Expected: 18

- [ ] **Step 4: Commit**

```powershell
git add components/ui/
git commit -m "feat(ui): copy shadcn new-york components from Legacy Plan"
```

---

### Task 7: Urbanist font in app/layout.tsx

**Files:**
- Modify: `app/layout.tsx`

**Interfaces:**
- Consumes: `next/font/google` (built into Next.js 15).
- Produces: Urbanist loaded via `next/font`, its CSS variable `--font-urbanist` set on `<html>`, body also gets `urbanist.className` for non-variable fallback. `--font-sans` in `@theme` references `Urbanist` (already set in Task 5).

- [ ] **Step 1: Read current app/layout.tsx**

Current content (already known):
```tsx
import '../styles/globals.css';
import '@livekit/components-styles';
import '@livekit/components-styles/prefabs';
import type { Metadata, Viewport } from 'next';
import { Toaster } from 'react-hot-toast';

export const metadata: Metadata = { ... };
export const viewport: Viewport = { themeColor: '#1D3A5D' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body data-lk-theme="default">
        <Toaster />
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Add Urbanist font import and apply to layout**

The updated `app/layout.tsx`:

```tsx
import '../styles/globals.css';
import '@livekit/components-styles';
import '@livekit/components-styles/prefabs';
import type { Metadata, Viewport } from 'next';
import { Toaster } from 'react-hot-toast';
import { Urbanist } from 'next/font/google';

const urbanist = Urbanist({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-urbanist',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Legacy Meet | Videoconferência da Legacy',
    template: '%s',
  },
  description: 'Aplicativo de videoconferência da Legacy.',
  openGraph: {
    siteName: 'Legacy Meet',
  },
};

export const viewport: Viewport = {
  themeColor: '#1D3A5D',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={urbanist.variable}>
      <body data-lk-theme="default" className={urbanist.className}>
        <Toaster />
        {children}
      </body>
    </html>
  );
}
```

Note: `urbanist.variable` on `<html>` sets `--font-urbanist` CSS var. `urbanist.className` on `<body>` directly applies the font class. Both are needed so the `--font-sans: "Urbanist"` in the `@theme` block resolves correctly AND the body itself uses Urbanist.

- [ ] **Step 3: Commit**

```powershell
git add app/layout.tsx
git commit -m "feat(font): add Urbanist via next/font with CSS variable"
```

---

### Task 8: Build verification and final commit

**Files:**
- No new files created. Verify existing work compiles.

**Interfaces:**
- Produces: a clean `pnpm build` exit 0, tsc --noEmit exit 0.

- [ ] **Step 1: Clean .next cache**

```powershell
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
```

- [ ] **Step 2: Run build**

```powershell
corepack pnpm build
```

Expected: exits 0. Common failures and fixes:
- **"Cannot find module 'tailwindcss'"** → re-run `corepack pnpm add tailwindcss @tailwindcss/postcss` (Task 1 may have been skipped).
- **"Module not found: Can't resolve 'radix-ui'"** → re-run `corepack pnpm add radix-ui`.
- **"Module not found: Can't resolve 'class-variance-authority'"** → re-run `corepack pnpm add class-variance-authority`.
- **"Circular reference" or missing UI file** → a copied component references another component not in the 18 (e.g. popover.tsx). Either copy the missing file or remove the import from the component that references it.
- **PostCSS plugin error about "@tailwindcss/postcss"** → verify `postcss.config.mjs` exists and uses the exact key `"@tailwindcss/postcss"`.
- **`@apply` error on `border-border/40`** → this means the `--color-border` token wasn't loaded. Verify Task 5 CSS is at the very top of globals.css before any `@layer` blocks.

- [ ] **Step 3: Run tsc**

```powershell
corepack pnpm exec tsc --noEmit
```

Expected: exits 0 with no output. If it errors:
- **"Cannot find module '@/lib/utils'"** → verify `lib/utils.ts` exists (Task 3).
- **"Property 'variable' does not exist"** → this would be a Next.js types issue; unlikely with Urbanist from next/font/google.

- [ ] **Step 4: Create final feature commit**

```powershell
git add -A
git commit -m "feat(design): base do design system (Tailwind v4 + shadcn + tokens Legacy Plan + Urbanist)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- [x] Task 1: deps installed (tailwindcss, @tailwindcss/postcss, radix-ui, cva, clsx, tailwind-merge, lucide-react)
- [x] Task 2: PostCSS config with @tailwindcss/postcss
- [x] Task 3: lib/utils.ts with cn()
- [x] Task 4: components.json adjusted for this repo (css: styles/globals.css, rsc: true)
- [x] Task 5: tokens prepended to globals.css — @import, @theme, @variant dark, :root, .dark, @layer base (without bg/color on body)
- [x] Task 6: 18 UI components copied
- [x] Task 7: Urbanist font via next/font/google
- [x] Task 8: Build verification
- [x] Do-not-copy list respected: sonner.tsx, custom-toast.tsx, @xyflow import
- [x] LiveKit CSS preserved
- [x] react-hot-toast kept

**Type consistency:** `cn` function exported from `lib/utils.ts` and imported in all UI components as `import { cn } from "@/lib/utils"` — consistent across all tasks.

**LiveKit risk noted:** Tailwind's preflight resets `box-sizing`, margins, and font. The `@layer base` in this plan deliberately omits `bg-background`/`text-foreground` on body to avoid fighting the LiveKit dark theme. However, preflight itself sets `box-sizing: border-box` on `*` — this duplicates the existing `* { box-sizing: border-box; }` in Meet CSS, which is harmless. The `border-border/40` rule on `*` in `@layer base` sets `border-color` globally; this could theoretically affect LiveKit borders. A visual check of the prejoin screen and in-call UI is recommended after this task.
