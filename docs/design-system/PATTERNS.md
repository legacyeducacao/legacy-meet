# Padrões e Animações — Legacy Plan

## Animações CSS (em tokens.css)

| Classe | Efeito | Quando usar |
|---|---|---|
| `animate-in-fade` | fadeInUp 0.6s `cubic-bezier(0.22, 1, 0.36, 1)` (sobe 20px) | entrada de qualquer bloco de página |
| `stagger-1` … `stagger-4` | delays de 100–400ms | listas/grids: cada filho com um stagger |
| `animate-slide-up` | sobe de baixo 0.3s ease-out | sheets, toasts, elementos ancorados embaixo |

```tsx
<div className="grid gap-4 md:grid-cols-3">
  <Card className="animate-in-fade stagger-1">…</Card>
  <Card className="animate-in-fade stagger-2">…</Card>
  <Card className="animate-in-fade stagger-3">…</Card>
</div>
```

`prefers-reduced-motion` e a classe `.reduce-motion` desligam tudo automaticamente.

## Animações framer-motion (convenções)

- **Entrada de página/painel:** `initial={{ opacity: 0, y: 20 }}` → `animate={{ opacity: 1, y: 0 }}`, `transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}` — o MESMO easing da `animate-in-fade`.
- **Sidebar:** entrada `x: -280 → 0`; colapso animando `width` 240 ↔ 104 (trilho colapsado fiel ao Figma), tween 0.3s `[0.4, 0, 0.2, 1]`. O toggle de colapso é uma abinha presa à borda direita do header do logo — não é mais um item "Recolher/Expandir" no rodapé. Estilo condicional por `isCollapsed`: expandido, flush na borda (`right-0`, `h-[26px] w-6`, `rounded-tl-lg rounded-bl-lg`, `bg-sidebar-primary/10`); colapsado, abinha de `w-[33px]` a 33px da borda no header branco (`left-full ml-[33px]`, `rounded-tl-lg rounded-bl-lg`, `bg-foreground/[0.16] text-foreground/70`) — chevron escuro sobre o header branco, não o mesmo fundo translúcido do modo expandido.
- **Busca da sidebar:** campo abaixo do header do logo (`bg-white/[0.06]`, ícone `Search`, placeholder "Buscar") que FILTRA os itens de navegação por label (normalizado, sem acento) — não é decorativo. No modo colapsado vira uma caixa quadrada de 56px (`w-14 h-14 rounded-xl bg-white/[0.06]`) que expande a sidebar ao clicar. Seções sem nenhum item correspondente somem inteiras (cabeçalho incluso).
- **Espaçamento entre categorias:** o gap acima do rótulo de cada seção (`pt-5 pb-2 px-4` no cabeçalho estático) é o que dá o respiro entre grupos — não usar `space-y` no container pai para isso, senão o espaçamento fica igual entre item e categoria.
- **Itens de nav:** container com `staggerChildren: 0.05`; itens `{opacity: 0, x: -15} → {opacity: 1, x: 0}` com spring `damping: 20, stiffness: 100`; hover `x: 4`; tap `scale: 0.98`. Colapsados, viram quadrado 52×52 (`w-[52px] h-[52px]`, ícone centrado).
- **Item ativo:** pill `rounded-xl` (16px) + `bg-sidebar-primary/10` com borda esquerda REAL no próprio elemento (`border-l-[1.3px] border-sidebar-primary`, curva junto com o canto arredondado) — não é mais um `motion.div` absoluto reto sobreposto; item inativo `text-sidebar-foreground/70`.
- **Mensagens de erro/aviso:** `{opacity: 0, y: -8} → {opacity: 1, y: 0}`.

## Sidebar (arquitetura compartilhada)

A sidebar vive em `components/sidebar/` (`SidebarNavItem.tsx`, `SidebarSearch.tsx`, `SidebarCollapseButton.tsx`, `tenantBranding.ts`) e é consumida por `patterns/AppLayout.tsx` — extraia esses mesmos módulos se seu projeto tiver mais de uma sidebar (ex.: um shell "staff" e um shell "tenant") para não duplicar ~200 linhas entre eles.

