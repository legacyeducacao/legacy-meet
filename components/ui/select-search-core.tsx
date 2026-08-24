"use client"

/**
 * Motor único de busca dos selects do sistema (2026-08-23).
 *
 * `select.tsx` (Radix, busca por árvore de children) e `searchable-select.tsx`
 * (combobox custom, busca por lista de options) tinham cada um sua própria
 * cópia do input de busca e do estado vazio — mesmo texto, classes quase
 * iguais mas sutilmente divergentes (ícone, padding, altura). Este módulo é o
 * que os dois têm em comum: o visual do input de busca, o texto+classe do
 * "Nenhum resultado." e um filtro genérico por lista. A filtragem por ÁRVORE
 * de children é específica do Radix Select e continua em select.tsx — não há
 * o que compartilhar ali, a estrutura de dados é outra.
 */
import * as React from "react"
import { SearchIcon } from "lucide-react"

import { cn } from "../../lib/utils"
import { matchesSearch, normalizeForSearch } from "../../lib/normalizeForSearch"

export { matchesSearch, normalizeForSearch }

/** Mesmo texto nos dois selects — não deixar divergir de novo. */
export const SELECT_SEARCH_EMPTY_TEXT = "Nenhum resultado."

/** Mesma classe nos dois selects: texto centralizado, discreto, com respiro. */
export function SelectSearchEmptyState({
  text = SELECT_SEARCH_EMPTY_TEXT,
}: {
  text?: string
}) {
  return (
    <div className="px-3 py-6 text-center text-xs text-muted-foreground">
      {text}
    </div>
  )
}

export interface SelectSearchInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "className" | "type"> {
  /**
   * Suprime a propagação de teclas imprimíveis (e Backspace) para fora do
   * input. Necessário só quando o pai é um Radix com typeahead próprio
   * (select.tsx) — ele roubaria o foco do campo de busca. O combobox custom
   * (searchable-select) não tem esse problema: o próprio input já é o topo
   * da árvore de teclado ali, então não precisa (nem deve) suprimir nada.
   */
  suppressBubbling?: boolean
  /** Classe extra pro wrapper (sticky/border/padding). Raramente necessário. */
  wrapperClassName?: string
}

/**
 * Input de busca comum aos dois selects: mesmo ícone de lupa, altura,
 * placeholder e foco. `select.tsx` e `searchable-select.tsx` só variam se
 * precisam suprimir o typeahead do Radix (`suppressBubbling`) e o handler de
 * teclado que passam (setas/Enter/Esc de um lado, nada do outro).
 */
export const SelectSearchInput = React.forwardRef<HTMLInputElement, SelectSearchInputProps>(
  function SelectSearchInput({ suppressBubbling, wrapperClassName, onKeyDown, ...inputProps }, ref) {
    return (
      <div
        className={cn(
          "sticky top-0 z-10 border-b border-border bg-popover p-1.5",
          wrapperClassName
        )}
      >
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={ref}
            type="text"
            onKeyDown={(e) => {
              // Letra digitada (ou Backspace) NÃO pode subir quando o pai tem
              // typeahead próprio: o Radix a usaria pra navegar um item e
              // roubaria o foco do campo. Setas/Enter/Esc continuam subindo.
              if (suppressBubbling && (e.key.length === 1 || e.key === "Backspace")) {
                e.stopPropagation()
              }
              onKeyDown?.(e)
            }}
            className="h-8 w-full rounded-sm bg-transparent pl-7 pr-2 text-sm outline-none placeholder:text-muted-foreground"
            {...inputProps}
          />
        </div>
      </div>
    )
  }
)

/**
 * Filtra uma lista genérica pelo termo digitado, extraindo os textos
 * pesquisáveis de cada item. Usado por selects "options-driven"
 * (searchable-select); a filtragem "children-driven" do Radix Select
 * (select.tsx) precisa andar pela árvore e por isso mora lá.
 */
export function filterBySearch<T>(
  items: T[],
  query: string,
  getHaystacks: (item: T) => (string | null | undefined)[]
): T[] {
  const termo = query.trim()
  if (!termo) return items
  return items.filter((item) => matchesSearch(termo, ...getHaystacks(item)))
}
