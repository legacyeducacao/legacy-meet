'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
// O pacote não expõe os tipos pelo campo "exports" (mesmo caso de lib/Debug.tsx).
// @ts-ignore
import { tinykeys } from 'tinykeys';
import { ChevronLeft, ChevronRight, Keyboard, Loader2, Menu, Plus, Search } from 'lucide-react';
import { toast } from '@/components/ui/custom-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { localYmd, type Ymd } from '@/lib/agenda-engine';
import {
  diasDaVisao,
  instanteMin,
  montarRRule,
  navegar,
  NOME_VISAO,
  periodoDaVisao,
  tituloPeriodo,
  type Visao,
} from '@/lib/agenda/visao';
import { CALENDARIOS, type Calendario, type Escopo, type EventoDTO, type FeriadoDTO, type Origem, type RespostaConflito } from '@/lib/agenda/tipos';
import type { Ancora } from './Flutuante';
import { MiniCalendario } from './MiniCalendario';
import { GradeHoras } from './GradeHoras';
import { VisaoMes } from './VisaoMes';
import { VisaoLista } from './VisaoLista';
import { CriacaoRapida, DetalhesEvento, type Cliente } from './Cartoes';
import { FormularioEvento, valoresIniciais, type Membro, type ValoresEvento } from './FormularioEvento';
import { DialogoAtalhos, DialogoCancelar, DialogoConflitos, DialogoEscopo } from './Dialogos';

export interface MeAgenda {
  id: string;
  name: string | null;
  isAdmin: boolean;
  sector: 'comercial' | 'executoria' | 'ambos' | null;
}

const VISOES: Visao[] = ['dia', '4dias', 'semana', 'mes', 'lista'];
const COR = new Map(CALENDARIOS.map((c) => [c.id, c.cor]));
const ESPERA_CANCELAR_MS = 6000;

function lerLocal<T>(k: string, padrao: T): T {
  try {
    const v = window.localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : padrao;
  } catch {
    return padrao;
  }
}
function gravarLocal(k: string, v: unknown) {
  try {
    window.localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* modo privado */
  }
}

async function textoErro(res: Response) {
  return (await res.text().catch(() => '')) || 'Algo deu errado. Tente de novo.';
}

type Rapida = { inicio: Date; fim: Date; ancora: Ancora };
type Conflito = { resposta: RespostaConflito; salvar: (j: string) => void; desistir?: () => void };
type PerguntaEscopo = { titulo: string; resolver: (e: Escopo | null) => void };