- **Item ativo:** pill `rounded-xl` + `bg-sidebar-primary/10`, borda esquerda REAL `border-l-[1.3px] border-sidebar-primary` (curva junto com o canto arredondado, não é mais um `motion.div` absoluto sobreposto). Item inativo: `text-sidebar-foreground/70`.
- **Busca (`SidebarSearch`):** filtra os `NavItem` via `NavQueryContext` (contexto module-level em `SidebarNavItem.tsx`) — envolva a lista de itens em `<NavQueryContext.Provider value={navQuery}>` para ativar; cada item compara seu label ao termo com `normalize()` (NFD, acento-insensível). Sem provider, o contexto vale `''` (sem filtro) — é assim que `AppLayout.tsx` usa: ele já filtra os itens ANTES de renderizar (`visibleSections`), então não precisa do provider.
- **Colapsado (104px de trilho):** itens viram quadrado `w-[52px] h-[52px]`; busca vira botão `w-14 h-14`; tooltip ao lado usa `ui/tooltip-balao.tsx` (ver seção própria abaixo).

## TooltipBalao

`ui/tooltip-balao.tsx` — balão de dica com seta apontando na direção do gatilho (`side`: `top`/`right`/`bottom`/`left`), o MESMO visual do tooltip colapsado da sidebar: bolha `bg-sidebar-primary`, texto branco, seta SVG (não é o `Tooltip` genérico do Radix com `Arrow` — usa `hideArrow` no `TooltipContent` + a seta própria embutida), animada com Framer Motion (`AnimatePresence` + `motion.div`) dentro de um portal Radix (`forceMount`, já que o Radix desmontaria o conteúdo antes da animação de saída rodar). Nasceu dentro do `SidebarNavItem` (sempre `side="right"`) e foi extraído quando uma segunda tela — as abas DRE/DFC do Dashboard Financeiro — precisou do mesmo balão apontando para baixo: duplicar significaria duas setas, duas animações e dois azuis para manter em sincronia. A prop `align` (`start`/`center`/`end`) controla onde o balão encosta no gatilho — `center` (padrão) espalha para os dois lados, o que pode invadir um vizinho estreito (foi o que aconteceu com a dica das abas sobre a sidebar); `start` alinha as bordas iniciais e cresce só para dentro do conteúdo. Uso: `<TooltipBalao label="Texto" side="right"><button>...</button></TooltipBalao>` — o `children` é o gatilho, recebido via `asChild` do Radix.
- **Botão recolher/expandir (`SidebarCollapseButton`):** dois estados finais — expandido, meia-pill flush na borda direita do header do logo (`right-0`, `h-[26px] w-6`, `rounded-tl-[8px] rounded-bl-[8px]`, `bg-sidebar-primary/10 text-sidebar-primary`); colapsado, pill espelhada colada por FORA da sidebar (`left-full`, `rounded-tr-[8px] rounded-br-[8px]`, `bg-foreground/[0.16] text-foreground`) — chevron escuro sobre o header branco do main content, não o mesmo fundo translúcido do modo expandido. `position: absolute`, precisa de um pai `relative` (o header da logo já é).
- **Gap entre categorias:** o app tem hoje duas convenções — `AppLayout.tsx`/`Layout.tsx` (Plan) usam cabeçalho `pt-5 pb-2 px-4` dentro do fluxo (some junto com a seção quando filtrada); o padrão mais novo (`GestaoSidebar.tsx`, Onda D) usa `SectionHeader` sempre visível com `mt-9`/`mt-1` (margem, nunca padding — padding infla a caixa) e todas as categorias sempre abertas. Escolha uma convenção por projeto e mantenha consistente.
- **Headers desktop:** brancos sólidos `bg-card border-b border-foreground/10`, sem blur; deslocam `pl-12` quando a sidebar está colapsada (`pl-8` expandida) — compensa o botão de expandir que fica por fora, colado na borda.

## Celebração de etapa (confetes)

`patterns/StepCompletedCelebration.tsx` — overlay fullscreen (`z-[9998]`, `pointer-events-none`) com confetes radiais em duas fases (estouro rápido até 75% do raio, depois deriva com leve queda gravitacional), backdrop `bg-background/30 backdrop-blur-[6px]`, mensagem central com ícone `PartyPopper`. Auto-dismiss em 2,8s via `onDone` (guardado em ref para não rearmar o timeout a cada re-render do pai). Portal em `document.body`; respeita `prefers-reduced-motion` (mostra só a mensagem, sem partículas).

Use para fechar um passo de um wizard/workflow multi-etapas — não para toda ação de sucesso (isso é o `toast.success`). Props `title`/`subtitle` generalizam o texto (default `Etapa ${stepId} Concluída!` / "Excelente trabalho 🎉"):

