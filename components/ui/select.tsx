"use client"

import * as React from"react"
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from"lucide-react"
import { Select as SelectPrimitive } from"radix-ui"

import { cn } from"../../lib/utils"
import { matchesSearch, SelectSearchEmptyState, SelectSearchInput } from"./select-search-core"

/**
 * A partir de quantas opções o select ganha campo de busca.
 *
 * Regra do produto (2026-08-11): mais de 7 opções = com busca, em TODO select
 * do sistema. Abaixo disso a lista inteira cabe na tela e um campo de busca só
 * atrapalharia.
 */
export const MIN_ITENS_PARA_BUSCA = 8

/**
 * O Radix NÃO expõe "está aberto?" para dentro do Content, e o Content fica
 * MONTADO num fragmento solto enquanto o select está fechado (é assim que o
 * gatilho sabe o texto do item selecionado). Sem este contexto, o efeito de
 * foco rodava uma vez, no fragmento desanexado — `.focus()` sem efeito —, e o
 * termo digitado sobrevivia ao fechamento do popup.
 */
const SelectAbertoContext = React.createContext(false)

function Select({
 open,
 defaultOpen,
 onOpenChange,
 ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
 const [abertoInterno, setAbertoInterno] = React.useState(defaultOpen ?? false)
 const aberto = open ?? abertoInterno

 return (
 <SelectAbertoContext.Provider value={aberto}>
 <SelectPrimitive.Root
 data-slot="select"
 open={open}
 defaultOpen={defaultOpen}
 onOpenChange={(v) => {
 setAbertoInterno(v)
 onOpenChange?.(v)
 }}
 {...props}
 />
 </SelectAbertoContext.Provider>
 )
}

function SelectGroup({
 ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
 return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectValue({
 ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
 return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
 className,
 size ="default",
 children,
 ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
 size?:"sm" |"default"
}) {
 return (
 <SelectPrimitive.Trigger
 data-slot="select-trigger"
 data-size={size}
 className={cn(
"flex w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[placeholder]:text-muted-foreground data-[size=default]:h-11 data-[size=sm]:h-9 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
 className
 )}
 {...props}
 >
 {children}
 <SelectPrimitive.Icon asChild>
 <ChevronDownIcon className="size-4 opacity-50" />
 </SelectPrimitive.Icon>
 </SelectPrimitive.Trigger>
 )
}

function SelectContent({
 className,
 children,
 // PADRÃO DO SISTEMA (2026-08-11): a lista abre ABAIXO do gatilho, alinhada
 // pela esquerda. O default do Radix é `item-aligned`, que sobrepõe a lista ao
 // gatilho para deixar o item selecionado sob o cursor — em tela cheia de
 // campos isso parecia um popup solto, fora de lugar. `popper` continua virando
 // a lista para cima quando não há espaço embaixo, senão ela sairia da tela.
 position ="popper",
 align ="start",
 sideOffset = 4,
 /** Força (ou proíbe) o campo de busca. Por padrão: a partir de 8 opções. */
 searchable,
 searchPlaceholder ="Buscar...",
 ...props
}: React.ComponentProps<typeof SelectPrimitive.Content> & {
 searchable?: boolean
 searchPlaceholder?: string
}) {
 const [query, setQuery] = React.useState("")
 const inputRef = React.useRef<HTMLInputElement>(null)
 const aberto = React.useContext(SelectAbertoContext)

 const totalItens = React.useMemo(() => contarItensDoSelect(children), [children])
 const temBusca = searchable ?? totalItens >= MIN_ITENS_PARA_BUSCA
 const { children: visiveis, correspondencias } = React.useMemo(
 () => (temBusca ? aplicarBuscaNoSelect(children, query) : { children, correspondencias: totalItens }),
 [children, query, temBusca, totalItens]
 )

 React.useEffect(() => {
 if (!temBusca) return
 // Fechou: zera a busca. O conteúdo continua montado (fragmento solto), e um
 // termo residual esconderia o item selecionado — o gatilho ficaria SEM
 // rótulo, com o valor ainda setado.
 if (!aberto) {
 setQuery("")
 return
 }
 // Abriu: o Radix foca o item selecionado. Sem tomar o foco de volta, o que a
 // pessoa digitasse iria para o typeahead dele, não para a busca.
 const t = setTimeout(() => inputRef.current?.focus(), 60)
 return () => clearTimeout(t)
 }, [aberto, temBusca])

 return (
 <SelectPrimitive.Portal>
 <SelectPrimitive.Content
 data-slot="select-content"
 className={cn(
"relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
 position ==="popper" &&
"data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
 className
 )}
 position={position}
 align={align}
 sideOffset={sideOffset}
 {...props}
 >
 {temBusca && (
 <SelectSearchInput
 ref={inputRef}
 value={query}
 onChange={(e) => setQuery(e.target.value)}
 suppressBubbling
 placeholder={searchPlaceholder}
 aria-label={searchPlaceholder}
 />
 )}
 <SelectScrollUpButton />
 <SelectPrimitive.Viewport
 className={cn(
"p-1",
 position ==="popper" &&
"min-h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1"
 )}
 >
 {visiveis}
 {temBusca && query.trim() && correspondencias === 0 && (
 <SelectSearchEmptyState />
 )}
 </SelectPrimitive.Viewport>
 <SelectScrollDownButton />
 </SelectPrimitive.Content>
 </SelectPrimitive.Portal>
 )
}

// ── Busca dentro do select (funções puras, testáveis sem DOM) ──────────────

/** Um elemento é item/grupo pelo componente, não por heurística de classe. */
function ehTipo(no: React.ReactNode, tipo: React.ElementType): no is React.ReactElement {
 return React.isValidElement(no) && no.type === tipo
}

function ehFragmento(no: React.ReactNode): no is React.ReactElement<{ children?: React.ReactNode }> {
 return React.isValidElement(no) && no.type === React.Fragment
}

/** Texto pesquisável de um item: o que ele mostra, com o value como reserva. */
export function textoDoItemDoSelect(no: React.ReactNode): string {
 if (no === null || no === undefined || typeof no ==="boolean") return""
 if (typeof no ==="string" || typeof no ==="number") return String(no)
 if (Array.isArray(no)) return no.map(textoDoItemDoSelect).join("")
 if (React.isValidElement(no)) {
 const props = no.props as { children?: React.ReactNode; value?: unknown }
 const texto = textoDoItemDoSelect(props.children).trim()
 if (texto) return texto
 return props.value !== undefined ? String(props.value) :""
 }
 return""
}

/** Quantas opções selecionáveis existem na árvore (entra em grupos e fragmentos). */
export function contarItensDoSelect(children: React.ReactNode): number {
 let total = 0
 React.Children.forEach(children, (filho) => {
 if (ehTipo(filho, SelectItem)) { total++; return }
 if (ehTipo(filho, SelectGroup) || ehFragmento(filho)) {
 total += contarItensDoSelect((filho.props as { children?: React.ReactNode }).children)
 }
 })
 return total
}

export interface BuscaNoSelect {
 /** A árvore com o que não casa OCULTO (nunca removido). */
 children: React.ReactNode
 /** Quantos itens casaram com o termo. */
 correspondencias: number
}

/**
 * Aplica a busca ESCONDENDO o que não casa, em vez de remover.
 *
 * Por que esconder: o Radix mantém o conteúdo montado num fragmento solto
 * mesmo com o select fechado — é de lá que o gatilho lê o texto do item
 * selecionado. Remover da árvore desmontava esse texto, e o gatilho ficava em
 * branco com o valor ainda setado (achado da revisão de 2026-08-11). Oculto,
 * o item continua registrado.
 *
 * O que não casa também vira `disabled`, senão seta e typeahead do Radix
 * continuariam navegando por item invisível.
 *
 * Grupo sem nenhum item correspondente some inteiro (com o rótulo — rótulo
 * sozinho é sujeira) e separador some durante a busca, porque não separaria
 * nada. A comparação ignora acento e caixa: "energia" acha "Energia Elétrica".
 */
export function aplicarBuscaNoSelect(children: React.ReactNode, query: string): BuscaNoSelect {
 const termo = query.trim()
 if (!termo) return { children, correspondencias: contarItensDoSelect(children) }

 let correspondencias = 0
 const saida: React.ReactNode[] = []

 React.Children.forEach(children, (filho, i) => {
 if (ehTipo(filho, SelectItem)) {
 const props = filho.props as { value?: unknown; className?: string }
 const casa = matchesSearch(termo, textoDoItemDoSelect(filho), String(props.value ?? ""))
 if (casa) {
 correspondencias++
 saida.push(filho)
 } else {
 saida.push(React.cloneElement(filho as React.ReactElement<Record<string, unknown>>, {
 key: filho.key ?? i,
 disabled: true,
 className: cn(props.className,"hidden"),
 }))
 }
 return
 }

 if (ehTipo(filho, SelectGroup) || ehFragmento(filho)) {
 const el = filho as React.ReactElement<Record<string, unknown>>
 const eraFragmento = ehFragmento(filho)
 const props = filho.props as { className?: string; children?: React.ReactNode }
 const dentro = aplicarBuscaNoSelect(props.children, termo)
 correspondencias += dentro.correspondencias
 // Fragmento não aceita className — quem some é o conteúdo dele, já tratado
 // na recursão. Grupo sem correspondência some inteiro, com o rótulo.
 const extra = eraFragmento || dentro.correspondencias > 0
 ? { key: el.key ?? i }
 : { key: el.key ?? i, className: cn(props.className,"hidden") }
 saida.push(React.cloneElement(el, extra, dentro.children))
 return
 }

 if (ehTipo(filho, SelectSeparator) || ehTipo(filho, SelectLabel)) {
 const props = filho.props as { className?: string }
 saida.push(React.cloneElement(filho as React.ReactElement<Record<string, unknown>>, {
 key: filho.key ?? i,
 className: cn(props.className,"hidden"),
 }))
 return
 }

 saida.push(filho)
 })

 return { children: saida, correspondencias }
}

/** Quantos itens estão VISÍVEIS (sem a classe `hidden`) — usado nos testes. */
export function contarItensVisiveisDoSelect(children: React.ReactNode): number {
 let total = 0
 React.Children.forEach(children, (filho) => {
 if (ehTipo(filho, SelectItem)) {
 const { className } = filho.props as { className?: string }
 if (!className?.includes("hidden")) total++
 return
 }
 if (ehTipo(filho, SelectGroup) || ehFragmento(filho)) {
 const { className, children: dentro } = filho.props as { className?: string; children?: React.ReactNode }
 if (!className?.includes("hidden")) total += contarItensVisiveisDoSelect(dentro)
 }
 })
 return total
}

function SelectLabel({
 className,
 ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
 return (
 <SelectPrimitive.Label
 data-slot="select-label"
 className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)}
 {...props}
 />
 )
}

function SelectItem({
 className,
 children,
 ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
 return (
 <SelectPrimitive.Item
 data-slot="select-item"
 className={cn(
"relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
 className
 )}
 {...props}
 >
 <span
 data-slot="select-item-indicator"
 className="absolute right-2 flex size-3.5 items-center justify-center"
 >
 <SelectPrimitive.ItemIndicator>
 <CheckIcon className="size-4" />
 </SelectPrimitive.ItemIndicator>
 </span>
 <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
 </SelectPrimitive.Item>
 )
}

function SelectSeparator({
 className,
 ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
 return (
 <SelectPrimitive.Separator
 data-slot="select-separator"
 className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
 {...props}
 />
 )
}

function SelectScrollUpButton({
 className,
 ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
 return (
 <SelectPrimitive.ScrollUpButton
 data-slot="select-scroll-up-button"
 className={cn(
"flex cursor-default items-center justify-center py-1",
 className
 )}
 {...props}
 >
 <ChevronUpIcon className="size-4" />
 </SelectPrimitive.ScrollUpButton>
 )
}

function SelectScrollDownButton({
 className,
 ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
 return (
 <SelectPrimitive.ScrollDownButton
 data-slot="select-scroll-down-button"
 className={cn(
"flex cursor-default items-center justify-center py-1",
 className
 )}
 {...props}
 >
 <ChevronDownIcon className="size-4" />
 </SelectPrimitive.ScrollDownButton>
 )
}

export {
 Select,
 SelectContent,
 SelectGroup,
 SelectItem,
 SelectLabel,
 SelectScrollDownButton,
 SelectScrollUpButton,
 SelectSeparator,
 SelectTrigger,
 SelectValue,
}
