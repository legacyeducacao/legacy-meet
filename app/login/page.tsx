'use client';

import * as React from 'react';
import { createBrowserSupabase } from '@/lib/supabase/client';
import LoginPage from '@/components/patterns/LoginPage';
import { POST_LOGIN_PRELOADER_FLAG } from '@/components/patterns/PostLoginPreloader';

/**
 * Login no padrão do design system Legacy Plan, com o Supabase plugado.
 * Após entrar: grava a flag do preloader e faz reload completo (contrato do
 * kit — o preloader de marca só aparece na primeira renderização pós-login).
 */
export default function Login() {
  return (
    <LoginPage
      title="Legacy Meet"
      subtitle="Entre com a sua conta da Legacy para acessar as reuniões."
      backgroundImageUrl="/Login-bg.svg"
      copyright={`© ${new Date().getFullYear()} Legacy Educação`}
      onLogin={async (email, password) => {
        const supabase = createBrowserSupabase();
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw new Error('E-mail ou senha inválidos.');
        try {
          sessionStorage.setItem(POST_LOGIN_PRELOADER_FLAG, '1');
        } catch {
          /* sem sessionStorage */
        }
        window.location.href = '/';
      }}
      onForgotPassword={async (email) => {
        const supabase = createBrowserSupabase();
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/login`,
        });
        if (error) throw new Error('Não foi possível enviar o e-mail de recuperação.');
      }}
    />
  );
}