```tsx
const [celebratingStep, setCelebratingStep] = useState<number | null>(null);
// ao concluir um passo: setCelebratingStep(stepId)
<StepCompletedCelebration stepId={celebratingStep} onDone={() => setCelebratingStep(null)} />
```

## Preloader pós-login

`patterns/PostLoginPreloader.tsx` — overlay de marca (logo com preenchimento líquido animado em SVG) exibido só na primeira renderização após o login, via flag em `sessionStorage`. Mecânica:

1. Na tela de login, ANTES do redirect (idealmente um `window.location.href` de reload completo, não navegação client-side), grave a flag: `sessionStorage.setItem(POST_LOGIN_PRELOADER_FLAG, '1')`.
2. Monte `<PostLoginPreloader />` uma vez no boot do app (fora de rotas). No mount, ele lê a flag, remove-a (efeito único) e decide o `phase` inicial (`'show'` se achou a flag, `'hidden'` caso contrário).
3. Timeline: `SHOW_MS` (2200ms) exibindo → `EXIT_MS` (1300ms) de animação de saída (símbolo cresce 34x e "engole" a tela) → desmonta.

Sem a flag, o componente renderiza `null` e não custa nada — seguro montar sempre.

## glass-card

Todos os `<Card>` já recebem `glass-card` automaticamente via `[data-slot="card"]` no tokens.css: fundo sólido `card` (sem vidro/blur), borda `border`, radius `--radius-lg` (12px), sombra `--shadow-card` e no hover eleva 1px com borda azulada. Para aplicar a mesma elevação em outra superfície, use a classe `glass-card` direto; para vidro translúcido com blur, use `glass` (utility separada, não usada mais pelo `glass-card`).

## Skeleton loading

Regra do produto: **no load, mostre o skeleton da estrutura — nunca um empty state**. O empty state (`EmptyState`) só aparece quando o load terminou e realmente não há dados.

- Base: `<Skeleton />` (`animate-pulse rounded-md bg-accent`).
- Composições prontas em `patterns/skeletons.tsx`: `PageSkeleton` (header + 3 stat cards + card, com stagger), `TableSkeleton`, `CardSkeleton`, `StatCardSkeleton`.
- Padrões comuns no app: lista = 5× `Skeleton h-12 w-full`; tabela = linhas `h-6 w-full` dentro de `TableRow`; gráfico = `Skeleton h-[240px] w-full`.

## Convenções de layout

- **Espaçamento de página:** o `AppLayout` já aplica `px-5 pt-5 md:px-10 md:pt-10`; dentro da página use `space-y-6`.
- **Cabeçalho:** `PageHeader` (título `text-2xl font-extrabold tracking-tight` + subtítulo muted + ações à direita).
- **Header desktop (`AppLayout`):** branco sólido `bg-card`, borda inferior `border-foreground/10` — sem blur/transparência (o glassmorphism foi removido do header).
- **Grids de KPI:** `grid gap-4 md:grid-cols-3` (ou 2/4/6 conforme densidade).
- **Bordas:** o reset global aplica `border-border/40` — bordas são sempre suaves.
- **Scrollbar:** fina (6px), thumb `muted-foreground/20`; use `.no-scrollbar` para carrosséis horizontais.

## Hierarquia de botões

- **Primário** (1 por tela): `<Button>` padrão; em CTAs grandes adicione `size="lg" className="h-12 font-bold uppercase tracking-wide text-sm shadow-lg shadow-primary/25"`.
- **Secundário:** `variant="outline"`.
- **Terciário/navegação:** `variant="ghost"`.
- **Destrutivo:** `variant="destructive"` SEMPRE atrás de confirmação via `AlertDialog` — nunca `window.confirm`/`alert`/`prompt` nativos (use `AlertDialog` + `Input`/`Textarea` em modal).

## Formulários

