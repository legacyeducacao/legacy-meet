'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { SearchableSelect } from '@/components/ui/searchable-select';

interface NpsResponse {
  id: string;
  meetingId: string | null;
  title: string | null;
  createdAt: string;
  score: number;
  comment: string | null;
  respondentName: string | null;
  hostName: string | null;
  hostId: string | null;
}

function formatDate(iso: string): string {
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

function scoreVariant(score: number): 'default' | 'secondary' | 'destructive' {
  if (score >= 9) return 'default';
  if (score >= 7) return 'secondary';
  return 'destructive';
}

export function NpsClient({ isAdmin }: { isAdmin: boolean }) {
  const [responses, setResponses] = useState<NpsResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hostFilter, setHostFilter] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch('/api/nps');
        if (!res.ok) throw new Error(await res.text());
        const json = await res.json();
        if (active) setResponses(json.responses ?? []);
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

  const hosts = useMemo(
    () => ([...new Set(responses.map((r) => r.hostName).filter(Boolean))] as string[]).sort(),
    [responses],
  );

  const filtered = useMemo(() => {
    if (!hostFilter) return responses;
    return responses.filter((r) => r.hostName === hostFilter);
  }, [responses, hostFilter]);

  const media = useMemo(() => {
    if (filtered.length === 0) return '—';
    const soma = filtered.reduce((acc, r) => acc + r.score, 0);
    return (soma / filtered.length).toFixed(1);
  }, [filtered]);

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">NPS</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Acompanhe as avaliações de satisfação das reuniões.
          </p>
        </div>

        {/* Card de resumo */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card className="rounded-xl">
            <CardHeader className="pb-2">
              <p className="text-sm font-medium text-muted-foreground">Média</p>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <p className="text-3xl font-bold">{media}</p>
              )}
            </CardContent>
          </Card>
          <Card className="rounded-xl">
            <CardHeader className="pb-2">
              <p className="text-sm font-medium text-muted-foreground">Total de respostas</p>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-8 w-12" />
              ) : (
                <p className="text-3xl font-bold">{filtered.length}</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Filtro por anfitrião (somente admin) */}
        {isAdmin && !loading && hosts.length > 1 && (
          <div className="w-64">
            <SearchableSelect
              value={hostFilter}
              onValueChange={setHostFilter}
              options={hosts.map((h) => ({ value: h, label: h }))}
              placeholder="Todos os anfitriões"
              searchPlaceholder="Buscar anfitrião…"
              emptyText="Nenhum anfitrião."
              clearable
              className="h-10"
            />
          </div>
        )}

        {/* Loading skeletons */}
        {loading && (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="rounded-xl">
                <CardHeader className="pb-2">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="mt-1 h-3 w-1/4" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-4 w-3/4" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Erro */}
        {error && (
          <Card className="rounded-xl">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Não foi possível carregar as respostas: {error}
            </CardContent>
          </Card>
        )}

        {/* Vazio */}
        {!loading && !error && filtered.length === 0 && (
          <Card className="rounded-xl">
            <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
              <ClipboardList className="h-10 w-10 opacity-40" />
              <p className="text-sm">Nenhuma resposta de NPS encontrada.</p>
            </CardContent>
          </Card>
        )}

        {/* Lista de respostas */}
        {!loading && !error && filtered.length > 0 && (
          <div className="flex flex-col gap-3">
            {filtered.map((r) => (
              <Card key={r.id} className="rounded-xl">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold leading-snug text-foreground">
                        {r.title ?? 'Reunião sem título'}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatDate(r.createdAt)}
                        {r.respondentName && ` · ${r.respondentName}`}
                      </p>
                    </div>
                    <Badge variant={scoreVariant(r.score)} className="shrink-0 text-sm font-bold">
                      {r.score}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-1.5">
                  {r.comment && (
                    <p className="text-sm text-foreground">
                      <span className="font-medium text-muted-foreground">Observações: </span>
                      {r.comment}
                    </p>
                  )}
                  {isAdmin && r.hostName && (
                    <p className="text-xs text-muted-foreground">
                      Anfitrião: <span className="font-medium">{r.hostName}</span>
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
