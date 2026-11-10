'use client';

import * as React from 'react';
import { CalendarPlus, ChevronDown, Loader2, Pencil, Plus, UserPlus, Users } from 'lucide-react';
import { toast } from '@/components/ui/custom-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { cn } from '@/lib/utils';
import { DIAS_LONGOS } from '@/lib/agenda/visao';
import type { RespostaConflito } from '@/lib/agenda/tipos';
import { DialogoConflitos } from '../Dialogos';

type Template = { id: string; nome: string; produto: string; duracao_min: number; hora_padrao: string | null; sequencia: string[]; campos_editaveis: string[]; ativo: boolean };
type Proximo = { data: string; rotulo: string | null; status: string; feriado: string | null };
type Grupo = {
  id: string;
  nome: string;
  executor_id: string;
  substituto_id: string | null;
  tenant_id: string | null;
  template_id: string | null;
  ancora: string;
  defasagem: number;
  executorNome: string | null;
  substitutoNome: string | null;
  clienteNome: string | null;
  dia_semana: number;
  hora: string;
  duracao_min: number;
  sequencia: string[];
  politica_feriado: string;
  ativo: boolean;
  clientesAtivos: number;
  proximos: Proximo[];
};
type Opcao = { id: string; name: string };
type Encontro = { numero: number; rotulo: string | null; data: string | null; presenca: string; recuperacao: boolean; grupo_id: string | null };
type Jornada = { id: string; cliente: string | null; progresso: string; status: string; agenda_jornada_encontros: Encontro[] };
type Previa = {
  sugestao: { grupoId: string; data: string; rotulo: string; esperaDias: number };
  jornada: { encontros: Array<{ numero: number; rotulo: string; grupoId: string; data: string; recuperacao: boolean }>; conclusao: string | null };
};

const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
async function erro(res: Response) {
  return (await res.text().catch(() => '')) || 'Algo deu errado.';
}

