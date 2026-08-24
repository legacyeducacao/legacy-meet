'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button, buttonVariants } from './button';
import type { VariantProps } from 'class-variance-authority';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from './tooltip';
import { cn } from '../../lib/utils';
import { toast } from './custom-toast';

type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
type ButtonSize = VariantProps<typeof buttonVariants>['size'];

interface CopyButtonProps {
  /** Texto que vai pra área de transferência. */
  value: string;
  /** Texto exibido ao lado do ícone (omitir pra botão só-ícone). */
  label?: string;
  /** Tooltip do app (Radix) — NUNCA `title` nativo. Omitir = sem tooltip. */
  tooltip?: string;
  className?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Mensagem pt-BR customizada pro toast de erro. */
  errorMessage?: string;
  /** Chamado após o copy ter sucesso — pra efeitos colaterais do chamador
   *  (ex: fechar um passo, recarregar uma lista). */
  onCopied?: () => void;
  disabled?: boolean;
  /** Repassado pro <button> — útil quando não há `label` visível. */
  'aria-label'?: string;
}

/**
 * Botão de copiar com morph Copy → Check (verde, `text-success`) por 1,2s +
 * micro-scale no ícone (`mi-copy-check`, CSS em tokens.css). Substitui os
 * pontos que fariam `navigator.clipboard.writeText` + toast de sucesso
 * manualmente — aqui o morph do ícone É o feedback de sucesso, então não
 * duplica com um toast.success. Erro (ex: clipboard bloqueado pelo browser)
 * continua caindo no toast padrão de erro.
 */
export const CopyButton: React.FC<CopyButtonProps> = ({
  value,
  label,
  tooltip,
  className,
  variant = 'outline',
  size = 'sm',
  errorMessage,
  onCopied,
  disabled,
  'aria-label': ariaLabel,
}) => {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleClick = async () => {
    try {
      await navigator.clipboard.writeText(value);
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
      setCopied(true);
      timeoutRef.current = setTimeout(() => setCopied(false), 1200);
      onCopied?.();
    } catch {
      toast.error(errorMessage ?? 'Não foi possível copiar. Selecione e copie manualmente.');
    }
  };

  // A11y: botão só-ícone (sem `label` visível) precisa de accessible name.
  // O Radix Tooltip só vira aria-describedby quando ABERTO (hover/focus) —
  // não é um substituto de aria-label. Sem `label` nem `aria-label`
  // explícito, cai pro texto do tooltip (mesmo texto que description).
  const resolvedAriaLabel = ariaLabel ?? (!label ? tooltip : undefined);

  const button = (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={disabled}
      onClick={handleClick}
      aria-label={resolvedAriaLabel}
      className={cn(label ? 'gap-2' : undefined, className)}
    >
      {copied ? (
        <Check key="check" size={14} className="text-success mi-copy-check" />
      ) : (
        <Copy key="copy" size={14} />
      )}
      {label}
    </Button>
  );

  if (!tooltip) return button;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default CopyButton;
