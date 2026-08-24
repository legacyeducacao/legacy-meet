/**
 * Cache de logo/nome do tenant em sessionStorage — as mesmas chaves são lidas
 * e escritas por Layout.tsx (Plan) e GestaoSidebar.tsx (Gestão) para que os
 * dois workspaces compartilhem o cache e hidratem a marca instantaneamente,
 * sem esperar o fetch do Supabase resolver.
 *
 * Extraído em 2026-08-11 (Onda D, achado de duplicação) — antes cada sidebar
 * tinha sua própria cópia idêntica destas quatro funções.
 */
const LOGO_CACHE_KEY = 'bsc_company_logo_url';
const COMPANY_NAME_CACHE_KEY = 'bsc_company_name';

export function getCachedLogo(tenantId?: string): string {
  if (!tenantId) return '';
  try { return sessionStorage.getItem(`${LOGO_CACHE_KEY}_${tenantId}`) ?? ''; } catch { return ''; }
}

export function getCachedCompanyName(tenantId?: string): string {
  if (!tenantId) return '';
  try { return sessionStorage.getItem(`${COMPANY_NAME_CACHE_KEY}_${tenantId}`) ?? ''; } catch { return ''; }
}

export function setCachedLogo(tenantId: string, url: string) {
  try { sessionStorage.setItem(`${LOGO_CACHE_KEY}_${tenantId}`, url); } catch { /* ignore */ }
}

export function setCachedCompanyName(tenantId: string, name: string) {
  try { sessionStorage.setItem(`${COMPANY_NAME_CACHE_KEY}_${tenantId}`, name); } catch { /* ignore */ }
}
