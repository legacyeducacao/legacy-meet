'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { cn } from '@/lib/utils';
import { expandirSerie, instante, localYmd, weekdayIso, type Ymd } from '@/lib/agenda-engine';
import {
  DIAS_CURTOS,
  descreverRepeticao,
  horaCurta,
  montarRRule,
  posicaoNoMes,
  SEM_REPETICAO,
  type Frequencia,
  type Repeticao,
} from '@/lib/agenda/visao';
import type { ConflitoDTO } from '@/lib/agenda/tipos';
import { ListaConflitos } from './Dialogos';
import type { Cliente } from './Cartoes';

export interface ValoresEvento {
  /** Presente = edição de uma reunião existente (só título e horário mudam). */
  id?: string;
  recorrente?: boolean;
  titulo: string;
  setor: 'executoria' | 'comercial';
  tenantId: string;
  inicio: Date;
  fim: Date;
  repeticao: Repeticao;
  politicaFeriado: 'manter' | 'pular' | 'cancelar';
  gravar: boolean;
  transcrever: boolean;
  onboarding: boolean;
  coHostIds: string[];
  guestEmails: string;
}

export interface Membro {
  id: string;
  name: string;
}

const ORD = ['', '1ª', '2ª', '3ª', '4ª', '5ª'];

