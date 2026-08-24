/**
 * Navegação com View Transitions API quando disponível (fallback: direto).
 *
 * Respeita DOIS sinais de "sem animação":
 * - `prefers-reduced-motion` do SO (matchMedia);
 * - um toggle manual "reduzir movimento" nas Preferências de Acessibilidade
 *   do SEU app, marcando `<html class="reduce-motion">` independente do SO
 *   (padrão do app original: hooks/useAccessibility.ts). O `.reduce-motion *`
 *   do CSS não alcança os pseudo-elementos ::view-transition-*(root) (não
 *   são descendentes reais no DOM), então sem essa checagem o toggle in-app
 *   não teria efeito aqui.
 *
 * `document.startViewTransition` pode não estar nos libs do TypeScript
 * configurados no seu projeto — o cast abaixo resolve isso.
 *
 * MECANISMO MANUAL, NÃO A OPÇÃO NATIVA DO REACT-ROUTER — por quê:
 * `navigate(path, { viewTransition: true })` existe no tipo do react-router
 * 7.17+, mas só é lido pelo state-subscriber do Data Router
 * (`<RouterProvider>`/`createBrowserRouter`). Se seu app usa `<BrowserRouter>`
 * puro (modo declarativo), o `navigator` é o `history` cru:
 * `history.push(to, state)` tem só 2 parâmetros, o 3º argumento (que
 * carregaria `viewTransition`) é descartado antes de chegar a algum lugar
 * que chame `document.startViewTransition`. Migrar para Data Router resolve
 * isso nativamente — este helper é o paliativo pra quem não migrou.
 *
 * HEURÍSTICA DE CHUNK QUENTE (rota já visitada nesta sessão):
 * Se suas rotas são `React.lazy()` + `<Suspense>`, sem a orquestração do
 * Data Router um `document.startViewTransition(fn)` manual captura o
 * snapshot "novo" ANTES do chunk lazy terminar de carregar na 1ª visita — a
 * transição anima o fallback do Suspense (skeleton), não o conteúdo real.
 * Paliativo dentro do escopo (sem migrar de router): só ativa a View
 * Transition da 2ª navegação em diante para uma dada rota nesta aba/sessão —
 * o import() dinâmico já fica em cache do module loader depois da 1ª vez,
 * então a 2ª visita monta o conteúdo real a tempo do snapshot "novo". Na 1ª
 * visita (chunk frio), navega direto, sem transição e sem animar o skeleton.
 */

const visitedRoutes = new Set<string>();

/** Remove a query string da chave — `/financeiro?clientId=1` e
 *  `/financeiro?clientId=2` contam como a MESMA rota pro heurístico de
 *  chunk quente (o componente por trás é o mesmo). */
function normalizeRoutePath(path: string): string {
  return path.split('?')[0];
}

/**
 * Marca uma rota como "visitada" sem navegar — usado pelo prefetch de rota
 * no hover/foco de um item de navegação (ver `lib/routePrefetch.ts`). Quando
 * o hover/foco baixa o chunk lazy ANTES do clique real, essa marcação já
 * conta como a 1ª visita da heurística acima: o clique de verdade entra como
 * se fosse a 2ª navegação e ganha a View Transition de cara, em vez de
 * precisar de uma 2ª navegação manual à mesma rota dentro da sessão.
 */
export function markRouteVisited(path: string): void {
  visitedRoutes.add(normalizeRoutePath(path));
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function appReducedMotion(): boolean {
  return (
    typeof document !== 'undefined' &&
    !!document.documentElement?.classList.contains('reduce-motion')
  );
}

/**
 * Critério compartilhado de "posso usar View Transitions": suporte do
 * browser + nenhum dos dois sinais de reduced-motion ativo. Reusado por
 * `withViewTransition` (navegação) e por um eventual toggle explícito de
 * tema claro/escuro no SEU app, que precisa do próprio controle do ciclo de
 * vida da transição (não só de um wrapper fire-and-forget) — ver a seção
 * "Tema suave" em docs/PATTERNS.md.
 */
export function canUseViewTransition(): boolean {
  if (prefersReducedMotion() || appReducedMotion()) return false;
  const docWithViewTransition = document as Document & {
    startViewTransition?: (callback: () => void) => unknown;
  };
  return typeof docWithViewTransition.startViewTransition === 'function';
}

/**
 * @param fn Navegação a executar (ex.: `() => navigate(path)`).
 * @param targetPath Rota alvo (com ou sem query). Quando informada, ativa a
 *   heurística de chunk quente: a 1ª navegação a essa rota nesta sessão roda
 *   `fn()` direto (chunk frio, sem transição); da 2ª em diante, tenta
 *   `document.startViewTransition(fn)`. Omitir pula o heurístico e tenta a
 *   transição direto (uso interno/testes — os call sites das sidebars
 *   sempre passam o path).
 */
export function withViewTransition(fn: () => void, targetPath?: string): void {
  if (!canUseViewTransition()) {
    fn();
    return;
  }

  const docWithViewTransition = document as Document & {
    startViewTransition?: (callback: () => void) => unknown;
  };

  if (targetPath !== undefined) {
    const key = normalizeRoutePath(targetPath);
    if (!visitedRoutes.has(key)) {
      visitedRoutes.add(key);
      fn();
      return;
    }
  }

  try {
    docWithViewTransition.startViewTransition(fn);
  } catch {
    // Ex.: já existe uma view transition em andamento (InvalidStateError) —
    // não deixa a navegação travada por causa da animação.
    fn();
  }
}
