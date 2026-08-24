# Tokens de Design — Legacy Plan

Todas as cores vivem como variáveis HSL sem `hsl()` (ex.: `--primary: 216 63% 30%`) em `tokens/tokens.css`, mapeadas para classes Tailwind via `@theme` (`bg-primary`, `text-muted-foreground`, `border-sidebar-border`, …). Os hex abaixo são aproximações para referência.

## Cores — tema claro (`:root`)

| Token | HSL | Hex aprox. | Uso |
|---|---|---|---|
| `background` | `270 100% 99%` | `#FCF9FF` | fundo da página (branco-lavanda) |
| `foreground` | `221 47% 10%` | `#0E1627` | texto principal |
| `card` | `0 0% 100%` | `#FFFFFF` | fundo de cards |
| `primary` | `216 63% 30%` | `#1C437D` | azul navy — CTAs, links, foco |
| `primary-foreground` | `0 0% 100%` | `#FFFFFF` | texto sobre primary |
| `secondary` / `muted` / `accent` | `210 40% 96%` | `#F1F5F9` | fundos suaves, hover, skeleton |
| `muted-foreground` | `215 16% 47%` | `#64748B` | texto secundário |
| `destructive` | `0 72% 51%` | `#DC2626` | erros, ações destrutivas |
| `success` | `160 100% 37%` | `#00BC7D` | sucesso, confirmações |
| `warning` | `30 100% 44%` | `#E17100` | avisos, atenção |
| `border` / `input` | `220 13% 91%` | `#E5E7EB` | bordas (usadas a 40%: `border-border/40`) |
| `ring` | `216 63% 30%` | `#1C437D` | anel de foco |

## Cores — tema escuro (`.dark`)

| Token | HSL | Hex aprox. | Uso |
|---|---|---|---|
| `background` | `224 71% 3%` | `#02050D` | fundo quase preto azulado |
| `foreground` | `210 40% 98%` | `#F8FAFC` | texto principal |
| `card` / `popover` | `222 47% 11%` | `#0F172A` | superfícies elevadas |
| `primary` | `203 96% 66%` | `#57BCFC` | azul céu vibrante (troca com o navy do claro) |
| `primary-foreground` | `224 71% 3%` | `#02050D` | texto sobre primary |
| `secondary` / `muted` / `accent` | `217 33% 15%` | `#1A2333` | fundos suaves |
| `muted-foreground` | `215 20% 65%` | `#94A3B8` | texto secundário |
| `destructive` | `0 84% 60%` | `#EF4444` | erros |
| `success` | `160 84% 45%` | `#12D394` | sucesso, confirmações |
| `success-foreground` | `224 71% 3%` | `#02050D` | texto sobre success |
| `warning` | `30 100% 55%` | `#FF8C1A` | avisos, atenção |
| `warning-foreground` | `224 71% 3%` | `#02050D` | texto sobre warning |
| `border` | `217 33% 18%` | `#1E293B` | bordas |

**Assinatura da marca:** primary claro = navy `#1C437D`; primary escuro e sidebar-primary (nos dois temas) = azul céu `#57BCFC`.

## Sidebar (dark navy nos DOIS temas)