/** Formulário completo ("Mais opções"): repetição, feriados, gravação, anfitriões e prévia de conflitos. */
export function FormularioEvento({
  inicial,
  tz,
  podeEscolherSetor,
  clientes,
  equipe,
  meId,
  onFechar,
  onSalvar,
}: {
  inicial: ValoresEvento;
  tz: string;
  podeEscolherSetor: boolean;
  clientes: Cliente[];
  equipe: Membro[];
  meId: string;
  onFechar: () => void;
  onSalvar: (v: ValoresEvento, justificativa?: string) => Promise<boolean>;
}) {
  const [v, setV] = React.useState<ValoresEvento>(inicial);
  const [data, setData] = React.useState<Ymd>(localYmd(inicial.inicio, tz));
  const [horaIni, setHoraIni] = React.useState(horaCurta(inicial.inicio, tz));
  const [horaFim, setHoraFim] = React.useState(horaCurta(inicial.fim, tz));
  const [conflitos, setConflitos] = React.useState<ConflitoDTO[]>([]);
  const [podeSobrepor, setPodeSobrepor] = React.useState(false);
  const [just, setJust] = React.useState('');
  const [erro, setErro] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const edicao = !!v.id;
  const set = <K extends keyof ValoresEvento>(k: K, val: ValoresEvento[K]) => setV((x) => ({ ...x, [k]: val }));
  const rep = v.repeticao;
  const setRep = (r: Partial<Repeticao>) => set('repeticao', { ...rep, ...r });

  const inicio = React.useMemo(() => {
    try {
      return instante(data, horaIni, tz);
    } catch {
      return null;
    }
  }, [data, horaIni, tz]);
  const fim = React.useMemo(() => {
    try {
      const f = instante(data, horaFim, tz);
      return inicio && f <= inicio ? new Date(f.getTime() + 86_400_000) : f;
    } catch {
      return null;
    }
  }, [data, horaFim, tz, inicio]);

  // Ocorrências para a prévia de conflitos (o servidor revalida ao salvar).
  const candidatas = React.useMemo(() => {
    if (!inicio || !fim) return [];
    const rrule = edicao ? null : montarRRule(rep, data);
    if (!rrule) return [{ inicio, fim }];
    const dur = Math.round((fim.getTime() - inicio.getTime()) / 60_000);
    const ate = new Date(inicio.getTime() + 366 * 86_400_000);
    try {
      return expandirSerie({ rrule, inicioLocal: `${data}T${horaIni}`, fuso: tz, duracaoMin: dur }, { de: new Date(inicio.getTime() - 60_000), ate }, { maxOcorrencias: 200 })
        .slice(0, 200)
        .map((o) => ({ inicio: o.inicio, fim: o.fim }));
    } catch {
      return [];
    }
  }, [inicio, fim, rep, data, horaIni, tz, edicao]);

  React.useEffect(() => {
    if (!candidatas.length) return setConflitos([]);
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch('/api/agenda/validar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: ctrl.signal,
          body: JSON.stringify({
            candidatas: candidatas.map((c) => ({ inicio: c.inicio.toISOString(), fim: c.fim.toISOString(), substituiEventoId: v.id })),
          }),
        });
        if (!res.ok) return;
        const j = (await res.json()) as { conflitos: ConflitoDTO[]; podeSobreporBloqueante?: boolean };
        setConflitos(j.conflitos);
        setPodeSobrepor(!!j.podeSobreporBloqueante);
      } catch {
        /* abortado ou sem rede: o servidor confere ao salvar */
      }
    }, 400);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [candidatas, v.id]);

  const temBloqueante = conflitos.some((c) => c.nivel === 'bloqueante');
  const travado = temBloqueante && !podeSobrepor;

  const salvar = async () => {
    if (!v.titulo.trim()) return setErro('Informe o título.');
    if (!edicao && v.setor === 'executoria' && !v.tenantId) return setErro('Selecione o cliente.');
    if (!inicio || !fim) return setErro('Confira a data e os horários.');
    if (conflitos.length && !just.trim()) return setErro('Há conflitos: escreva o motivo para salvar mesmo assim.');
    setErro('');
    setBusy(true);
    const ok = await onSalvar({ ...v, titulo: v.titulo.trim(), inicio, fim }, just.trim() || undefined);
    setBusy(false);
    if (ok) onFechar();
  };

  const freqs: Array<{ v: Frequencia; rotulo: string }> = [
    { v: 'nenhuma', rotulo: 'Não se repete' },
    { v: 'diaria', rotulo: 'Todos os dias' },
    { v: 'semanal', rotulo: 'Semanal' },
    { v: 'mensal_dia', rotulo: `Mensal no dia ${Number(data.slice(8))}` },
    {
      v: 'mensal_semana',
      rotulo: `Mensal na ${posicaoNoMes(data) === -1 ? 'última' : ORD[posicaoNoMes(data)]} ${['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'][weekdayIso(data) - 1]}`,
    },
  ];

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{edicao ? 'Editar reunião' : 'Nova reunião'}</DialogTitle>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void salvar();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="f-titulo">Título</Label>
            <Input id="f-titulo" autoFocus value={v.titulo} onChange={(e) => set('titulo', e.target.value)} />
          </div>

          {!edicao && podeEscolherSetor && (
            <div className="flex gap-1 rounded-lg bg-muted p-1 text-sm">
              {(['executoria', 'comercial'] as const).map((x) => (
                <button
                  key={x}
                  type="button"
                  onClick={() => set('setor', x)}
                  className={cn('flex-1 rounded-md px-2 py-1', v.setor === x ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground')}
                >
                  {x === 'executoria' ? 'Executoria' : 'Comercial'}
                </button>
              ))}
            </div>
          )}

          {!edicao && v.setor === 'executoria' && (
            <div className="space-y-1.5">
              <Label>Cliente</Label>
              <SearchableSelect
                value={v.tenantId}
                onValueChange={(x) => set('tenantId', x)}
                options={clientes.map((c) => ({ value: c.id, label: c.name }))}
                placeholder={clientes.length ? 'Selecione o cliente' : 'Carregando clientes…'}
                searchPlaceholder="Buscar cliente…"
                emptyText="Nenhum cliente encontrado."
              />
            </div>
          )}

          <div className="grid grid-cols-[1fr_auto_auto] gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="f-data">Data</Label>
              <Input id="f-data" type="date" value={data} onChange={(e) => e.target.value && setData(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-ini">Início</Label>
              <Input id="f-ini" type="time" step={900} value={horaIni} onChange={(e) => e.target.value && setHoraIni(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-fim">Fim</Label>
              <Input id="f-fim" type="time" step={900} value={horaFim} onChange={(e) => e.target.value && setHoraFim(e.target.value)} />
            </div>
          </div>

          {!edicao && (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="space-y-1.5">
                <Label htmlFor="f-rep">Repetição</Label>
                <select
                  id="f-rep"
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={rep.frequencia}
                  onChange={(e) => setRep({ frequencia: e.target.value as Frequencia })}
                >
                  {freqs.map((f) => (
                    <option key={f.v} value={f.v}>
                      {f.rotulo}
                    </option>
                  ))}
                </select>
              </div>
              {rep.frequencia !== 'nenhuma' && (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span>A cada</span>
                    <Input
                      type="number"
                      min={1}
                      max={52}
                      value={rep.intervalo}
                      onChange={(e) => setRep({ intervalo: Number(e.target.value) || 1 })}
                      className="h-8 w-16"
                      aria-label="Intervalo"
                    />
                    <span>{rep.frequencia === 'diaria' ? 'dia(s)' : rep.frequencia === 'semanal' ? 'semana(s)' : 'mês(es)'}</span>
                  </div>
                  {rep.frequencia === 'semanal' && (
                    <div className="flex flex-wrap gap-1" role="group" aria-label="Dias da semana">
                      {DIAS_CURTOS.map((d, i) => {
                        const dia = i + 1;
                        const ativo = (rep.diasSemana.length ? rep.diasSemana : [weekdayIso(data)]).includes(dia);
                        return (
                          <button
                            key={d}
                            type="button"
                            aria-pressed={ativo}
                            onClick={() => {
                              const atual = rep.diasSemana.length ? rep.diasSemana : [weekdayIso(data)];
                              const novo = ativo ? atual.filter((x) => x !== dia) : [...atual, dia];
                              setRep({ diasSemana: novo.length ? novo : atual });
                            }}
                            className={cn('h-8 w-10 rounded-full border text-xs capitalize', ativo ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted')}
                          >
                            {d}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span>Termina</span>
                    <select
                      className="h-8 rounded-md border bg-background px-2"
                      value={rep.termino}
                      onChange={(e) => setRep({ termino: e.target.value as Repeticao['termino'] })}
                      aria-label="Término"
                    >
                      <option value="contagem">após</option>
                      <option value="data">em</option>
                      <option value="nunca">nunca</option>
                    </select>
                    {rep.termino === 'contagem' && (
                      <>
                        <Input type="number" min={1} max={200} value={rep.contagem} onChange={(e) => setRep({ contagem: Number(e.target.value) || 1 })} className="h-8 w-20" aria-label="Quantidade" />
                        <span>vezes</span>
                      </>
                    )}
                    {rep.termino === 'data' && (
                      <Input type="date" value={rep.ate ?? ''} min={data} onChange={(e) => setRep({ ate: e.target.value || null })} className="h-8 w-40" aria-label="Até" />
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span>Em feriado</span>
                    <select
                      className="h-8 rounded-md border bg-background px-2"
                      value={v.politicaFeriado}
                      onChange={(e) => set('politicaFeriado', e.target.value as ValoresEvento['politicaFeriado'])}
                      aria-label="Em feriado"
                    >
                      <option value="pular">pular e colocar no fim</option>
                      <option value="cancelar">não marcar</option>
                      <option value="manter">marcar assim mesmo</option>
                    </select>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {descreverRepeticao(rep, data)} · {candidatas.length} {candidatas.length === 1 ? 'reunião' : 'reuniões'}
                  </p>
                </>
              )}
            </div>
          )}

          {!edicao && (
            <div className="space-y-3 rounded-lg border p-3">
              {(
                [
                  ['gravar', 'Gravar reunião'],
                  ['transcrever', 'Transcrever reunião'],
                  ...(v.setor === 'executoria' ? [['onboarding', 'Reunião de onboarding']] : []),
                ] as Array<['gravar' | 'transcrever' | 'onboarding', string]>
              ).map(([k, rotulo]) => (
                <div key={k} className="flex items-center justify-between gap-4">
                  <Label htmlFor={`f-${k}`} className="font-normal">
                    {rotulo}
                  </Label>
                  <Switch
                    id={`f-${k}`}
                    checked={v[k]}
                    onCheckedChange={(c) =>
                      setV((x) => ({
                        ...x,
                        [k]: c,
                        ...(k === 'gravar' && !c ? { transcrever: false } : {}),
                        ...(k === 'transcrever' && c ? { gravar: true } : {}),
                      }))
                    }
                  />
                </div>
              ))}
            </div>
          )}

          {!edicao && equipe.length > 0 && (
            <details className="rounded-lg border p-3 text-sm">
              <summary className="cursor-pointer select-none font-medium">
                Outros anfitriões{v.coHostIds.length ? ` (${v.coHostIds.length})` : ''}
              </summary>
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                {equipe
                  .filter((m) => m.id !== meId)
                  .map((m) => (
                    <label key={m.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={v.coHostIds.includes(m.id)}
                        onChange={(e) => set('coHostIds', e.target.checked ? [...v.coHostIds, m.id] : v.coHostIds.filter((x) => x !== m.id))}
                      />
                      {m.name}
                    </label>
                  ))}
              </div>
            </details>
          )}

          {!edicao && v.setor === 'comercial' && (
            <div className="space-y-1.5">
              <Label htmlFor="f-emails">E-mail do cliente</Label>
              <Input id="f-emails" type="text" placeholder="cliente@empresa.com.br" value={v.guestEmails} onChange={(e) => set('guestEmails', e.target.value)} />
            </div>
          )}

          {conflitos.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">{travado ? 'Este horário não pode ser usado' : 'Conflitos encontrados'}</p>
              <ListaConflitos conflitos={conflitos} />
              {!travado && (
                <Textarea value={just} onChange={(e) => setJust(e.target.value)} rows={2} placeholder="Motivo para salvar mesmo assim (fica registrado)" aria-label="Motivo" />
              )}
            </div>
          )}

          {erro && <p className="text-sm text-destructive">{erro}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onFechar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || travado}>
              {busy ? 'Salvando…' : 'Salvar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function valoresIniciais(inicio: Date, fim: Date, setor: 'executoria' | 'comercial'): ValoresEvento {
  return {
    titulo: '',
    setor,
    tenantId: '',
    inicio,
    fim,
    repeticao: { ...SEM_REPETICAO },
    politicaFeriado: 'pular',
    gravar: true,
    transcrever: true,
    onboarding: false,
    coHostIds: [],
    guestEmails: '',
  };
}
