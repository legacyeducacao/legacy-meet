'use client';

import * as React from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { toast } from '@/components/ui/custom-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { instante, weekdayIso, type FaixaExpediente } from '@/lib/agenda-engine';
import { DIAS_LONGOS } from '@/lib/agenda/visao';
import { EditorExpediente } from './EditorExpediente';

type Bloqueio = { id: string; inicio: string; fim: string; dia_inteiro: boolean; rrule: string | null; motivo: string | null };
type Dados = {
  executorId: string;
  expediente: FaixaExpediente[];
  usaPadrao: boolean;
  regras: { buffer_min: number | null; max_reunioes_dia: number | null; max_horas_dia: number | null; max_horas_semana: number | null; uf: string | null; municipio: string | null } | null;
  bloqueios: Bloqueio[];
  empresa: { expediente: FaixaExpediente[]; regras: { bufferMin: number; maxReunioesDia?: number | null; maxHorasDia?: number | null; maxHorasSemana?: number | null } };
  podeEditarLimites: boolean;
};

const SP = 'America/Sao_Paulo';
const fmt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: SP, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const DIA_RRULE = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
async function erro(res: Response) {
  return (await res.text().catch(() => '')) || 'Algo deu errado.';
}
const num = (v: string) => (v.trim() === '' ? null : Number(v));

export function AbaDisponibilidade({ isAdmin, meId }: { isAdmin: boolean; meId: string }) {
  const [executor, setExecutor] = React.useState(meId);
  const [equipe, setEquipe] = React.useState<Array<{ id: string; name: string }>>([]);
  const [d, setD] = React.useState<Dados | null>(null);
  const [expediente, setExpediente] = React.useState<FaixaExpediente[]>([]);
  const [buffer, setBuffer] = React.useState('');
  const [limites, setLimites] = React.useState({ dia: '', horasDia: '', horasSemana: '', uf: '', municipio: '' });
  const [salvando, setSalvando] = React.useState(false);

  const carregar = React.useCallback(async () => {
    const r = await fetch(`/api/agenda/disponibilidade?executorId=${executor}`, { cache: 'no-store' });
    if (!r.ok) return toast.error('Não foi possível carregar', { description: await erro(r) });
    const j = (await r.json()) as Dados;
    setD(j);
    setExpediente(j.expediente);
    setBuffer(j.regras?.buffer_min != null ? String(j.regras.buffer_min) : '');
    setLimites({
      dia: j.regras?.max_reunioes_dia != null ? String(j.regras.max_reunioes_dia) : '',
      horasDia: j.regras?.max_horas_dia != null ? String(j.regras.max_horas_dia) : '',
      horasSemana: j.regras?.max_horas_semana != null ? String(j.regras.max_horas_semana) : '',
      uf: j.regras?.uf ?? '',
      municipio: j.regras?.municipio ?? '',
    });
  }, [executor]);

  React.useEffect(() => {
    void carregar();
  }, [carregar]);
  React.useEffect(() => {
    if (isAdmin) fetch('/api/team').then((r) => r.json()).then((j) => setEquipe(j.members ?? [])).catch(() => {});
  }, [isAdmin]);

  const salvar = async () => {
    setSalvando(true);
    const r = await fetch('/api/agenda/disponibilidade', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        executorId: executor,
        expediente,
        bufferMin: num(buffer),
        ...(isAdmin
          ? { maxReunioesDia: num(limites.dia), maxHorasDia: num(limites.horasDia), maxHorasSemana: num(limites.horasSemana), uf: limites.uf || null, municipio: limites.municipio || null }
          : {}),
      }),
    });
    setSalvando(false);
    if (!r.ok) return toast.error('Não foi possível salvar', { description: await erro(r) });
    toast.success('Disponibilidade salva');
    void carregar();
  };

  if (!d) {
    return (
      <div className="flex justify-center py-12 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="max-w-sm space-y-1.5">
          <Label>Executor</Label>
          <SearchableSelect value={executor} onValueChange={(v) => setExecutor(v || meId)} options={equipe.map((m) => ({ value: m.id, label: m.name }))} placeholder="Eu" searchPlaceholder="Buscar…" emptyText="Ninguém." />
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Expediente</CardTitle>
          <p className="text-sm text-muted-foreground">
            {d.usaPadrao ? 'Usando o padrão da empresa. Ajuste e salve para ter o seu.' : 'Horários em que você atende.'} Reunião fora daqui gera aviso.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <EditorExpediente valor={expediente} onChange={setExpediente} />
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="d-buffer">Intervalo entre reuniões (min)</Label>
              <Input id="d-buffer" type="number" min={d.empresa.regras.bufferMin} step={5} placeholder={String(d.empresa.regras.bufferMin)} value={buffer} onChange={(e) => setBuffer(e.target.value)} className="w-32" />
              <p className="text-xs text-muted-foreground">Mínimo da empresa: {d.empresa.regras.bufferMin} min.</p>
            </div>
            <Button variant="ghost" onClick={() => setExpediente(d.empresa.expediente)}>
              Voltar ao padrão da empresa
            </Button>
          </div>
          {d.podeEditarLimites && (
            <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-3">
              <p className="text-sm font-medium sm:col-span-3">Limites deste executor (só admin; vazio = padrão da empresa)</p>
              {(
                [
                  ['dia', 'Reuniões por dia', d.empresa.regras.maxReunioesDia],
                  ['horasDia', 'Horas por dia', d.empresa.regras.maxHorasDia],
                  ['horasSemana', 'Horas por semana', d.empresa.regras.maxHorasSemana],
                ] as const
              ).map(([k, rotulo, padrao]) => (
                <div key={k} className="space-y-1.5">
                  <Label>{rotulo}</Label>
                  <Input type="number" min={0} value={limites[k]} placeholder={padrao != null ? String(padrao) : ''} onChange={(e) => setLimites((l) => ({ ...l, [k]: e.target.value }))} />
                </div>
              ))}
              <div className="space-y-1.5">
                <Label>UF (feriados estaduais)</Label>
                <Input maxLength={2} value={limites.uf} onChange={(e) => setLimites((l) => ({ ...l, uf: e.target.value.toUpperCase() }))} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Município (feriados municipais)</Label>
                <Input value={limites.municipio} onChange={(e) => setLimites((l) => ({ ...l, municipio: e.target.value }))} />
              </div>
            </div>
          )}
          <Button onClick={() => void salvar()} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar disponibilidade'}
          </Button>
        </CardContent>
      </Card>

      <Bloqueios executorId={executor} bloqueios={d.bloqueios} onMudou={carregar} />
    </div>
  );
}

