import { redirect } from 'next/navigation';
import { getCurrentUser, type CurrentUser } from '@/lib/auth';

// Para páginas internas (server). Logado não-staff → /sem-acesso. Sem sessão → /login.
export async function requireStaff(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!user.isStaff) redirect('/sem-acesso');
  return user;
}
