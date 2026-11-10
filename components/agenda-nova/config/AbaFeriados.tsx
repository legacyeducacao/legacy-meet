'use client';

import * as React from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { toast } from '@/components/ui/custom-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Nacional = { data: string; nome: string; facultativo?: boolean };
type Cadastrado = { id: string; data: string; nome: string; escopo: string; uf: string | null; municipio: string | null };
type Previa = {
  grupos: Array<{ grupoNome: string; data: string; antes: { rotulo: string | null; status: string } | null; depois: { rotulo: string | null; status: string } | null }>;
  reunioesNoDia: number;
};

const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const ESCOPO: Record<string, string> = { nacional: 'Nacional', estadual: 'Estadual', municipal: 'Municipal', legacy: 'Recesso Legacy' };
async function erro(res: Response) {
  return (await res.text().catch(() => '')) || 'Algo deu errado.';
}
const descreve = (x: { rotulo: string | null; status: string } | null) =>
  !x ? '-' : x.status === 'pausada_feriado' ? 'sem aula (pausa)' : x.status === 'perdida_feriado' ? `${x.rotulo} perdida` : x.rotulo ?? '-';

export function AbaFeriados() {
  const [ano, setAno] = React.useState(new Date().getFullYear());
  const [dados, setDados] = React.useState<{ nacionais: Nacional[]; cadastrados: Cadastrado[]; podeEditar: boolean } | null>(null);
  const [novo, setNovo] = React.useState({ data: '', nome: '', escopo: 'legacy', uf: '', municipio: '' });
  const [previa, setPrevia] = React.useState<Previa | null>(null);
  const [busy, setBusy] = React.useState(false);

  const carregar = React.useCallback(async () => {
    const r = await fetch(`/api/agenda/feriados?ano=${ano}`, { cache: 'no-store' });
    if (r.ok) setDados(await r.json());
  }, [ano]);
  React.useEffect(() => {
    void carregar();
  }, [carregar]);

  const verImpacto = async () => {
    if (!novo.data || !novo.nome.trim()) return toast.error('Informe a data e o nome');
    setBusy(true);
    const r = await fetch('/api/agenda/feriados/previa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(novo) });
    setBusy(false);
    if (!r.ok) return toast.error('Não foi possível calcular o impacto', { description: await erro(r) });
    setPrevia(await r.json());
  };

  const cadastrar = async () => {
    setBusy(true);
    const r = await fetch('/api/agenda/feriados', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(novo) });
    setBusy(false);
    if (!r.ok) return toast.error('Não foi possível cadastrar', { description: await erro(r) });
    toast.success('Feriado cadastrado. Gere a agenda dos grupos para aplicar nos encontros novos.');
    setPrevia(null);
    setNovo({ data: '', nome: '', escopo: 'legacy', uf: '', municipio: '' });
    void carregar();
  };

  const remover = async (id: string) => {
    if (!window.confirm('Remover este feriado?')) return;
    const r = await fetch(`/api/agenda/feriados?id=${id}`, { method: 'DELETE' });
    if (!r.ok) return toast.error('Não foi possível remover', { description: await erro(r) });
    void carregar();
  };

  if (!dados) return <Loader2 className="mx-auto my-12 h-6 w-6 animate-spin text-muted-foreground" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setAno((a) => a - 1)}>
          {ano - 1}
        </Button>
        <span className="font-semibold">{ano}</span>
        <Button variant="outline" size="sm" onClick={() => setAno((a) => a + 1)}>
          {ano + 1}
        </Button>
      </div>

      {dados.podeEditar && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Cadastrar feriado ou recesso</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="f-data">Data</Label>
                <Input id="f-data" type="date" value={novo.data} onChange={(e) => setNovo({ ...novo, data: e.target.value })} className="w-40" />
              </div>
              <div className="min-w-48 flex-1 space-y-1.5">
                <Label htmlFor="f-nome">Nome</Label>
                <Input id="f-nome" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} placeholder="Ex.: Recesso de fim de ano" />
              </div>
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <select className="h-9 rounded-md border bg-background px-2 text-sm" value={novo.escopo} onChange={(e) => setNovo({ ...novo, escopo: e.target.value })}>
                  <option value="legacy">Recesso Legacy</option>
                  <option value="estadual">Estadual</option>
                  <option value="municipal">Municipal</option>
                </select>
              </div>
              {novo.escopo !== 'legacy' && (
                <div className="space-y-1.5">
                  <Label>UF</Label>
                  <Input maxLength={2} value={novo.uf} onChange={(e) => setNovo({ ...novo, uf: e.target.value.toUpperCase() })} className="w-16" />
                </div>
              )}
              {novo.escopo === 'municipal' && (
                <div className="space-y-1.5">
                  <Label>Município</Label>
                  <Input value={novo.municipio} onChange={(e) => setNovo({ ...novo, municipio: e.target.value })} className="w-44" />
                </div>
              )}
              <Button variant="outline" onClick={() => void verImpacto()} disabled={busy}>
                Ver impacto
              </Button>
            </div>
            {previa && (
              <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
                <p>
                  {previa.reunioesNoDia ? `${previa.reunioesNoDia} reunião(ões) já marcada(s) neste dia (continuam marcadas; remarque se precisar).` : 'Nenhuma reunião marcada neste dia.'}
                </p>
                {previa.grupos.length ? (
                  <>
                    <p className="font-medium">Grupos do Impulsão:</p>
                    <ul className="space-y-0.5">
                      {previa.grupos.map((g, i) => (
                        <li key={i}>
                          {g.grupoNome} · {br(g.data)}: {descreve(g.antes)} → <strong>{descreve(g.depois)}</strong>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-muted-foreground">Nenhum grupo muda.</p>
                )}
                <Button onClick={() => void cadastrar()} disabled={busy}>
                  Confirmar e cadastrar
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="divide-y p-0">
          {[
            ...dados.nacionais.map((f) => ({ ...f, escopo: 'nacional', id: null as string | null })),
            ...dados.cadastrados.map((f) => ({ ...f, facultativo: false })),
          ]
            .sort((a, b) => a.data.localeCompare(b.data))
            .map((f) => (
              <div key={`${f.data}-${f.nome}`} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                <span>
                  <span className="mr-2 tabular-nums text-muted-foreground">{br(f.data)}</span>
                  {f.nome}
                </span>
                <span className="flex items-center gap-2">
                  {f.facultativo && <Badge variant="outline">Ponto facultativo</Badge>}
                  <Badge variant="secondary">{ESCOPO[f.escopo] ?? f.escopo}</Badge>
                  {f.id && dados.podeEditar && (
                    <Button variant="ghost" size="icon" aria-label="Remover" onClick={() => void remover(f.id!)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </span>
              </div>
            ))}
        </CardContent>
      </Card>
    </div>
  );
}