- Label acima do campo: `text-[10px] font-bold uppercase tracking-widest ml-1` em muted.
- Input com ícone: wrapper `relative group`, ícone `absolute left-4 top-1/2 -translate-y-1/2` que ganha `text-primary` no `group-focus-within`, input `pl-11 bg-muted/30 border-border/60`.
- **Select com busca automática:** `ui/select.tsx` ganha um campo de busca embutido (sticky no topo do `SelectContent`) sozinho a partir de `MIN_ITENS_PARA_BUSCA` (8) opções — abaixo disso a lista inteira cabe na tela e a busca só atrapalharia. A comparação é acento-insensível (`lib/normalizeForSearch.ts`: NFD + minúsculas, "energia" acha "Energia Elétrica"). O que não casa fica oculto (`disabled` + `hidden`), nunca removido da árvore — o Radix mantém o `SelectContent` montado num fragmento solto mesmo fechado, e é de lá que o gatilho lê o texto do item selecionado; remover desmontaria esse texto. Prop `searchable` força ou desliga o campo independente da contagem. `ui/searchable-select.tsx` é o combobox equivalente para listas MUITO maiores (clientes, tripulação/colaboradores) — usa a mesma normalização, mais cursor de teclado (↑/↓/Enter/Esc); dentro de um `Dialog`/`Sheet`, passe `modal` para a roda do mouse não ser engolida pela trava de rolagem do diálogo.
- **MoneyInput (`ui/money-input.tsx`):** campo de valor monetário com máscara aplicada só no BLUR — digitar fica livre ("1234,56", "1.234,56", "1234.56" todos funcionam), e ao sair do campo o valor aparece formatado. Guarda TEXTO CRU (`value`/`onChange` são `string`), não número, de propósito: o texto digitado alimenta avisos de ambiguidade (ex.: "1.234" pode ser mil-duzentos-e-trinta-e-quatro ou um-vírgula-dois-três-quatro) que se perderiam se convertido para número na hora. Locale/símbolo são pt-BR/R$ por padrão (props `locale`/`symbol`, ou troque as constantes no topo do arquivo) — no app original isso vem de um sistema de moeda ativa por tenant (`utils/currency.ts`), deixado de fora deste kit por depender de estado global do app.

## Toasts

`<Toaster />` (sonner) no root + helper `toast` de `ui/custom-toast.tsx` (`toast.success/error/info/warning`) — é o custom-toast que aplica o visual do sistema.

## Micro-interações

Primitivos em `components/motion/` (React + framer-motion) e hooks em `lib/`. Todos respeitam `useReducedMotion`/`prefers-reduced-motion` — nenhum precisa de guard extra no call site.

- **`NumberTicker`** — número que conta até `value` com easing (contenção: 600ms default, easing cúbico próprio). Use em KPIs/contadores onde o valor muda depois do mount; NÃO anima no primeiro render (parte direto do valor final), só em mudanças subsequentes — e ao retarget continua do valor exibido, sem saltar.
- **`MorphingActionButton` + `useSuccessMorph`** — botão de ação que morfa loading → check verde desenhado (contenção: reverte a idle sozinho após 900ms). O hook deriva o estado de um `successSignal` que só muda em ÊXITO real (nunca no catch) — passar a mesma flag que dispara em erro faz o morph acender por engano.
- **`AutosaveIndicator`** — pill "Salvando…" (pontos com stagger) → "Salvo ✓" (some sozinho após 2s, deixa o horário no `title`) → erro/conflito com retry. Use ao lado de qualquer campo/formulário com autosave; o tipo `AutosaveStatus` é local ao componente — mapeie o status do seu mecanismo de save para os 4 valores tratados (`saving`/`saved`/`error`/`conflict`; qualquer outro não renderiza nada).
- **`MiniBurst` + `useCrossedGoal`** — confete CONTIDO num card (contenção: 12 partículas, raio 18–40px default, ~700ms), sem portal/backdrop — para comemorar uma meta cruzando 100% sem cobrir a tela. O pai precisa de `relative overflow-visible`; `useCrossedGoal(pct)` só dispara numa travessia <100→≥100 que acontece DEPOIS do load inicial (nunca numa meta que já chega pronta em 100%).
- **`TiltCard`** — tilt 3D sutil (±2°) que segue o ponteiro, com brilho especular via CSS vars `--mx`/`--my`. Passthrough puro (sem `motion.div`, zero overhead) quando `disabled`, reduced-motion ou ponteiro grosso (touch) — use em cards de destaque/CTA, não em listas densas.
- **`useShake`** — shake de validação (contenção: 3px, 240ms) para submit inválido; aplique `shakeClass` no wrapper e chame `triggerShake()` no handler de erro. Reinicia mesmo em disparos consecutivos (usa `requestAnimationFrame` para forçar reflow da classe).
- **`useFlashOnChange`** — pulso de fundo (`mi-flash-success`/`mi-flash-sky`, ~1.1s) quando um valor muda, para marcar "isto acabou de ser salvo" numa célula/linha de grade. Nunca pisca no primeiro render — só em mudanças reais, importante em listas onde cada linha nasce com sua própria instância do hook.
- **`useCondensedHeader`** — `true` quando o container de scroll passa de um limiar (default 24px), com histerese de 8px para não oscilar (flicker) perto do limite. Use para condensar um header sticky ao rolar.
- **`useNumberScrub`** — number scrubbing estilo Figma (Alt + arrastar horizontal ajusta um valor numérico; Shift multiplica o passo por 10). Desktop only (`pointer: fine`); sem Alt não faz nada, preservando click/digitação normais no campo.
- **`withViewTransition`** (`lib/viewTransition.ts`) — navegação com a View Transitions API nativa quando disponível, com fallback direto. Contenção: transição de 160–200ms (`mi-vt-out`/`mi-vt-in` em `tokens.css`); só ativa da 2ª navegação em diante para uma dada rota na sessão (heurística de "chunk quente" para rotas lazy-loaded — evita animar o skeleton do Suspense na 1ª visita).
- **`toast.undo`** (`ui/custom-toast.tsx`) — toast com anel regressivo (`durationMs`, default 5000) e um único botão "Desfazer"; o commit roda num `setTimeout` fora do ciclo de vida do React, então dispara mesmo se a tela desmontar antes do anel fechar. Use para remoções otimistas reversíveis (nunca para ações destrutivas irreversíveis — essas pedem `AlertDialog`).
- **Tabs deslizantes** (`ui/tabs.tsx`) — o indicador de fundo da aba ativa é um `motion.span` com `layoutId` compartilhado por `TabsList`, então desliza entre triggers em vez de saltar. Contenção: spring `stiffness: 400, damping: 32`.

