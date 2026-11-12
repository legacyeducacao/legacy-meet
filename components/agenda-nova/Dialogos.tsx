'use client';

import * as React from 'react';
import { AlertTriangle, Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { NOME_CONFLITO, type ConflitoDTO, type Escopo, type Origem } from '@/lib/agenda/tipos';

function Opcoes<T extends string>({
  nome,
  valor,
  onChange,
  opcoes,
}: {
  nome: string;
  valor: T;
  onChange: (v: T) => void;
  opcoes: Array<{ v: T; rotulo: string }>;
}) {
  return (
    <div role="radiogroup" aria-label={nome} className="space-y-1">
      {opcoes.map((o) => (
        <label
          key={o.v}
          className={cn(
            'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm',
            valor === o.v ? 'border-primary bg-primary/5' : 'hover:bg-muted',
          )}
        >
          <input type="radio" name={nome} className="accent-[hsl(var(--primary))]" checked={valor === o.v} onChange={() => onChange(o.v)} />
          {o.rotulo}
        </label>
      ))}
    </div>
  );
}

const ESCOPOS: Array<{ v: Escopo; rotulo: string }> = [
  { v: 'esta', rotulo: 'Somente este evento' },
  { v: 'seguintes', rotulo: 'Este e os seguintes' },
  { v: 'todas', rotulo: 'Todos os eventos' },
];

/** "Editar evento recorrente": qual parte da série muda. */
export function DialogoEscopo({
  titulo,
  onConfirmar,
  onCancelar,
}: {
  titulo: string;
  onConfirmar: (e: Escopo) => void;
  onCancelar: () => void;
}) {
  const [escopo, setEscopo] = React.useState<Escopo>('esta');
  return (
    <Dialog open onOpenChange={(o) => !o && onCancelar()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
        </DialogHeader>
        <Opcoes nome="escopo" valor={escopo} onChange={setEscopo} opcoes={ESCOPOS} />
        <DialogFooter>
          <Button variant="outline" onClick={onCancelar}>
            Cancelar
          </Button>
          <Button onClick={() => onConfirmar(escopo)}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Excluir (cancelar) reunião: escopo da série e quem originou. */
export function DialogoCancelar({
  titulo,
  recorrente,
  onConfirmar,
  onCancelar,
}: {
  titulo: string;
  recorrente: boolean;
  onConfirmar: (escopo: Escopo, origem: Origem) => void;
  onCancelar: () => void;
}) {
  const [escopo, setEscopo] = React.useState<Escopo>('esta');
  const [origem, setOrigem] = React.useState<Origem>('cliente');
  return (
    <Dialog open onOpenChange={(o) => !o && onCancelar()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Cancelar reunião</DialogTitle>
          <DialogDescription className="truncate">{titulo}</DialogDescription>
        </DialogHeader>
        {recorrente && <Opcoes nome="escopo" valor={escopo} onChange={setEscopo} opcoes={ESCOPOS} />}
        <div className="space-y-2">
          <Label>Quem pediu o cancelamento?</Label>
          <Opcoes
            nome="origem"
            valor={origem}
            onChange={setOrigem}
            opcoes={[
              { v: 'cliente', rotulo: 'O cliente' },
              { v: 'executor', rotulo: 'O executor' },
              { v: 'legacy', rotulo: 'A Legacy' },
            ]}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancelar}>
            Voltar
          </Button>
          <Button variant="destructive" onClick={() => onConfirmar(escopo, origem)}>
            Cancelar reunião
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const fmtData = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Lista de conflitos (prévia no formulário e resposta 409 ao salvar). */
export function ListaConflitos({ conflitos }: { conflitos: ConflitoDTO[] }) {
  const ordenados = [...conflitos].sort((a, b) => (a.nivel === b.nivel ? a.inicio.localeCompare(b.inicio) : a.nivel === 'bloqueante' ? -1 : 1));
  return (
    <ul className="max-h-60 space-y-1 overflow-y-auto text-sm">
      {ordenados.map((c, i) => (
        <li key={`${c.ref}-${c.tipo}-${i}`} className="flex items-start gap-2 rounded-md border px-2 py-1.5">
          {c.nivel === 'bloqueante' ? (
            <Ban className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-label="Impede salvar" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-label="Aviso" />
          )}
          <span className="min-w-0">
            <span className="font-medium">{NOME_CONFLITO[c.tipo] ?? c.tipo}</span>
            <span className="text-muted-foreground"> · {fmtData(c.inicio)}</span>
            <span className="block text-xs text-muted-foreground">
              {c.detalhe}
              {c.sugestao ? ` · próximo horário livre: ${fmtData(c.sugestao)}` : ''}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Conflitos ao salvar: justificar (fica registrado) ou desistir. */
export function DialogoConflitos({
  conflitos,
  podeSobreporBloqueante,
  onSalvar,
  onDesistir,
}: {
  conflitos: ConflitoDTO[];
  podeSobreporBloqueante: boolean;
  onSalvar: (justificativa: string) => void;
  onDesistir: () => void;
}) {
  const [just, setJust] = React.useState('');
  const temBloqueante = conflitos.some((c) => c.nivel === 'bloqueante');
  const travado = temBloqueante && !podeSobreporBloqueante;
  return (
    <Dialog open onOpenChange={(o) => !o && onDesistir()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{travado ? 'Não dá para salvar neste horário' : 'Este horário tem conflitos'}</DialogTitle>
          <DialogDescription>
            {travado
              ? 'Há regras que impedem salvar. Escolha outro horário ou peça a um admin.'
              : 'Para salvar mesmo assim, escreva o motivo. Ele fica registrado.'}
          </DialogDescription>
        </DialogHeader>
        <ListaConflitos conflitos={conflitos} />
        {!travado && (
          <div className="space-y-1.5">
            <Label htmlFor="justificativa">Motivo</Label>
            <Textarea id="justificativa" value={just} onChange={(e) => setJust(e.target.value)} rows={2} placeholder="Ex.: cliente só pode nesse horário" />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onDesistir}>
            {travado ? 'Entendi' : 'Escolher outro horário'}
          </Button>
          {!travado && (
            <Button disabled={!just.trim()} onClick={() => onSalvar(just.trim())}>
              Salvar mesmo assim
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const ATALHOS: Array<[string, string]> = [
  ['C', 'Criar reunião'],
  ['T', 'Ir para hoje'],
  ['D', 'Visão de dia'],
  ['X', 'Visão de 4 dias'],
  ['W', 'Visão de semana'],
  ['M', 'Visão de mês'],
  ['A', 'Lista (agenda corrida)'],
  ['J ou →', 'Próximo período'],
  ['K ou ←', 'Período anterior'],
  ['/', 'Buscar'],
  ['Esc', 'Fechar'],
  ['Delete', 'Cancelar a reunião selecionada'],
  ['?', 'Mostrar esta lista'],
];

export function DialogoAtalhos({ onFechar }: { onFechar: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Atalhos de teclado</DialogTitle>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {ATALHOS.map(([k, d]) => (
            <React.Fragment key={k}>
              <dt>
                <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{k}</kbd>
              </dt>
              <dd className="text-muted-foreground">{d}</dd>
            </React.Fragment>
          ))}
        </dl>
        <div className="space-y-1.5 border-t pt-3 text-sm">
          <p className="font-medium">Com o mouse</p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>Arraste uma reunião para outro horário ou outro dia.</li>
            <li>Solte uma reunião em cima de outra para trocar os horários das duas.</li>
            <li>Puxe a borda de baixo da reunião para mudar a duração.</li>
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
