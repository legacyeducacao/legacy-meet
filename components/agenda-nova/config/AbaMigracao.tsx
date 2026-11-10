'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from '@/components/ui/custom-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Relatorio = {
  seriesEncontradas: number;
  jaNoModeloNovo: number;
  semAnfitriao: number;
  seriesMigradas: number;
  ocorrencias: number;
  jornadasLegado: { ativas: number; concluidas: number };
  regras: Record<string, number>;
  porExecutor: Array<{ nome: string; series: number }>;
};
type Lote = { id: string; executada_em: string; revertida_em: string | null; relatorio: Relatorio };

const ORIGEM: Record<string, string> = { meet: 'Agenda antiga do Meet', plan: 'Legacy Plan', inferida: 'deduzida das datas', 'agenda-nova': 'agenda nova' };

function Resumo({ r }: { r: Relatorio }) {
  return (
    <div className="space-y-1 text-sm">
      <p>
        {r.seriesMigradas} série(s) com {r.ocorrencias} reunião(ões). Jornadas do Legado: {r.jornadasLegado.ativas} ativa(s) e {r.jornadasLegado.concluidas} concluída(s).
      </p>
      <p className="text-muted-foreground">
        Já no modelo novo: {r.jaNoModeloNovo}. Sem anfitrião (não migradas): {r.semAnfitriao}. Regras:{' '}
        {Object.entries(r.regras)
          .map(([k, v]) => `${v} ${ORIGEM[k] ?? k}`)
          .join(', ') || 'nenhuma'}
        .
      </p>
      {r.porExecutor.length > 0 && <p className="text-muted-foreground">Por executor: {r.porExecutor.map((e) => `${e.nome} (${e.series})`).join(', ')}.</p>}
    </div>
  );
}

/** Fase 6: traz as séries existentes para a agenda nova. Só admin. Reuniões não mudam; cada lote pode ser desfeito. */
export function AbaMigracao() {
  const [lotes, setLotes] = React.useState<Lote[] | null>(null);
  const [previa, setPrevia] = React.useState<Relatorio | null>(null);
  const [busy, setBusy] = React.useState(false);

  const carregar = React.useCallback(async () => {
    const r = await fetch('/api/agenda/migracao', { cache: 'no-store' });
    if (r.ok) setLotes((await r.json()).lotes);
  }, []);
  React.useEffect(() => {
    void carregar();
  }, [carregar]);

  const acao = async (corpo: Record<string, string>) => {
    setBusy(true);
    const r = await fetch('/api/agenda/migracao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
    setBusy(false);
    if (!r.ok) {
      toast.error('Não foi possível', { description: await r.text() });
      return null;
    }
    return r.json();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Trazer as séries existentes</CardTitle>
          <p className="text-sm text-muted-foreground">
            Registra as reuniões recorrentes já marcadas (Agenda antiga e Legacy Plan) no modelo da agenda nova e cria as jornadas do Legado. Nenhuma reunião é alterada, e cada lote pode ser desfeito.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={async () => {
                const j = await acao({ acao: 'simular' });
                if (j) setPrevia(j.relatorio);
              }}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Simular
            </Button>
            {previa && previa.seriesMigradas > 0 && (
              <Button
                disabled={busy}
                onClick={async () => {
                  const j = await acao({ acao: 'executar' });
                  if (j) {
                    toast.success(`Migração feita: ${j.relatorio.seriesMigradas} série(s)`);
                    setPrevia(null);
                    void carregar();
                  }
                }}
              >
                Executar
              </Button>
            )}
          </div>
          {previa && (
            <div className="rounded-lg border bg-muted/30 p-3">
              {previa.seriesMigradas === 0 ? <p className="text-sm">Nada novo para migrar.</p> : <Resumo r={previa} />}
            </div>
          )}
        </CardContent>
      </Card>

      {lotes === null ? (
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
      ) : (
        lotes.map((l) => (
          <Card key={l.id}>
            <CardContent className="space-y-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  Lote de {new Date(l.executada_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
                  {l.revertida_em && <Badge variant="outline" className="ml-2">Desfeito</Badge>}
                </p>
                {!l.revertida_em && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    disabled={busy}
                    onClick={async () => {
                      if (!window.confirm('Desfazer este lote? As séries e jornadas criadas por ele saem da agenda nova (as reuniões continuam).')) return;
                      const j = await acao({ acao: 'reverter', id: l.id });
                      if (j) {
                        toast.success(`Desfeito: ${j.series} série(s) e ${j.jornadas} jornada(s)`);
                        void carregar();
                      }
                    }}
                  >
                    Desfazer
                  </Button>
                )}
              </div>
              <Resumo r={l.relatorio} />
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
