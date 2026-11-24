import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { alternarCapacidade, lerCapacidades, PERMISSAO_KICKOFF } from '@/lib/kickoff/regras';
import { funcaoParaSetor } from '@/lib/comercial/funcao';
import { removerUsuario } from '@/lib/usuarios/remover';
import { PERMISSAO_VER_TODAS_GRAVACOES } from '@/lib/acessoGravacoes';

export const dynamic = 'force-dynamic';

const SECTORS = ['comercial', 'executoria', 'ambos'] as const;
type Sector = (typeof SECTORS)[number];
const asSector = (s: unknown): Sector => (SECTORS.includes(s as Sector) ? (s as Sector) : 'ambos');

export async function GET() {
  const me = await getCurrentUser();
  if (!me?.isAdmin) return new NextResponse('Não autorizado', { status: 401 });
  const admin = createAdminSupabase();
  // Só usuários internos do Meet: e-mail do domínio @legacyeducacaocorp.com.br
  // (evita listar clientes do Legacy Plan que compartilham a tabela `users`).
  // meet_user_profile(*): a coluna capacidades só existe depois da migration do
  // kickoff; pedir pelo nome antes disso derrubaria a lista inteira.
  const { data } = await admin
    .from('users')
    .select('id, name, email, role, meet_user_profile(*)')
    .ilike('email', '%@legacyeducacaocorp.com.br')
    .order('name');
  const users = ((data ?? []) as any[]).map((u) => {
    const p = Array.isArray(u.meet_user_profile) ? u.meet_user_profile[0] : u.meet_user_profile;
    return {
      id: u.id as string,
      name: u.name as string,
      email: u.email as string,
      isAdmin: p?.is_admin ?? false,
      sector: (p?.sector as Sector | undefined) ?? null,
      agendaNova: p?.agenda_nova === true,
      kickoffImpulsao: lerCapacidades(p).includes(PERMISSAO_KICKOFF),
      verTodasGravacoes: lerCapacidades(p).includes(PERMISSAO_VER_TODAS_GRAVACOES),
      funcaoComercial: funcaoParaSetor(p?.funcao_comercial, p?.sector),
    };
  });
  return NextResponse.json({ users });
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me?.isAdmin) return new NextResponse('Não autorizado', { status: 401 });
  const { email, password, name, sector, funcaoComercial } = (await req.json().catch(() => ({}))) as {
    email?: string; password?: string; name?: string; sector?: string; funcaoComercial?: string | null;
  };
  const cleanEmail = (email ?? '').trim();
  const cleanName = (name ?? '').trim();
  if (!cleanEmail || !password || !cleanName)
    return new NextResponse('email, password e name são obrigatórios', { status: 400 });
  const admin = createAdminSupabase();
  const { data: created, error } = await admin.auth.admin.createUser({
    email: cleanEmail, password, email_confirm: true,
    // role no metadata: o trigger do CRM em auth.users (handle_new_auth_user)
    // cria a linha em public.users já com o papel certo. Sem ele, o e-mail de
    // domínio Legacy caía no fallback CLIENT.
    user_metadata: { name: cleanName, role: 'EXECUTOR' },
  });
  if (error || !created.user)
    return new NextResponse('Falha ao criar: ' + (error?.message ?? ''), { status: 400 });
  // O trigger acima já pode ter inserido o usuário — upsert em vez de insert
  // (o insert batia em users_pkey duplicada e derrubava o cadastro inteiro).
  const { error: e2 } = await admin
    .from('users')
    .upsert(
      { id: created.user.id, email: cleanEmail, name: cleanName, role: 'EXECUTOR' },
      { onConflict: 'id' },
    );
  if (e2) {
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    return new NextResponse('Falha ao criar o perfil do usuário: ' + e2.message, { status: 500 });
  }
  const { error: e3 } = await admin
    .from('meet_user_profile')
    .upsert({
      user_id: created.user.id,
      is_admin: false,
      sector: asSector(sector),
      funcao_comercial: funcaoParaSetor(funcaoComercial, asSector(sector)),
    });
  if (e3)
    return new NextResponse('Perfil criado mas falha ao salvar o setor: ' + e3.message, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me?.isAdmin) return new NextResponse('Não autorizado', { status: 401 });
  const corpo = (await req.json().catch(() => ({}))) as {
    userId?: string; isAdmin?: boolean; sector?: string; agendaNova?: boolean; kickoffImpulsao?: boolean;
    funcaoComercial?: string | null;
    /** Permissão "Ver todas as gravações" (sem ser admin). */
    verTodasGravacoes?: boolean;
  };
  const { userId, isAdmin, sector, agendaNova, kickoffImpulsao, verTodasGravacoes } = corpo;
  if (!userId) return new NextResponse('userId obrigatório', { status: 400 });
  const admin = createAdminSupabase();
  // Permissões (kickoff, ver todas as gravações): só mexe em capacidades quando
  // vierem no corpo, e sem apagar as outras que o perfil já tiver.
  let capacidades: string[] | undefined;
  if (typeof kickoffImpulsao === 'boolean' || typeof verTodasGravacoes === 'boolean') {
    const { data: atual } = await admin.from('meet_user_profile').select('*').eq('user_id', userId).maybeSingle();
    capacidades = lerCapacidades(atual);
    if (typeof kickoffImpulsao === 'boolean') capacidades = alternarCapacidade(capacidades, PERMISSAO_KICKOFF, kickoffImpulsao);
    if (typeof verTodasGravacoes === 'boolean') {
      capacidades = alternarCapacidade(capacidades, PERMISSAO_VER_TODAS_GRAVACOES, verTodasGravacoes);
    }
  }
  const { error } = await admin
    .from('meet_user_profile')
    .upsert({
      user_id: userId,
      is_admin: !!isAdmin,
      sector: asSector(sector),
      // Liberação da agenda nova (teste): só muda quando vier no corpo.
      ...(typeof agendaNova === 'boolean' ? { agenda_nova: agendaNova } : {}),
      ...(capacidades ? { capacidades } : {}),
      // Função no Comercial (SDR/Closer): muda quando vier no corpo; quem sai
      // do Comercial (setor Executoria) perde a função.
      ...('funcaoComercial' in corpo || asSector(sector) === 'executoria'
        ? { funcao_comercial: funcaoParaSetor(corpo.funcaoComercial, asSector(sector)) }
        : {}),
      updated_at: new Date().toISOString(),
    });
  if (error) return new NextResponse('Falha ao salvar: ' + error.message, { status: 500 });
  return NextResponse.json({ ok: true });
}

/**
 * DELETE ?userId= : remove quem saiu da empresa (só admin). Apaga o acesso em
 * todos os projetos e mantém o nome no histórico. Ver lib/usuarios/remover.ts.
 */
export async function DELETE(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me?.isAdmin) return new NextResponse('Não autorizado', { status: 401 });
  const userId = req.nextUrl.searchParams.get('userId') ?? '';
  const r = await removerUsuario(userId, me.id);
  if (!r.ok) return new NextResponse(r.message, { status: r.status });
  return NextResponse.json({ ok: true, nome: r.nome });
}
