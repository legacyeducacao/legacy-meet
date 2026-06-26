'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';

type UserRow = { id: string; name: string | null; email: string; role: string };

export default function UsuariosClient() {
  const router = useRouter();
  const [users, setUsers] = React.useState<UserRow[]>([]);
  const [loadError, setLoadError] = React.useState('');

  // form state
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [role, setRole] = React.useState<'EXECUTOR' | 'MASTER'>('EXECUTOR');
  const [formError, setFormError] = React.useState('');
  const [formMsg, setFormMsg] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const loadUsers = React.useCallback(async () => {
    setLoadError('');
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) { setLoadError('Erro ao carregar usuários.'); return; }
      const json = await res.json();
      setUsers(json.users ?? []);
    } catch {
      setLoadError('Erro de rede ao carregar usuários.');
    }
  }, []);

  React.useEffect(() => { loadUsers(); }, [loadUsers]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    setFormMsg('');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, name: name.trim(), role }),
      });
      if (!res.ok) {
        const text = await res.text();
        setFormError(text || 'Falha ao criar usuário.');
        return;
      }
      setFormMsg('Usuário criado com sucesso.');
      setName(''); setEmail(''); setPassword(''); setRole('EXECUTOR');
      await loadUsers();
      router.refresh();
    } catch {
      setFormError('Erro de rede. Tente novamente.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ marginBottom: '1.5rem' }}>Gerenciar Usuários</h1>

      {/* Lista */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem', opacity: 0.7 }}>Usuários cadastrados</h2>
        {loadError && <p style={{ color: '#ff8a8a' }}>{loadError}</p>}
        {!loadError && users.length === 0 && <p style={{ opacity: 0.5 }}>Nenhum usuário encontrado.</p>}
        {users.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.15)' }}>
                <th style={{ textAlign: 'left', padding: '0.4rem 0.6rem' }}>Nome</th>
                <th style={{ textAlign: 'left', padding: '0.4rem 0.6rem' }}>E-mail</th>
                <th style={{ textAlign: 'left', padding: '0.4rem 0.6rem' }}>Papel</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                  <td style={{ padding: '0.4rem 0.6rem' }}>{u.name ?? '—'}</td>
                  <td style={{ padding: '0.4rem 0.6rem' }}>{u.email}</td>
                  <td style={{ padding: '0.4rem 0.6rem' }}>{u.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Form */}
      <section>
        <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem', opacity: 0.7 }}>Adicionar usuário</h2>
        <form onSubmit={onSubmit} className="prejoin-card" style={{ padding: '1.5rem' }}>
          <input
            className="lk-form-control"
            type="text"
            placeholder="Nome completo"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            style={{ marginBottom: '0.75rem' }}
          />
          <input
            className="lk-form-control"
            type="email"
            placeholder="E-mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ marginBottom: '0.75rem' }}
          />
          <input
            className="lk-form-control"
            type="password"
            placeholder="Senha inicial"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
            style={{ marginBottom: '0.75rem' }}
          />
          <select
            className="lk-form-control"
            value={role}
            onChange={(e) => setRole(e.target.value as 'EXECUTOR' | 'MASTER')}
            style={{ marginBottom: '1rem' }}
          >
            <option value="EXECUTOR">EXECUTOR</option>
            <option value="MASTER">MASTER</option>
          </select>
          {formError && <p style={{ color: '#ff8a8a', marginBottom: '0.5rem' }}>{formError}</p>}
          {formMsg && <p style={{ color: '#7dffb3', marginBottom: '0.5rem' }}>{formMsg}</p>}
          <button
            className="lk-button lk-join-button"
            type="submit"
            disabled={busy}
            style={{ width: '100%' }}
          >
            {busy ? 'Criando…' : 'Criar usuário'}
          </button>
        </form>
      </section>
    </div>
  );
}
