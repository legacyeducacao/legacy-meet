'use client';

import React from 'react';
import { cn } from '../../lib/utils';

/**
 * Estado vazio no padrão do Legacy Plan: ícone em bloco arredondado,
 * título curto, descrição opcional e ação opcional.
 * Importante: usar apenas quando NÃO há dados de fato — durante o
 * carregamento, use os skeletons (nunca um empty state no load).
 */
export interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 text-center', className)}>
      <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center text-muted-foreground mb-4">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-sm mt-1">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export default EmptyState;
