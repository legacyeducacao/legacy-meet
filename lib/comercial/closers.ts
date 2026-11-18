/**
 * Closers do Comercial (servidor, service_role): quem o SDR pode escolher
 * como responsável pela reunião. Ver lib/comercial/funcao.ts.
 */
import { createAdminSupabase } from '@/lib/supabase/admin';
import { funcaoParaSetor } from './funcao';

export interface Closer {
  id: string;
  name: string;
  email: string;
}

export async function listarClosers(): Promise<Closer[]> {
  const { data, error } = await createAdminSupabase()
    .from('meet_user_profile')
    .select('user_id, sector, funcao_comercial, users!inner(name, email)')
    .eq('funcao_comercial', 'closer');
  if (error) {
    console.error('comercial: falha ao listar closers', error.message);
    return [];
  }
  return ((data ?? []) as any[])
    .filter((p) => funcaoParaSetor(p.funcao_comercial, p.sector) === 'closer')
    .map((p) => {
      const u = Array.isArray(p.users) ? p.users[0] : p.users;
      return { id: p.user_id as string, name: String(u?.name ?? '').trim(), email: String(u?.email ?? '') };
    })
    .filter((c) => c.name)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}
