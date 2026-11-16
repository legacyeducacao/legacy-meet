'use client';

import * as React from 'react';
import { Link2, Loader2, RefreshCw, Search, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/custom-toast';
import { cn } from '@/lib/utils';
import { quando, textoErro } from './tipos';

interface Convite {
  codigo: string;
  criadoEm: string;
  expiraEm: string;
  expirado: boolean;
  empresa: { id: string; nome: string };
  reserva: { status: string; sessaoId: string; inicio: string | null } | null;
  /** Link no endereço oficial (montado no servidor); null se não configurado. */
  link: string | null;
}

type Endereco = { ok: true; base: string } | { ok: false; motivo: string };

interface Empresa {
  id: string;
  nome: string;
  reservaAtiva: { reservaId: string; sessaoId: string } | null;
  concluida: boolean;
}

const dataCurta = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

async function postar(corpo: Record<string, unknown>): Promise<boolean> {
  const res = await fetch('/api/agenda/kickoffs/convites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  if (!res.ok) {
    toast.error('Não foi possível concluir', { description: await textoErro(res) });
    return false;
  }
  return true;
}

/**
 * Convites por empresa (M3): um link individual por empresa, em vigor até
 * revogar ou expirar. O link leva a /impulsao/agendar/<código> (sem login).
 */
export function ConvitesKickoff({ habilitado }: { habilitado: boolean }) {
  const [convites, setConvites] = React.useState<Convite[] | null>(null);
  const [endereco, setEndereco] = React.useState<Endereco | null>(null);
  const [erro, setErro] = React.useState('');
  const [acao, setAcao] = React.useState<{ tipo: 'reemitir' | 'revogar'; convite: Convite } | null>(null);

  const carregar = React.useCallback(() => {
    fetch('/api/agenda/kickoffs/convites')
      .then(async (r) => (r.ok ? ((await r.json()) as { convites: Convite[]; endereco: Endereco }) : Promise.reject(new Error(await textoErro(r)))))
      .then((j) => {
        setConvites(j.convites);
        setEndereco(j.endereco);
        setErro('');
      })
      .catch((e) => setErro(e instanceof Error ? e.message : 'Não foi possível carregar os convites'));
  }, []);
  React.useEffect(() => {
    if (habilitado) carregar();
  }, [habilitado, carregar]);

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div>
        <h2 className="font-semibold">Convites das empresas</h2>
        <p className="text-sm text-muted-foreground">
          Cada empresa recebe um link individual para escolher o horário do kickoff, sem login. O link mostra só a empresa dele e serve também para a
          empresa consultar o agendamento.
        </p>
      </div>
      {!habilitado ? (
        <p className="text-sm text-muted-foreground">Os convites dependem da migration 005 (ainda não aplicada).</p>
      ) : (
        <>
          {endereco && !endereco.ok && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {endereco.motivo} Até lá, não dá para gerar nem reemitir convites.
            </p>
          )}
          {endereco?.ok && <p className="text-xs text-muted-foreground">Os links usam o endereço oficial: {endereco.base}</p>}
          <NovoConvite feito={carregar} desabilitado={!endereco?.ok} />
          {erro && <p className="text-sm text-destructive">{erro}</p>}
          {!convites && !erro && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Carregando" />}
          {convites && convites.length === 0 && <p className="text-sm text-muted-foreground">Nenhum convite em vigor.</p>}
          {convites && convites.length > 0 && (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Empresa</th>
                    <th className="px-3 py-2 font-medium">Kickoff</th>
                    <th className="px-3 py-2 font-medium">Validade</th>
                    <th className="px-3 py-2 font-medium">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {convites.map((c) => (
                    <tr key={c.codigo} className="border-t align-top">
                      <td className="px-3 py-2 font-medium">{c.empresa.nome}</td>
                      <td className="px-3 py-2">
                        {c.reserva?.status === 'concluida' ? (
                          <Badge>Concluído</Badge>
                        ) : c.reserva ? (
                          <a href={`#sessao-${c.reserva.sessaoId}`} className="text-primary underline-offset-4 hover:underline first-letter:uppercase">
                            {c.reserva.inicio ? quando(c.reserva.inicio) : 'Agendado'}
                          </a>
                        ) : (
                          <span className="text-muted-foreground">Ainda não agendou</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {c.expirado ? (
                          <Badge variant="secondary">{c.reserva ? 'Expirado (só consulta)' : 'Expirado'}</Badge>
                        ) : (
                          <span className="tabular-nums">até {dataCurta(c.expiraEm)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap justify-end gap-1">
                          {c.link && (!c.expirado || c.reserva) && (
                            <CopyButton value={c.link} label="Copiar link" size="sm" variant="ghost" aria-label={`Copiar link de ${c.empresa.nome}`} />
                          )}
                          <Button size="sm" variant="ghost" onClick={() => setAcao({ tipo: 'reemitir', convite: c })}>
                            <RefreshCw className="mr-1 h-4 w-4" /> Reemitir
                          </Button>
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setAcao({ tipo: 'revogar', convite: c })}>
                            <XCircle className="mr-1 h-4 w-4" /> Revogar
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <DialogoDoConvite acao={acao} fechar={() => setAcao(null)} feito={carregar} />
        </>
      )}
    </section>
  );
}

/** Buscar a empresa e gerar (ou reaproveitar) o convite dela. */
function NovoConvite({ feito, desabilitado }: { feito: () => void; desabilitado: boolean }) {
  const [termo, setTermo] = React.useState('');
  const [empresas, setEmpresas] = React.useState<Empresa[] | null>(null);
  const [gerando, setGerando] = React.useState('');
  const [ultimo, setUltimo] = React.useState<{ empresa: string; link: string; reutilizado: boolean } | null>(null);

  React.useEffect(() => {
    const t = termo.trim();
    if (t.length < 2) return setEmpresas(null);
    const ctl = new AbortController();
    const id = setTimeout(() => {
      fetch(`/api/agenda/kickoffs/empresas?q=${encodeURIComponent(t)}`, { signal: ctl.signal })
        .then(async (r) => (r.ok ? ((await r.json()) as { empresas: Empresa[] }).empresas : []))
        .then(setEmpresas)
        .catch(() => undefined);
    }, 250);
    return () => {
      clearTimeout(id);
      ctl.abort();
    };
  }, [termo]);

  const gerar = async (e: Empresa) => {
    setGerando(e.id);
    const res = await fetch('/api/agenda/kickoffs/convites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acao: 'gerar', tenantId: e.id }),
    });
    setGerando('');
    if (!res.ok) return toast.error('Não foi possível gerar o convite', { description: await textoErro(res) });
    const j = (await res.json()) as { convite: { link: string; reutilizado: boolean } };
    setUltimo({ empresa: e.nome, link: j.convite.link, reutilizado: j.convite.reutilizado });
    setTermo('');
    feito();
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="convite-busca">Gerar convite para uma empresa</Label>
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input id="convite-busca" className="pl-8" placeholder="Digite ao menos 2 letras do nome" value={termo} onChange={(e) => setTermo(e.target.value)} />
      </div>
      {empresas && (
        <ul className="max-h-56 max-w-md overflow-y-auto rounded-md border" aria-label="Empresas encontradas">
          {empresas.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">Nenhuma empresa encontrada.</li>}
          {empresas.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className={cn('min-w-0', e.concluida && 'text-muted-foreground')}>
                <span className="font-medium">{e.nome}</span>
                {e.concluida && <span className="block text-xs">Kickoff concluído: não precisa de convite</span>}
                {!e.concluida && e.reservaAtiva && <span className="block text-xs text-muted-foreground">Já tem kickoff marcado</span>}
              </span>
              <Button size="sm" variant="outline" disabled={desabilitado || e.concluida || gerando === e.id} onClick={() => void gerar(e)}>
                {gerando === e.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="mr-1 h-4 w-4" />} Convite
              </Button>
            </li>
          ))}
        </ul>
      )}
      {ultimo && (
        <div role="status" className="flex max-w-2xl flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
          <span className="min-w-0 flex-1">
            {ultimo.reutilizado ? 'Convite em vigor de' : 'Convite criado para'} <strong>{ultimo.empresa}</strong>:{' '}
            <span className="break-all font-mono text-xs">{ultimo.link}</span>
          </span>
          <CopyButton value={ultimo.link} label="Copiar link" size="sm" />
        </div>
      )}
    </div>
  );
}

function DialogoDoConvite({
  acao,
  fechar,
  feito,
}: {
  acao: { tipo: 'reemitir' | 'revogar'; convite: Convite } | null;
  fechar: () => void;
  feito: () => void;
}) {
  const [motivo, setMotivo] = React.useState('');
  const [salvando, setSalvando] = React.useState(false);
  React.useEffect(() => setMotivo(''), [acao]);
  if (!acao) return null;
  const reemitir = acao.tipo === 'reemitir';
  const salvar = async () => {
    setSalvando(true);
    const ok = await postar({ acao: acao.tipo, tenantId: acao.convite.empresa.id, motivo });
    setSalvando(false);
    if (ok) {
      toast.success(reemitir ? 'Convite reemitido: copie o link novo na lista' : 'Convite revogado');
      fechar();
      feito();
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{reemitir ? 'Reemitir convite' : 'Revogar convite'}</DialogTitle>
          <DialogDescription>
            {acao.convite.empresa.nome}:{' '}
            {reemitir
              ? 'o link atual para de abrir na hora e um link novo é criado. A reserva da empresa, se houver, não muda.'
              : 'o link para de abrir na hora e nenhum outro é criado. A reserva da empresa, se houver, não muda.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="convite-motivo">Motivo (opcional)</Label>
          <Textarea id="convite-motivo" maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={fechar}>
            Voltar
          </Button>
          <Button variant={reemitir ? 'default' : 'destructive'} onClick={() => void salvar()} disabled={salvando}>
            {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {reemitir ? 'Reemitir' : 'Revogar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
