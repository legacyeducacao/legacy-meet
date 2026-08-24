'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { Video } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { PageHeader } from '@/components/patterns/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { SearchableSelect } from '@/components/ui/searchable-select';

type Client = { id: string; name: string };

export default function Page() {
  const router = useRouter();
  const [sector, setSector] = useState<'comercial' | 'executoria'>('executoria');
  const [title, setTitle] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [record, setRecord] = useState(true);
  const [transcribe, setTranscribe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Setor e permissões do usuário logado
  const [meIsAdmin, setMeIsAdmin] = useState(false);
  const [meSector, setMeSector] = useState<string | null>(null);

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

  // Transcrição depende da gravação (transcrevemos o arquivo gravado).
  const onRecordChange = (checked: boolean) => {
    setRecord(checked);
    if (!checked) setTranscribe(false);
  };
  const onTranscribeChange = (checked: boolean) => {
    setTranscribe(checked);
    if (checked) setRecord(true);
  };

  // Carrega clientes quando o setor é executoria e o usuário pode ver Executoria
  useEffect(() => {
    if (sector !== 'executoria') return;
    if (!canExe) return;
    fetch('/api/clients')
      .then((r) => r.json())
      .then((json) => {
        const list: Client[] = json.clients ?? [];
        setClients(list);
        setTenantId(list[0]?.id ?? '');
      })
      .catch(() => setClients([]));
  }, [sector, canExe]);

  const createMeeting = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);

    if (!title.trim()) {
      setError('Informe o título da reunião.');
      setBusy(false);
      return;
    }
    const body: Record<string, unknown> = {
      sector,
      record,
      transcribe,
      title: title.trim(),
    };
    if (sector === 'executoria') {
      if (!tenantId) {
        setError('Selecione um cliente para a reunião de Executoria.');
        setBusy(false);
        return;
      }
      body.tenantId = tenantId;
    }

    try {
      const res = await fetch('/api/meetings/local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        setError(text || 'Erro ao criar reunião.');
        setBusy(false);
        return;
      }
      const { roomName } = await res.json();
      const params = new URLSearchParams();
      params.set('rec', record ? '1' : '0');
      params.set('tx', transcribe ? '1' : '0');
      router.push(`/rooms/${roomName}?${params.toString()}`);
    } catch {
      setError('Erro de rede ao criar reunião.');
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center">
        <div className="w-full max-w-xl">
        <PageHeader title="Seja bem-vindo!" subtitle="Crie uma reunião da Legacy." className="mb-6 animate-in-fade" />

        <Card className="animate-in-fade stagger-1">
          <CardHeader>
            <CardTitle>Nova reunião</CardTitle>
            <CardDescription>Escolha o setor e os detalhes da reunião.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={createMeeting} className="space-y-6">
              {canCom && canExe && (
                <div className="space-y-2">
                  <Label>Setor</Label>
                  <Tabs
                    value={sector}
                    onValueChange={(v) => setSector(v as 'comercial' | 'executoria')}
                  >
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="executoria">Executoria</TabsTrigger>
                      <TabsTrigger value="comercial">Comercial</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
              )}

              {sector === 'executoria' && (
                <div className="space-y-2">
                  <Label htmlFor="tenant">Cliente</Label>
                  <SearchableSelect
                    value={tenantId}
                    onValueChange={setTenantId}
                    options={clients.map((c) => ({ value: c.id, label: c.name }))}
                    placeholder={clients.length ? 'Selecione um cliente' : 'Carregando clientes…'}
                    searchPlaceholder="Buscar cliente…"
                    emptyText="Nenhum cliente encontrado."
                  />
                  {clients.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      Nenhum cliente disponível para a sua conta.
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="title">Título da reunião</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={
                    sector === 'comercial' ? 'Ex: Reunião com João Silva' : 'Ex: Planejamento mensal'
                  }
                  required
                />
                <p className="text-xs text-muted-foreground">Define o nome da pasta no Drive.</p>
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
                  <Switch
                    id="transcribe"
                    checked={transcribe}
                    onCheckedChange={onTranscribeChange}
                  />
                </div>
              </div>

              {error && <p className="text-sm font-medium text-destructive">{error}</p>}

              <Button type="submit" disabled={busy} className="w-full gap-2">
                <Video className="h-4 w-4" />
                {busy ? 'Criando…' : 'Criar reunião'}
              </Button>
            </form>
          </CardContent>
        </Card>
        </div>
      </div>
    </AppShell>
  );
}
