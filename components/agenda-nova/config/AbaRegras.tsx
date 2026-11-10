'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from '@/components/ui/custom-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { NOME_CONFLITO } from '@/lib/agenda/tipos';
import type { FaixaExpediente } from '@/lib/agenda-engine';
import { EditorExpediente } from './EditorExpediente';

type Config = {
  expediente: FaixaExpediente[];
  regras: { bufferMin: number; maxReunioesDia?: number | null; maxHorasDia?: number | null; maxHorasSemana?: number | null };
  niveis: Record<string, 'bloqueante' | 'aviso'>;
  horizonteMeses: number;
  considerarFacultativos: boolean;
};
const num = (v: string) => (v.trim() === '' ? null : Number(v));

/** Padrões da empresa: só admin altera; os demais veem. */
export function AbaRegras() {
  const [c, setC] = React.useState<Config | null>(null);
  const [podeEditar, setPodeEditar] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    fetch('/api/agenda/config', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        setC(j.config);
        setPodeEditar(!!j.podeEditar);
      })
      .catch(() => {});
  }, []);

  if (!c) return <Loader2 className="mx-auto my-12 h-6 w-6 animate-spin text-muted-foreground" />;
  const set = (p: Partial<Config>) => setC({ ...c, ...p });
  const setR = (p: Partial<Config['regras']>) => setC({ ...c, regras: { ...c.regras, ...p } });

  const salvar = async () => {
    setBusy(true);
    const r = await fetch('/api/agenda/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expediente: c.expediente, regras: c.regras, niveis: c.niveis, horizonteMeses: c.horizonteMeses, considerarFacultativos: c.considerarFacultativos }),
    });
    setBusy(false);
    if (!r.ok) return toast.error('Não foi possível salvar', { description: (await r.text()) || undefined });
    toast.success('Regras da empresa salvas');
  };

  return (
    <div className="space-y-4">
      {!podeEditar && <p className="text-sm text-muted-foreground">Só os admins alteram as regras da empresa.</p>}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Expediente padrão</CardTitle>
          <p className="text-sm text-muted-foreground">Vale para quem não cadastrou o próprio expediente.</p>
        </CardHeader>
        <CardContent>
          <EditorExpediente valor={c.expediente} onChange={(v) => set({ expediente: v })} desabilitado={!podeEditar} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Limites e intervalo</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Intervalo mínimo entre reuniões (min)</Label>
            <Input type="number" min={0} step={5} disabled={!podeEditar} value={c.regras.bufferMin} onChange={(e) => setR({ bufferMin: Number(e.target.value) || 0 })} />
          </div>
          <div className="space-y-1.5">
            <Label>Máximo de reuniões por dia</Label>
            <Input type="number" min={0} disabled={!podeEditar} value={c.regras.maxReunioesDia ?? ''} onChange={(e) => setR({ maxReunioesDia: num(e.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label>Máximo de horas por dia</Label>
            <Input type="number" min={0} disabled={!podeEditar} value={c.regras.maxHorasDia ?? ''} onChange={(e) => setR({ maxHorasDia: num(e.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label>Máximo de horas por semana</Label>
            <Input type="number" min={0} disabled={!podeEditar} value={c.regras.maxHorasSemana ?? ''} onChange={(e) => setR({ maxHorasSemana: num(e.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label>Validar a agenda até quantos meses à frente</Label>
            <Input type="number" min={1} max={24} disabled={!podeEditar} value={c.horizonteMeses} onChange={(e) => set({ horizonteMeses: Number(e.target.value) || 6 })} />
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <Switch disabled={!podeEditar} checked={c.considerarFacultativos} onCheckedChange={(v) => set({ considerarFacultativos: v })} />
            Carnaval e Corpus Christi contam como feriado
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">O que cada regra faz</CardTitle>
          <p className="text-sm text-muted-foreground">&quot;Impede salvar&quot;: só admin passa por cima, com motivo. &quot;Avisa&quot;: salva com motivo. Tudo fica registrado.</p>
        </CardHeader>
        <CardContent>
          <div className="divide-y rounded-lg border">
            {Object.entries(c.niveis).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span>{NOME_CONFLITO[k] ?? k}</span>
                <select disabled={!podeEditar} className="h-8 shrink-0 rounded-md border bg-background px-2" value={v} onChange={(e) => set({ niveis: { ...c.niveis, [k]: e.target.value as 'bloqueante' | 'aviso' } })}>
                  <option value="aviso">Avisa</option>
                  <option value="bloqueante">Impede salvar</option>
                </select>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {podeEditar && (
        <Button onClick={() => void salvar()} disabled={busy}>
          {busy ? 'Salvando…' : 'Salvar regras da empresa'}
        </Button>
      )}
    </div>
  );
}
