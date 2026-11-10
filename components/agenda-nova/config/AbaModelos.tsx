'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from '@/components/ui/custom-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

type Template = {
  id: string;
  nome: string;
  produto: 'impulsao' | 'legado' | 'personalizado';
  duracao_min: number;
  hora_padrao: string | null;
  sequencia: string[];
  entradas_permitidas: string[];
  politica_feriado: string;
  encontros_total: number | null;
  limite_remarcacoes: number | null;
  preparo_min: number;
  campos_editaveis: string[];
  ativo: boolean;
};

const CAMPOS: Array<[string, string]> = [
  ['dia_semana', 'Dia da semana'],
  ['hora', 'Horário'],
  ['ancora', 'Data da primeira aula'],
  ['defasagem', 'Defasagem do grupo'],
  ['duracao_min', 'Duração'],
];
const PRODUTO: Record<string, string> = { impulsao: 'Impulsão', legado: 'Legado', personalizado: 'Personalizado' };
const lista = (s: string) => s.split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);

/** Modelos de agenda. Só admin edita; o executor usa nos campos que o admin libera. */
export function AbaModelos() {
  const [ts, setTs] = React.useState<Template[] | null>(null);
  const [podeEditar, setPodeEditar] = React.useState(false);

  const carregar = React.useCallback(async () => {
    const r = await fetch('/api/agenda/templates', { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    setTs(j.templates);
    setPodeEditar(!!j.podeEditar);
  }, []);
  React.useEffect(() => {
    void carregar();
  }, [carregar]);

  if (!ts) return <Loader2 className="mx-auto my-12 h-6 w-6 animate-spin text-muted-foreground" />;
  return (
    <div className="space-y-4">
      {!podeEditar && <p className="text-sm text-muted-foreground">Só os admins alteram os modelos.</p>}
      {ts.map((t) => (
        <Modelo key={t.id} t={t} podeEditar={podeEditar} onSalvo={carregar} />
      ))}
    </div>
  );
}

function Modelo({ t, podeEditar, onSalvo }: { t: Template; podeEditar: boolean; onSalvo: () => void }) {
  const [v, setV] = React.useState(t);
  const [seq, setSeq] = React.useState(t.sequencia.join(', '));
  const [ent, setEnt] = React.useState(t.entradas_permitidas.join(', '));
  const [busy, setBusy] = React.useState(false);
  const set = (p: Partial<Template>) => setV({ ...v, ...p });

  const salvar = async () => {
    setBusy(true);
    const r = await fetch(`/api/agenda/templates/${t.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: v.nome,
        duracao_min: v.duracao_min,
        hora_padrao: v.hora_padrao || null,
        sequencia: lista(seq),
        entradas_permitidas: lista(ent),
        politica_feriado: v.politica_feriado,
        encontros_total: v.encontros_total,
        limite_remarcacoes: v.limite_remarcacoes,
        preparo_min: v.preparo_min,
        campos_editaveis: v.campos_editaveis,
        ativo: v.ativo,
      }),
    });
    setBusy(false);
    if (!r.ok) return toast.error('Não foi possível salvar', { description: (await r.text()) || undefined });
    toast.success('Modelo salvo');
    onSalvo();
  };

  const d = !podeEditar;
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input value={v.nome} disabled={d} onChange={(e) => set({ nome: e.target.value })} className="max-w-xs font-semibold" aria-label="Nome do modelo" />
          <Badge variant="secondary">{PRODUTO[v.produto]}</Badge>
          <label className="ml-auto flex items-center gap-2 text-sm">
            <Switch disabled={d} checked={v.ativo} onCheckedChange={(x) => set({ ativo: x })} /> Ativo
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label>Duração (min)</Label>
            <Input type="number" min={15} step={15} disabled={d} value={v.duracao_min} onChange={(e) => set({ duracao_min: Number(e.target.value) || 60 })} />
          </div>
          <div className="space-y-1.5">
            <Label>Horário padrão</Label>
            <Input type="time" step={900} disabled={d} value={v.hora_padrao ?? ''} onChange={(e) => set({ hora_padrao: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Encontros na jornada</Label>
            <Input type="number" min={1} disabled={d} value={v.encontros_total ?? ''} onChange={(e) => set({ encontros_total: Number(e.target.value) || null })} />
          </div>
          <div className="space-y-1.5">
            <Label>Remarcações permitidas</Label>
            <Input type="number" min={0} disabled={d} value={v.limite_remarcacoes ?? ''} onChange={(e) => set({ limite_remarcacoes: e.target.value === '' ? null : Number(e.target.value) })} />
          </div>
          {v.produto === 'impulsao' && (
            <>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Sequência do ciclo</Label>
                <Input disabled={d} value={seq} onChange={(e) => setSeq(e.target.value)} placeholder="F1, F2, C1, C2" />
              </div>
              <div className="space-y-1.5">
                <Label>Onde o cliente pode entrar</Label>
                <Input disabled={d} value={ent} onChange={(e) => setEnt(e.target.value)} placeholder="F1, C1" />
              </div>
            </>
          )}
          <div className="space-y-1.5">
            <Label>Em feriado</Label>
            <select disabled={d} className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={v.politica_feriado} onChange={(e) => set({ politica_feriado: e.target.value })}>
              {v.produto === 'impulsao' ? (
                <>
                  <option value="pausa">o ciclo pausa (conteúdo vai para a semana seguinte)</option>
                  <option value="segue">o ciclo segue (semana perdida, aula reposta)</option>
                </>
              ) : (
                <>
                  <option value="pular">pular e colocar no fim</option>
                  <option value="cancelar">não marcar</option>
                  <option value="manter">marcar assim mesmo</option>
                </>
              )}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Preparo antes (min)</Label>
            <Input type="number" min={0} step={5} disabled={d} value={v.preparo_min} onChange={(e) => set({ preparo_min: Number(e.target.value) || 0 })} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>O executor pode ajustar</Label>
          <div className="flex flex-wrap gap-3">
            {CAMPOS.map(([k, rotulo]) => (
              <label key={k} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  disabled={d}
                  checked={v.campos_editaveis.includes(k)}
                  onChange={(e) => set({ campos_editaveis: e.target.checked ? [...v.campos_editaveis, k] : v.campos_editaveis.filter((x) => x !== k) })}
                />
                {rotulo}
              </label>
            ))}
          </div>
        </div>
        {podeEditar && (
          <Button size="sm" onClick={() => void salvar()} disabled={busy}>
            {busy ? 'Salvando…' : 'Salvar modelo'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