## Descoberta (Ctrl+K + coachmark)

Duas peças pequenas para ensinar atalhos sem manual:

- **Badge "Ctrl K"/"⌘ K"** — chip no header desktop (`border border-border rounded px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground hover:text-foreground hover:border-foreground/30`), rótulo trocado por plataforma (`navigator.platform`), `title` explicando o atalho. Clique dispara `window.dispatchEvent(new CustomEvent('open-command-palette'))` — quem tiver uma paleta de comandos (`cmdk` ou similar) escuta esse evento além do atalho de teclado; sem paleta no seu app, o badge não serve de nada, é só a metade da descoberta.
- **`motion/Coachmark.tsx`** — balão de dica de UMA VEZ SÓ, mesma linguagem visual do `TooltipBalao` (`bg-sidebar-primary`, texto branco, seta, botão X). Controla a própria visibilidade por `localStorage['coach_' + id]` (lido de forma síncrona no `useState` inicial — sem flash de "aparece e some"). Três gatilhos de dismiss, todos gravando o localStorage antes de esconder: botão X, 8s sem interação, e o PRIMEIRO gesto real que a dica ensina (ex.: Alt+arrasto >4px, o mesmo limiar de `useNumberScrub`) — um clique parado sem mover NÃO gasta a dica, só o gesto de verdade prova que a pessoa descobriu sozinha. Reduced-motion via `lib/useAppReducedMotion.ts`. Uso: `<Coachmark id="scrub" text="Segure Alt e arraste para ajustar o valor" />` — `id` único vira a chave, então cada dica nova é só trocar a prop, sem copiar o componente.

## Desfazer: `toast.undo` vs `pendingDelete`

Duas variantes do mesmo princípio ("nada destrutivo executa na hora — dá pra desfazer"), escolhidas pelo CAMINHO DE PERSISTÊNCIA da tela, mapeado ANTES de decidir:

