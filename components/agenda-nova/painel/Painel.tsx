'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowLeft, ArrowUpRight, Loader2, RefreshCw } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from '@/components/ui/custom-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { cn } from '@/lib/utils';
import { addDays, localYmd, startOfWeek, type ResultadoKpis, type Ymd } from '@/lib/agenda-engine';
import { DIAS_CURTOS } from '@/lib/agenda/visao';

type Painel = {
  periodo: { de: Ymd; ate: Ymd };
  anteriorPeriodo: { de: Ymd; ate: Ymd };
  atual: ResultadoKpis;
  anterior: ResultadoKpis;
  porExecutor: Array<{ id: string; nome: string; atual: ResultadoKpis }>;
  semanas: Array<{ semana: Ymd; agendadas: number; realizadas: number }>;
  mapa: number[][];
  limiteSemanal: number | null;
  gestor: boolean;
  listaExecutores?: Array<{ id: string; nome: string }>;
  jornadas: {
    impulsao: { ativosPorGrupo: Array<{ grupo: string; clientes: number }>; progresso: Array<{ clienteId: string; concluidos: number; total: number }>; faltaramAula2: string[] };
    legado: Array<{ cliente: string; pendentes: number; possiveis: number; diasRestantes: number; emRisco: boolean; realizados: number; previstos: number }>;
  };
};

const SP = 'America/Sao_Paulo';
// Paleta de referência validada (slots 1 e 2), com passos próprios para o modo escuro.
const COR = { claro: { agendadas: '#2a78d6', realizadas: '#eb6834' }, escuro: { agendadas: '#3987e5', realizadas: '#d95926' } };
const AZUL = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
const PRODUTOS = [
  ['', 'Todos os produtos'],
  ['impulsao', 'Impulsão'],
  ['legado', 'Legado'],
  ['comercial', 'Comercial'],
  ['outros', 'Outras reuniões'],
] as const;

