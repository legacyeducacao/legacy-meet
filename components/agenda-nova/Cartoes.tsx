'use client';

import * as React from 'react';
import { Clock, Copy, ExternalLink, GraduationCap, History, Link2, MapPin, Monitor, Pencil, Repeat, Trash2, User, UserX, Users, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { localYmd } from '@/lib/agenda-engine';
import { faixaHorario, rotuloDia } from '@/lib/agenda/visao';
import type { EventoDTO } from '@/lib/agenda/tipos';
import { rotuloModalidade } from '@/lib/agenda/turmas';
import { Flutuante, type Ancora } from './Flutuante';

export interface Cliente {
  id: string;
  name: string;
}

const STATUS: Record<string, string> = {
  live: 'Em andamento',
  ended: 'Encerrada',
  no_show: 'No-show',
};

/** Detalhes do evento com ações rápidas. */
export function DetalhesEvento({
  evento,
  ancora,
  tz,
  cor,
  meId,
  onFechar,
  onEntrar,
  onCopiarLink,
  onEditar,
  onDuplicar,
  onExcluir,
  onRemoverBloqueio,
  onUltimaReuniao,
  onNoShow,
}: {
  onRemoverBloqueio: () => void;
  /** Abre o resumo da última reunião com o mesmo cliente. */
  onUltimaReuniao: () => void;
  /** Marca (ou desfaz) o no-show. */
  onNoShow: (desfazer: boolean) => void;
  evento: EventoDTO;
  ancora: Ancora;
  tz: string;
  cor: string;
  meId: string;
  onFechar: () => void;
  onEntrar: () => void;
  onCopiarLink: () => void;
  onEditar: () => void;
  onDuplicar: () => void;
  onExcluir: () => void;
}) {
  const ini = new Date(evento.inicio);
  const fim = new Date(evento.fim);
  const reuniao = evento.tipo === 'reuniao';
  const turma = evento.tipo === 'turma';
  const modalidade = turma ? rotuloModalidade(evento.modalidade) : null;
  const podeEntrar = reuniao && !!evento.roomName && (evento.status === 'scheduled' || evento.status === 'live');
  // No-show: depois do horário de início (cliente não veio); desfazer quando já marcado.
  const jaComecou = ini.getTime() <= Date.now();
  const podeNoShow = reuniao && evento.podeEditar && jaComecou && ['scheduled', 'live', 'ended'].includes(evento.status ?? '');
  const podeDesfazerNoShow = reuniao && evento.podeEditar && evento.status === 'no_show';
  const temUltima = reuniao && evento.setor === 'executoria' && !!evento.tenantId;
  return (
    <Flutuante ancora={ancora} onClose={onFechar} titulo={evento.titulo} largura={380}>
      <div className="space-y-3 p-4 pr-10">
        <div className="flex items-start gap-3">
          <span className="mt-1.5 h-3.5 w-3.5 shrink-0 rounded" style={{ backgroundColor: cor }} />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-snug">
              {evento.rotulo && <Badge variant="secondary" className="mr-1.5 align-middle">{evento.rotulo}</Badge>}
              {evento.titulo}
            </h2>
            <p className="text-sm text-muted-foreground first-letter:uppercase">
              {rotuloDia(localYmd(ini, tz))}
              {evento.diaInteiro ? ' · dia todo' : ` · ${faixaHorario(ini, fim, tz)}`}
            </p>
          </div>
        </div>
        <ul className="space-y-1.5 pl-[26px] text-sm">
          {evento.serieId && (
            <li className="flex items-center gap-2 text-muted-foreground">
              <Repeat className="h-4 w-4" /> Faz parte de uma série
            </li>
          )}
          {evento.cliente && (
            <li className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" /> {evento.cliente}
            </li>
          )}
          {evento.executorNome && evento.executorId !== meId && (
            <li className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" /> {evento.executorNome}
            </li>
          )}
          {reuniao && (
            <li className="flex flex-wrap items-center gap-1.5">
              <Clock className="h-4 w-4 text-muted-foreground" />
              {evento.status && STATUS[evento.status] && <Badge variant="outline">{STATUS[evento.status]}</Badge>}
              {evento.onboarding && <Badge variant="outline">Onboarding</Badge>}
              <span className="text-xs text-muted-foreground">
                {evento.gravar ? (evento.transcrever ? 'Grava e transcreve' : 'Grava') : 'Sem gravação'}
              </span>
            </li>
          )}
          {turma && evento.turma && (
            <li className="flex items-center gap-2">
              <GraduationCap className="h-4 w-4 text-muted-foreground" /> {evento.turma}
            </li>
          )}
          {turma && modalidade && (
            <li className="flex items-center gap-2">
              {evento.modalidade === 'online' ? <Monitor className="h-4 w-4 text-muted-foreground" /> : <Users className="h-4 w-4 text-muted-foreground" />}
              {modalidade}
            </li>
          )}
          {turma && evento.local && (
            <li className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" /> {evento.local}
            </li>
          )}
        </ul>
        {turma && (
          <div className="space-y-2 pt-1">
            {evento.link && (
              <Button size="sm" asChild>
                <a href={evento.link} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" /> Abrir link da aula
                </a>
              </Button>
            )}
            <p className="text-xs text-muted-foreground">Gerenciada no Legacy Plan</p>
          </div>
        )}
        {evento.tipo === 'bloqueio' && evento.podeEditar && (
          <Button size="sm" variant="outline" className="text-destructive" onClick={onRemoverBloqueio}>
            <Trash2 className="h-4 w-4" /> Remover bloqueio
          </Button>
        )}
        {reuniao && (
          <div className="flex flex-wrap gap-2 pt-1">
            {podeEntrar && (
              <Button size="sm" onClick={onEntrar}>
                <Video className="h-4 w-4" /> Entrar na sala
              </Button>
            )}
            {evento.roomName && (
              <Button size="sm" variant="outline" onClick={onCopiarLink} aria-label="Copiar link do convidado">
                <Link2 className="h-4 w-4" /> Link
              </Button>
            )}
            {evento.podeEditar && (
              <Button size="sm" variant="outline" onClick={onEditar} aria-label="Editar">
                <Pencil className="h-4 w-4" /> Editar
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={onDuplicar} aria-label="Duplicar">
              <Copy className="h-4 w-4" /> Duplicar
            </Button>
            {temUltima && (
              <Button size="sm" variant="outline" onClick={onUltimaReuniao}>
                <History className="h-4 w-4" /> Última reunião
              </Button>
            )}
            {podeNoShow && (
              <Button size="sm" variant="outline" className="text-muted-foreground hover:text-destructive" onClick={() => onNoShow(false)}>
                <UserX className="h-4 w-4" /> No-show
              </Button>
            )}
            {podeDesfazerNoShow && (
              <Button size="sm" variant="outline" onClick={() => onNoShow(true)}>
                <UserX className="h-4 w-4" /> Desfazer no-show
              </Button>
            )}
            {evento.podeEditar && (
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={onExcluir} aria-label="Cancelar reunião">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}
      </div>
    </Flutuante>
  );
}

/** Criação rápida: título, cliente e horário; "Mais opções" abre o formulário completo. */
export function CriacaoRapida({
  ancora,
  inicio,
  fim,
  tz,
  setor,
  podeEscolherSetor,
  clientes,
  onFechar,
  onSalvar,
  onMaisOpcoes,
  onBloquear,
}: {
  onBloquear: (motivo: string) => Promise<boolean>;
  ancora: Ancora;
  inicio: Date;
  fim: Date;
  tz: string;
  setor: 'executoria' | 'comercial';
  podeEscolherSetor: boolean;
  clientes: Cliente[];
  onFechar: () => void;
  onSalvar: (v: { titulo: string; setor: 'executoria' | 'comercial'; tenantId: string }) => Promise<boolean>;
  onMaisOpcoes: (v: { titulo: string; setor: 'executoria' | 'comercial'; tenantId: string }) => void;
}) {
  const [titulo, setTitulo] = React.useState('');
  const [tipo, setTipo] = React.useState<'reuniao' | 'bloqueio'>('reuniao');
  const [s, setS] = React.useState(setor);
  const [tenantId, setTenantId] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [erro, setErro] = React.useState('');

  const salvar = async () => {
    if (tipo === 'bloqueio') {
      setBusy(true);
      const ok = await onBloquear(titulo.trim());
      setBusy(false);
      if (ok) onFechar();
      return;
    }
    if (!titulo.trim()) return setErro('Informe o título.');
    if (s === 'executoria' && !tenantId) return setErro('Selecione o cliente.');
    setErro('');
    setBusy(true);
    const ok = await onSalvar({ titulo: titulo.trim(), setor: s, tenantId });
    setBusy(false);
    if (ok) onFechar();
  };

  return (
    <Flutuante ancora={ancora} onClose={onFechar} titulo="Nova reunião" largura={380}>
      <form
        className="space-y-3 p-4 pr-10"
        onSubmit={(e) => {
          e.preventDefault();
          void salvar();
        }}
      >
        <div className="flex gap-1 text-sm" role="tablist" aria-label="Tipo">
          {(
            [
              ['reuniao', 'Reunião'],
              ['bloqueio', 'Bloquear horário'],
            ] as const
          ).map(([k, rotulo]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tipo === k}
              onClick={() => setTipo(k)}
              className={tipo === k ? 'rounded-md bg-primary/10 px-2.5 py-1 font-medium text-primary' : 'rounded-md px-2.5 py-1 text-muted-foreground hover:bg-muted'}
            >
              {rotulo}
            </button>
          ))}
        </div>
        <Input
          autoFocus
          placeholder={tipo === 'bloqueio' ? 'Motivo (só você e os admins veem)' : 'Adicionar título'}
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          className="text-base font-medium"
        />
        <p className="text-sm text-muted-foreground first-letter:uppercase">
          {rotuloDia(localYmd(inicio, tz))} · {faixaHorario(inicio, fim, tz)}
        </p>
        {tipo === 'reuniao' && podeEscolherSetor && (
          <div className="flex gap-1 rounded-lg bg-muted p-1 text-sm">
            {(['executoria', 'comercial'] as const).map((x) => (
              <button
                key={x}
                type="button"
                onClick={() => setS(x)}
                className={`flex-1 rounded-md px-2 py-1 ${s === x ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'}`}
              >
                {x === 'executoria' ? 'Executoria' : 'Comercial'}
              </button>
            ))}
          </div>
        )}
        {tipo === 'reuniao' && s === 'executoria' && (
          <SearchableSelect
            value={tenantId}
            onValueChange={setTenantId}
            options={clientes.map((c) => ({ value: c.id, label: c.name }))}
            placeholder={clientes.length ? 'Cliente' : 'Carregando clientes…'}
            searchPlaceholder="Buscar cliente…"
            emptyText="Nenhum cliente encontrado."
          />
        )}
        {erro && <p className="text-sm text-destructive">{erro}</p>}
        <div className="flex justify-end gap-2 pt-1">
          {tipo === 'reuniao' && (
            <Button type="button" variant="ghost" onClick={() => onMaisOpcoes({ titulo: titulo.trim(), setor: s, tenantId })}>
              Mais opções
            </Button>
          )}
          <Button type="submit" disabled={busy}>
            {busy ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </form>
    </Flutuante>
  );
}
