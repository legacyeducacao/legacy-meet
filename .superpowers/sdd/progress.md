# Fundação (auth Supabase) — progresso

Plano: docs/superpowers/plans/2026-06-26-legacy-meet-fundacao.md
Branch: feat/fundacao-auth

Ordem de execução (service_role ainda ausente → Tasks 2,6,7,8 PAUSADAS):
- [x] Task 1: clientes Supabase + envs
- [ ] Task 3: login Supabase + logout
- [ ] Task 4: middleware (sessão) + getCurrentUser
- [ ] Task 5: migrar auth de host p/ sessão Supabase
- (PAUSADAS até service_role + ok de escrever na base) Task 2, 6, 7, 8

Nota: verificação "manual" de login/middleware é feita pelo usuário após deploy
(precisa de servidor + chaves). Subagentes validam com tsc + build + commit.
Task 1: complete (commits d47ef9e..14764b9, review: spec OK, 1 fix de placeholder aplicado)