const h = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`;
const pct = (n: number | null) => (n === null ? '-' : `${Math.round(n * 100)}%`);
const br = (d: Ymd) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

function periodos(hoje: Ymd): Record<string, { de: Ymd; ate: Ymd; nome: string }> {
  const seg = startOfWeek(hoje);
  const mesIni = `${hoje.slice(0, 8)}01`;
  const mesPassadoFim = addDays(mesIni, -1);
  return {
    semana: { de: seg, ate: addDays(seg, 6), nome: 'Esta semana' },
    mes: { de: mesIni, ate: hoje, nome: 'Este mês' },
    '30d': { de: addDays(hoje, -29), ate: hoje, nome: 'Últimos 30 dias' },
    mesPassado: { de: `${mesPassadoFim.slice(0, 8)}01`, ate: mesPassadoFim, nome: 'Mês passado' },
    '90d': { de: addDays(hoje, -89), ate: hoje, nome: 'Últimos 90 dias' },
  };
}

function useEscuro() {
  const [escuro, setEscuro] = React.useState(false);
  React.useEffect(() => {
    const ver = () => setEscuro(document.documentElement.classList.contains('dark'));
    ver();
    const obs = new MutationObserver(ver);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return escuro;
}

/** Cartão de número com comparação ao período anterior (cor de texto neutra; seta + sinal dizem a direção). */
function Numero({ titulo, valor, atual, anterior, ajuda }: { titulo: string; valor: string; atual: number | null; anterior: number | null; ajuda?: string }) {
  const delta = atual !== null && anterior !== null && anterior !== 0 ? (atual - anterior) / Math.abs(anterior) : null;
  return (
    <Card className="gap-1 py-4">
      <CardContent className="space-y-1 px-4">
        <p className="text-xs font-medium text-muted-foreground" title={ajuda}>
          {titulo}
        </p>
        <p className="text-2xl font-bold tabular-nums">{valor}</p>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          {delta === null ? (
            'sem base no período anterior'
          ) : (
            <>
              {delta >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
              {delta >= 0 ? '+' : ''}
              {Math.round(delta * 100)}% vs. período anterior
            </>
          )}
        </p>
      </CardContent>
    </Card>
  );
}

export function Painel({ me }: { me: { id: string; isAdmin: boolean } }) {
  const hoje = localYmd(new Date(), SP);
  const presets = React.useMemo(() => periodos(hoje), [hoje]);
  const [preset, setPreset] = React.useState<string>('mes');
  const [de, setDe] = React.useState(presets.mes.de);
  const [ate, setAte] = React.useState(presets.mes.ate);
  const [executor, setExecutor] = React.useState(me.isAdmin ? 'todos' : me.id);
  const [produto, setProduto] = React.useState('');
  const [tenant, setTenant] = React.useState('');
  const [equipe, setEquipe] = React.useState<Array<{ id: string; name: string }>>([]);
  const [clientes, setClientes] = React.useState<Array<{ id: string; name: string }>>([]);
  const [p, setP] = React.useState<Painel | null>(null);
  const [carregando, setCarregando] = React.useState(true);
  const [sincronizando, setSincronizando] = React.useState(false);
  const escuro = useEscuro();
  const cores = escuro ? COR.escuro : COR.claro;

  React.useEffect(() => {
    fetch('/api/clients').then((r) => r.json()).then((j) => setClientes(j.clients ?? [])).catch(() => {});
  }, [me.isAdmin]);

  React.useEffect(() => {
    const ctrl = new AbortController();
    setCarregando(true);
    const qs = new URLSearchParams({ de, ate, executor, ...(produto ? { produto } : {}), ...(tenant ? { tenantId: tenant } : {}) });
    fetch(`/api/agenda/kpis?${qs}`, { cache: 'no-store', signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.text()) || 'Erro');
        const j = (await r.json()) as Painel;
        setP(j);
        if (j.listaExecutores?.length) setEquipe(j.listaExecutores.map((e) => ({ id: e.id, name: e.nome })));
      })
      .catch((e) => e.name !== 'AbortError' && toast.error('Não foi possível carregar o painel', { description: e.message }))
      .finally(() => !ctrl.signal.aborted && setCarregando(false));
    return () => ctrl.abort();
  }, [de, ate, executor, produto, tenant]);

  const escolherPreset = (k: string) => {
    setPreset(k);
    if (presets[k]) {
      setDe(presets[k].de);
      setAte(presets[k].ate);
    }
  };

  const sincronizar = async () => {
    setSincronizando(true);
    const r = await fetch('/api/agenda/kpis', { method: 'POST' });
    setSincronizando(false);
    if (!r.ok) return toast.error('Não foi possível atualizar', { description: await r.text() });
    const j = (await r.json()) as { novas: number; restantes: number };
    toast.success(`${j.novas} gravação(ões) atualizadas${j.restantes ? `, faltam ${j.restantes}` : ''}`);
  };

  const a = p?.atual;
  const b = p?.anterior;
  const maxMapa = Math.max(0.0001, ...(p?.mapa.flat() ?? [0]));
  const horas = Array.from({ length: 16 }, (_, i) => i + 6); // 06h às 21h

  return (
    <div className="space-y-5">
      <Link href="/agenda" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar para a agenda
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Painel da agenda</h1>
        {me.isAdmin && (
          <Button variant="ghost" size="sm" onClick={() => void sincronizar()} disabled={sincronizando} title="Busca a duração das gravações que ainda não estão no banco">
            <RefreshCw className={cn('h-4 w-4', sincronizando && 'animate-spin')} /> Atualizar durações
          </Button>
        )}
      </div>

      {/* Filtros numa linha só */}
      <div className="flex flex-wrap items-end gap-2">
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={preset} onChange={(e) => escolherPreset(e.target.value)} aria-label="Período">
          {Object.entries(presets).map(([k, v]) => (
            <option key={k} value={k}>
              {v.nome}
            </option>
          ))}
          <option value="personalizado">Personalizado</option>
        </select>
        {preset === 'personalizado' && (
          <>
            <Input type="date" value={de} max={ate} onChange={(e) => e.target.value && setDe(e.target.value)} className="h-9 w-40" aria-label="De" />
            <Input type="date" value={ate} min={de} onChange={(e) => e.target.value && setAte(e.target.value)} className="h-9 w-40" aria-label="Até" />
          </>
        )}
        {me.isAdmin && (
          <select className="h-9 rounded-md border bg-background px-2 text-sm" value={executor} onChange={(e) => setExecutor(e.target.value)} aria-label="Executor">
            <option value="todos">Todos os executores</option>
            {equipe.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
        )}
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={produto} onChange={(e) => setProduto(e.target.value)} aria-label="Produto">
          {PRODUTOS.map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <div className="w-56">
          <SearchableSelect value={tenant} onValueChange={setTenant} options={[{ value: '', label: 'Todos os clientes' }, ...clientes.map((c) => ({ value: c.id, label: c.name }))]} placeholder="Todos os clientes" searchPlaceholder="Buscar cliente…" emptyText="Nenhum." />
        </div>
        {carregando && <Loader2 className="mb-2 h-4 w-4 animate-spin text-muted-foreground" aria-label="Carregando" />}
      </div>
      {p && (
        <p className="text-xs text-muted-foreground">
          {br(p.periodo.de)} a {br(p.periodo.ate)}, comparado com {br(p.anteriorPeriodo.de)} a {br(p.anteriorPeriodo.ate)}. Horas realizadas = duração real das gravações.
        </p>
      )}

      {a && b && p && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Numero titulo="Horas disponíveis" valor={h(a.horasDisponiveis)} atual={a.horasDisponiveis} anterior={b.horasDisponiveis} ajuda="Expediente menos bloqueios e feriados" />
            <Numero titulo="Horas agendadas" valor={h(a.horasAgendadas)} atual={a.horasAgendadas} anterior={b.horasAgendadas} />
            <Numero titulo="Horas realizadas" valor={h(a.horasRealizadas)} atual={a.horasRealizadas} anterior={b.horasRealizadas} ajuda="Duração real das gravações" />
            <Numero titulo="Ocupação" valor={pct(a.taxaOcupacao)} atual={a.taxaOcupacao} anterior={b.taxaOcupacao} ajuda="Agendadas / disponíveis" />
            <Numero titulo="Realização" valor={pct(a.taxaRealizacao)} atual={a.taxaRealizacao} anterior={b.taxaRealizacao} ajuda="Realizadas / agendadas" />
            <Numero titulo="Aderência à duração" valor={pct(a.aderenciaDuracao)} atual={a.aderenciaDuracao} anterior={b.aderenciaDuracao} ajuda="Duração real média / planejada média (acima de 100% = reuniões estourando)" />
            <Numero titulo="No-show" valor={`${a.noShow.total} · ${pct(a.noShow.taxa)}`} atual={a.noShow.taxa} anterior={b.noShow.taxa} />
            <Numero titulo="Cancelamentos" valor={`${a.cancelamentos.total} · ${pct(a.cancelamentos.taxa)}`} atual={a.cancelamentos.taxa} anterior={b.cancelamentos.taxa} />
            <Numero titulo="Remarcações" valor={`${a.remarcacoes.total} · ${pct(a.remarcacoes.taxa)}`} atual={a.remarcacoes.taxa} anterior={b.remarcacoes.taxa} />
            <Numero titulo="Fora do expediente" valor={h(a.horasForaExpediente)} atual={a.horasForaExpediente} anterior={b.horasForaExpediente} />
            <Numero titulo="Tempo de foco" valor={`${a.tempoFoco.blocos} blocos · ${h(a.tempoFoco.horas)}`} atual={a.tempoFoco.horas} anterior={b.tempoFoco.horas} ajuda="Blocos livres de 2 h ou mais dentro do expediente" />
            <Card className="gap-1 py-4">
              <CardContent className="space-y-1.5 px-4">
                <p className="text-xs font-medium text-muted-foreground">Quem cancelou</p>
                {Object.keys(a.cancelamentos.porOrigem).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum cancelamento</p>
                ) : (
                  Object.entries(a.cancelamentos.porOrigem).map(([k, v]) => (
                    <p key={k} className="flex justify-between text-sm">
                      <span>{{ cliente: 'Cliente', executor: 'Executor', legacy: 'Legacy', nao_informado: 'Não informado' }[k] ?? k}</span>
                      <strong className="tabular-nums">{v}</strong>
                    </p>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-base">Horas por semana</CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                {p.semanas.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem reuniões no período.</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={p.semanas.map((s) => ({ ...s, rotulo: br(s.semana) }))} barGap={2} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="rotulo" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                      <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} unit=" h" />
                      <Tooltip
                        cursor={{ fill: 'hsl(var(--muted) / 0.5)' }}
                        contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12, color: 'hsl(var(--popover-foreground))' }}
                        formatter={(v, nome) => [h(Number(v ?? 0)), String(nome)]}
                        labelFormatter={(l) => `Semana de ${l}`}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span style={{ color: 'hsl(var(--foreground))' }}>{v}</span>} />
                      <Bar dataKey="agendadas" name="Agendadas" fill={cores.agendadas} radius={[4, 4, 0, 0]} maxBarSize={28} />
                      <Bar dataKey="realizadas" name="Realizadas" fill={cores.realizadas} radius={[4, 4, 0, 0]} maxBarSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-base">Horas realizadas por produto</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {Object.keys(a.horasPorProduto).length === 0 && <p className="text-sm text-muted-foreground">Sem gravações no período.</p>}
                {Object.entries(a.horasPorProduto)
                  .sort((x, y) => y[1] - x[1])
                  .map(([k, v]) => {
                    const max = Math.max(...Object.values(a.horasPorProduto));
                    return (
                      <div key={k} className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span>{{ impulsao: 'Impulsão', legado: 'Legado', comercial: 'Comercial', outros: 'Outras' }[k] ?? k}</span>
                          <span className="tabular-nums text-muted-foreground">{h(v)}</span>
                        </div>
                        <div className="h-2 rounded-full bg-muted">
                          <div className="h-2 rounded-full" style={{ width: `${(v / max) * 100}%`, backgroundColor: cores.agendadas }} />
                        </div>
                      </div>
                    );
                  })}
                {executor !== 'todos' && p.limiteSemanal && a.cargaSemanal.some((c) => c.acimaLimite) && (
                  <div className="mt-3 rounded-lg border border-amber-400 bg-amber-500/10 p-2 text-sm">
                    Carga acima de {p.limiteSemanal} h nas semanas de{' '}
                    {a.cargaSemanal
                      .filter((c) => c.acimaLimite)
                      .map((c) => `${br(c.semana)} (${h(c.horas)})`)
                      .join(', ')}
                    .
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-base">Ocupação por dia e horário</CardTitle>
              <p className="text-xs text-muted-foreground">Horas de reunião em cada hora do dia, somadas no período. Quanto mais escuro, mais ocupado.</p>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="border-separate border-spacing-0.5 text-[11px]">
                <thead>
                  <tr>
                    <th />
                    {horas.map((hh) => (
                      <th key={hh} className="w-9 font-normal text-muted-foreground">
                        {hh}h
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {p.mapa.map((linha, d) => (
                    <tr key={d}>
                      <th className="pr-2 text-left font-normal capitalize text-muted-foreground">{DIAS_CURTOS[d]}</th>
                      {horas.map((hh) => {
                        const v = linha[hh];
                        const passo = v <= 0 ? -1 : Math.min(AZUL.length - 1, Math.floor((v / maxMapa) * AZUL.length));
                        return (
                          <td
                            key={hh}
                            title={`${DIAS_CURTOS[d]} ${hh}h: ${h(v)}`}
                            className="h-7 w-9 rounded-sm"
                            style={{ backgroundColor: passo < 0 ? 'hsl(var(--muted) / 0.6)' : AZUL[passo] }}
                          />
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {p.gestor && executor === 'todos' && (
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-base">Executores</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead className="border-b text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-medium">Executor</th>
                      <th className="px-3 py-2 text-right font-medium">Realizadas</th>
                      <th className="px-3 py-2 text-right font-medium">Agendadas</th>
                      <th className="px-3 py-2 text-right font-medium">Ocupação</th>
                      <th className="px-3 py-2 text-right font-medium">Realização</th>
                      <th className="px-3 py-2 text-right font-medium">No-show</th>
                      <th className="px-3 py-2 text-right font-medium">Cancel.</th>
                      <th className="px-3 py-2 text-right font-medium">Fora do exp.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.porExecutor.map((e) => (
                      <tr key={e.id} className="border-b last:border-0 hover:bg-muted/40">
                        <td className="px-4 py-2">
                          <button type="button" className="text-left hover:underline" onClick={() => setExecutor(e.id)}>
                            {e.nome}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{h(e.atual.horasRealizadas)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{h(e.atual.horasAgendadas)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{pct(e.atual.taxaOcupacao)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{pct(e.atual.taxaRealizacao)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{e.atual.noShow.total}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{e.atual.cancelamentos.total}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{h(e.atual.horasForaExpediente)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-base">Jornadas do Impulsão</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {p.jornadas.impulsao.ativosPorGrupo.length === 0 ? (
                  <p className="text-muted-foreground">Nenhum cliente ativo nos grupos.</p>
                ) : (
                  p.jornadas.impulsao.ativosPorGrupo.map((g) => (
                    <p key={g.grupo} className="flex justify-between">
                      <span>{g.grupo}</span>
                      <strong className="tabular-nums">{g.clientes} ativo(s)</strong>
                    </p>
                  ))
                )}
                {p.jornadas.impulsao.progresso.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {p.jornadas.impulsao.progresso.map((x) => (
                      <Badge key={x.clienteId} variant="secondary">
                        {x.clienteId} · {x.concluidos}/{x.total}
                      </Badge>
                    ))}
                  </div>
                )}
                {p.jornadas.impulsao.faltaramAula2.length > 0 && (
                  <p className="pt-1">
                    <strong>Faltaram a uma Aula 2:</strong> {p.jornadas.impulsao.faltaramAula2.join(', ')}
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-base">Jornadas do Legado</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                {p.jornadas.legado.length === 0 && <p className="text-muted-foreground">Nenhuma jornada do Legado acompanhada ainda.</p>}
                {p.jornadas.legado.slice(0, 12).map((j, i) => (
                  <div key={i} className="flex items-center justify-between gap-2">
                    <span className="truncate">{j.cliente}</span>
                    <span className="flex shrink-0 items-center gap-2 tabular-nums">
                      {j.realizados}/{j.previstos}
                      {j.emRisco && <Badge variant="destructive">Em risco: faltam {j.pendentes} em {j.diasRestantes} dias</Badge>}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
