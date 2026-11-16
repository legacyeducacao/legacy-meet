'use client';

import * as React from 'react';
import { Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/custom-toast';
import { cn } from '@/lib/utils';
import { situacaoDaSessao, validarParticipante } from '@/lib/kickoff/reservasRegras';
import { quando, textoErro, type ReservaTela, type SessaoTela } from './tipos';

/** O que está aberto na seção (um diálogo por vez). */
export type AcaoKickoff =
  | { tipo: 'adicionar'; sessao: SessaoTela }
  | { tipo: 'participante'; reserva: ReservaTela }
  | { tipo: 'remanejar'; reserva: ReservaTela }
  | { tipo: 'cancelarReserva'; reserva: ReservaTela }
  | { tipo: 'historico'; reserva: ReservaTela }
  | { tipo: 'cancelarSessao'; sessao: SessaoTela }
  | { tipo: 'ausente'; reserva: ReservaTela }
  | { tipo: 'interromper'; reserva: ReservaTela }
  | { tipo: 'corrigirPresenca'; reserva: ReservaTela }
  | { tipo: 'concluir'; reserva: ReservaTela }
  | { tipo: 'reagendar'; reserva: ReservaTela };

interface Props {
  acao: AcaoKickoff | null;
  sessoes: SessaoTela[];
  fechar: () => void;
  /** Depois de gravar: recarrega a seção. */
  feito: () => void;
}

async function enviar(url: string, method: 'POST' | 'PATCH', corpo: unknown): Promise<boolean> {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  if (!res.ok) {
    toast.error('Não foi possível salvar', { description: await textoErro(res) });
    return false;
  }
  return true;
}

export function ReservasDialogos({ acao, sessoes, fechar, feito }: Props) {
  return (
    <Dialog open={!!acao} onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="sm:max-w-lg">
        {acao?.tipo === 'adicionar' && <Adicionar sessao={acao.sessao} fechar={fechar} feito={feito} />}
        {acao?.tipo === 'participante' && <Participante reserva={acao.reserva} fechar={fechar} feito={feito} />}
        {acao?.tipo === 'remanejar' && <Remanejar reserva={acao.reserva} sessoes={sessoes} fechar={fechar} feito={feito} />}
        {acao?.tipo === 'reagendar' && <Remanejar reagendar reserva={acao.reserva} sessoes={sessoes} fechar={fechar} feito={feito} />}
        {acao?.tipo === 'ausente' && <Ausente reserva={acao.reserva} fechar={fechar} feito={feito} />}
        {acao?.tipo === 'concluir' && <Concluir reserva={acao.reserva} fechar={fechar} feito={feito} />}
        {acao?.tipo === 'interromper' && <Interromper reserva={acao.reserva} fechar={fechar} feito={feito} />}
        {acao?.tipo === 'corrigirPresenca' && <CorrigirPresenca reserva={acao.reserva} fechar={fechar} feito={feito} />}
        {acao?.tipo === 'cancelarReserva' && <CancelarReserva reserva={acao.reserva} fechar={fechar} feito={feito} />}
        {acao?.tipo === 'historico' && <Historico reserva={acao.reserva} />}
        {acao?.tipo === 'cancelarSessao' && <CancelarSessao sessao={acao.sessao} fechar={fechar} feito={feito} />}
      </DialogContent>
    </Dialog>
  );
}

type Acoes = { fechar: () => void; feito: () => void };

function CamposParticipante({
  valor,
  mudar,
}: {
  valor: { nome: string; email: string; telefone: string };
  mudar: (v: { nome: string; email: string; telefone: string }) => void;
}) {
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="kp-nome">Nome do participante principal</Label>
        <Input id="kp-nome" value={valor.nome} maxLength={200} onChange={(e) => mudar({ ...valor, nome: e.target.value })} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="kp-email">E-mail (obrigatório)</Label>
        <Input id="kp-email" type="email" value={valor.email} maxLength={254} onChange={(e) => mudar({ ...valor, email: e.target.value })} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="kp-tel">Telefone / WhatsApp (opcional)</Label>
        <Input id="kp-tel" type="tel" value={valor.telefone} maxLength={30} onChange={(e) => mudar({ ...valor, telefone: e.target.value })} />
      </div>
    </div>
  );
}

