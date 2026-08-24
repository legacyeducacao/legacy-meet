'use client';

import React, { useState } from 'react';
import { Eye, EyeOff, Lock, Mail, Loader2, ShieldCheck, ArrowLeft } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Checkbox } from '../ui/checkbox';

/**
 * Tela de login do Legacy Plan, desacoplada de auth/roteamento.
 *
 * - `onLogin` deve rejeitar com um Error para exibir a mensagem de erro inline.
 * - `onForgotPassword` é opcional; quando omitido, o link "Esqueci a senha"
 *   não é renderizado.
 * - O painel esquerdo (desktop) e o topo (mobile) usam uma imagem de fundo
 *   sobre a cor `brandPanelColor`.
 */
export interface LoginPageProps {
  onLogin: (email: string, password: string, rememberMe: boolean) => Promise<void>;
  onForgotPassword?: (email: string) => Promise<void>;
  backgroundImageUrl?: string;
  brandPanelColor?: string;
  copyright?: string;
  title?: string;
  subtitle?: string;
}

const LoginPage: React.FC<LoginPageProps> = ({
  onLogin,
  onForgotPassword,
  backgroundImageUrl = '/Login-bg.svg',
  brandPanelColor = '#040E1B',
  copyright = 'Copyright 2026 Legacy Educação | Todos os direitos reservados',
  title = 'Seja bem-vindo!',
  subtitle = 'Acesse o sistema utilizando suas credenciais.',
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [isResetting, setIsResetting] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setIsLoading(true);
    try {
      await onLogin(email, password, rememberMe);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Credenciais inválidas.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onForgotPassword) return;
    setIsResetting(true);
    setError('');
    try {
      await onForgotPassword(resetEmail);
      setNotice('Link de recuperação enviado para seu e-mail');
      setShowForgotPassword(false);
      setResetEmail('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar link de recuperação.');
    } finally {
      setIsResetting(false);
    }
  };

  const heading = (
    <div className="text-center">
      <h2 className="text-2xl lg:text-3xl font-extrabold text-foreground mb-1 lg:mb-2 tracking-tight">
        {showForgotPassword ? 'Recuperar senha' : title}
      </h2>
      <p className="text-muted-foreground text-sm font-medium">
        {showForgotPassword
          ? 'Informe seu e-mail para receber o link de recuperação.'
          : subtitle}
      </p>
    </div>
  );

  const forgotForm = (idSuffix: string) => (
    <form onSubmit={handleForgotPassword} className="space-y-6">
      <div className="space-y-5">
        <div className="relative group space-y-2">
          <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-1">E-mail</Label>
          <div className="relative">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" size={18} />
            <Input
              type="email"
              value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
              className="pl-11 bg-muted/30 border-border/60"
              placeholder="Informe seu e-mail"
              required
              autoFocus
            />
          </div>
        </div>
      </div>
      {error && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm text-center font-medium">
          {error}
        </motion.div>
      )}
      <div className="pt-2 space-y-3">
        <Button
          type="submit"
          disabled={isResetting}
          size="lg"
          className="w-full h-12 font-bold uppercase tracking-wide text-sm shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 gap-2"
        >
          {isResetting ? <Loader2 size={18} className="animate-spin" /> : <Mail size={18} />}
          {isResetting ? 'ENVIANDO...' : idSuffix === 'desktop' ? 'ENVIAR LINK DE RECUPERAÇÃO' : 'ENVIAR LINK'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="lg"
          className="w-full h-12 font-bold uppercase tracking-wide text-sm gap-2"
          onClick={() => { setShowForgotPassword(false); setError(''); }}
        >
          <ArrowLeft size={18} />
          {idSuffix === 'desktop' ? 'VOLTAR AO LOGIN' : 'VOLTAR'}
        </Button>
      </div>
    </form>
  );

  const loginForm = (idSuffix: string) => (
    <form onSubmit={handleLogin} className="space-y-5 lg:space-y-6">
      <div className="space-y-4 lg:space-y-5">
        {/* Email */}
        <div className="relative group space-y-2">
          <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-1">E-mail</Label>
          <div className="relative">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" size={18} />
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pl-11 bg-muted/30 border-border/60"
              placeholder="Informe seu e-mail"
              required
            />
          </div>
        </div>

        {/* Password */}
        <div className="relative group space-y-2">
          <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-1">Senha</Label>
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" size={18} />
            <Input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pl-11 pr-12 bg-muted/30 border-border/60"
              placeholder="Informe sua senha"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>
      </div>

      {/* Remember me + forgot password */}
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <Checkbox
            id={`rememberMe-${idSuffix}`}
            checked={rememberMe}
            onCheckedChange={(checked) => setRememberMe(checked === true)}
          />
          <Label htmlFor={`rememberMe-${idSuffix}`} className="text-sm font-medium text-muted-foreground cursor-pointer">
            Lembrar-me
          </Label>
        </div>
        {onForgotPassword && (
          <button
            type="button"
            onClick={() => { setShowForgotPassword(true); setResetEmail(email); setError(''); }}
            className="font-bold text-primary hover:text-primary/80 transition-colors text-xs"
          >
            Esqueci a senha
          </button>
        )}
      </div>

      {/* Notice (ex.: link de recuperação enviado) */}
      {notice && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="p-3 rounded-lg bg-primary/10 border border-primary/20 text-primary text-sm text-center font-medium">
          {notice}
        </motion.div>
      )}

      {/* Error */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm text-center font-medium"
        >
          {error}
        </motion.div>
      )}

      {/* Submit */}
      <div className="pt-1 lg:pt-2">
        <Button
          type="submit"
          disabled={isLoading}
          size="lg"
          className="w-full h-12 font-bold uppercase tracking-wide text-sm shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 gap-2"
        >
          {isLoading ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} />}
          {isLoading ? 'ENTRANDO...' : 'ENTRAR'}
        </Button>
      </div>
    </form>
  );

  return (
    <div className="min-h-dvh flex bg-background">

      {/* Left Side — Visual Branding (desktop only) */}
      <div className="hidden lg:flex w-1/2 relative items-center justify-center" style={{ backgroundColor: brandPanelColor }}>
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: `url('${backgroundImageUrl}')` }}
        />
        <div className="absolute bottom-12 text-center w-full text-muted-foreground/50 text-sm font-medium z-10">
          {copyright}
        </div>
      </div>

      {/* ─── Mobile Layout: image top + form bottom ─── */}
      <div className="flex flex-col w-full lg:hidden min-h-dvh">
        {/* Top: branding image area */}
        <div
          className="relative flex-shrink-0 bg-cover bg-center bg-no-repeat flex items-center justify-center"
          style={{ backgroundColor: brandPanelColor, backgroundImage: `url('${backgroundImageUrl}')`, minHeight: '38vh' }}
        />

        {/* Bottom: form card overlapping the image */}
        <div className="relative -mt-8 flex-1 bg-background rounded-t-3xl shadow-[0_-8px_30px_rgba(0,0,0,0.15)] px-6 pt-8 pb-6 flex flex-col">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-[420px] mx-auto space-y-6 flex-1"
          >
            {heading}
            {showForgotPassword ? forgotForm('mobile') : loginForm('mobile')}
          </motion.div>

          <p className="text-[10px] text-muted-foreground/40 text-center mt-auto pt-4 font-medium">
            {copyright.split('|')[0].trim()}
          </p>
        </div>
      </div>

      {/* ─── Desktop Layout: form right side ─── */}
      <div className="w-1/2 hidden lg:flex flex-col justify-center items-center p-24 bg-background">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-[420px] space-y-8"
        >
          {heading}
          <div className="mt-8">
            {showForgotPassword ? forgotForm('desktop') : loginForm('desktop')}
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default LoginPage;
