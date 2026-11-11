'use client';

import * as React from 'react';
import { AlertTriangle, Loader2, RotateCcw } from 'lucide-react';
import { toast } from '@/components/ui/custom-toast';
import { Button } from '@/components/ui/button';

type Resumo = { total: number; semCreditos: number; ultimoErro: string | null; desde: string | null };

/**
 * Aviso dos admins no topo das telas: reuniões que não chegaram ao ExecScore
 * (em 10/11/2026 os créditos acabaram e ninguém percebeu). Some quando zera.
 */
export function AvisoErrosExecScore() {
  const [r, setR] = React.useState<Resumo | null>(null);
  const [enviando, setEnviando] = React.useState(false);

  React.useEffect(() => {
    let cancelado = false;
    fetch('/api/execscore/erros', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((j: Resumo | null) => !cancelado && setR(j))
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, []);

  if (!r || r.total === 0) return null;

  const reenviar = async () => {
    setEnviando(true);
    try {
      const res = await fetch('/api/execscore/erros', { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const j = (await res.json()) as { reenviadas: number };
      toast.success(`${j.reenviadas} reunião(ões) reenviada(s)`, {
        description: 'O ExecScore avalia uma por vez. Se der erro de novo, o aviso volta.',
      });
      setR(null);
    } catch {
      toast.error('Não foi possível reenviar agora.');
    } finally {
      setEnviando(false);
    }
  };

  const plural = r.total === 1 ? 'reunião não chegou' : 'reuniões não chegaram';
  const desde = r.desde ? new Date(r.desde).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : null;
  return (
    <div
      role="alert"
      className="mb-4 flex flex-col gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
        <div className="space-y-0.5">
          <p className="font-medium">
            {r.semCreditos > 0
              ? `O ExecScore está sem créditos: ${r.total} ${plural} para avaliação.`
              : `${r.total} ${plural} ao ExecScore.`}
          </p>
          <p className="text-muted-foreground">
            {r.semCreditos > 0
              ? 'Recarregue os créditos do ExecScore e clique em Reenviar.'
              : `Último erro: ${r.ultimoErro ?? 'sem detalhe'}.`}
            {desde ? ` Primeiro erro em ${desde}.` : ''}
          </p>
        </div>
      </div>
      <Button size="sm" variant="outline" className="shrink-0" onClick={() => void reenviar()} disabled={enviando}>
        {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
        Reenviar
      </Button>
    </div>
  );
}
