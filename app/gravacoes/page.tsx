'use client';

import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';
import { toast } from '@/components/ui/custom-toast';
import { Search, ChevronLeft, ChevronRight, Trash2, Video } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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

interface Rec {
  id: string;
  title?: string;
  roomName: string;
  createdAt: string;
  durationSeconds: number;
  storage: 's3' | 'gdrive';
  transcriptionStatus: string;
  utteranceCount: number;
  hostName?: string | null;
  metaHost?: string | null;
  sector?: string | null;
  noShow?: boolean;
  canDelete?: boolean;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
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

function formatDuration(seconds: number): string {
  if (!seconds) return '—';
  return `${Math.round(seconds / 60)} min`;
}

export default function GravacoesPage() {
  const [items, setItems] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [host, setHost] = useState('');
  const [hideNoShow, setHideNoShow] = useState(false);
  const [page, setPage] = useState(1);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Rec | null>(null);
  const [pageSize, setPageSize] = useState(16);

  // Quantos cards cabem na tela (preenche a altura; o excedente pagina).
  useEffect(() => {
    const calc = () => {
      const w = window.innerWidth;
      const cols = w >= 1280 ? 4 : w >= 1024 ? 3 : w >= 640 ? 2 : 1;
      const rowH = 150; // altura aproximada do card + gap
      const avail = window.innerHeight - 260; // header + toolbar + paginação + margens
      const rows = Math.max(2, Math.floor(avail / rowH));
      setPageSize(cols * rows);
    };
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch('/api/recordings');
        if (!res.ok) throw new Error(await res.text());
        if (active) setItems(await res.json());
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'erro');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // usuários (hosts) distintos presentes nas gravações — base do filtro
  const hosts = useMemo(
    () => ([...new Set(items.map((r) => r.hostName).filter(Boolean))] as string[]).sort(),
    [items],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((r) => {
      // busca casa título, sala e o nome do host (cadastrado OU o gravado na criação)
      if (q) {
        const haystack = [r.title, r.roomName, r.hostName, r.metaHost]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (host && r.hostName !== host) return false;
      if (hideNoShow && r.noShow) return false;
      const day = (r.createdAt || '').slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      return true;
    });
  }, [items, query, from, to, host, hideNoShow]);

  useEffect(() => {
    setPage(1);
  }, [query, from, to, host, hideNoShow]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const rec = pendingDelete;
    setPendingDelete(null);
    setDeletingId(rec.id);
    try {
      const res = await fetch(`/api/recordings/${encodeURIComponent(rec.id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      setItems((prev) => prev.filter((r) => r.id !== rec.id));
    } catch (e) {
      toast.error('Falha ao excluir: ' + (e instanceof Error ? e.message : e));
    } finally {
      setDeletingId(null);
    }
  };

  const hasFilters = !!(query || from || to || host || hideNoShow);

  return (
    <AppShell>
      {/* AlertDialog de confirmação de exclusão */}
      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir gravação?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso remove permanentemente o vídeo e a transcrição de{' '}
              <strong>&quot;{pendingDelete?.title?.trim() || pendingDelete?.roomName}&quot;</strong>.
              Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex min-h-[calc(100vh-4rem)] flex-col gap-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Gravações</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Acesse e gerencie todas as reuniões gravadas.
          </p>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-10 pl-9"
              placeholder="Buscar por título ou usuário…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {hosts.length > 1 && (
            <div className="w-52">
              <SearchableSelect
                value={host}
                onValueChange={setHost}
                options={hosts.map((h) => ({ value: h, label: h }))}
                placeholder="Todos os usuários"
                searchPlaceholder="Buscar usuário…"
                emptyText="Nenhum usuário."
                clearable
                className="h-10"
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 whitespace-nowrap text-sm text-muted-foreground">
              De
              <Input
                type="date"
                className="h-10 w-36"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 whitespace-nowrap text-sm text-muted-foreground">
              Até
              <Input
                type="date"
                className="h-10 w-36"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </div>

          <label className="flex h-10 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md border border-input px-3 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={hideNoShow}
              onChange={(e) => setHideNoShow(e.target.checked)}
            />
            Ocultar no-show
          </label>

          {hasFilters && (
            <Button
              type="button"
              variant="outline"
              className="h-10"
              onClick={() => {
                setQuery('');
                setFrom('');
                setTo('');
                setHost('');
                setHideNoShow(false);
              }}
            >
              Limpar
            </Button>
          )}
        </div>

        {/* Área de conteúdo (cresce para preencher a altura) */}
        <div className="flex-1">
          {loading && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: pageSize }).map((_, i) => (
                <Card key={i} className="rounded-xl">
                  <CardHeader>
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="mt-1 h-3 w-1/2" />
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      <Skeleton className="h-5 w-16 rounded-full" />
                      <Skeleton className="h-5 w-20 rounded-full" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {error && (
            <Card className="rounded-xl">
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                Não foi possível carregar: {error}
              </CardContent>
            </Card>
          )}

          {!loading && !error && filtered.length === 0 && (
            <Card className="rounded-xl">
              <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
                <Video className="h-10 w-10 opacity-40" />
                <p className="text-sm">Nenhuma gravação encontrada.</p>
              </CardContent>
            </Card>
          )}

          {!loading && !error && pageItems.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {pageItems.map((rec) => (
                <Card key={rec.id} className="group relative rounded-xl">
                  {rec.canDelete !== false && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Excluir gravação"
                      title="Excluir gravação"
                      disabled={deletingId === rec.id}
                      onClick={() => setPendingDelete(rec)}
                      className="absolute right-3 top-3 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                  <Link
                    href={`/gravacoes/${encodeURIComponent(rec.id)}`}
                    className="block focus:outline-none"
                  >
                    <CardHeader className="pb-2">
                      <p className="pr-8 text-sm font-semibold leading-snug text-foreground transition-colors group-hover:text-primary">
                        {rec.title?.trim() || `Reunião · ${rec.roomName}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(rec.createdAt)} · {formatDuration(rec.durationSeconds)}
                      </p>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-1.5">
                        {rec.storage === 'gdrive' && <Badge variant="secondary">Google Drive</Badge>}
                        {rec.noShow && <Badge variant="destructive">No-show</Badge>}
                        {rec.transcriptionStatus === 'failed' ? (
                          <Badge variant="destructive">Transcrição falhou</Badge>
                        ) : (
                          <Badge variant="secondary">{rec.utteranceCount} falas</Badge>
                        )}
                        {rec.sector && (
                          <Badge variant="secondary">
                            {rec.sector === 'comercial' ? 'Comercial' : 'Executoria'}
                          </Badge>
                        )}
                        {(rec.hostName || rec.metaHost) && (
                          <Badge variant="secondary">{rec.hostName || rec.metaHost}</Badge>
                        )}
                      </div>
                    </CardContent>
                  </Link>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Paginação (fixa no rodapé da área) */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
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
              type="button"
              variant="outline"
              size="sm"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
