'use client';
// Legacy Hub: o login único de todos os sistemas da Legacy (projeto legacy-core).
//
// Como funciona aqui no Meet:
//   1. a pessoa entra com e-mail e senha no Legacy Hub;
//   2. a função legacy-hub-sessao (projeto do Plan, onde o Meet mora) confere o
//      login do Hub e o crachá, e devolve a sessão do Meet da MESMA pessoa;
//   3. o Meet segue funcionando exatamente como antes (cookies, rotas, regras).
//
// Rede de segurança: se o Hub não reconhecer a pessoa ou a troca falhar por
// motivo técnico, o login segue pelo caminho antigo. O Meet é sistema interno:
// o caminho antigo só vale para e-mail corporativo.
import { AuthError, createClient, type SupabaseClient } from '@supabase/supabase-js';

const HUB_URL = 'https://uckiaomlxakqmtvxkyfk.supabase.co';
// Chave publicável: é pública por natureza.
const HUB_KEY = 'sb_publishable_d1-9XsjBSEk5jwxXLNhOUw_uHWFDHAi';
const PLATAFORMA = 'legacy_meet';
const DOMINIO_CORPORATIVO = '@legacyeducacaocorp.com.br';

let hubCliente: SupabaseClient | null = null;
function hub(): SupabaseClient {
  if (!hubCliente) {
    hubCliente = createClient(HUB_URL, HUB_KEY, {
      auth: {
        storage: typeof window !== 'undefined' ? window.localStorage : undefined,
        storageKey: 'legacy-hub-auth',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return hubCliente;
}

/** Entra pelo Legacy Hub e abre a sessão do Meet (cookies) da mesma pessoa. */
export async function entrarPeloHub(meet: SupabaseClient, email: string, password: string): Promise<void> {
  const corporativo = email.trim().toLowerCase().endsWith(DOMINIO_CORPORATIVO);
  const caminhoAntigo = async () => {
    // Sistema interno: o caminho antigo só vale para e-mail corporativo.
    if (!corporativo) throw new Error('E-mail ou senha inválidos.');
    const { error } = await meet.auth.signInWithPassword({ email, password });
    if (error) throw new Error('E-mail ou senha inválidos.');
  };

  const hubLogin = await hub().auth.signInWithPassword({ email, password });
  if (hubLogin.error || !hubLogin.data.session) return caminhoAntigo();

  let corpo: { error?: string; access_token?: string; refresh_token?: string } = {};
  let ok = false;
  try {
    const resp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/legacy-hub-sessao`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        authorization: `Bearer ${hubLogin.data.session.access_token}`,
      },
      body: JSON.stringify({ plataforma: PLATAFORMA }),
    });
    corpo = await resp.json().catch(() => ({}));
    ok = resp.ok && !!corpo.access_token && !!corpo.refresh_token;
  } catch {
    ok = false;
  }

  if (!ok) {
    await hub().auth.signOut({ scope: 'local' }).catch(() => undefined);
    if (corpo.error === 'conta_bloqueada') throw new Error('Conta desativada. Fale com o RH.');
    if (corpo.error === 'sem_acesso') throw new Error('Sua conta não tem acesso ao Legacy Meet.');
    return caminhoAntigo();
  }

  const { error } = await meet.auth.setSession({
    access_token: corpo.access_token!,
    refresh_token: corpo.refresh_token!,
  });
  if (error) throw new Error('E-mail ou senha inválidos.');
  // Colaborador: a senha local acompanha a do Hub (o caminho antigo não aceita senha velha).
  if (senhaPeloHub(email)) await meet.auth.updateUser({ password }).catch(() => undefined);
}

/** Sai também do Hub (só neste navegador). */
export async function sairDoHub(): Promise<void> {
  await hub().auth.signOut({ scope: 'local' }).catch(() => undefined);
}


// ---------------------------------------------------------------------------
// Senha de colaborador: mora no Legacy Hub e vale em todos os sistemas.
// O e-mail sai pelo Hub (Resend) e o link abre /definir-senha.html neste app
// (página única, a mesma em todos os apps da Legacy). Cliente continua com o
// "esqueci a senha" do próprio app.
// ---------------------------------------------------------------------------

/** E-mail corporativo: a senha é a do Legacy Hub. */
export function senhaPeloHub(email: string): boolean {
  return email.trim().toLowerCase().endsWith('@legacyeducacaocorp.com.br')
}

/** "Esqueci a senha" pelo Hub. Mesmo formato de resposta do resetPasswordForEmail. */
export async function esqueciASenhaNoHub(
  email: string,
): Promise<{ data: Record<string, never>; error: null } | { data: null; error: AuthError }> {
  const voltar = `${window.location.origin}/definir-senha.html`
  try {
    const resp = await fetch(`${HUB_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(voltar)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: HUB_KEY },
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
    })
    if (resp.ok) return { data: {}, error: null }
    const corpo = (await resp.json().catch(() => ({}))) as { msg?: string; message?: string; error_code?: string }
    return { data: null, error: new AuthError(corpo.msg ?? corpo.message ?? 'Não foi possível enviar o e-mail.', resp.status, corpo.error_code) }
  } catch {
    return { data: null, error: new AuthError('Não foi possível enviar o e-mail. Confira a internet e tente de novo.', 0) }
  }
}
