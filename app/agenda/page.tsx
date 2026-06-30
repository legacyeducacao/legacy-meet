'use client';

import { useRouter } from 'next/navigation';
import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { CalendarPlus, ChevronLeft, ChevronRight, Clock, Copy, Pencil, Play, X } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const PAGE_SIZE = 6;

type Client = { id: string; name: string };
type Scheduled = {
  id: string;
  title: string;
  roomName: string;
  startAt: string;
  record: boolean;
  transcribe: boolean;
  hostName: string | null;
  clientName: string | null;
  sector: string | null;
};

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function AgendaPage() {
  const router = useRouter();

  // form
  const [sector, setSector] = useState<'comercial' | 'executoria'>('executoria');
  const [clients, setClients] = useState<Client[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [title, setTitle] = useState('');
  const [startAt, setStartAt] = useState('');
  const [record, setRecord] = useState(true);
  const [transcribe, setTranscribe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Setor e permissões do usuário logado
  const [meIsAdmin, setMeIsAdmin] = useState(false);
  const [meSector, setMeSector] = useState<string | null>(null);

  // lista
  const [meetings, setMeetings] = useState<Scheduled[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  // confirmação de cancelamento
  const [pendingCancel, setPendingCancel] = useState<Scheduled | null>(null);

  // edição de reunião
  const [editMeeting, setEditMeeting] = useState<Scheduled | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editStartAt, setEditStartAt] = useState('');
  const [editRecord, setEditRecord] = useState(true);
  const [editTranscribe, setEditTranscribe] = useState(true);
  const [editBusy, setEditBusy] = useState(false);

  const totalPages = Math.max(1, Math.ceil(meetings.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = meetings.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const onRecordChange = (checked: boolean) => {
    setRecord(checked);
    if (!checked) setTranscribe(false);
  };
  const onTranscribeChange = (checked: boolean) => {
    setTranscribe(checked);
    if (checked) setRecord(true);
  };

  const toLocalInput = (iso: string) => {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  const openEdit = (m: Scheduled) => {
    setEditMeeting(m);
    setEditTitle(m.title);
    setEditStartAt(toLocalInput(m.startAt));
    setEditRecord(m.record);
    setEditTranscribe(m.transcribe);
  };

  const closeEdit = () => {
    setEditMeeting(null);
  };

  const onEditRecordChange = (checked: boolean) => {
    setEditRecord(checked);
    if (!checked) setEditTranscribe(false);
  };
  const onEditTranscribeChange = (checked: boolean) => {
    setEditTranscribe(checked);
    if (checked) setEditRecord(true);
  };

  const saveEdit = async () => {
    if (!editMeeting) return;
    if (!editTitle.trim()) {
      toast.error('O título não pode estar vazio.');
      return;
    }
    setEditBusy(true);
    try {
      const res = await fetch(`/api/meetings/${editMeeting.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle.trim(),
          startAt: new Date(editStartAt).toISOString(),
          record: editRecord,
          transcribe: editTranscribe,
        }),
      });
      if (!res.ok) {
        toast.error(await res.text());
        return;
      }
      toast.success('Reunião atualizada!');
      closeEdit();
      await loadList();
    } catch {
      toast.error('Erro de rede ao atualizar.');
    } finally {
      setEditBusy(false);
    }
  };

  useEffect(() => {
    fetch('/api/me')
      .then((r) => r.json())
      .then((json) => {
        const u = json?.user;
        if (u) {
          setMeIsAdmin(!!u.isAdmin);
          setMeSector(u.sector ?? null);
        }
      })
      .catch(() => {});
  }, []);

  // Derivar abas permitidas
  const canCom = meIsAdmin || meSector === 'comercial' || meSector === 'ambos';
  const canExe = meIsAdmin || meSector === 'executoria' || meSector === 'ambos';

  // Se só uma aba é permitida, fixar o sector nela
  useEffect(() => {
    if (canCom && !canExe) setSector('comercial');
    else if (canExe && !canCom) setSector('executoria');
  }, [canCom, canExe]);

  useEffect(() => {
    if (sector !== 'executoria') return;
    if (!canExe) return;
    fetch('/api/clients')
      .then((r) => r.json())
      .then((json) => {
        const list: Client[] = json.clients ?? [];
        setClients(list);
        setTenantId((prev) => prev || list[0]?.id || '');
      })
      .catch(() => setClients([]));
  }, [sector, canExe]);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await fetch('/api/meetings/scheduled');
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setMeetings(json.meetings ?? []);
      setPage(1);
    } catch {
      setMeetings([]);
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const schedule = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    if (!startAt) {
      setError('Escolha a data e a hora da reunião.');
      return;
    }
    if (!title.trim()) {
      setError('Informe o título da reunião.');
      return;
    }
    const iso = new Date(startAt).toISOString();

    const body: Record<string, unknown> = {
      sector,
      record,
      transcribe,
      startAt: iso,
      title: title.trim(),
    };
    if (sector === 'executoria') {
      if (!tenantId) {
        setError('Selecione um cliente para a reunião de Executoria.');
        return;
      }
      body.tenantId = tenantId;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/meetings/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError((await res.text()) || 'Erro ao agendar.');
        return;
      }
      toast.success('Reunião agendada!');
      setTitle('');
      setStartAt('');
      await loadList();
    } catch {
      setError('Erro de rede ao agendar.');
    } finally {
      setBusy(false);
    }
  };

  const startMeeting = async (m: Scheduled) => {
    setActingId(m.id);
    try {
      const res = await fetch('/api/meetings/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: m.id }),
      });
      if (!res.ok) {
        toast.error((await res.text()) || 'Falha ao iniciar.');
        setActingId(null);
        return;
      }
      const params = new URLSearchParams();
      params.set('rec', m.record ? '1' : '0');
      params.set('tx', m.transcribe ? '1' : '0');
      router.push(`/rooms/${m.roomName}?${params.toString()}`);
    } catch {
      toast.error('Erro de rede ao iniciar.');
      setActingId(null);
    }
  };

  const copyGuestLink = async (m: Scheduled) => {
    const link = `${window.location.origin}/rooms/${m.roomName}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link do convidado copiado!');
    } catch {
      toast.error('Não foi possível copiar. Link: ' + link);
    }
  };

  const confirmCancel = async () => {
    if (!pendingCancel) return;
    const m = pendingCancel;
    setPendingCancel(null);
    setActingId(m.id);
    try {
      const res = await fetch('/api/meetings/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: m.id }),
      });
      if (!res.ok) {
        toast.error((await res.text()) || 'Falha ao cancelar.');
        return;
      }
      setMeetings((prev) => prev.filter((x) => x.id !== m.id));
      toast.success('Reunião cancelada.');
    } catch {
      toast.error('Erro de rede ao cancelar.');
    } finally {
      setActingId(null);
    }
  };

  return (
    <AppShell>
      {/* AlertDialog de confirmação de cancelamento */}
      <AlertDialog open={!!pendingCancel} onOpenChange={(open) => { if (!open) setPendingCancel(null); }}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar reunião?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja cancelar{' '}
              <strong>&quot;{pendingCancel?.title}&quot;</strong>?
              Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmCancel}>Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog de edição de reunião */}
      <Dialog open={!!editMeeting} onOpenChange={(open) => { if (!open) closeEdit(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar reunião</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-title">Título</Label>
              <Input
                id="edit-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Título da reunião"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-startAt">Data e hora</Label>
              <Input
                id="edit-startAt"
                type="datetime-local"
                value={editStartAt}
                onChange={(e) => setEditStartAt(e.target.value)}
              />
            </div>
            <div className="space-y-4 rounded-lg border border-border/60 bg-muted/30 p-4">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="edit-record" className="cursor-pointer font-normal">
                  Gravar reunião
                </Label>
                <Switch id="edit-record" checked={editRecord} onCheckedChange={onEditRecordChange} />
              </div>
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="edit-transcribe" className="cursor-pointer font-normal">
                  Transcrever reunião
                </Label>
                <Switch id="edit-transcribe" checked={editTranscribe} onCheckedChange={onEditTranscribeChange} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeEdit} disabled={editBusy}>
              Cancelar
            </Button>
            <Button onClick={saveEdit} disabled={editBusy}>
              {editBusy ? 'Salvando…' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Agenda</h1>
        <p className="text-muted-foreground">Marque reuniões futuras e inicie quando chegar a hora.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Formulário de agendamento */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Agendar reunião</CardTitle>
            <CardDescription>Escolha o setor, a data e os detalhes.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={schedule} className="space-y-5">
              {canCom && canExe && (
                <div className="space-y-2">
                  <Label>Setor</Label>
                  <Tabs value={sector} onValueChange={(v) => setSector(v as 'comercial' | 'executoria')}>
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="executoria">Executoria</TabsTrigger>
                      <TabsTrigger value="comercial">Comercial</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
              )}

              {sector === 'executoria' && (
                <div className="space-y-2">
                  <Label>Cliente</Label>
                  <SearchableSelect
                    value={tenantId}
                    onValueChange={setTenantId}
                    options={clients.map((c) => ({ value: c.id, label: c.name }))}
                    placeholder={clients.length ? 'Selecione um cliente' : 'Carregando clientes…'}
                    searchPlaceholder="Buscar cliente…"
                    emptyText="Nenhum cliente encontrado."
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="title">Título da reunião</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={
                    sector === 'comercial' ? 'Ex: Reunião com João Silva' : 'Ex: Alinhamento mensal'
                  }
                  required
                />
                <p className="text-xs text-muted-foreground">Define o nome da pasta no Drive.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="startAt">Data e hora</Label>
                <Input
                  id="startAt"
                  type="datetime-local"
                  value={startAt}
                  onChange={(e) => setStartAt(e.target.value)}
                />
              </div>

              <div className="space-y-4 rounded-lg border border-border/60 bg-muted/30 p-4">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="record" className="cursor-pointer font-normal">
                    Gravar reunião
                  </Label>
                  <Switch id="record" checked={record} onCheckedChange={onRecordChange} />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="transcribe" className="cursor-pointer font-normal">
                    Transcrever reunião
                  </Label>
                  <Switch id="transcribe" checked={transcribe} onCheckedChange={onTranscribeChange} />
                </div>
              </div>

              {error && <p className="text-sm font-medium text-destructive">{error}</p>}

              <Button type="submit" disabled={busy} className="w-full gap-2">
                <CalendarPlus className="h-4 w-4" />
                {busy ? 'Agendando…' : 'Agendar'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Lista de agendadas */}
        <div className="space-y-4 lg:col-span-2">
          {loadingList ? (
            <>
              <Skeleton className="h-28 w-full rounded-xl" />
              <Skeleton className="h-28 w-full rounded-xl" />
            </>
          ) : meetings.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
                <Clock className="h-8 w-8 opacity-60" />
                <p>Nenhuma reunião agendada.</p>
              </CardContent>
            </Card>
          ) : (
            pageItems.map((m) => {
              const overdue = new Date(m.startAt).getTime() < Date.now();
              return (
                <Card key={m.id}>
                  <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-semibold">{m.title}</span>
                        {m.sector && (
                          <Badge variant="secondary">
                            {m.sector === 'comercial' ? 'Comercial' : 'Executoria'}
                          </Badge>
                        )}
                        {overdue && <Badge variant="destructive">Atrasada</Badge>}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          {formatDateTime(m.startAt)}
                        </span>
                        {m.clientName && <span>· {m.clientName}</span>}
                        {m.hostName && <span>· {m.hostName}</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        className="gap-1.5"
                        disabled={actingId === m.id}
                        onClick={() => startMeeting(m)}
                      >
                        <Play className="h-3.5 w-3.5" />
                        Iniciar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={() => copyGuestLink(m)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Link
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label="Editar reunião"
                        className="gap-1.5"
                        onClick={() => openEdit(m)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Editar
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Cancelar reunião"
                        className="text-muted-foreground hover:text-destructive"
                        disabled={actingId === m.id}
                        onClick={() => setPendingCancel(m)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}

          {!loadingList && totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 pt-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
                Anterior
              </Button>
              <span className="text-sm text-muted-foreground">
                {safePage} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Próxima
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
