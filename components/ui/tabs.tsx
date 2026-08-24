'use client';

import * as React from"react"
import { cva, type VariantProps } from"class-variance-authority"
import { Tabs as TabsPrimitive } from"radix-ui"
import { motion, useReducedMotion } from"framer-motion"

import { cn } from"../../lib/utils"

/**
 * Espelha o valor ativo do Tabs root (controlado OU não) para que o
 * TabsTrigger saiba, em JS, se é o ativo — sem depender de ler `data-state`
 * do DOM. `TabsListIdContext` dá o `layoutId` compartilhado por lista
 * (indicador viaja só dentro da MESMA TabsList).
 */
const TabsValueContext = React.createContext<string | undefined>(undefined)
const TabsListIdContext = React.createContext<string>("")

function Tabs({
 className,
 orientation ="horizontal",
 value,
 defaultValue,
 onValueChange,
 ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
 const isControlled = value !== undefined
 const [uncontrolledValue, setUncontrolledValue] = React.useState<string | undefined>(defaultValue)
 const activeValue = isControlled ? value : uncontrolledValue

 const handleValueChange = React.useCallback(
 (next: string) => {
 if (!isControlled) setUncontrolledValue(next)
 onValueChange?.(next)
 },
 [isControlled, onValueChange]
 )

 return (
 <TabsValueContext.Provider value={activeValue}>
 <TabsPrimitive.Root
 data-slot="tabs"
 data-orientation={orientation}
 orientation={orientation}
 value={value}
 defaultValue={defaultValue}
 onValueChange={handleValueChange}
 className={cn(
"group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
 className
 )}
 {...props}
 />
 </TabsValueContext.Provider>
 )
}

const tabsListVariants = cva(
"group/tabs-list inline-flex w-full items-center rounded-lg p-[3px] text-muted-foreground group-data-[orientation=horizontal]/tabs:h-9 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col data-[variant=line]:rounded-none overflow-x-auto no-scrollbar",
 {
 variants: {
 variant: {
 default:"bg-muted",
 line:"gap-1 bg-transparent",
 },
 },
 defaultVariants: {
 variant:"default",
 },
 }
)

function TabsList({
 className,
 variant ="default",
 ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
 VariantProps<typeof tabsListVariants>) {
 const listId = React.useId()
 return (
 <TabsListIdContext.Provider value={listId}>
 <TabsPrimitive.List
 data-slot="tabs-list"
 data-variant={variant}
 className={cn(tabsListVariants({ variant }), className)}
 {...props}
 />
 </TabsListIdContext.Provider>
 )
}

function TabsTrigger({
 className,
 children,
 value,
 ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
 const listId = React.useContext(TabsListIdContext)
 const activeValue = React.useContext(TabsValueContext)
 const isActive = activeValue === value
 const prefersReducedMotion = useReducedMotion()

 return (
 <TabsPrimitive.Trigger
 data-slot="tabs-trigger"
 value={value}
 className={cn(
"relative isolate inline-flex h-[calc(100%-1px)] shrink-0 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
"group-data-[variant=line]/tabs-list:bg-transparent",
"data-[state=active]:text-foreground dark:data-[state=active]:text-foreground",
"after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-100",
 className
 )}
 {...props}
 >
 {isActive && (
 // Indicador de fundo que desliza entre triggers (mesma TabsList via
 // layoutId). z-index NEGATIVO + `isolate` no trigger: fica atrás do
 // conteúdo (ícone/texto) sem precisar envolvê-lo — preserva gap/layout
 // de qualquer className custom que as telas já passam para o trigger.
 // `-inset-px` (não `inset-0`): o trigger tem `border border-transparent`
 // (1px) — inset-0 alinharia à padding-box e o pill ativo ficaria 1px
 // menor por lado que o visual original, que sempre pintou até a
 // border-box. Inofensivo na variante `line` (sem bg/shadow/border).
 <motion.span
 data-slot="tabs-indicator"
 data-indicator-id={`tab-indicator-${listId}`}
 layoutId={`tab-indicator-${listId}`}
 className={cn(
"absolute -inset-px -z-10 rounded-[inherit]",
"group-data-[variant=default]/tabs-list:bg-background group-data-[variant=default]/tabs-list:shadow-sm",
"dark:group-data-[variant=default]/tabs-list:border dark:group-data-[variant=default]/tabs-list:border-input dark:group-data-[variant=default]/tabs-list:bg-input/30"
 )}
 transition={
 prefersReducedMotion
 ? { duration: 0 }
 : { type:"spring", stiffness: 400, damping: 32 }
 }
 />
 )}
 {children}
 </TabsPrimitive.Trigger>
 )
}

function TabsContent({
 className,
 ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
 return (
 <TabsPrimitive.Content
 data-slot="tabs-content"
 className={cn("flex-1 outline-none", className)}
 {...props}
 />
 )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