interface Empresa {
  id: string;
  nome: string;
  produto: string | null;
  reservaAtiva: { reservaId: string; sessaoId: string } | null;
  concluida: boolean;
  ausente: boolean;
}

function Adicionar({ sessao, fechar, feito }: { sessao: SessaoTela } & Acoes) {
  const [termo, setTermo] = React.useState('');
  const [empresas, setEmpresas] = React.useState<Empresa[] | null>(null);
  const [buscando, setBuscando] = React.useState(false);
  const [escolhida, setEscolhida] = React.useState<Empresa | null>(null);
  const [p, setP] = React.useState({ nome: '', email: '', telefone: '' });
  const [salvando, setSalvando] = React.useState(false);
  const [aviso, setAviso] = React.useState('');

  React.useEffect(() => {
    const t = termo.trim();
    if (t.length < 2) {
      setEmpresas(null);
      return;
    }
    const ctl = new AbortController();
    const id = setTimeout(() => {
      setBuscando(true);
      fetch(`/api/agenda/kickoffs/empresas?q=${encodeURIComponent(t)}`, { signal: ctl.signal })
        .then(async (r) => (r.ok ? ((await r.json()) as { empresas: Empresa[] }).empresas : Promise.reject(new Error(await textoErro(r)))))
        .then(setEmpresas)
        .catch((e) => {
          if ((e as Error).name !== 'AbortError') setAviso((e as Error).message);
        })
        .finally(() => setBuscando(false));
    }, 250);
    return () => {
      clearTimeout(id);
      ctl.abort();
    };
  }, [termo]);

  const salvar = async () => {
    if (!escolhida) return setAviso('Escolha a empresa.');
    const v = validarParticipante(p);
    if (!v.ok) return setAviso(v.message);
    setSalvando(true);
    const ok = await enviar('/api/agenda/kickoffs/reservas', 'POST', { sessaoId: sessao.id, tenantId: escolhida.id, ...v.participante });
    setSalvando(false);
    if (ok) {
      toast.success(`${escolhida.nome} inscrita no kickoff`);
      fechar();
      feito();
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Adicionar empresa</DialogTitle>
        <DialogDescription className="first-letter:uppercase">
          {quando(sessao.inicio)} · {sessao.ocupadas} de {sessao.capacidade} empresas
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="kp-busca">Empresa</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            id="kp-busca"
            className="pl-8"
            placeholder="Digite ao menos 2 letras do nome"
            value={termo}
            onChange={(e) => {
              setTermo(e.target.value);
              setEscolhida(null);
              setAviso('');
            }}
          />
        </div>
        {buscando && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Buscando" />}
        {empresas && !buscando && (
          <ul className="max-h-48 overflow-y-auto rounded-md border" role="listbox" aria-label="Empresas encontradas">
            {empresas.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">Nenhuma empresa encontrada.</li>}
            {empresas.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={escolhida?.id === e.id}
                  disabled={!!e.reservaAtiva || e.concluida}
                  onClick={() => setEscolhida(e)}
                  className={cn(
                    'flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60',
                    escolhida?.id === e.id && 'bg-muted',
                  )}
                >
                  <span className="font-medium">{e.nome}</span>
                  {e.concluida && <span className="text-xs text-muted-foreground">Kickoff já concluído: um novo só pelo suporte</span>}
                  {!e.concluida && e.reservaAtiva && (
                    <span className="text-xs text-muted-foreground">Já tem kickoff marcado: remaneje a reserva existente</span>
                  )}
                  {!e.concluida && !e.reservaAtiva && e.ausente && (
                    <span className="text-xs text-muted-foreground">Faltou a um kickoff: a nova reserva fica ligada à ausência</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <CamposParticipante valor={p} mudar={setP} />
      {aviso && <p className="text-sm text-destructive">{aviso}</p>}
      <DialogFooter>
        <Button variant="outline" onClick={fechar}>
          Cancelar
        </Button>
        <Button onClick={() => void salvar()} disabled={salvando || !escolhida}>
          {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Inscrever
        </Button>
      </DialogFooter>
    </>
  );
}

function Participante({ reserva, fechar, feito }: { reserva: ReservaTela } & Acoes) {
  const [p, setP] = React.useState({
    nome: reserva.participante.nome,
    email: reserva.participante.email,
    telefone: reserva.participante.telefone ?? '',
  });
  const [aviso, setAviso] = React.useState('');
  const [salvando, setSalvando] = React.useState(false);
  const salvar = async () => {
    const v = validarParticipante(p);
    if (!v.ok) return setAviso(v.message);
    setSalvando(true);
    const ok = await enviar(`/api/agenda/kickoffs/reservas/${reserva.id}`, 'PATCH', v.participante);
    setSalvando(false);
    if (ok) {
      toast.success('Participante atualizado');
      fechar();
      feito();
    }
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>Participante principal</DialogTitle>
        <DialogDescription>{reserva.empresa.nome}. Os dados anteriores ficam no histórico.</DialogDescription>
      </DialogHeader>
      <CamposParticipante valor={p} mudar={setP} />
      {aviso && <p className="text-sm text-destructive">{aviso}</p>}
      <DialogFooter>
        <Button variant="outline" onClick={fechar}>
          Cancelar
        </Button>
        <Button onClick={() => void salvar()} disabled={salvando}>
          {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar
        </Button>
      </DialogFooter>
    </>
  );
}

function Remanejar({
  reserva,
  sessoes,
  fechar,
  feito,
  reagendar = false,
}: { reserva: ReservaTela; sessoes: SessaoTela[]; reagendar?: boolean } & Acoes) {
  const destinos = sessoes.filter((s) => s.id !== reserva.sessaoId && situacaoDaSessao(s) === 'aberta');
  const [destino, setDestino] = React.useState('');
  const [motivo, setMotivo] = React.useState('');
  const [salvando, setSalvando] = React.useState(false);
  const salvar = async () => {
    setSalvando(true);
    const ok = await enviar(`/api/agenda/kickoffs/reservas/${reserva.id}`, 'POST', {
      acao: reagendar ? 'reagendar' : 'remanejar',
      sessaoId: destino,
      motivo,
    });
    setSalvando(false);
    if (ok) {
      toast.success(`${reserva.empresa.nome} ${reagendar ? 'reagendada' : 'remanejada'}`);
      fechar();
      feito();
    }
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>{reagendar ? 'Reagendar empresa' : 'Remanejar empresa'}</DialogTitle>
        <DialogDescription>
          {reagendar
            ? `${reserva.empresa.nome} ${reserva.status === 'interrompida' ? 'participou sem concluir' : 'não compareceu'}. Uma reserva nova é criada na sessão escolhida, com o mesmo participante; o registro anterior continua no histórico.`
            : `${reserva.empresa.nome}: a mesma reserva vai para outra sessão; a troca fica no histórico.`}
        </DialogDescription>
      </DialogHeader>
      {destinos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma outra sessão futura com vaga e aberta para reservas.</p>
      ) : (
        <fieldset className="grid gap-1.5">
          <legend className="mb-1 text-sm font-medium">Sessão de destino</legend>
          <div className="max-h-56 overflow-y-auto rounded-md border">
            {destinos.map((s) => (
              <label key={s.id} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted">
                <input type="radio" name="kp-destino" value={s.id} checked={destino === s.id} onChange={() => setDestino(s.id)} />
                <span className="first-letter:uppercase">{quando(s.inicio)}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {s.ocupadas}/{s.capacidade}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="kp-motivo-rem">Motivo (opcional)</Label>
        <Textarea id="kp-motivo-rem" maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={fechar}>
          Cancelar
        </Button>
        <Button onClick={() => void salvar()} disabled={salvando || !destino}>
          {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {reagendar ? 'Reagendar' : 'Remanejar'}
        </Button>
      </DialogFooter>
    </>
  );
}

function CancelarReserva({ reserva, fechar, feito }: { reserva: ReservaTela } & Acoes) {
  const [motivo, setMotivo] = React.useState('');
  const [salvando, setSalvando] = React.useState(false);
  const salvar = async () => {
    setSalvando(true);
    const ok = await enviar(`/api/agenda/kickoffs/reservas/${reserva.id}`, 'POST', { acao: 'cancelar', motivo });
    setSalvando(false);
    if (ok) {
      toast.success('Reserva cancelada');
      fechar();
      feito();
    }
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>Cancelar reserva</DialogTitle>
        <DialogDescription>
          {reserva.empresa.nome}: a vaga é liberada e a empresa pode reservar outra sessão. O cancelamento fica no histórico e não pode ser desfeito.
          Ninguém é avisado automaticamente.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="kp-motivo-can">Motivo (opcional)</Label>
        <Textarea id="kp-motivo-can" maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={fechar}>
          Voltar
        </Button>
        <Button variant="destructive" onClick={() => void salvar()} disabled={salvando}>
          {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Cancelar reserva
        </Button>
      </DialogFooter>
    </>
  );
}

function Ausente({ reserva, fechar, feito }: { reserva: ReservaTela } & Acoes) {
  const [salvando, setSalvando] = React.useState(false);
  const salvar = async () => {
    setSalvando(true);
    const ok = await enviar(`/api/agenda/kickoffs/reservas/${reserva.id}`, 'POST', { acao: 'presenca', presenca: 'ausente' });
    setSalvando(false);
    if (ok) {
      toast.success(`${reserva.empresa.nome}: ausência registrada`, { description: 'A empresa pode ser reagendada.' });
      fechar();
      feito();
    }
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>Registrar que não compareceu</DialogTitle>
        <DialogDescription>
          {reserva.empresa.nome}: a ausência fica registrada no histórico e não pode ser desfeita aqui. A empresa não conta como tendo feito o
          kickoff e pode ser reagendada para outra sessão.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onClick={fechar}>
          Voltar
        </Button>
        <Button onClick={() => void salvar()} disabled={salvando}>
          {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Registrar ausência
        </Button>
      </DialogFooter>
    </>
  );
}

function Interromper({ reserva, fechar, feito }: { reserva: ReservaTela } & Acoes) {
  const [motivo, setMotivo] = React.useState('');
  const [salvando, setSalvando] = React.useState(false);
  const salvar = async () => {
    setSalvando(true);
    const ok = await enviar(`/api/agenda/kickoffs/reservas/${reserva.id}`, 'POST', { acao: 'interromper', motivo });
    setSalvando(false);
    if (ok) {
      toast.success(`${reserva.empresa.nome}: participação não concluída registrada`, { description: 'A empresa pode ser reagendada.' });
      fechar();
      feito();
    }
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>Participou, mas não concluiu</DialogTitle>
        <DialogDescription>
          {reserva.empresa.nome} compareceu, mas o kickoff não foi concluído (interrupção, problema técnico). A participação fica registrada no
          histórico, não pode ser desfeita aqui, e a empresa pode ser reagendada.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="kp-motivo-int">Motivo (obrigatório)</Label>
        <Textarea id="kp-motivo-int" maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={fechar}>
          Voltar
        </Button>
        <Button onClick={() => void salvar()} disabled={salvando || !motivo.trim()}>
          {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Registrar
        </Button>
      </DialogFooter>
    </>
  );
}

const PRESENCA_ROTULO = { presente: 'Compareceu', ausente: 'Não compareceu', nenhuma: 'Sem registro' } as const;

function CorrigirPresenca({ reserva, fechar, feito }: { reserva: ReservaTela } & Acoes) {
  const atual = reserva.presenca ?? 'nenhuma';
  const opcoes = (['presente', 'ausente', 'nenhuma'] as const).filter((o) => o !== atual);
  const [nova, setNova] = React.useState<(typeof opcoes)[number] | ''>('');
  const [motivo, setMotivo] = React.useState('');
  const [salvando, setSalvando] = React.useState(false);
  const salvar = async () => {
    setSalvando(true);
    const ok = await enviar(`/api/agenda/kickoffs/reservas/${reserva.id}`, 'POST', { acao: 'corrigirPresenca', presenca: nova, motivo });
    setSalvando(false);
    if (ok) {
      toast.success(`${reserva.empresa.nome}: presença corrigida`);
      fechar();
      feito();
    }
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>Corrigir presença</DialogTitle>
        <DialogDescription>
          {reserva.empresa.nome}: hoje está como &quot;{PRESENCA_ROTULO[atual]}&quot;. A correção vale na mesma reserva (nenhuma reserva nova) e fica
          no histórico com o valor anterior, o novo, o motivo e quem corrigiu.
        </DialogDescription>
      </DialogHeader>
      <fieldset className="grid gap-1.5">
        <legend className="mb-1 text-sm font-medium">Corrigir para</legend>
        {opcoes.map((o) => (
          <label key={o} className="flex items-center gap-2 text-sm">
            <input type="radio" name="kp-correcao" value={o} checked={nova === o} onChange={() => setNova(o)} />
            {PRESENCA_ROTULO[o]}
          </label>
        ))}
      </fieldset>
      <div className="grid gap-1.5">
        <Label htmlFor="kp-motivo-cor">Motivo (obrigatório)</Label>
        <Textarea id="kp-motivo-cor" maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={fechar}>
          Voltar
        </Button>
        <Button onClick={() => void salvar()} disabled={salvando || !nova || !motivo.trim()}>
          {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Corrigir
        </Button>
      </DialogFooter>
    </>
  );
}

function Concluir({ reserva, fechar, feito }: { reserva: ReservaTela } & Acoes) {
  const [observacao, setObservacao] = React.useState('');
  const [confirmo, setConfirmo] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);
  const salvar = async () => {
    setSalvando(true);
    const ok = await enviar(`/api/agenda/kickoffs/reservas/${reserva.id}`, 'POST', { acao: 'concluir', observacao });
    setSalvando(false);
    if (ok) {
      toast.success(`${reserva.empresa.nome}: kickoff concluído`);
      fechar();
      feito();
    }
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>Concluir o kickoff da empresa</DialogTitle>
        <DialogDescription>
          {reserva.empresa.nome} compareceu. Concluir é definitivo: a empresa não poderá reservar outro kickoff, e a reserva não poderá ser
          cancelada nem remanejada. Uma exceção só pode ser tratada pelo suporte.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="kp-obs">Observação (opcional)</Label>
        <Textarea id="kp-obs" maxLength={500} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={confirmo} onChange={(e) => setConfirmo(e.target.checked)} />
        Confirmo que {reserva.empresa.nome} concluiu o kickoff.
      </label>
      <DialogFooter>
        <Button variant="outline" onClick={fechar}>
          Voltar
        </Button>
        <Button onClick={() => void salvar()} disabled={salvando || !confirmo}>
          {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Concluir kickoff
        </Button>
      </DialogFooter>
    </>
  );
}

function CancelarSessao({ sessao, fechar, feito }: { sessao: SessaoTela } & Acoes) {
  const [motivo, setMotivo] = React.useState('');
  const [confirmo, setConfirmo] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);
  const salvar = async () => {
    setSalvando(true);
    const ok = await enviar(`/api/agenda/kickoffs/sessoes/${sessao.id}`, 'POST', { acao: 'cancelar', comReservas: true, motivo });
    setSalvando(false);
    if (ok) {
      toast.success('Sessão e reservas canceladas');
      fechar();
      feito();
    }
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>Cancelar sessão com as reservas</DialogTitle>
        <DialogDescription className="first-letter:uppercase">
          {quando(sessao.inicio)}: {sessao.ocupadas} empresa(s) inscrita(s). As reservas são canceladas junto e ficam no histórico; nenhuma é
          remanejada sozinha e ninguém é avisado automaticamente. Para manter alguma empresa, remaneje antes.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="kp-motivo-ses">Motivo (opcional)</Label>
        <Textarea id="kp-motivo-ses" maxLength={400} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={confirmo} onChange={(e) => setConfirmo(e.target.checked)} />
        Entendo que as {sessao.ocupadas} reserva(s) desta sessão serão canceladas.
      </label>
      <DialogFooter>
        <Button variant="outline" onClick={fechar}>
          Voltar
        </Button>
        <Button variant="destructive" onClick={() => void salvar()} disabled={salvando || !confirmo}>
          {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Cancelar sessão e reservas
        </Button>
      </DialogFooter>
    </>
  );
}

interface EventoHistorico {
  acao:
    | 'criada'
    | 'reagendada'
    | 'remanejada'
    | 'cancelada'
    | 'participante_alterado'
    | 'presenca_registrada'
    | 'ausente'
    | 'concluida'
    | 'interrompida'
    | 'presenca_corrigida';
  em: string;
  usuario: string | null;
  motivo: string | null;
  sessaoDe: { id: string; inicio: string | null } | null;
  sessaoPara: { id: string; inicio: string | null } | null;
  dados: { antes?: Record<string, string | null>; depois?: Record<string, string | null> } | null;
}

const ACAO: Record<EventoHistorico['acao'], string> = {
  criada: 'Inscrita',
  reagendada: 'Reagendada',
  interrompida: 'Participou, não concluiu',
  presenca_corrigida: 'Presença corrigida',
  presenca_registrada: 'Compareceu',
  ausente: 'Não compareceu',
  concluida: 'Kickoff concluído',
  remanejada: 'Remanejada',
  cancelada: 'Cancelada',
  participante_alterado: 'Participante alterado',
};

function Historico({ reserva }: { reserva: ReservaTela }) {
  const [itens, setItens] = React.useState<EventoHistorico[] | null>(null);
  const [erro, setErro] = React.useState('');
  React.useEffect(() => {
    fetch(`/api/agenda/kickoffs/reservas/${reserva.id}`)
      .then(async (r) => (r.ok ? ((await r.json()) as { historico: EventoHistorico[] }).historico : Promise.reject(new Error(await textoErro(r)))))
      .then(setItens)
      .catch((e) => setErro((e as Error).message));
  }, [reserva.id]);
  const sessao = (s: EventoHistorico['sessaoDe']) => (s?.inicio ? quando(s.inicio) : 'sessão');
  return (
    <>
      <DialogHeader>
        <DialogTitle>Histórico da reserva</DialogTitle>
        <DialogDescription>{reserva.empresa.nome}</DialogDescription>
      </DialogHeader>
      {erro && <p className="text-sm text-destructive">{erro}</p>}
      {!itens && !erro && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Carregando" />}
      {itens && (
        <ol className="max-h-80 space-y-3 overflow-y-auto text-sm">
          {itens.map((h, i) => (
            <li key={i} className="border-l-2 pl-3">
              <div className="font-medium">{ACAO[h.acao]}</div>
              <div className="text-xs text-muted-foreground">
                {new Date(h.em).toLocaleString('pt-BR')} {h.usuario ? `· ${h.usuario}` : ''}
              </div>
              {(h.acao === 'criada' || h.acao === 'reagendada') && h.sessaoPara && <div className="first-letter:uppercase">{sessao(h.sessaoPara)}</div>}
              {h.acao === 'remanejada' && (
                <div>
                  De {sessao(h.sessaoDe)} para {sessao(h.sessaoPara)}
                </div>
              )}
              {h.acao === 'participante_alterado' && h.dados?.antes && (
                <div className="text-xs">
                  Antes: {h.dados.antes.nome} · {h.dados.antes.email}
                  {h.dados.antes.telefone ? ` · ${h.dados.antes.telefone}` : ''}
                </div>
              )}
              {h.acao === 'presenca_corrigida' && h.dados?.antes && h.dados.depois && (
                <div className="text-xs">
                  De &quot;{PRESENCA_ROTULO[(h.dados.antes.presenca ?? 'nenhuma') as keyof typeof PRESENCA_ROTULO]}&quot; para &quot;
                  {PRESENCA_ROTULO[(h.dados.depois.presenca ?? 'nenhuma') as keyof typeof PRESENCA_ROTULO]}&quot;
                </div>
              )}
              {h.motivo && <div className="text-xs">Motivo: {h.motivo}</div>}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
