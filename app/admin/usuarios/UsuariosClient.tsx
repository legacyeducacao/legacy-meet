'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus } from 'lucide-react';
import { toast } from '@/components/ui/custom-toast';

import { AppShell } from '@/components/AppShell';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

type Sector = 'comercial' | 'executoria' | 'ambos';
type UserRow = {
  id: string;
  name: string | null;
  email: string;
  isAdmin: boolean;
  sector: Sector | null;
};

function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

export default function UsuariosClient() {
  const router = useRouter();
  const [users, setUsers] = React.useState<UserRow[]>([]);
  const [loadError, setLoadError] = React.useState('');
  const [loading, setLoading] = React.useState(true);

  // form state
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [sector, setSector] = React.useState<Sector>('ambos');
  const [formError, setFormError] = React.useState('');
  const [formMsg, setFormMsg] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  // per-row saving state: userId → 'saving' | undefined
  const [saving, setSaving] = React.useState<Record<string, boolean>>({});

  const loadUsers = React.useCallback(async () => {
    setLoadError('');
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) { setLoadError('Erro ao carregar usuários.'); return; }
      const json = await res.json();
      setUsers(json.users ?? []);
    } catch {
      setLoadError('Erro de rede ao carregar usuários.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { loadUsers(); }, [loadUsers]);

  const patchUser = React.useCallback(
    async (userId: string, isAdmin: boolean, userSector: Sector | null) => {
      setSaving((prev) => ({ ...prev, [userId]: true }));
      try {
        const res = await fetch('/api/admin/users', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, isAdmin, sector: userSector ?? 'ambos' }),
        });
        if (!res.ok) {
          const text = await res.text();
          console.error('Falha ao salvar usuário:', text);
          toast.error('Falha ao salvar usuário: ' + (text || 'erro desconhecido'));
          await loadUsers();
          return;
        }
        await loadUsers();
      } catch (err) {
        console.error('Erro de rede ao salvar usuário:', err);
      } finally {
        setSaving((prev) => ({ ...prev, [userId]: false }));
      }
    },
    [loadUsers],
  );

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    setFormMsg('');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, name: name.trim(), sector }),
      });
      if (!res.ok) {
        const text = await res.text();
        setFormError(text || 'Falha ao criar usuário.');
        return;
      }
      setFormMsg('Usuário criado com sucesso.');
      setName(''); setEmail(''); setPassword(''); setSector('ambos');
      await loadUsers();
      router.refresh();
    } catch {
      setFormError('Erro de rede. Tente novamente.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-6 lg:h-[calc(100vh-4rem)]">
        {/* Page header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Usuários</h1>
          <p className="text-sm text-muted-foreground">Gerencie quem acessa o Legacy Meet.</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3 lg:min-h-0 lg:flex-1">
          {/* Create-user form */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>Novo usuário</CardTitle>
              <CardDescription>Preencha os dados para criar um acesso.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-1">
                  <Label htmlFor="u-name">Nome</Label>
                  <Input
                    id="u-name"
                    type="text"
                    placeholder="Nome completo"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    autoComplete="off"
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="u-email">E-mail</Label>
                  <Input
                    id="u-email"
                    type="email"
                    placeholder="usuario@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="off"
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="u-password">Senha</Label>
                  <Input
                    id="u-password"
                    type="password"
                    placeholder="Senha inicial"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="u-sector">Setor</Label>
                  <Select
                    value={sector}
                    onValueChange={(v) => setSector(v as Sector)}
                  >
                    <SelectTrigger id="u-sector">
                      <SelectValue placeholder="Selecione o setor" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="comercial">Comercial</SelectItem>
                      <SelectItem value="executoria">Executoria</SelectItem>
                      <SelectItem value="ambos">Ambos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {formError && (
                  <p className="text-sm font-medium text-destructive">{formError}</p>
                )}
                {formMsg && (
                  <p className="text-sm text-primary font-medium">{formMsg}</p>
                )}

                <Button type="submit" disabled={busy} className="w-full gap-2">
                  <UserPlus className="h-4 w-4" />
                  {busy ? 'Criando…' : 'Criar usuário'}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* User list */}
          <Card className="lg:col-span-2 lg:flex lg:min-h-0 lg:flex-col">
            <CardHeader>
              <CardTitle>Usuários cadastrados</CardTitle>
              <CardDescription>Todos os usuários com acesso à plataforma.</CardDescription>
            </CardHeader>
            <CardContent className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              {loadError && (
                <p className="text-sm font-medium text-destructive">{loadError}</p>
              )}

              {loading && !loadError && (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full rounded-md" />
                  ))}
                </div>
              )}

              {!loading && !loadError && users.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhum usuário encontrado.</p>
              )}

              {!loading && !loadError && users.length > 0 && (
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>E-mail</TableHead>
                      <TableHead>Admin</TableHead>
                      <TableHead>Setor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Avatar className="h-7 w-7 text-xs">
                              <AvatarFallback>{getInitials(u.name, u.email)}</AvatarFallback>
                            </Avatar>
                            <span>{u.name ?? '—'}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{u.email}</TableCell>
                        <TableCell>
                          <Switch
                            checked={u.isAdmin}
                            disabled={saving[u.id]}
                            onCheckedChange={(checked) =>
                              patchUser(u.id, checked, u.sector)
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={u.sector ?? 'ambos'}
                            disabled={saving[u.id]}
                            onValueChange={(v) =>
                              patchUser(u.id, u.isAdmin, v as Sector)
                            }
                          >
                            <SelectTrigger className="h-8 w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="comercial">Comercial</SelectItem>
                              <SelectItem value="executoria">Executoria</SelectItem>
                              <SelectItem value="ambos">Ambos</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