function Bloqueios({ executorId, bloqueios, onMudou }: { executorId: string; bloqueios: Bloqueio[]; onMudou: () => void }) {
  const [data, setData] = React.useState('');
  const [ini, setIni] = React.useState('09:00');
  const [fim, setFim] = React.useState('12:00');
  const [diaInteiro, setDiaInteiro] = React.useState(false);
  const [semanal, setSemanal] = React.useState(false);
  const [motivo, setMotivo] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [afetadas, setAfetadas] = React.useState<Array<{ id: string; titulo: string; inicio: string }> | null>(null);

  const criar = async () => {
    if (!data) return toast.error('Escolha a data');
    const inicio = instante(data, diaInteiro ? '00:00' : ini, SP);
    const termino = diaInteiro ? instante(data, '24:00', SP) : instante(data, fim, SP);
    if (termino <= inicio) return toast.error('O fim precisa ser depois do início');
    setBusy(true);
    const r = await fetch('/api/agenda/bloqueios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        executorId,
        inicio: inicio.toISOString(),
        fim: termino.toISOString(),
        diaInteiro,
        motivo,
        rrule: semanal ? `FREQ=WEEKLY;BYDAY=${DIA_RRULE[weekdayIso(data) - 1]}` : null,
      }),
    });
    setBusy(false);
    if (!r.ok) return toast.error('Não foi possível bloquear', { description: await erro(r) });
    const j = (await r.json()) as { afetadas: Array<{ id: string; titulo: string; inicio: string }> };
    setAfetadas(j.afetadas);
    toast.success('Horário bloqueado');
    setMotivo('');
    onMudou();
  };

  const remover = async (id: string) => {
    const r = await fetch(`/api/agenda/bloqueios/${id}`, { method: 'DELETE' });
    if (!r.ok) return toast.error('Não foi possível remover', { description: await erro(r) });
    onMudou();
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Bloqueios pessoais</CardTitle>
        <p className="text-sm text-muted-foreground">Os outros veem só &quot;Indisponível&quot;. O motivo fica só para você e para os admins.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="b-data">Data</Label>
            <Input id="b-data" type="date" value={data} onChange={(e) => setData(e.target.value)} className="w-40" />
          </div>
          {!diaInteiro && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="b-ini">De</Label>
                <Input id="b-ini" type="time" step={900} value={ini} onChange={(e) => setIni(e.target.value)} className="w-28" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="b-fim">Até</Label>
                <Input id="b-fim" type="time" step={900} value={fim} onChange={(e) => setFim(e.target.value)} className="w-28" />
              </div>
            </>
          )}
          <label className="flex items-center gap-2 pb-2 text-sm">
            <Switch checked={diaInteiro} onCheckedChange={setDiaInteiro} /> Dia inteiro
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <Switch checked={semanal} onCheckedChange={setSemanal} /> Toda semana{data ? ` (${DIAS_LONGOS[weekdayIso(data) - 1]})` : ''}
          </label>
          <div className="min-w-48 flex-1 space-y-1.5">
            <Label htmlFor="b-motivo">Motivo (privado)</Label>
            <Input id="b-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: consulta médica" />
          </div>
          <Button onClick={() => void criar()} disabled={busy}>
            {busy ? 'Bloqueando…' : 'Bloquear'}
          </Button>
        </div>

        {afetadas && (
          <div className={afetadas.length ? 'rounded-lg border border-amber-400 bg-amber-500/10 p-3 text-sm' : 'text-sm text-muted-foreground'}>
            {afetadas.length ? (
              <>
                <p className="font-medium">Este bloqueio atinge {afetadas.length} reunião(ões) já marcada(s). Remarque pela agenda:</p>
                <ul className="mt-1 list-disc pl-5">
                  {afetadas.map((a) => (
                    <li key={a.id}>
                      {fmt(a.inicio)} · {a.titulo}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              'Nenhuma reunião marcada é atingida.'
            )}
          </div>
        )}

        <ul className="divide-y rounded-lg border">
          {bloqueios.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">Nenhum bloqueio futuro.</li>}
          {bloqueios.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>
                {b.dia_inteiro ? new Date(b.inicio).toLocaleDateString('pt-BR', { timeZone: SP }) + ' · dia inteiro' : `${fmt(b.inicio)} às ${new Date(b.fim).toLocaleTimeString('pt-BR', { timeZone: SP, hour: '2-digit', minute: '2-digit' })}`}
                {b.rrule ? ' · toda semana' : ''}
                {b.motivo ? <span className="text-muted-foreground"> · {b.motivo}</span> : null}
              </span>
              <Button variant="ghost" size="icon" aria-label="Remover bloqueio" onClick={() => void remover(b.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
