'use client';

﻿/**
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
import { Check, ChevronDown, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { cn } from '../../lib/utils';
import { filterBySearch, SelectSearchEmptyState, SelectSearchInput } from './select-search-core';

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
  /** Rotulo acessivel do combobox (quando nao ha <label for>). */
  ariaLabel?: string;
  /** id do botao-gatilho — pra casar com um <label htmlFor>. */
  id?: string;
  /**
   * Use `true` quando a combobox vive DENTRO de um Dialog/Sheet.
   *
   * O Radix Dialog tranca a rolagem da página (react-remove-scroll) e o
   * popover é renderizado num portal FORA da árvore do diálogo — resultado: a
   * roda do mouse é engolida e a lista só rola arrastando a barra. Com
   * `modal`, o popover passa a gerenciar a própria trava e a roda volta a
   * funcionar dentro dele.
   */
  modal?: boolean;
  /** Largura do popover. Default: confortável para nomes longos. */
  contentClassName?: string;
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
  ariaLabel,
  id,
  modal = false,
  contentClassName,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((o) => o.value === value);

  // Busca ignorando ACENTO e caixa (utils/normalizeForSearch): num plano de
  // contas com ~100 linhas, "lancamentos" tem que achar "Lançamentos" — o
  // usuário não digita acento no meio de uma triagem de importação.
  const filtered = useMemo(
    () => filterBySearch(options, query, (o) => [o.label, o.description, o.value]),
    [options, query],
  );

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
    <Popover open={open} onOpenChange={setOpen} modal={modal}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          // Padrão "listbox button": o gatilho continua sendo um BUTTON (é o
          // que ele é — não tem campo de texto embutido; a busca vive dentro do
          // popover) e anuncia o popup e o estado. Trocar para role="combobox"
          // mentiria sobre a estrutura e ainda renomearia o controle para todo
          // consumidor que já o encontra como botão.
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          className={cn(
            'flex items-center gap-2 w-full h-9 px-3 py-1 rounded-md border border-input bg-transparent text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer dark:bg-input/30',
            !selectedOption && 'text-muted-foreground',
            className,
          )}
        >
          <span className="flex-1 truncate text-left">
            {selectedOption?.label ?? placeholder}
          </span>
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
        // Largura: NUNCA menor que o gatilho, porém livre para passar dele —
        // preso à largura da coluna, "1.1.1.1 — Receita com produto 1" chegava
        // truncado como "Receita com pro...", que é ilegível numa triagem.
        className={cn(
          'p-0 min-w-[var(--radix-popover-trigger-width)] w-[min(26rem,calc(100vw-2rem))]',
          contentClassName,
        )}
        align="start"
        sideOffset={4}
      >
        <SelectSearchInput
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={searchPlaceholder}
        />
        <div
          ref={listRef}
          role="listbox"
          aria-label={ariaLabel}
          // A roda do mouse para AQUI: se subir, o contêiner que trancou a
          // rolagem (Dialog) a engole e a lista só rolaria pela barra.
          onWheel={(e) => e.stopPropagation()}
          className="max-h-72 overflow-y-auto overscroll-contain py-1"
        >
          {filtered.length === 0 ? (
            <SelectSearchEmptyState text={emptyText} />
          ) : (
            filtered.map((opt, idx) => {
              const isSelected = opt.value === value;
              const isHighlighted = idx === highlightIdx;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
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
                    <span className="block truncate" title={opt.label}>{opt.label}</span>
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