- **DELETE pontual** (API aceita excluir 1 registro por id, sem replace-all concorrente): remoção OTIMISTA da lista local no clique + `toast.undo({ onUndo, onCommit })` (`ui/custom-toast.tsx`) — `onCommit` só chama a API de verdade ~5s depois (roda mesmo se a tela desmontar, é `setTimeout` fora do ciclo do React); `onUndo` só reinsere na lista local, nada foi persistido ainda.
- **`pendingDelete`** (a tela salva um ARRAY INTEIRO — replace-all — e pode haver outro save concorrente nesses 5s, ex.: editar um item vizinho enquanto o anel do undo corre): clique NÃO remove nada do array real, só marca o id num `Set` local; um utilitário `hidePendingDelete<T extends {id:string}>` esconde esses ids só da renderização (lista, contadores, dialogs filhos). Um `ref` espelho sempre-fresco do estado garante que o `onCommit` (rodando depois) filtre a partir do array MAIS RECENTE, não de uma cópia capturada no clique — inclui qualquer edição concorrente feita durante a janela do undo.
- Em ambos os casos: erro no `onCommit` devolve o item (reaparece) + `toast.error`; nenhum precisa de `AlertDialog` de confirmação se a única cascata real (ex.: apagar uma conta de acesso) só roda DEPOIS da janela de undo — é o próprio undo que cobre o arrependimento. Escolha `AlertDialog` (nunca `window.confirm`) só quando a cascata é irreversível e roda ANTES/FORA de qualquer janela de undo.

## Densidade (confortável/compacta)

`lib/useDensity.ts` — hook trivial: `localStorage['ui_density']` (`'confortavel' | 'compacto'`, default confortável), retorno `[density, toggle]`. Chave ÚNICA e GLOBAL — qualquer grid pesado (tabela, lista longa) que leia o hook compartilha a mesma preferência do usuário, mas cada componente chama o hook por conta própria (sem Context/store): o toggle de uma tela não re-renderiza outra tela aberta em paralelo — aceitável porque são sessões de navegação diferentes, e evita introduzir estado global só para isto.

Aplicação típica: no componente do grid, derive 3–4 constantes de padding por tipo de linha (`compact = density === 'compacto'`; ex. `py-2.5→py-1.5` cabeçalho de grupo, `py-1.5→py-1` linha normal) e troque só a classe Tailwind — zero toque em lógica de dados/persistência. Botão de toggle: ícones `Rows3`/`Rows4` (lucide) + `Tooltip` "Densidade" (nunca `title` nativo), perto de outros controles de visualização do grid (não dentro da área de dados).

## Dark elevation (dialog/popover/dropdown)

No escuro, superfícies flutuantes (`Dialog`, `Popover`, `DropdownMenuContent`) precisam se destacar do fundo por CONTRASTE de camada, não só por sombra — sombra sozinha é quase invisível sobre um `--background` já bem escuro. Dois ajustes, aplicados juntos:

1. **`--popover` mais claro que `--card`** no tema escuro (`tokens.css`, ex. `222 47% 14%` vs. `222 47% 11%` do card) — separa visualmente "isto é uma camada por cima" de "isto é conteúdo da página". `--accent` (estado hover/focus de item de menu) também precisa de um degrau visível acima do novo `--popover` (ex. `217 33% 19%`), senão o hover do item some contra o fundo do menu.
2. **Sombra reforçada só no escuro**: `dark:shadow-[0_8px_24px_rgba(0,0,0,0.45)]` adicionado à classe do `DialogContent`/`PopoverContent`/`DropdownMenuContent` (junto do `shadow-lg`/`shadow-md` já existente para o claro) — no claro a sombra padrão já lê bem contra um fundo majoritariamente branco; no escuro, sem esse reforço, a sombra alpha-preta se perde contra um fundo já escuro.

Aplique nos DOIS: só mudar o token sem a sombra (ou vice-versa) deixa metade do contraste na mesa.

## Tema suave (crossfade claro↔escuro)

Trocar a classe `dark` no `<html>` direto é um corte seco. Para um crossfade suave SÓ no toggle explícito de tema (não na navegação entre rotas, que já tem sua própria transição — ver `withViewTransition` acima), reusar a **View Transitions API** com um keyframe dedicado:

1. `tokens.css` já traz o par `mi-theme-fade-out`/`mi-theme-fade-in` (opacity puro, 200ms, sem transform — diferente do slide de 4px do `mi-vt-*` de navegação), escopado por uma classe temporária `.theme-switching` no `<html>` — necessário porque as pseudo-classes `::view-transition-*(root)` não são descendentes reais do DOM, não dá pra isolar com um seletor filho normal. Por ser MAIS específico que o `::view-transition-*(root)` global, vence só durante o toggle de tema.
2. `lib/viewTransition.ts` exporta `canUseViewTransition()` — o mesmo critério (suporte do browser + nenhum sinal de reduced-motion) usado por `withViewTransition`, mas devolvido como booleano puro porque o toggle de tema precisa do PRÓPRIO controle de ciclo de vida da transição (esperar `.finished` para saber a hora de remover a classe), não de um wrapper fire-and-forget.
3. Snippet do toggle (no seu equivalente de `ThemeContext`/`setTheme`):

