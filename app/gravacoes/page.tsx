'use client';

import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';
import { Search, ChevronLeft, ChevronRight, Trash2, Video } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

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
  sector?: string | null;
}

const PAGE_SIZE = 9;

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
  const [page, setPage] = useState(1);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((r) => {
      const title = (r.title || r.roomName).toLowerCase();
      if (q && !title.includes(q) && !r.roomName.toLowerCase().includes(q)) return false;
      const day = (r.createdAt || '').slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      return true;
    });
  }, [items, query, from, to]);

  useEffect(() => {
    setPage(1);
  }, [query, from, to]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const handleDelete = async (rec: Rec) => {
    if (
      !confirm(
        `Excluir a gravação "${rec.title?.trim() || rec.roomName}"?\nIsso remove o vídeo e a transcrição permanentemente.`,
      )
    ) {
      return;
    }
    setDeletingId(rec.id);
    try {
      const res = await fetch(`/api/recordings/${encodeURIComponent(rec.id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      setItems((prev) => prev.filter((r) => r.id !== rec.id));
    } catch (e) {
      alert('Falha ao excluir: ' + (e instanceof Error ? e.message : e));
    } finally {
      setDeletingId(null);
    }
  };

  const hasFilters = !!(query || from || to);

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Gravações</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Acesse e gerencie todas as reuniões gravadas.
          </p>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-9"
              placeholder="Buscar por título…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-muted-foreground whitespace-nowrap">
              De
              <Input
                type="date"
                className="w-36"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground whitespace-nowrap">
              Até
              <Input
                type="date"
                className="w-36"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </div>
          {hasFilters && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setQuery('');
                setFrom('');
                setTo('');
              }}
            >
              Limpar
            </Button>
          )}
        </div>

        {/* Loading skeleton */}
        {loading && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="rounded-xl">
                <CardHeader>
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2 mt-1" />
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

        {/* Error */}
        {error && (
          <Card className="rounded-xl">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Não foi possível carregar: {error}
            </CardContent>
          </Card>
        )}

        {/* Empty state */}
        {!loading && !error && filtered.length === 0 && (
          <Card className="rounded-xl">
            <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <Video className="h-10 w-10 opacity-40" />
              <p className="text-sm">Nenhuma gravação encontrada.</p>
            </CardContent>
          </Card>
        )}

        {/* Grid */}
        {!loading && !error && pageItems.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {pageItems.map((rec) => (
              <Card key={rec.id} className="rounded-xl relative group">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  title="Excluir gravação"
                  disabled={deletingId === rec.id}
                  onClick={() => handleDelete(rec)}
                  className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
                <Link
                  href={`/gravacoes/${encodeURIComponent(rec.id)}`}
                  className="block focus:outline-none"
                >
                  <CardHeader className="pb-2">
                    <p className="font-semibold text-sm leading-snug pr-8 text-foreground group-hover:text-primary transition-colors">
                      {rec.title?.trim() || `Reunião · ${rec.roomName}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(rec.createdAt)} · {formatDuration(rec.durationSeconds)}
                    </p>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-1.5">
                      {rec.storage === 'gdrive' && (
                        <Badge variant="secondary">Google Drive</Badge>
                      )}
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
                      {rec.hostName && (
                        <Badge variant="secondary">{rec.hostName}</Badge>
                      )}
                    </div>
                  </CardContent>
                </Link>
              </Card>
            ))}
          </div>
        )}

        {/* Pagination */}
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
