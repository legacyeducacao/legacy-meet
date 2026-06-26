'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabase } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const supabase = createBrowserSupabase();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      setError('E-mail ou senha inválidos.');
      return;
    }
    router.push('/');
    router.refresh();
  };

  return (
    <main data-lk-theme="default" style={{ height: '100%', display: 'flex' }}>
      <form onSubmit={onSubmit} className="prejoin-card" style={{ margin: 'auto', width: 'min(100%,420px)' }}>
        <div className="prejoin-header">
          <img src="/favicon.svg" alt="Legacy Meet" width={52} height={52} />
          <h1>Entrar</h1>
          <p>Acesse com sua conta Legacy.</p>
        </div>
        <input className="lk-form-control" type="email" placeholder="E-mail" value={email}
          onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        <input className="lk-form-control" type="password" placeholder="Senha" value={password}
          onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password"
          style={{ marginTop: '0.75rem' }} />
        {error && <p style={{ color: '#ff8a8a', marginTop: '0.5rem' }}>{error}</p>}
        <button className="lk-button lk-join-button" type="submit" disabled={busy} style={{ marginTop: '1rem', width: '100%' }}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}