export function AbaGrupos({ isAdmin, meId }: { isAdmin: boolean; meId: string }) {
  const [grupos, setGrupos] = React.useState<Grupo[] | null>(null);
  const [templates, setTemplates] = React.useState<Template[]>([]);
  const [equipe, setEquipe] = React.useState<Opcao[]>([]);
  const [clientes, setClientes] = React.useState<Opcao[]>([]);
  const [novo, setNovo] = React.useState(false);
  const [editando, setEditando] = React.useState<Grupo | null>(null);
  const [matricular, setMatricular] = React.useState<Grupo | 'qualquer' | null>(null);
  const [abertos, setAbertos] = React.useState<Record<string, Jornada[] | 'carregando'>>({});
  const [ocupado, setOcupado] = React.useState<string | null>(null);
  const [conflito, setConflito] = React.useState<{ r: RespostaConflito; salvar: (j: string) => void } | null>(null);

  const carregar = React.useCallback(async () => {
    const r = await fetch('/api/agenda/grupos', { cache: 'no-store' });
    if (r.ok) setGrupos((await r.json()).grupos);
    else toast.error('Não foi possível carregar os grupos', { description: await erro(r) });
  }, []);

  React.useEffect(() => {
    void carregar();
    fetch('/api/agenda/templates').then((r) => r.json()).then((j) => setTemplates((j.templates ?? []).filter((t: Template) => t.produto === 'impulsao' && t.ativo))).catch(() => {});
    fetch('/api/team').then((r) => r.json()).then((j) => setEquipe(j.members ?? [])).catch(() => {});
    fetch('/api/clients').then((r) => r.json()).then((j) => setClientes(j.clients ?? [])).catch(() => {});
  }, [carregar]);

  const gerar = async (g: Grupo, justificativa?: string) => {
    setOcupado(g.id);
    const r = await fetch(`/api/agenda/grupos/${g.id}/gerar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ justificativa }),
    });
    setOcupado(null);
    if (r.status === 409) {
      const resposta = (await r.json()) as RespostaConflito;
      setConflito({ r: resposta, salvar: (j) => void gerar(g, j) });
      return;
    }
    if (!r.ok) return toast.error('Não foi possível gerar a agenda', { description: await erro(r) });
    const j = (await r.json()) as { criadas: number; semConteudo: number; substituto: number };
    setConflito(null);
    toast.success(j.criadas ? `${j.criadas} encontros criados na agenda` : 'A agenda do grupo já estava em dia', {
      description: [j.semConteudo ? `${j.semConteudo} semana(s) sem aula por feriado` : '', j.substituto ? `${j.substituto} com o substituto` : '']
        .filter(Boolean)
        .join(' · ') || undefined,
    });
    void carregar();
  };

  const encerrar = async (g: Grupo) => {
    if (!window.confirm(`Encerrar o ${g.nome}? Os encontros futuros serão cancelados.`)) return;
    const r = await fetch(`/api/agenda/grupos/${g.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ativo: false }) });
    if (!r.ok) return toast.error('Não foi possível encerrar', { description: await erro(r) });
    toast.success('Grupo encerrado');
    void carregar();
  };

  const verClientes = async (g: Grupo) => {
    if (abertos[g.id]) return setAbertos((a) => Object.fromEntries(Object.entries(a).filter(([k]) => k !== g.id)));
    setAbertos((a) => ({ ...a, [g.id]: 'carregando' }));
    const r = await fetch(`/api/agenda/jornadas?grupoId=${g.id}`, { cache: 'no-store' });
    const j = r.ok ? ((await r.json()).jornadas as Jornada[]) : [];
    setAbertos((a) => ({ ...a, [g.id]: j }));
  };

  const presenca = async (g: Grupo, jornadaId: string, numero: number, valor: string) => {
    const r = await fetch(`/api/agenda/jornadas/${jornadaId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ numero, presenca: valor }) });
    if (!r.ok) return toast.error('Não foi possível salvar a presença', { description: await erro(r) });
    setAbertos((a) => {
      const lista = a[g.id];
      if (!Array.isArray(lista)) return a;
      return {
        ...a,
        [g.id]: lista.map((jo) => (jo.id !== jornadaId ? jo : { ...jo, agenda_jornada_encontros: jo.agenda_jornada_encontros.map((e) => (e.numero === numero ? { ...e, presenca: valor } : e)) })),
      };
    });
  };

  if (!grupos) {
    return (
      <div className="flex justify-center py-12 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Cada grupo tem um dia e um horário. O conteúdo de cada semana segue o ciclo do modelo, e o cliente sempre entra numa Aula 1.
          Feriados entram sozinhos.
        </p>
        <div className="flex gap-2">
          {grupos.some((g) => g.ativo) && (
            <Button variant="outline" onClick={() => setMatricular('qualquer')}>
              <UserPlus className="h-4 w-4" /> Matricular cliente
            </Button>
          )}
          <Button onClick={() => setNovo(true)} disabled={!templates.length}>
            <Plus className="h-4 w-4" /> Novo grupo
          </Button>
        </div>
      </div>

      {grupos.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">Nenhum grupo ainda. Crie o primeiro (ex.: Grupo Terça).</CardContent>
        </Card>
      )}

      {grupos.map((g) => {
        const podeMexer = isAdmin || g.executor_id === meId;
        const lista = abertos[g.id];
        return (
          <Card key={g.id} className={cn(!g.ativo && 'opacity-60')}>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="flex items-center gap-2 font-semibold">
                    {g.nome}
                    {!g.ativo && <Badge variant="outline">Encerrado</Badge>}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {DIAS_LONGOS[g.dia_semana - 1]} às {g.hora} · {Math.round(g.duracao_min / 6) / 10} h · {g.executorNome ?? 'sem executor'}
                    {g.substitutoNome ? ` (substituto: ${g.substitutoNome})` : ''} · feriado: {g.politica_feriado === 'pausa' ? 'o ciclo pausa' : 'a semana é perdida'}
                  </p>
                </div>
                {g.ativo && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setMatricular(g)}>
                      <UserPlus className="h-4 w-4" /> Matricular
                    </Button>
                    {podeMexer && (
                      <Button size="sm" variant="outline" onClick={() => setEditando(g)}>
                        <Pencil className="h-4 w-4" /> Editar
                      </Button>
                    )}
                    {podeMexer && (
                      <Button size="sm" onClick={() => void gerar(g)} disabled={ocupado === g.id}>
                        {ocupado === g.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />} Gerar agenda
                      </Button>
                    )}
                    {isAdmin && (
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void encerrar(g)}>
                        Encerrar
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {g.proximos.length > 0 && (
                <div className="flex flex-wrap gap-1.5" aria-label="Próximos encontros">
                  {g.proximos.map((p) => (
                    <span
                      key={p.data}
                      title={p.feriado ?? undefined}
                      className={cn(
                        'rounded-md border px-2 py-1 text-xs',
                        p.status === 'normal' && 'bg-primary/5',
                        p.status !== 'normal' && 'border-red-300 bg-red-500/10 text-red-700 dark:text-red-300',
                      )}
                    >
                      <span className="text-muted-foreground">{br(p.data)}</span>{' '}
                      <strong>{p.status === 'pausada_feriado' ? 'feriado' : p.rotulo}</strong>
                      {p.status === 'perdida_feriado' && ' (perdida)'}
                    </span>
                  ))}
                </div>
              )}

              <button type="button" onClick={() => void verClientes(g)} className="flex items-center gap-1 text-sm font-medium text-primary">
                <Users className="h-4 w-4" /> {g.clientesAtivos} {g.clientesAtivos === 1 ? 'cliente ativo' : 'clientes ativos'}
                <ChevronDown className={cn('h-4 w-4 transition-transform', lista && 'rotate-180')} />
              </button>
              {lista === 'carregando' && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              {Array.isArray(lista) && (
                <div className="space-y-2">
                  {lista.length === 0 && <p className="text-sm text-muted-foreground">Nenhum cliente matriculado.</p>}
                  {lista.map((jo) => (
                    <div key={jo.id} className="rounded-lg border p-2">
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="font-medium">{jo.cliente ?? 'Cliente'}</span>
                        <Badge variant="secondary">{jo.progresso}</Badge>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {jo.agenda_jornada_encontros.map((e) => (
                          <label key={e.numero} className="flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-1 text-xs">
                            <span>
                              {e.numero}/{jo.agenda_jornada_encontros.length} {e.rotulo} {e.data ? br(e.data) : ''}
                              {e.recuperacao ? ' (reposição)' : ''}
                            </span>
                            <select
                              value={e.presenca}
                              onChange={(ev) => void presenca(g, jo.id, e.numero, ev.target.value)}
                              className="rounded border bg-background px-1 text-xs"
                              aria-label={`Presença no encontro ${e.numero}`}
                            >
                              <option value="pendente">pendente</option>
                              <option value="presente">presente</option>
                              <option value="faltou">faltou</option>
                            </select>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {novo && (
        <NovoGrupo
          templates={templates}
          isAdmin={isAdmin}
          equipe={equipe}
          clientes={clientes}
          meId={meId}
          onFechar={() => setNovo(false)}
          onCriado={() => {
            setNovo(false);
            void carregar();
          }}
        />
      )}
      {editando && (
        <EditarGrupo
          grupo={editando}
          template={templates.find((t) => t.id === editando.template_id) ?? null}
          isAdmin={isAdmin}
          equipe={equipe}
          clientes={clientes}
          onFechar={() => setEditando(null)}
          onSalvo={() => {
            setEditando(null);
            setAbertos({});
            void carregar();
          }}
        />
      )}
      {matricular && (
        <Matricular
          grupos={grupos.filter((g) => g.ativo)}
          fixo={matricular === 'qualquer' ? null : matricular}
          clientes={clientes}
          onFechar={() => setMatricular(null)}
          onFeito={() => {
            setMatricular(null);
            setAbertos({});
            void carregar();
          }}
        />
      )}
      {conflito && (
        <DialogoConflitos conflitos={conflito.r.conflitos} podeSobreporBloqueante={conflito.r.podeSobreporBloqueante} onSalvar={conflito.salvar} onDesistir={() => setConflito(null)} />
      )}
    </div>
  );
}

function NovoGrupo({
  templates,
  isAdmin,
  equipe,
  clientes,
  meId,
  onFechar,
  onCriado,
}: {
  templates: Template[];
  isAdmin: boolean;
  equipe: Opcao[];
  clientes: Opcao[];
  meId: string;
  onFechar: () => void;
  onCriado: () => void;
}) {
  const [t, setT] = React.useState(templates[0]);
  const [nome, setNome] = React.useState('');
  const [dia, setDia] = React.useState(2);
  const [hora, setHora] = React.useState(templates[0]?.hora_padrao ?? '19:00');
  const [primeira, setPrimeira] = React.useState('');
  const [executor, setExecutor] = React.useState(meId);
  const [substituto, setSubstituto] = React.useState('');
  const [tenant, setTenant] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const livre = (c: string) => isAdmin || t?.campos_editaveis.includes(c);
  const primeiroRotulo = t?.sequencia[0] ?? 'Aula 1';

  const salvar = async () => {
    if (!primeira) return toast.error(`Informe a data da primeira ${primeiroRotulo}`);
    setBusy(true);
    const r = await fetch('/api/agenda/grupos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId: t.id,
        nome,
        diaSemana: dia,
        hora,
        // A data da 1ª aula do ciclo é a âncora (defasagem 0): vale para qualquer dia.
        ancora: primeira,
        defasagem: 0,
        ...(isAdmin ? { executorId: executor, substitutoId: substituto || null, tenantId: tenant || null } : {}),
      }),
    });
    setBusy(false);
    if (!r.ok) return toast.error('Não foi possível criar o grupo', { description: await erro(r) });
    toast.success('Grupo criado. Agora clique em "Gerar agenda".');
    onCriado();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo grupo</DialogTitle>
          <DialogDescription>O ciclo, as entradas e a regra de feriado vêm do modelo{isAdmin ? '' : ' (definidos pelo admin)'}.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Modelo</Label>
            <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={t?.id} onChange={(e) => setT(templates.find((x) => x.id === e.target.value)!)}>
              {templates.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.nome} ({x.sequencia.join(' → ')})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g-nome">Nome</Label>
            <Input id="g-nome" placeholder={`Grupo ${DIAS_LONGOS[dia - 1]}`} value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>Dia da semana</Label>
              <select className="h-9 w-full rounded-md border bg-background px-2 text-sm capitalize" value={dia} disabled={!livre('dia_semana')} onChange={(e) => setDia(Number(e.target.value))}>
                {DIAS_LONGOS.map((d, i) => (
                  <option key={d} value={i + 1}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-hora">Horário</Label>
              <Input id="g-hora" type="time" step={900} value={hora} disabled={!livre('hora')} onChange={(e) => setHora(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g-primeira">Data da primeira {primeiroRotulo} deste grupo</Label>
            <Input id="g-primeira" type="date" value={primeira} disabled={!livre('ancora')} onChange={(e) => setPrimeira(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              Ex.: se a terça dá {primeiroRotulo} em 06/01 e a quinta vai uma semana atrás, a quinta dá {primeiroRotulo} em 15/01.
            </p>
          </div>
          {isAdmin && (
            <>
              <div className="space-y-1.5">
                <Label>Executor responsável</Label>
                <SearchableSelect value={executor} onValueChange={setExecutor} options={equipe.map((m) => ({ value: m.id, label: m.name }))} placeholder="Executor" searchPlaceholder="Buscar…" emptyText="Ninguém encontrado." />
              </div>
              <div className="space-y-1.5">
                <Label>Substituto (quando o executor tiver bloqueio)</Label>
                <SearchableSelect value={substituto} onValueChange={setSubstituto} options={equipe.map((m) => ({ value: m.id, label: m.name }))} placeholder="Nenhum" searchPlaceholder="Buscar…" emptyText="Ninguém encontrado." />
              </div>
              <div className="space-y-1.5">
                <Label>Cliente das reuniões (opcional)</Label>
                <SearchableSelect value={tenant} onValueChange={setTenant} options={clientes.map((c) => ({ value: c.id, label: c.name }))} placeholder="Legacy Executoria" searchPlaceholder="Buscar cliente…" emptyText="Nenhum cliente." />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={() => void salvar()} disabled={busy}>
            {busy ? 'Criando…' : 'Criar grupo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditarGrupo({
  grupo: g,
  template,
  isAdmin,
  equipe,
  clientes,
  onFechar,
  onSalvo,
}: {
  grupo: Grupo;
  template: Template | null;
  isAdmin: boolean;
  equipe: Opcao[];
  clientes: Opcao[];
  onFechar: () => void;
  onSalvo: () => void;
}) {
  // Data da 1ª aula do ciclo (âncora + defasagem em semanas).
  const primeiraAtual = React.useMemo(() => {
    const d = new Date(`${g.ancora}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 7 * (g.defasagem || 0));
    return d.toISOString().slice(0, 10);
  }, [g.ancora, g.defasagem]);
  const [nome, setNome] = React.useState(g.nome);
  const [dia, setDia] = React.useState(g.dia_semana);
  const [hora, setHora] = React.useState(g.hora);
  const [duracao, setDuracao] = React.useState(String(g.duracao_min));
  const [primeira, setPrimeira] = React.useState(primeiraAtual);
  const [executor, setExecutor] = React.useState(g.executor_id);
  const [substituto, setSubstituto] = React.useState(g.substituto_id ?? '');
  const [tenant, setTenant] = React.useState(g.tenant_id ?? '');
  const [busy, setBusy] = React.useState(false);
  const [conflito, setConflito] = React.useState<RespostaConflito | null>(null);
  const livre = (c: string) => isAdmin || !!template?.campos_editaveis.includes(c);
  const primeiroRotulo = g.sequencia[0] ?? 'Aula 1';
  const mudaHorario = dia !== g.dia_semana || hora !== g.hora || Number(duracao) !== g.duracao_min || primeira !== primeiraAtual;

  const salvar = async (justificativa?: string) => {
    const corpo: Record<string, unknown> = {};
    if (nome.trim() !== g.nome) corpo.nome = nome.trim();
    if (dia !== g.dia_semana) corpo.diaSemana = dia;
    if (hora !== g.hora) corpo.hora = hora;
    if (Number(duracao) !== g.duracao_min) corpo.duracaoMin = Number(duracao);
    if (primeira !== primeiraAtual) corpo.ancora = primeira;
    if (isAdmin) {
      if (executor !== g.executor_id) corpo.executorId = executor;
      if (substituto !== (g.substituto_id ?? '')) corpo.substitutoId = substituto || null;
      if (tenant !== (g.tenant_id ?? '')) corpo.tenantId = tenant || null;
    }
    if (!Object.keys(corpo).length) return onFechar();
    setBusy(true);
    const r = await fetch(`/api/agenda/grupos/${g.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...corpo, justificativa }),
    });
    setBusy(false);
    if (r.status === 409) return setConflito((await r.json()) as RespostaConflito);
    if (!r.ok) return toast.error('Não foi possível salvar', { description: await erro(r) });
    const j = (await r.json()) as { movidos: number };
    toast.success('Grupo atualizado', { description: j.movidos ? `${j.movidos} encontro(s) remarcado(s). Os convidados recebem o aviso.` : undefined });
    onSalvo();
  };

  return (
    <>
      <Dialog open={!conflito} onOpenChange={(o) => !o && onFechar()}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar {g.nome}</DialogTitle>
            <DialogDescription>O ciclo, as entradas e a regra de feriado vêm do modelo{isAdmin ? '' : ' (definidos pelo admin)'}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="eg-nome">Nome</Label>
              <Input id="eg-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Dia da semana</Label>
                <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={dia} disabled={!livre('dia_semana')} onChange={(e) => setDia(Number(e.target.value))}>
                  {DIAS_LONGOS.map((d, i) => (
                    <option key={d} value={i + 1}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="eg-hora">Horário</Label>
                <Input id="eg-hora" type="time" step={900} value={hora} disabled={!livre('hora')} onChange={(e) => setHora(e.target.value)} />
              </div>
              <div className="col-span-2 space-y-1.5 sm:col-span-1">
                <Label htmlFor="eg-dur">Duração (min)</Label>
                <Input id="eg-dur" type="number" min={15} max={720} step={15} value={duracao} disabled={!livre('duracao_min')} onChange={(e) => setDuracao(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="eg-primeira">Data da primeira {primeiroRotulo} deste grupo</Label>
              <Input id="eg-primeira" type="date" value={primeira} disabled={!livre('ancora') || g.clientesAtivos > 0} onChange={(e) => setPrimeira(e.target.value)} />
              {g.clientesAtivos > 0 && <p className="text-xs text-muted-foreground">Não muda enquanto houver clientes no grupo: mudaria o conteúdo das aulas deles.</p>}
            </div>
            {isAdmin && (
              <>
                <div className="space-y-1.5">
                  <Label>Executor responsável</Label>
                  <SearchableSelect value={executor} onValueChange={setExecutor} options={equipe.map((m) => ({ value: m.id, label: m.name }))} placeholder="Executor" searchPlaceholder="Buscar…" emptyText="Ninguém encontrado." />
                </div>
                <div className="space-y-1.5">
                  <Label>Substituto (quando o executor tiver bloqueio)</Label>
                  <div className="flex gap-2">
                    <div className="min-w-0 flex-1">
                      <SearchableSelect value={substituto} onValueChange={setSubstituto} options={equipe.map((m) => ({ value: m.id, label: m.name }))} placeholder="Nenhum" searchPlaceholder="Buscar…" emptyText="Ninguém encontrado." />
                    </div>
                    {substituto && (
                      <Button type="button" variant="ghost" onClick={() => setSubstituto('')}>
                        Tirar
                      </Button>
                    )}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Cliente das reuniões (opcional)</Label>
                  <div className="flex gap-2">
                    <div className="min-w-0 flex-1">
                      <SearchableSelect value={tenant} onValueChange={setTenant} options={clientes.map((c) => ({ value: c.id, label: c.name }))} placeholder="Legacy Executoria" searchPlaceholder="Buscar cliente…" emptyText="Nenhum cliente." />
                    </div>
                    {tenant && (
                      <Button type="button" variant="ghost" onClick={() => setTenant('')}>
                        Tirar
                      </Button>
                    )}
                  </div>
                </div>
              </>
            )}
            {mudaHorario && (
              <p className="rounded-lg border border-amber-300 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-200">
                Os encontros já marcados vão para o novo dia e horário, na mesma ordem do ciclo. A sala, o link e a matrícula dos clientes continuam os mesmos, e os
                convidados recebem o aviso da mudança.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onFechar}>
              Cancelar
            </Button>
            <Button onClick={() => void salvar()} disabled={busy || !nome.trim()}>
              {busy ? 'Salvando…' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {conflito && (
        <DialogoConflitos
          conflitos={conflito.conflitos}
          podeSobreporBloqueante={conflito.podeSobreporBloqueante}
          onSalvar={(j) => {
            setConflito(null);
            void salvar(j);
          }}
          onDesistir={() => setConflito(null)}
        />
      )}
    </>
  );
}

function Matricular({
  grupos,
  fixo,
  clientes,
  onFechar,
  onFeito,
}: {
  grupos: Grupo[];
  fixo: Grupo | null;
  clientes: Opcao[];
  onFechar: () => void;
  onFeito: () => void;
}) {
  const [tenant, setTenant] = React.useState('');
  const [preferencia, setPreferencia] = React.useState<string>(fixo ? `g:${fixo.id}` : 'qualquer');
  const [previa, setPrevia] = React.useState<Previa | null | 'carregando'>('carregando');
  const [busy, setBusy] = React.useState(false);
  const nomeGrupo = (id: string) => grupos.find((g) => g.id === id)?.nome ?? 'grupo';
  const dias = [...new Set(grupos.map((g) => g.dia_semana))].sort();

  const params = React.useMemo(() => {
    const p = new URLSearchParams();
    if (preferencia.startsWith('g:')) p.set('grupoId', preferencia.slice(2));
    if (preferencia.startsWith('d:')) p.set('diaSemana', preferencia.slice(2));
    return p;
  }, [preferencia]);

  React.useEffect(() => {
    let cancelado = false;
    setPrevia('carregando');
    fetch(`/api/agenda/jornadas/sugestao?${params}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => !cancelado && setPrevia(j.previa ?? null))
      .catch(() => !cancelado && setPrevia(null));
    return () => {
      cancelado = true;
    };
  }, [params]);

  const confirmar = async () => {
    if (!tenant) return toast.error('Selecione o cliente');
    setBusy(true);
    const r = await fetch('/api/agenda/jornadas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId: tenant, ...Object.fromEntries([...params.entries()].map(([k, v]) => [k, k === 'diaSemana' ? Number(v) : v])) }),
    });
    setBusy(false);
    if (!r.ok) return toast.error('Não foi possível matricular', { description: await erro(r) });
    toast.success('Cliente matriculado. Ele recebe o convite dos encontros.');
    onFeito();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Matricular cliente no Impulsão</DialogTitle>
          <DialogDescription>O cliente sempre entra numa Aula 1 e faz os encontros seguidos.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Cliente</Label>
            <SearchableSelect value={tenant} onValueChange={setTenant} options={clientes.map((c) => ({ value: c.id, label: c.name }))} placeholder="Selecione o cliente" searchPlaceholder="Buscar cliente…" emptyText="Nenhum cliente." />
          </div>
          <div className="space-y-1.5">
            <Label>Preferência</Label>
            <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={preferencia} onChange={(e) => setPreferencia(e.target.value)}>
              <option value="qualquer">Qualquer dia (entra o quanto antes)</option>
              {dias.map((d) => (
                <option key={d} value={`d:${d}`}>
                  Só {DIAS_LONGOS[d - 1]}
                </option>
              ))}
              {grupos.map((g) => (
                <option key={g.id} value={`g:${g.id}`}>
                  {g.nome}
                </option>
              ))}
            </select>
          </div>
          {previa === 'carregando' ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : !previa ? (
            <p className="text-sm text-destructive">Nenhuma Aula 1 disponível nas próximas semanas para essa preferência.</p>
          ) : (
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
              <p>
                Entrada: <strong>{br(previa.sugestao.data)}</strong> no {nomeGrupo(previa.sugestao.grupoId)} ({previa.sugestao.rotulo})
                {previa.sugestao.esperaDias > 0 ? `, daqui a ${previa.sugestao.esperaDias} dia(s)` : ', hoje'}.
              </p>
              <ol className="space-y-1">
                {previa.jornada.encontros.map((e) => (
                  <li key={e.numero} className="flex justify-between gap-2">
                    <span>
                      {e.numero}/{previa.jornada.encontros.length} · <strong>{e.rotulo}</strong>
                      {e.recuperacao ? ' (reposição)' : ''}
                    </span>
                    <span className="text-muted-foreground">
                      {br(e.data)} · {nomeGrupo(e.grupoId)}
                    </span>
                  </li>
                ))}
              </ol>
              {previa.jornada.conclusao && <p className="text-muted-foreground">Conclui em {br(previa.jornada.conclusao)}.</p>}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={() => void confirmar()} disabled={busy || !previa || previa === 'carregando'}>
            {busy ? 'Matriculando…' : 'Confirmar matrícula'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
