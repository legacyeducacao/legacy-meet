'use client';

/**
 * SearchableSelect — combobox com search input embutido.
 *
 * USAR como padrao em selects que listam:
 *  - Clientes
 *  - Tripulacao / Colaboradores
 *  - Usuarios
 *  - Listas grandes (> 8 itens) em geral
 *
 * API espelha um <Select> simples (value + onValueChange + options).
 * Mantem cursor de teclado (↑/↓/Enter/Esc) pra acessibilidade.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { cn } from '@/lib/utils';

export interface SearchableSelectOption {
  value: string;
  label: string;
  /** Subtitulo opcional (ex: email, departamento) — entra no campo de busca. */
  description?: string;
}

interface Props {
  value: string;
  onValueChange: (v: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  /** Mostra um X pra limpar a selecao (volta value pra ''). Default: false. */
  clearable?: boolean;
}

export const SearchableSelect: React.FC<Props> = ({
  value,
  onValueChange,
  options,
  placeholder = 'Selecionar...',
  searchPlaceholder = 'Buscar...',
  emptyText = 'Nenhum resultado.',
  disabled = false,
  className,
  clearable = false,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => {
      return (
        o.label.toLowerCase().includes(q) ||
        (o.description?.toLowerCase().includes(q) ?? false) ||
        o.value.toLowerCase().includes(q)
      );
    });
  }, [options, query]);

  // Reset query + highlight quando abre/fecha
  useEffect(() => {
    if (open) {
      setQuery('');
      setHighlightIdx(0);
      // Foco no search apos a animacao do popover
      const t = setTimeout(() => searchRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Mantem o highlight dentro do range filtrado
  useEffect(() => {
    if (highlightIdx >= filtered.length) setHighlightIdx(Math.max(0, filtered.length - 1));
  }, [filtered.length, highlightIdx]);

  // Scroll automatico pro item destacado
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const item = list.querySelector<HTMLElement>(`[data-idx="${highlightIdx}"]`);
    if (item) {
      item.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightIdx, open]);

  const selectAt = useCallback(
    (idx: number) => {
      const opt = filtered[idx];
      if (!opt) return;
      onValueChange(opt.value);
      setOpen(false);
    },
    [filtered, onValueChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      selectAt(highlightIdx);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onValueChange('');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'flex items-center gap-2 w-full h-9 px-3 py-1 rounded-md border border-input bg-transparent text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer dark:bg-input/30',
            !selectedOption && 'text-muted-foreground',
            className,
          )}
        >
          <span className="flex-1 truncate text-left">{selectedOption?.label ?? placeholder}</span>
          {clearable && selectedOption && !disabled && (
            <span
              role="button"
              aria-label="Limpar selecao"
              onClick={handleClear}
              className="h-4 w-4 flex items-center justify-center text-muted-foreground hover:text-foreground rounded-sm hover:bg-muted/60 cursor-pointer"
            >
              <X size={12} />
            </span>
          )}
          <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 w-[var(--radix-popover-trigger-width)] min-w-[220px]"
        align="start"
        sideOffset={4}
      >
        <div className="p-2 border-b border-border">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={searchPlaceholder}
              className="w-full h-8 pl-8 pr-2 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>
        <div ref={listRef} className="max-h-64 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">{emptyText}</div>
          ) : (
            filtered.map((opt, idx) => {
              const isSelected = opt.value === value;
              const isHighlighted = idx === highlightIdx;
              return (
                <button
                  key={opt.value}
                  type="button"
                  data-idx={idx}
                  onClick={() => selectAt(idx)}
                  onMouseEnter={() => setHighlightIdx(idx)}
                  className={cn(
                    'w-full flex items-start gap-2 px-3 py-1.5 text-left text-sm cursor-pointer transition-colors',
                    isHighlighted ? 'bg-muted' : 'bg-transparent',
                    isSelected && 'font-semibold',
                  )}
                >
                  <Check
                    size={14}
                    className={cn(
                      'shrink-0 mt-0.5 transition-opacity',
                      isSelected ? 'opacity-100 text-primary' : 'opacity-0',
                    )}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate">{opt.label}</span>
                    {opt.description && (
                      <span className="block text-[11px] text-muted-foreground truncate">
                        {opt.description}
                      </span>
                    )}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
