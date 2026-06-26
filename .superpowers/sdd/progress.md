# Fundação (auth Supabase) — progresso

Plano: docs/superpowers/plans/2026-06-26-legacy-meet-fundacao.md
Branch: feat/fundacao-auth

Ordem de execução (service_role ainda ausente → Tasks 2,6,7,8 PAUSADAS):
- [x] Task 1: clientes Supabase + envs
- [x] Task 3: login Supabase + logout
- [x] Task 4: middleware (sessão) + getCurrentUser
- [x] Task 5: migrar auth de host p/ sessão Supabase
- (PAUSADAS até service_role + ok de escrever na base) Task 2, 6, 7, 8

Nota: verificação "manual" de login/middleware é feita pelo usuário após deploy
(precisa de servidor + chaves). Subagentes validam com tsc + build + commit.
Task 1: complete (commits d47ef9e..14764b9, review: spec OK, 1 fix de placeholder aplicado)
Task 3: complete (commits 59e0621..8c20185, review: spec 9/9, fix try/catch aplicado; minors a11y/next anotados p/ review final)
Task 4: complete (commit 6f0717e, review: spec 22/22; RLS users_select permite own-row -> getCurrentUser le o role OK; minors: ?next nao preservado e role:string anotados p/ review final)
Task 5: complete (commits 76061c1 + fix 360c26e, review: spec 8/8; fix aplicado: host=papel interno (MASTER/EXECUTOR), hostKey antes da sessao, getCurrentUser try/catch).

== DEFERIDOS p/ review final / proximo plano ==
- /api/record/start|stop SEM auth (pre-existente, comentario CAUTION) — fechar superficie.
- Sem dev-bypass (MEET_DEV_OPEN) — dev sem Supabase fica bloqueado (aceitavel; opcional).
- /api/room/* nao renova sessao no middleware (rota publica); host so-sessao >1h pode perder acoes (mitigado se @supabase/ssr renovar via refresh token no route handler — verificar).
- login/middleware: ?next nao preservado; inputs sem <label>/aria-live (a11y).

== STATUS: Tasks 1,3,4,5 DONE na branch feat/fundacao-auth (nao mergeado/deployado). ==
== Tasks 2,6,7,8 PAUSADAS: faltam SUPABASE_SERVICE_ROLE_KEY + ok p/ escrever na base de producao do Legacy Plan. ==
Task 6: complete (commit 56e59da + fix 777d3d0, review: spec OK; C1 corrigido: rollback se sector insert falhar. Minors I1/I2/I3/M* anotados p/ review final).
Task 7: complete (commit 383b5ac + fix 550a07a, review: spec 100%, sem Critical; I1 corrigido (rollback orfao) + trim server. I2 (msg de erro do Auth) anotado p/ review final).
Task 8: complete (commit 1f56aed + fix 3c8efc4, review: spec 100%; gap fechado: ownership nas rotas /api/recordings/[id] (GET/DELETE/video). Minors M1/M2 anotados).
== FUNDACAO: 8/8 tasks DONE na branch feat/fundacao-auth. Pendente: review final + service_role no prod + deploy. ==
Review final (opus): 1 bloqueador -> /gravacoes/[id]/page.tsx sem ownership. CORRIGIDO em eb49f68. Demais confirmados OK (service_role nao vaza, convidado nao vira host, isolamento ok). Deferidos nao-bloqueadores registrados. FUNDACAO PRONTA (pos-fix).
