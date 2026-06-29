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

=========================================================
# NOVO PLANO: Acesso do Meet + NPS de Executoria
Plano: docs/superpowers/plans/2026-06-29-meet-acesso-nps.md
Branch: feat/design-legacy-plan  | BASE inicial: 78fe06b
Tasks 1 e 6 (migrações) rodadas pelo controlador via MCP. Demais por subagente.
Task 1: complete (migracao meet_user_profile aplicada; seed=10 profiles, 5 admins). DB only.
Task 2: complete (commit 79960d4, review: spec OK / quality Approved, sem Critical/Important).
  Minors p/ review final: (M) helpers checam !isStaff antes de isAdmin (ok em runtime); (M) vitest.config sem include; (M) comentario desatualizado em connection-details/route.ts:38 (MASTER/EXECUTOR -> isStaff). vitest.config.ts criado (alias @/).
Task 3: complete (commit b2c4551, review: spec OK / quality Approved, sem Critical/Important).
  Confirmado: app/layout.tsx raiz NAO usa AppShell -> /sem-acesso sem loop. Minors p/ review final: eslint-disable explicito no useEffect do AppShell; metadata em /sem-acesso; comentario no catch vazio do LogoutButton.
Task 4: complete (commit 913932f + fix 939b932, review: spec OK / quality Approved; 1 Important corrigido (POST 500 se upsert do profile falhar) + 1 Minor (PATCH resincroniza+toast em erro)).
Task 6: complete (migracao meet_nps_responses aplicada; tabela vazia). DB only.
Task 5: complete (commit 9f16137 + fix 35c2bdb, review: spec OK pos-fix / quality Approved; Important corrigido (guard canExe no useEffect de clientes da Agenda). Minor p/ review final: nome 'isMaster' em recordings/route.ts = user.isAdmin (renomear/inline).
== PARTE A (acesso) COMPLETA: Tasks 1-5. ==
Task 7: complete (commit 392ceee, review: spec OK / quality Approved, sem Critical/Important). Minors p/ review final: (M) /api/nps/submit vaza error.message do Supabase ao cliente publico -> logar + msg generica; (M) campo 'title' nao usado no select de /api/nps/context.
Task 8: complete (commit 08bfad1, review: spec OK / quality Approved, sem Critical/Important). Minors p/ review final: (M) NpsForm vai p/ 'done' mesmo se POST falhar (checar res.ok); (M) estado loading retorna null (sem spinner); (M) texto do estado 'done' redundante.
Task 9: complete (commit 4632e8d, review: spec OK / quality Approved, sem Critical/Important). Minors p/ review final: (M) canNps na sidebar duplica logica de canSeeNps (manutencao); (M) filtro oculto com 1 host (igual Gravacoes); (M) filtro por hostName e nao hostId.
== PARTE B (NPS) COMPLETA: Tasks 6-9. PLANO ACESSO+NPS: 9/9 tasks DONE. ==
== REVIEW FINAL (opus): PRONTA PARA MERGE. Sem Critical/Important. ==
Verificado OK: seguranca dos endpoints publicos de NPS (valida 0-10, resolve ids no server, /api/nps gated), isolamento comercial (UI+API, sem loop), migracao role->isAdmin/isStaff completa, service_role server-only, contratos coerentes, cobertura da spec.
Todos os minors = follow-up (nenhum bloqueia merge). Recomendados p/ limpeza: (T7) /api/nps/submit msg generica; (T8) NpsForm checar res.ok; + cosmeticos (eslint-disable, /sem-acesso metadata, isMaster rename, comentario connection-details, role deprecado removivel).
Polish (recomendado): commit 77a7e3a — /api/nps/submit msg generica + NpsForm checa res.ok. Build 0. Demais minors = follow-up opcional.