```ts
function setTheme(next: 'light' | 'dark') {
  const apply = () => { /* seta o estado + classe light/dark no <html> */ };
  if (!canUseViewTransition()) { apply(); return; }
  document.documentElement.classList.add('theme-switching');
  const transition = document.startViewTransition(apply);
  transition.finished
    .catch(() => {})
    .finally(() => document.documentElement.classList.remove('theme-switching'));
}
```

Guarda dupla: o `mount effect` que restaura o tema salvo no boot (sem interação do usuário) NUNCA passa por este caminho — aplica a classe direto, sem `startViewTransition`, para não animar o primeiro paint da página.

## Micro-copy

Voz do produto em pt-BR, derivada dos textos reais do app (toasts, botões, diálogos):

- **CTAs — imperativo curto, sem gerúndio nem enfeite.** Botões de ação são um verbo no infinitivo/imperativo direto: `Salvar` (`PlannerActionsCard.tsx`), `Excluir` (`ExecutorNotes.tsx`), `Concluir` (`NpsBlockerModal.tsx`), `Avançar`. Nunca "Salvando..." como label estático (isso é estado de loading do `MorphingActionButton`/`AutosaveIndicator`, não copy de botão parado) nem frases longas tipo "Clique aqui para salvar".
- **Títulos — sem gerúndio.** `Etapa ${stepId} Concluída!` (`StepCompletedCelebration`, não "Concluindo etapa"), `Pagamento confirmado!` (`billing/Success.tsx`, não "Confirmando pagamento"), `Regimento Interno`, `Tripulação`. Um título descreve o estado/conteúdo da tela, não uma ação em andamento.
- **Erros — o que aconteceu + o que fazer, nunca "algo deu errado" genérico nem tom de culpa do usuário.** Exemplos reais do app:
  - `Não foi possível salvar antes de trocar de filial. Suas edições foram mantidas — tente novamente.` (`ClientDREView.tsx`) — diz o que falhou, tranquiliza sobre o dado (não foi perdido) e dá a próxima ação.
  - `Não foi possível consultar a API do Banco Central.` (`CoAFinancialInput.tsx`) — o que aconteceu, sem inventar causa.
  - `Configure o Plano de Contas primeiro.` (`CoAFinancialInput.tsx`) — o que fazer, direto.
  - `Setor da empresa não informado. Preencha o Diagnóstico Inicial.` (`ChartOfAccountsSetup.tsx`) — mesmo padrão: fato + ação.
  - Evite `if (!msg.toLowerCase().includes('abort')) toast.error(\`Erro: ${msg}\`)` como referência de estilo — é fallback técnico, não copy; sempre que possível troque a mensagem crua do erro por uma frase nas linhas acima.
- **Nunca "consultor" — sempre "executor".** Vale para toda copy voltada ao usuário (títulos, toasts, labels, e-mails); é quem executa o plano, não quem consulta. Ver `.claude` memory `feedback_never_use_consultor.md`.
- **Números com moeda ativa, nunca `Intl`/BRL fixo.** Formate valores monetários via `utils/currency.ts` / `hooks/useActiveCurrency` (o kit expõe a mesma ideia em `ui/money-input.tsx`, que já deixa locale/símbolo configuráveis em vez de fixos) — uma tela de tenant nunca deve chamar `Intl.NumberFormat('pt-BR', { currency: 'BRL' })` direto, porque a moeda é configurável por tenant.

## Fluidez percebida

Conjunto de peças pequenas (plano 2026-08-24) para fazer o app parecer mais rápido do que ele "de fato" é — nenhuma delas otimiza I/O real, só reduzem o tempo em que o usuário fica olhando pra um estado vazio/travado.

