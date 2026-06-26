'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Mail, Lock, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { createBrowserSupabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const supabase = createBrowserSupabase();
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        setError('E-mail ou senha inválidos.');
        return;
      }
      router.push('/');
      router.refresh();
    } catch {
      // falha de rede/inesperada — não trava o botão e mostra mensagem amigável
      setError('Não foi possível entrar. Verifique sua conexão e tente novamente.');
    } finally {
      setBusy(false);
    }
  };

  const labelClass = 'text-xs font-semibold uppercase tracking-wide text-primary';

  return (
    <div className="flex h-full w-full overflow-auto">
      {/* Painel de marca (esquerda) */}
      <div
        className="relative hidden flex-1 bg-[#03101d] bg-cover bg-center md:block"
        style={{ backgroundImage: "url('/Login-bg.svg')" }}
        aria-hidden="true"
      >
        <p className="absolute inset-x-0 bottom-8 px-8 text-center text-xs text-white/55">
          Copyright 2026 Legacy Educação | Todos os direitos reservados
        </p>
      </div>

      {/* Painel do formulário (direita) */}
      <div className="flex flex-1 items-center justify-center overflow-auto bg-white p-8">
        <div className="w-full max-w-sm">
          <h1 className="mb-1 text-center text-3xl font-bold text-primary">Seja bem-vindo!</h1>
          <p className="mb-8 text-center text-muted-foreground">
            Acesse o sistema utilizando suas credenciais.
          </p>

          <form onSubmit={onSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className={labelClass}>
                E-mail
              </Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  className="pl-9"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="voce@empresa.com.br"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className={labelClass}>
                Senha
              </Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  className="px-9"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && <p className="text-sm font-medium text-destructive">{error}</p>}

            <Button type="submit" disabled={busy} className="w-full gap-2">
              <ShieldCheck className="h-4 w-4" />
              {busy ? 'Entrando…' : 'Entrar'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
