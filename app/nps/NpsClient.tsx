'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  Cell,
  PieChart,
  Pie,
  Tooltip,
  Legend,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import {
  ClipboardList,
  Gauge,
  Star,
  MessageSquare,
  ThumbsUp,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { AppShell } from '@/components/AppShell';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NpsResponse {
  id: string;
  meetingId: string | null;
  title: string | null;
  clientName: string | null;
  createdAt: string;
  score: number;
  comment: string | null;
  respondentName: string | null;
  hostName: string | null;
  hostId: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function category(score: number): 'promotor' | 'neutro' | 'detrator' {
  if (score >= 9) return 'promotor';
  if (score >= 7) return 'neutro';
  return 'detrator';
}

// CSS variable color tokens
const COLOR_PROMOTOR = 'hsl(var(--chart-3))'; // green
const COLOR_NEUTRO = 'hsl(var(--chart-4))';   // amber
const COLOR_DETRATOR = 'hsl(var(--chart-5))'; // red

function barColor(score: number): string {
  const cat = category(score);
  if (cat === 'promotor') return COLOR_PROMOTOR;
  if (cat === 'neutro') return COLOR_NEUTRO;
  return COLOR_DETRATOR;
}

function scoreBadgeClass(score: number): string {
  const cat = category(score);
  if (cat === 'promotor') return 'bg-green-100 text-green-800 border-green-200';
  if (cat === 'neutro') return 'bg-amber-100 text-amber-800 border-amber-200';
  return 'bg-red-100 text-red-800 border-red-200';
}

function npsColor(nps: number): string {
  if (nps >= 50) return 'text-green-600';
  if (nps >= 0) return 'text-amber-600';
  return 'text-red-600';
}

const PAGE_SIZE = 8;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function KpiCard({
  title,
  value,
  icon: Icon,
  valueClassName,
}: {
  title: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  valueClassName?: string;
}) {
  return (
    <Card className="rounded-xl">
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <p className={cn('text-3xl font-bold', valueClassName)}>{value}</p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function NpsClient({ isAdmin }: { isAdmin: boolean }) {
  // --- Data ---
  const [responses, setResponses] = useState<NpsResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // --- Filters ---
  const [companyFilter, setCompanyFilter] = useState('');
  const [hostFilter, setHostFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // --- Pagination ---
  const [page, setPage] = useState(1);

  // Fetch on mount
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    (async () => {
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

  // Reset page whenever any filter changes
  useEffect(() => {
    setPage(1);
  }, [companyFilter, hostFilter, dateFrom, dateTo]);

  // --- Derived data for filter dropdowns ---
  const companies = useMemo(
    () =>
      ([...new Set(responses.map((r) => r.clientName).filter(Boolean))] as string[]).sort(),
    [responses],
  );

  const hosts = useMemo(
    () =>
      ([...new Set(responses.map((r) => r.hostName).filter(Boolean))] as string[]).sort(),
    [responses],
  );

  // --- Filtered set ---
  const filtered = useMemo(() => {
    return responses.filter((r) => {
      if (companyFilter && r.clientName !== companyFilter) return false;
      if (hostFilter && r.hostName !== hostFilter) return false;
      const day = r.createdAt.slice(0, 10);
      if (dateFrom && day < dateFrom) return false;
      if (dateTo && day > dateTo) return false;
      return true;
    });
  }, [responses, companyFilter, hostFilter, dateFrom, dateTo]);

  const hasActiveFilter = companyFilter !== '' || hostFilter !== '' || dateFrom !== '' || dateTo !== '';

  // --- KPI computations ---
  const kpis = useMemo(() => {
    const n = filtered.length;
    if (n === 0)
      return { nps: null, media: null, total: 0, pctPromotor: null };
    const promotores = filtered.filter((r) => r.score >= 9).length;
    const detratores = filtered.filter((r) => r.score <= 6).length;
    const nps = Math.round(((promotores - detratores) / n) * 100);
    const media = (filtered.reduce((a, r) => a + r.score, 0) / n).toFixed(1);
    const pctPromotor = Math.round((promotores / n) * 100);
    return { nps, media, total: n, pctPromotor };
  }, [filtered]);

  // --- Bar chart data (0-10) ---
  const barData = useMemo(() => {
    const counts: Record<number, number> = {};
    for (let i = 0; i <= 10; i++) counts[i] = 0;
    filtered.forEach((r) => {
      counts[r.score] = (counts[r.score] ?? 0) + 1;
    });
    return Array.from({ length: 11 }, (_, i) => ({ nota: i, total: counts[i] }));
  }, [filtered]);

  // --- Pie chart data ---
  const pieData = useMemo(() => {
    const promotores = filtered.filter((r) => r.score >= 9).length;
    const neutros = filtered.filter((r) => r.score >= 7 && r.score <= 8).length;
    const detratores = filtered.filter((r) => r.score <= 6).length;
    return [
      { name: 'Promotores', value: promotores, color: COLOR_PROMOTOR },
      { name: 'Neutros', value: neutros, color: COLOR_NEUTRO },
      { name: 'Detratores', value: detratores, color: COLOR_DETRATOR },
    ];
  }, [filtered]);

  // --- Pagination ---
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

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

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Company filter */}
        <SearchableSelect
          value={companyFilter}
          onValueChange={setCompanyFilter}
          options={companies.map((c) => ({ value: c, label: c }))}
          placeholder="Todas as empresas"
          searchPlaceholder="Buscar empresa…"
          emptyText="Nenhuma empresa."
          clearable
          className="h-10 w-52"
        />

        {/* Host filter — admin only, and only if ≥2 hosts */}
        {isAdmin && hosts.length >= 2 && (
          <SearchableSelect
            value={hostFilter}
            onValueChange={setHostFilter}
            options={hosts.map((h) => ({ value: h, label: h }))}
            placeholder="Todos os usuários"
            searchPlaceholder="Buscar usuário…"
            emptyText="Nenhum usuário."
            clearable
            className="h-10 w-52"
          />
        )}

        {/* Date range */}
        <Input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="w-40 h-10"
          aria-label="Data inicial"
        />
        <Input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="w-40 h-10"
          aria-label="Data final"
        />

        {/* Clear button */}
        {hasActiveFilter && (
          <Button
            variant="outline"
            size="sm"
            className="h-10"
            onClick={() => {
              setCompanyFilter('');
              setHostFilter('');
              setDateFrom('');
              setDateTo('');
            }}
          >
            Limpar
          </Button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading ? (
          <>
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="rounded-xl">
                <CardHeader className="pb-2">
                  <Skeleton className="h-4 w-24" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-8 w-16" />
                </CardContent>
              </Card>
            ))}
          </>
        ) : (
          <>
            <KpiCard
              title="NPS"
              icon={Gauge}
              value={kpis.nps === null ? '—' : kpis.nps}
              valueClassName={kpis.nps === null ? '' : npsColor(kpis.nps)}
            />
            <KpiCard
              title="Média"
              icon={Star}
              value={kpis.media === null ? '—' : kpis.media}
            />
            <KpiCard
              title="Total de respostas"
              icon={MessageSquare}
              value={kpis.total}
            />
            <KpiCard
              title="% Promotores"
              icon={ThumbsUp}
              value={kpis.pctPromotor === null ? '—' : `${kpis.pctPromotor}%`}
            />
          </>
        )}
      </div>

      {/* Charts */}
      {!loading && !error && filtered.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Bar chart — distribution 0-10 */}
          <Card className="rounded-xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Distribuição de notas (0–10)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={barData} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="nota"
                    tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'hsl(var(--muted))' }}
                    contentStyle={{
                      background: 'hsl(var(--background))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(value) => [value, 'respostas']}
                    labelFormatter={(label) => `Nota ${label}`}
                  />
                  <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                    {barData.map((entry) => (
                      <Cell key={`cell-${entry.nota}`} fill={barColor(entry.nota)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Donut pie chart */}
          <Card className="rounded-xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Detratores / Neutros / Promotores
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, value }) => (value > 0 ? `${value}` : '')}
                    labelLine={false}
                  >
                    {pieData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: 'hsl(var(--background))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(value, name) => [value, name]}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={10}
                    formatter={(value) => (
                      <span style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>
                        {value}
                      </span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Loading state — list skeletons */}
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

      {/* Error state */}
      {error && (
        <Card className="rounded-xl">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Não foi possível carregar as respostas: {error}
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!loading && !error && filtered.length === 0 && (
        <Card className="rounded-xl">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
            <ClipboardList className="h-10 w-10 opacity-40" />
            <p className="text-sm">Nenhuma resposta de NPS encontrada.</p>
          </CardContent>
        </Card>
      )}

      {/* Paginated list */}
      {!loading && !error && filtered.length > 0 && (
        <div className="flex flex-col gap-3">
          {pageItems.map((r) => (
            <Card key={r.id} className="rounded-xl">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold leading-snug text-foreground">
                      {r.title ?? 'Reunião'}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatDate(r.createdAt)}
                      {r.clientName && (
                        <span className="ml-1 text-muted-foreground">· {r.clientName}</span>
                      )}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn('shrink-0 text-sm font-bold border', scoreBadgeClass(r.score))}
                  >
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
                {r.respondentName && (
                  <p className="text-xs text-muted-foreground">
                    Respondido por: <span className="font-medium">{r.respondentName}</span>
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

          {/* Pagination controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
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
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Próxima
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
    </AppShell>
  );
}