A sidebar é sempre escura — é a marca visual mais forte do sistema.

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `sidebar-background` | `221 47% 10%` (#0E1627) | `222 84% 5%` (#020817) | fundo |
| `sidebar-foreground` | `210 40% 98%` | idem | texto |
| `sidebar-border` | `218 33% 18%` (~#1F2B3E) | idem | bordas/divisores |
| `sidebar-primary` | `203 96% 66%` (#57BCFC) | idem | item ativo, glow, indicadores |
| `sidebar-accent` | `218 33% 18%` | idem | hover |

## Charts

Claro: `chart-1` navy `#1C437D`, `chart-2` céu `#57BCFC`, `chart-3` verde `#22C55E`, `chart-4` âmbar `#F59E0B`, `chart-5` vermelho `#EF4444`. No escuro, `chart-1`/`chart-2` trocam de lugar (céu `#57BCFC` primeiro).

## Glassmorphism

```css
--glass-bg: rgba(255, 255, 255, 0.55);       /* claro */
--glass-bg-dark: rgba(10, 25, 60, 0.4);      /* escuro (tint azul) */
--glass-border: rgba(255, 255, 255, 0.3);
--glass-border-dark: rgba(255, 255, 255, 0.08);
```

Usados pela utility `glass` (blur 8px). `glass-card` NÃO usa mais vidro/blur — é sólido (`background: hsl(var(--card))`) com sombra `--shadow-card` (ver PATTERNS.md e seção Sombras abaixo); `glass` permanece disponível para quem quiser o efeito translúcido.

## Espaçamento

Ritmo 4/8px do Tailwind. Escala usada de fato no app (derivada de grep nos componentes principais, não a escala completa do Tailwind):

| Classe | px | Uso real no app |
|---|---|---|
| `1` (`gap-1`/`p-1`/`mt-1`) | 4 | `mt-1` no primeiro `SectionHeader` da sidebar da Gestão (sem categoria acima, não precisa do respiro grande) |
| `2` (`gap-2`/`p-2`) | 8 | ícone+texto em blocos compactos (header mobile do `GestaoLayout`: `gap-2.5`/`gap-2`) |
| `3` (`gap-3`/`p-3`) | 12 | **o gap mais comum do app** (100+ ocorrências) — linha ícone+label; ex. `SidebarNavItem.tsx`: `h-11 px-4 gap-3` |
| `4` (`gap-4`/`p-4`/`space-y-4`) | 16 | `space-y-4` em blocos menores dentro de uma seção (ex. `Configuracoes.tsx`); `grid gap-4 md:grid-cols-3` em grids de KPI/cards |
| `5` (`px-5`/`py-5`) | 20 | padding do container principal no mobile: `<main>` do `GestaoLayout` é `px-5 py-5 md:px-10 md:py-10` |
| `6` (`p-6`/`px-6`/`space-y-6`) | 24 | padding padrão do `Card` (`ui/card.tsx`: `CardHeader`/`CardContent`/`CardFooter` em `px-6`, wrapper `py-6`); `space-y-6` é o ritmo vertical padrão do conteúdo de página e de formulários grandes (Login) |
| `8` (`px-8`) | 32 | header desktop do `GestaoLayout`: `pr-8` fixo, `pl-8` com sidebar expandida |
| `9` (`mt-9`) | 36 | `mt-9` separa categorias entre si no `SectionHeader` da `GestaoSidebar` — **sempre margem, nunca padding** (padding infla a caixa; comentário explícito no código-fonte) |
| `10` (`px-10`/`py-10`) | 40 | padding do `<main>` em telas `md:` (ver linha do `5` acima) |
| `12` (`pl-12`) | 48 | header desktop do `GestaoLayout` quando a sidebar está colapsada (`pl-12`) — compensa o botão de expandir que fica fora, colado na borda |

Regra prática: espaçamento entre irmãos do mesmo nível usa `gap-*`/`space-y-*` no container pai; espaçamento que precisa "pular" um elemento sem afetar seu tamanho (como o respiro entre categorias da sidebar) usa margem no próprio elemento, nunca padding.

## Tipografia

- **Fonte única:** Urbanist (Google Fonts), fallback `system-ui, sans-serif`, antialiased.
- **Headings:** `letter-spacing: -0.01em` global; títulos de página `text-2xl/3xl font-extrabold tracking-tight`.
- **Labels de formulário e de seção:** `text-[10px] font-bold uppercase tracking-widest` em `muted-foreground` — mesmo padrão usa o `SectionHeader` da `GestaoSidebar` (`px-4 py-2 mb-1 text-[10px] font-bold uppercase tracking-widest text-sidebar-foreground/70`) e os labels de campo de formulário.
- **Nav da sidebar:** `text-[11px] font-bold uppercase tracking-[0.15em]`.
- **Título do header:** `text-sm font-bold uppercase tracking-widest text-foreground/70` — ex. `GestaoLayout.tsx`, `<h2>{title}</h2>` no header desktop.
- **`text-sm` — corpo denso:** texto de tabelas/listas compactas. `ui/table.tsx` aplica `text-sm` na `<table>` inteira (`caption-bottom text-sm`); é também o tamanho de CTAs pequenos e descrições de toast (`custom-toast.tsx`: título `text-sm font-bold`, corpo `text-xs font-semibold`).
- **`text-base` — corpo normal:** texto de leitura padrão e inputs (`CurrencyInput.tsx`: `text-base` no mobile, reduz para `md:text-sm` no desktop); também usado em subtítulos de card (`CardTitle` em `FinanceiroTab.tsx`: `text-base font-bold`, ex. "MRR — últimos 6 meses").
- **`text-xl` — títulos de seção/subseção:** cabeçalhos de bloco dentro de uma página, não a página inteira — ex. `ClientDREView.tsx` (`text-xl font-bold tracking-tight`, "DRE & Caixa"), `CoAFinancialInput.tsx` (`text-xl font-bold`).
- **`text-2xl` — títulos de página:** o `<h1>`/`<h2>` principal da tela — ex. `TripulacaoList.tsx` e `client/Settings.tsx` (`text-2xl font-bold mb-1`), `ClientRegimentoView.tsx` (`text-2xl font-bold tracking-tight`).
- **Pesos usados:** `font-medium` (texto de apoio), `font-semibold` (nomes/itens, descrições de toast), `font-bold` (labels/CTAs/títulos de seção — o peso mais comum do app), `font-extrabold` (títulos de página maiores, `text-2xl/3xl`).

## Radius

Base `--radius: 0.75rem` (12px). Derivados: `sm` 8px, `md` 10px, `lg` 12px, `xl` 16px, `2xl` 20px. Na prática: cards usam `rounded-[--radius-lg]` (via `glass-card`), botões/inputs `rounded-md`+, itens de nav ativos `rounded-2xl`, avatares `rounded-xl`/`rounded-lg`, card mobile do login `rounded-t-3xl`.

### Mapeamento de radius Figma → tema

A escala de radius deste tema é MAIOR que a escala default do Tailwind (que é a que o plugin do Figma exporta): `--radius` aqui é 12px (`sm` 8, `md` 10, `lg` 12, `xl` 16, `2xl` 20), enquanto no default do Tailwind `lg` = 8px, `xl` = 12px, `2xl` = 16px.

**Regra prática:** ao portar um raio vindo de um export do Figma, ele está na escala DEFAULT — sempre converta para o token equivalente deste tema ou use px explícito (`rounded-[8px]`), nunca copie o nome da classe direto.

Exemplos reais já resolvidos no app:
- `rounded-2xl` do Figma (16px) = `rounded-xl` deste tema.
- `rounded-lg` do Figma (8px) em elementos pequenos = `rounded-[8px]` — não é o `lg` deste tema (12px), que em elementos de `h-26` (26px de altura) já vira meia-pill.

## Sombras

- **Card em repouso:** `--shadow-card: 0 1px 3px rgba(111,111,111,.12), 0 1px 1px rgba(111,111,111,.14), 0 2px 1px -1px rgba(111,111,111,.2)` (escuro: mesmas camadas em `rgba(0,0,0,…)`, mais opaco) — quase plano.
- **Card hover:** `0 4px 12px rgb(0 0 0 / .08)` + borda `primary` a 20% + `translateY(-1px)`.
- **CTA primário:** `shadow-lg shadow-primary/25`, hover `shadow-xl shadow-primary/30`.
- **Sidebar:** `shadow-2xl`.
- **Foco (global):** `0 0 0 2px background, 0 0 0 4px primary/30` (dois anéis).
