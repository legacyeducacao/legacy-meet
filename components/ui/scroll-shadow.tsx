"use client"

import * as React from "react"
import { cn } from "../../lib/utils"

export interface ScrollShadowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** className aplicada no elemento que rola (overflow-x-auto), não no
   *  container relative externo — mantém compatível com wrappers que hoje
   *  levam classes de layout (max-h, scrollbar custom, etc). */
  className?: string
  /** className do container `relative` externo, só quando o chamador
   *  precisa esticar/posicionar o wrapper como um todo (ex: dentro de um
   *  Card com p-0). Opcional — default é `w-full`. */
  containerClassName?: string
}

/**
 * Wrapper de scroll horizontal que sinaliza, com sombras nas bordas, que há
 * conteúdo além da dobra. Mede `scrollLeft`/`scrollWidth` do próprio
 * elemento (listener de scroll passivo + ResizeObserver no scroller e no
 * primeiro filho, pra recalcular quando o conteúdo muda de tamanho) e liga
 * dois overlays absolutos com gradiente (24px, `from-background` →
 * transparente) conforme dá pra rolar pra esquerda/direita.
 *
 * Os overlays são irmãos do elemento que rola (não filhos) — ficam fixos na
 * borda do container e não rolam junto com o conteúdo.
 */
export const ScrollShadow = React.forwardRef<HTMLDivElement, ScrollShadowProps>(
  ({ children, className, containerClassName, onScroll, style, ...props }, forwardedRef) => {
    const scrollerRef = React.useRef<HTMLDivElement | null>(null)
    const [canScrollLeft, setCanScrollLeft] = React.useState(false)
    const [canScrollRight, setCanScrollRight] = React.useState(false)
    const rafRef = React.useRef<number | null>(null)

    const measure = React.useCallback(() => {
      const el = scrollerRef.current
      if (!el) return
      const { scrollLeft, scrollWidth, clientWidth } = el
      // margem de 1px pra absorver arredondamento de subpixel do layout
      setCanScrollLeft(scrollLeft > 1)
      setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 1)
    }, [])

    const scheduleMeasure = React.useCallback(() => {
      if (rafRef.current != null) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        measure()
      })
    }, [measure])

    React.useEffect(() => {
      const el = scrollerRef.current
      if (!el) return

      measure()

      el.addEventListener("scroll", scheduleMeasure, { passive: true })
      window.addEventListener("resize", scheduleMeasure)

      let resizeObserver: ResizeObserver | undefined
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(scheduleMeasure)
        resizeObserver.observe(el)
        if (el.firstElementChild) resizeObserver.observe(el.firstElementChild)
      }

      return () => {
        el.removeEventListener("scroll", scheduleMeasure)
        window.removeEventListener("resize", scheduleMeasure)
        resizeObserver?.disconnect()
        if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      }
    }, [measure, scheduleMeasure])

    return (
      <div data-slot="table-container" className={cn("relative w-full", containerClassName)}>
        <div
          ref={(node) => {
            scrollerRef.current = node
            if (typeof forwardedRef === "function") forwardedRef(node)
            else if (forwardedRef) forwardedRef.current = node
          }}
          // overflow-auto (não só -x): alguns wrappers substituídos aqui
          // também rolam verticalmente (ex: max-h + thead sticky) — manter
          // os dois eixos preserva esse comportamento. As sombras só
          // reagem ao eixo horizontal (scrollLeft/scrollWidth).
          // WebkitOverflowScrolling inline: se seu reset global mirar as
          // classes .overflow-{x,y}-auto e não pegar .overflow-auto, sem
          // isto o iOS perde o momentum scroll.
          className={cn("overflow-auto", className)}
          style={{ WebkitOverflowScrolling: "touch", ...style }}
          onScroll={(e) => {
            scheduleMeasure()
            onScroll?.(e)
          }}
          {...props}
        >
          {children}
        </div>
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute left-0 top-0 bottom-0 z-10 w-6 bg-gradient-to-r from-background to-transparent transition-opacity duration-150",
            canScrollLeft ? "opacity-100" : "opacity-0"
          )}
        />
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute right-0 top-0 bottom-0 z-10 w-6 bg-gradient-to-l from-background to-transparent transition-opacity duration-150",
            canScrollRight ? "opacity-100" : "opacity-0"
          )}
        />
      </div>
    )
  }
)
ScrollShadow.displayName = "ScrollShadow"