export function AgendaNova({ me }: { me: MeAgenda }) {
  const router = useRouter();
  const tz = React.useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo', []);
  const [agora, setAgora] = React.useState(() => new Date());
  const hoje = localYmd(agora, tz);
  const [visao, setVisao] = React.useState<Visao>('semana');
  const [cursor, setCursor] = React.useState<Ymd>(hoje);
  const [eventos, setEventos] = React.useState<EventoDTO[]>([]);
  const [feriados, setFeriados] = React.useState<FeriadoDTO[]>([]);
  const [carregando, setCarregando] = React.useState(true);
  const [ocultos, setOcultos] = React.useState<Calendario[]>([]);
  const [executoresExtras, setExecutoresExtras] = React.useState<string[]>([]);
  const [busca, setBusca] = React.useState('');
  const [selecionado, setSelecionado] = React.useState<string | null>(null);
  const [rapida, setRapida] = React.useState<Rapida | null>(null);
  const [detalhe, setDetalhe] = React.useState<{ evento: EventoDTO; ancora: Ancora } | null>(null);
  const [formulario, setFormulario] = React.useState<ValoresEvento | null>(null);
  const [cancelar, setCancelar] = React.useState<EventoDTO | null>(null);
  const [conflito, setConflito] = React.useState<Conflito | null>(null);
  const [escopo, setEscopo] = React.useState<PerguntaEscopo | null>(null);
  const [atalhos, setAtalhos] = React.useState(false);
  const [lateralMobile, setLateralMobile] = React.useState(false);
  const [clientes, setClientes] = React.useState<Cliente[]>([]);
  const [equipe, setEquipe] = React.useState<Membro[]>([]);
  const [escondidosPendentes, setEscondidosPendentes] = React.useState<Set<string>>(new Set());
  const pendentes = React.useRef(new Map<string, { timer: number; enviar: (keepalive?: boolean) => void }>());
  const buscaRef = React.useRef<HTMLInputElement>(null);
  const [montado, setMontado] = React.useState(false);
  React.useEffect(() => setMontado(true), []);

  const setorPadrao: 'executoria' | 'comercial' = me.sector === 'comercial' ? 'comercial' : 'executoria';
  const podeEscolherSetor = me.isAdmin || me.sector === 'ambos';

  // Preferências do usuário (visão e calendários). No celular, começa na lista.
  React.useEffect(() => {
    const salva = lerLocal<Visao | null>('agenda-nova:visao', null);
    setVisao(salva && VISOES.includes(salva) ? salva : window.innerWidth < 640 ? 'lista' : 'semana');
    setOcultos(lerLocal<Calendario[]>('agenda-nova:ocultos', []));
    setExecutoresExtras(lerLocal<string[]>('agenda-nova:executores', []));
  }, []);
  React.useEffect(() => gravarLocal('agenda-nova:visao', visao), [visao]);
  React.useEffect(() => gravarLocal('agenda-nova:ocultos', ocultos), [ocultos]);
  React.useEffect(() => gravarLocal('agenda-nova:executores', executoresExtras), [executoresExtras]);

  // Relógio da linha do "agora".
  React.useEffect(() => {
    const t = window.setInterval(() => setAgora(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  React.useEffect(() => {
    fetch('/api/clients')
      .then((r) => (r.ok ? r.json() : { clients: [] }))
      .then((j) => setClientes(j.clients ?? []))
      .catch(() => {});
    fetch('/api/team')
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((j) => setEquipe((j.members ?? []).map((m: Membro) => ({ id: m.id, name: m.name }))))
      .catch(() => {});
  }, []);

  const dias = React.useMemo(() => diasDaVisao(visao, cursor), [visao, cursor]);
  const executoresParam = React.useMemo(() => [me.id, ...executoresExtras.filter((x) => x !== me.id)].join(','), [me.id, executoresExtras]);

  const carregar = React.useCallback(
    async (sinal?: AbortSignal) => {
      const { de, ate } = periodoDaVisao(visao, cursor, tz);
      setCarregando(true);
      try {
        const qs = new URLSearchParams({ de: de.toISOString(), ate: ate.toISOString(), executores: executoresParam });
        const res = await fetch(`/api/agenda/eventos?${qs}`, { cache: 'no-store', signal: sinal });
        if (!res.ok) throw new Error(await textoErro(res));
        const j = (await res.json()) as { eventos: EventoDTO[]; feriados: FeriadoDTO[] };
        setEventos(j.eventos);
        setFeriados(j.feriados);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') toast.error('Não foi possível carregar a agenda', { description: (e as Error).message });
      } finally {
        if (!sinal?.aborted) setCarregando(false);
      }
    },
    [visao, cursor, tz, executoresParam],
  );

  React.useEffect(() => {
    const ctrl = new AbortController();
    void carregar(ctrl.signal);
    return () => ctrl.abort();
  }, [carregar]);

  // Cancelamentos ainda no prazo do "Desfazer" vão mesmo se a página fechar.
  React.useEffect(() => {
    const enviarTudo = () => {
      for (const p of pendentes.current.values()) {
        window.clearTimeout(p.timer);
        p.enviar(true);
      }
      pendentes.current.clear();
    };
    window.addEventListener('pagehide', enviarTudo);
    return () => window.removeEventListener('pagehide', enviarTudo);
  }, []);

  const corDe = React.useCallback(
    (e: EventoDTO) => (e.executorId !== me.id && e.tipo === 'reuniao' ? '#94a3b8' : COR.get(e.calendario) ?? '#64748b'),
    [me.id],
  );

  const visiveis = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return eventos.filter(
      (e) =>
        !ocultos.includes(e.calendario) &&
        !escondidosPendentes.has(e.id) &&
        (!q || `${e.titulo} ${e.cliente ?? ''} ${e.rotulo ?? ''} ${e.executorNome ?? ''}`.toLowerCase().includes(q)),
    );
  }, [eventos, ocultos, escondidosPendentes, busca]);
  const feriadosVisiveis = ocultos.includes('feriados') ? [] : feriados;

  const perguntarEscopo = (titulo: string) => new Promise<Escopo | null>((resolver) => setEscopo({ titulo, resolver }));

  // ------------------------------ Criar ------------------------------
  const enviarCriacao = async (v: ValoresEvento, justificativa?: string): Promise<boolean> => {
    const rrule = montarRRule(v.repeticao, localYmd(v.inicio, tz));
    const res = await fetch('/api/agenda/eventos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titulo: v.titulo,
        setor: v.setor,
        tenantId: v.tenantId,
        inicio: v.inicio.toISOString(),
        fim: v.fim.toISOString(),
        rrule,
        politicaFeriado: rrule ? v.politicaFeriado : 'manter',
        gravar: v.gravar,
        transcrever: v.transcrever,
        onboarding: v.onboarding,
        coHostIds: v.coHostIds,
        guestEmails: v.guestEmails,
        justificativa,
      }),
    });
    if (res.status === 409) {
      const resposta = (await res.json()) as RespostaConflito;
      setConflito({ resposta, salvar: (j) => void enviarCriacao(v, j) });
      return false;
    }
    if (!res.ok) {
      toast.error('Não foi possível criar', { description: await textoErro(res) });
      return false;
    }
    const j = (await res.json()) as { ids: string[]; ocorrencias: number };
    setConflito(null);
    toast.success(j.ocorrencias > 1 ? `${j.ocorrencias} reuniões criadas` : 'Reunião criada', {
      action: {
        label: 'Desfazer',
        onClick: async () => {
          const r = await fetch('/api/agenda/desfazer-criacao', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: j.ids }),
          });
          if (!r.ok) toast.error('Não deu para desfazer', { description: await textoErro(r) });
          void carregar();
        },
      },
    });
    void carregar();
    return true;
  };

  const abrirCriacao = (inicio: Date, fim: Date, ancora: Ancora) => {
    setDetalhe(null);
    setRapida({ inicio, fim, ancora });
  };

  const novoAgora = () => {
    const base = new Date(agora);
    base.setMinutes(0, 0, 0);
    const ini = new Date(base.getTime() + 3_600_000);
    setRapida(null);
    setFormulario(valoresIniciais(ini, new Date(ini.getTime() + 3_600_000), setorPadrao));
  };

  // ------------------------------ Mover / editar ------------------------------
  const desfazerMovimento = async (anteriores: Array<{ id: string; inicio: string; fim: string; titulo: string | null }>) => {
    const r = await fetch('/api/agenda/restaurar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itens: anteriores }),
    });
    if (!r.ok) toast.error('Não deu para desfazer', { description: await textoErro(r) });
    void carregar();
  };

  const aplicarMudanca = async (
    ev: EventoDTO,
    inicio: Date,
    fim: Date,
    esc: Escopo,
    opts: { justificativa?: string; titulo?: string } = {},
  ): Promise<boolean> => {
    const antes = eventos;
    const delta = inicio.getTime() - Date.parse(ev.inicio);
    const dur = fim.getTime() - inicio.getTime();
    const atinge = (e: EventoDTO) =>
      e.id === ev.id ||
      (esc !== 'esta' && !!ev.serieId && e.serieId === ev.serieId && e.status === 'scheduled' && (esc === 'todas' || e.inicio >= ev.inicio));
    // Otimista: a tela muda na hora e volta se o servidor recusar.
    setEventos((lista) =>
      lista.map((e) => {
        if (!atinge(e)) return e;
        const ini = Date.parse(e.inicio) + delta;
        return { ...e, inicio: new Date(ini).toISOString(), fim: new Date(ini + dur).toISOString(), ...(opts.titulo ? { titulo: opts.titulo } : {}) };
      }),
    );
    const res = await fetch(`/api/agenda/eventos/${ev.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inicio: inicio.toISOString(), fim: fim.toISOString(), escopo: esc, titulo: opts.titulo, justificativa: opts.justificativa }),
    });
    if (res.status === 409) {
      setEventos(antes);
      const resposta = (await res.json()) as RespostaConflito;
      setConflito({ resposta, salvar: (j) => void aplicarMudanca(ev, inicio, fim, esc, { ...opts, justificativa: j }) });
      return false;
    }
    if (!res.ok) {
      setEventos(antes);
      toast.error('Não foi possível salvar', { description: await textoErro(res) });
      return false;
    }
    const j = (await res.json()) as { anteriores: Array<{ id: string; inicio: string; fim: string; titulo: string | null }> };
    setConflito(null);
    const n = j.anteriores.length;
    toast.success(n > 1 ? `${n} reuniões atualizadas` : 'Reunião atualizada', {
      action: { label: 'Desfazer', onClick: () => void desfazerMovimento(j.anteriores) },
    });
    void carregar();
    return true;
  };

  const mover = async (ev: EventoDTO, inicio: Date, fim: Date) => {
    if (!ev.podeEditar) return;
    let esc: Escopo = 'esta';
    if (ev.serieId) {
      const r = await perguntarEscopo('Mover evento recorrente');
      if (!r) return;
      esc = r;
    }
    await aplicarMudanca(ev, inicio, fim, esc);
  };

  const salvarFormulario = async (v: ValoresEvento, justificativa?: string): Promise<boolean> => {
    if (!v.id) return enviarCriacao(v, justificativa);
    const ev = eventos.find((e) => e.id === v.id);
    if (!ev) return false;
    let esc: Escopo = 'esta';
    if (v.recorrente) {
      const r = await perguntarEscopo('Editar evento recorrente');
      if (!r) return false;
      esc = r;
    }
    return aplicarMudanca(ev, v.inicio, v.fim, esc, { justificativa, titulo: v.titulo !== ev.titulo ? v.titulo : undefined });
  };

  // ------------------------------ Cancelar (com Desfazer) ------------------------------
  const confirmarCancelamento = (ev: EventoDTO, esc: Escopo, origem: Origem) => {
    setCancelar(null);
    setDetalhe(null);
    const ids = eventos
      .filter((e) => e.id === ev.id || (esc !== 'esta' && !!ev.serieId && e.serieId === ev.serieId && e.status === 'scheduled' && (esc === 'todas' || e.inicio >= ev.inicio)))
      .map((e) => e.id);
    const chave = `${ev.id}:${Date.now()}`;
    setEscondidosPendentes((s) => new Set([...s, ...ids]));
    const reexibir = () =>
      setEscondidosPendentes((s) => {
        const n = new Set(s);
        ids.forEach((i) => n.delete(i));
        return n;
      });
    const enviar = (keepalive = false) => {
      pendentes.current.delete(chave);
      void fetch(`/api/agenda/eventos/${ev.id}/cancelar`, {
        method: 'POST',
        keepalive,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ escopo: esc, origem }),
      })
        .then(async (r) => {
          if (!r.ok) {
            reexibir();
            toast.error('Não foi possível cancelar', { description: await textoErro(r) });
          } else if (!keepalive) {
            await carregar();
            reexibir();
          }
        })
        .catch(() => reexibir());
    };
    const timer = window.setTimeout(() => enviar(), ESPERA_CANCELAR_MS);
    pendentes.current.set(chave, { timer, enviar });
    toast(ids.length > 1 ? `${ids.length} reuniões canceladas` : 'Reunião cancelada', {
      duration: ESPERA_CANCELAR_MS,
      action: {
        label: 'Desfazer',
        onClick: () => {
          window.clearTimeout(timer);
          pendentes.current.delete(chave);
          reexibir();
        },
      },
    });
  };

  // ------------------------------ Ações do detalhe ------------------------------
  const entrar = async (ev: EventoDTO) => {
    const res = await fetch('/api/meetings/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: ev.id }),
    });
    if (!res.ok) return toast.error('Não foi possível entrar', { description: await textoErro(res) });
    const qs = new URLSearchParams({ rec: ev.gravar ? '1' : '0', tx: ev.transcrever ? '1' : '0' });
    router.push(`/rooms/${ev.roomName}?${qs}`);
  };
  const copiarLink = async (ev: EventoDTO) => {
    const link = `${window.location.origin}/rooms/${ev.roomName}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link do convidado copiado');
    } catch {
      toast.error('Não foi possível copiar', { description: link });
    }
  };
  const valoresDe = (ev: EventoDTO, comId: boolean): ValoresEvento => ({
    ...valoresIniciais(new Date(ev.inicio), new Date(ev.fim), ev.setor ?? setorPadrao),
    ...(comId ? { id: ev.id, recorrente: !!ev.serieId } : {}),
    titulo: ev.titulo,
    tenantId: ev.tenantId ?? '',
    gravar: ev.gravar ?? true,
    transcrever: ev.transcrever ?? true,
    onboarding: ev.onboarding ?? false,
  });

  // ------------------------------ Navegação e atalhos ------------------------------
  const irPara = (d: Ymd, v?: Visao) => {
    setCursor(d);
    if (v) setVisao(v);
  };

  React.useEffect(() => {
    const livre = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return false;
      return !document.querySelector('[role="dialog"]');
    };
    const k = (fn: () => void) => (e: KeyboardEvent) => {
      if (!livre(e)) return;
      e.preventDefault();
      fn();
    };
    return tinykeys(window, {
      c: k(novoAgora),
      t: k(() => setCursor(hoje)),
      d: k(() => setVisao('dia')),
      x: k(() => setVisao('4dias')),
      w: k(() => setVisao('semana')),
      m: k(() => setVisao('mes')),
      a: k(() => setVisao('lista')),
      j: k(() => setCursor((c) => navegar(visao, c, 1))),
      k: k(() => setCursor((c) => navegar(visao, c, -1))),
      ArrowRight: k(() => setCursor((c) => navegar(visao, c, 1))),
      ArrowLeft: k(() => setCursor((c) => navegar(visao, c, -1))),
      '/': k(() => buscaRef.current?.focus()),
      'Shift+?': k(() => setAtalhos(true)),
      Delete: k(() => {
        const ev = eventos.find((e) => e.id === selecionado);
        if (ev?.podeEditar && ev.tipo === 'reuniao') setCancelar(ev);
      }),
      Escape: () => {
        setRapida(null);
        setDetalhe(null);
        setSelecionado(null);
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visao, hoje, eventos, selecionado]);

  const abrir = (ev: EventoDTO, ancora: Ancora) => {
    setRapida(null);
    setSelecionado(ev.id);
    setDetalhe({ evento: ev, ancora });
  };

  if (!montado) {
    return (
      <div className="flex h-[60dvh] items-center justify-center text-muted-foreground" aria-busy="true">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const lateral = (
    <div className="space-y-6">
      <Button className="h-11 w-full justify-start gap-2 rounded-2xl shadow-sm" onClick={novoAgora}>
        <Plus className="h-5 w-5" /> Criar
      </Button>
      <MiniCalendario cursor={cursor} hoje={hoje} diasVisiveis={visao === 'lista' ? [] : dias} onEscolher={(d) => irPara(d, visao === 'mes' ? 'dia' : undefined)} />
      <div className="space-y-1">
        <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Meus calendários</p>
        {CALENDARIOS.map((c) => {
          const on = !ocultos.includes(c.id);
          return (
            <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted">
              <input
                type="checkbox"
                className="h-4 w-4"
                style={{ accentColor: c.cor }}
                checked={on}
                onChange={() => setOcultos((o) => (on ? [...o, c.id] : o.filter((x) => x !== c.id)))}
              />
              {c.nome}
            </label>
          );
        })}
      </div>
      {me.isAdmin && equipe.length > 0 && (
        <div className="space-y-1">
          <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Outros executores</p>
          <div className="max-h-56 space-y-0.5 overflow-y-auto">
            {equipe
              .filter((m) => m.id !== me.id)
              .map((m) => (
                <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={executoresExtras.includes(m.id)}
                    onChange={(e) => setExecutoresExtras((x) => (e.target.checked ? [...x, m.id].slice(0, 29) : x.filter((i) => i !== m.id)))}
                  />
                  <span className="truncate">{m.name}</span>
                </label>
              ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="-mx-5 -mt-5 flex h-[calc(100dvh-8.5rem-env(safe-area-inset-bottom))] min-h-[480px] flex-col bg-background md:-mx-10 md:-mt-10 md:h-[calc(100dvh-4rem)]">
      {/* Barra de ferramentas */}
      <header className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-2 md:px-4">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setLateralMobile(true)} aria-label="Calendários">
          <Menu className="h-5 w-5" />
        </Button>
        <Button variant="outline" size="sm" onClick={() => setCursor(hoje)}>
          Hoje
        </Button>
        <div className="flex">
          <Button variant="ghost" size="icon" aria-label="Período anterior" onClick={() => setCursor((c) => navegar(visao, c, -1))}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Próximo período" onClick={() => setCursor((c) => navegar(visao, c, 1))}>
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>
        <h1 className="order-last w-full min-w-0 truncate px-1 text-base font-semibold first-letter:uppercase sm:order-none sm:w-auto sm:flex-1 sm:px-0 md:text-lg" aria-live="polite">
          {tituloPeriodo(visao, cursor)}
        </h1>
        {carregando && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Carregando" />}
        <div className="relative hidden sm:block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input ref={buscaRef} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar" className="h-9 w-44 pl-8 lg:w-56" aria-label="Buscar reuniões" />
        </div>
        <div className="ml-auto flex rounded-lg border p-0.5 sm:ml-0" role="tablist" aria-label="Visão">
          {VISOES.map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={visao === v}
              onClick={() => setVisao(v)}
              className={cn(
                'rounded-md px-2 py-1 text-xs font-medium sm:px-3 sm:text-sm',
                visao === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
                (v === '4dias' || v === 'semana') && 'hidden sm:block',
              )}
            >
              {NOME_VISAO[v]}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="icon" className="hidden md:inline-flex" onClick={() => setAtalhos(true)} aria-label="Atalhos de teclado">
          <Keyboard className="h-5 w-5" />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-64 shrink-0 overflow-y-auto border-r bg-card p-4 lg:block">{lateral}</aside>
        <main className="min-h-0 min-w-0 flex-1">
          {visao === 'mes' ? (
            <VisaoMes
              dias={dias}
              cursor={cursor}
              hoje={hoje}
              tz={tz}
              eventos={visiveis}
              feriados={feriadosVisiveis}
              corDe={corDe}
              onCriar={abrirCriacao}
              onAbrir={abrir}
              onMover={mover}
              onVerDia={(d) => irPara(d, 'dia')}
            />
          ) : visao === 'lista' ? (
            <VisaoLista dias={dias} hoje={hoje} tz={tz} eventos={visiveis} feriados={feriadosVisiveis} corDe={corDe} onAbrir={abrir} />
          ) : (
            <GradeHoras
              dias={dias}
              hoje={hoje}
              agora={agora}
              tz={tz}
              eventos={visiveis}
              feriados={feriadosVisiveis}
              corDe={corDe}
              selecionadoId={selecionado}
              onCriar={abrirCriacao}
              onAbrir={abrir}
              onMover={mover}
              onVerDia={(d) => irPara(d, 'dia')}
            />
          )}
        </main>
      </div>

      {/* Botão flutuante de criar no celular */}
      <Button
        className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-4 z-40 h-14 w-14 rounded-2xl shadow-lg md:hidden"
        onClick={novoAgora}
        aria-label="Criar reunião"
      >
        <Plus className="h-6 w-6" />
      </Button>

      <Sheet open={lateralMobile} onOpenChange={setLateralMobile}>
        <SheetContent side="left" className="w-72 overflow-y-auto p-4">
          <SheetHeader>
            <SheetTitle>Agenda</SheetTitle>
          </SheetHeader>
          <div className="mb-4 sm:hidden">
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar" aria-label="Buscar reuniões" />
          </div>
          {lateral}
        </SheetContent>
      </Sheet>

      {rapida && (
        <CriacaoRapida
          ancora={rapida.ancora}
          inicio={rapida.inicio}
          fim={rapida.fim}
          tz={tz}
          setor={setorPadrao}
          podeEscolherSetor={podeEscolherSetor}
          clientes={clientes}
          onFechar={() => setRapida(null)}
          onSalvar={(v) => enviarCriacao({ ...valoresIniciais(rapida.inicio, rapida.fim, v.setor), ...v })}
          onMaisOpcoes={(v) => {
            setFormulario({ ...valoresIniciais(rapida.inicio, rapida.fim, v.setor), ...v });
            setRapida(null);
          }}
        />
      )}

      {detalhe && (
        <DetalhesEvento
          evento={detalhe.evento}
          ancora={detalhe.ancora}
          tz={tz}
          cor={corDe(detalhe.evento)}
          meId={me.id}
          onFechar={() => setDetalhe(null)}
          onEntrar={() => void entrar(detalhe.evento)}
          onCopiarLink={() => void copiarLink(detalhe.evento)}
          onEditar={() => {
            setFormulario(valoresDe(detalhe.evento, true));
            setDetalhe(null);
          }}
          onDuplicar={() => {
            setFormulario(valoresDe(detalhe.evento, false));
            setDetalhe(null);
          }}
          onExcluir={() => setCancelar(detalhe.evento)}
        />
      )}

      {formulario && (
        <FormularioEvento
          inicial={formulario}
          tz={tz}
          podeEscolherSetor={podeEscolherSetor}
          clientes={clientes}
          equipe={equipe}
          meId={me.id}
          onFechar={() => setFormulario(null)}
          onSalvar={salvarFormulario}
        />
      )}

      {cancelar && (
        <DialogoCancelar
          titulo={cancelar.titulo}
          recorrente={!!cancelar.serieId}
          onCancelar={() => setCancelar(null)}
          onConfirmar={(esc, origem) => confirmarCancelamento(cancelar, esc, origem)}
        />
      )}

      {escopo && (
        <DialogoEscopo
          titulo={escopo.titulo}
          onConfirmar={(e) => {
            escopo.resolver(e);
            setEscopo(null);
          }}
          onCancelar={() => {
            escopo.resolver(null);
            setEscopo(null);
          }}
        />
      )}

      {conflito && (
        <DialogoConflitos
          conflitos={conflito.resposta.conflitos}
          podeSobreporBloqueante={conflito.resposta.podeSobreporBloqueante}
          onSalvar={(j) => conflito.salvar(j)}
          onDesistir={() => setConflito(null)}
        />
      )}

      {atalhos && <DialogoAtalhos onFechar={() => setAtalhos(false)} />}
    </div>
  );
}

/** Instante de um dia + minutos (exportado para testes da tela). */
export const _instanteMin = instanteMin;