- **Prefetch de rota no hover** (`lib/routePrefetch.ts`, snippet documentado) — `registerRoutePrefetch({ '/base': factory })` uma vez perto dos `React.lazy()`, depois `prefetchRoute(path)` no `onMouseEnter`/`onFocus` de cada item de navegação. Idempotente por sessão (`Set` de já-disparadas) e silencioso em erro — o clique real ainda tenta o `import()` de novo normalmente se o prefetch falhar. Acoplado ao router/estrutura de lazy do SEU app — adapte o matching de prefixo antes de usar.
- **Barra de progresso global** (`components/TopProgressBar.tsx`) — liga sozinha quando há atividade assíncrona (no app original, `useIsFetching`/`useIsMutating` do react-query) em qualquer parte do app, sem cada tela declarar seu próprio loading. Anti-flicker de dois estágios: só aparece se a atividade persistir >300ms, e uma vez visível fica pelo menos 400ms mesmo que a atividade termine antes disso. Slide indeterminado via `.mi-progress-slide-bar` (tokens.css); reduced-motion vira barra estática preenchida.
- **Crossfade skeleton → conteúdo** (`components/motion/FadeInContent.tsx`) — opacity 0/y 4 → opacity 1/y 0 em 150ms, só na entrada (sem `AnimatePresence`/exit). Funciona porque o branch de loading e o de conteúdo são tipicamente mutuamente exclusivos no JSX (`if/else`): o unmount do skeleton + mount deste componente já É o "mount natural" que dispara o `initial` uma vez só.
- **FLIP com `layout="position"`** — ao reordenar/filtrar uma lista renderizada com framer-motion, prefira `layout="position"` a `layout` puro: anima só a translação (posição), não também `width`/`height`, que costuma distorcer conteúdo de largura variável (texto, números) durante a transição.
- **Sombras de scroll** (`components/ui/scroll-shadow.tsx`) — wrapper de scroll horizontal que liga gradientes nas bordas (`from-background` → transparente, 24px) conforme mede `scrollLeft`/`scrollWidth` (listener passivo + `ResizeObserver` no scroller e no primeiro filho). Sinaliza "tem mais conteúdo pra esse lado" sem depender de o usuário descobrir por acaso arrastando a barra.
- **Ações no hover** — padrão CSS puro para revelar ações secundárias (editar/excluir/copiar) só quando relevante: `group`/`group-hover` no container para o caso simples; `focus-within` no wrapper garante que teclado (Tab) revele as mesmas ações que o mouse revelaria, sem depender só de `:hover`; `has-data-[state=open]` (`:has()` sobre um atributo `data-state="open"` de um Radix `DropdownMenu`/`Popover` filho) mantém as ações visíveis enquanto um menu decorrente delas está aberto — sem isso, abrir o menu e mover o mouse pra dentro dele esconde o botão que o abriu, porque o cursor saiu da área do `:hover` original.
- **Botão de copiar** (`components/ui/copy-button.tsx`) — morph Copy → Check (`text-success`) por 1,2s + micro-scale via `.mi-copy-check` (tokens.css); o morph do ícone É o feedback de sucesso, não duplique com um toast à parte. Erro (clipboard bloqueado) cai no toast padrão.
- **Shake de validação** (`useShake`, em `lib/useMicroFeedback.ts`) — `triggerShake()` no submit inválido, aplique `shakeClass` no wrapper (`.mi-shake`, tokens.css, 3px/240ms). Usa `requestAnimationFrame` pra forçar a classe a ser removida e reaplicada mesmo em disparos consecutivos — sem isso o browser não reinicia a animação porque a classe nunca mudou de valor entre um shake e o próximo.
- **Scroll restoration** (`lib/useScrollRestoration.ts`) — restaura/zera o scroll de um container INTERNO (`overflow-y-auto`) conforme o tipo de navegação do react-router: `POP` (voltar/avançar do browser) restaura a posição salva da rota; `PUSH`/`REPLACE` (navegação nova) zera, como abrir uma página nova. Mapa de posições é module-level (sobrevive a remounts de layout) com cap FIFO (50 rotas) para não vazar memória em sessões longas.
- **Colapso de linha/grupo** — ao reaparecer um item que estava escondido por filtro de array (não CSS-hide), o próprio mount real já dispara um fade rápido (`.mi-collapse-row-in`, tokens.css, 150ms) sem precisar de classe efêmera nem JS extra para disparar/limpar.

## Notas sobre o app original

- O Layout original tem modos fullscreen/edge-to-edge acoplados a rotas específicas (workflow, canvas de organograma/jornada); ficaram fora do `AppLayout` genérico. Se precisar, troque o `<main>` para `overflow-hidden flex flex-col` no caso full-canvas.
- As animações `journey-*` do tokens.css pertencem ao canvas de jornada (linhas pontilhadas fluindo, pin pulsando) — seção marcada como opcional.
