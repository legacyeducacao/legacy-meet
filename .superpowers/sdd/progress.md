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
/code-review (high): correctness+cleanup finders. Fixes aplicados: middleware copia cookies no redirect; removidos diff*.txt. Refutado: isStaff/sector-null (coluna NOT NULL). Follow-ups (nao bloqueiam): gravacoes sem host_id ocultas p/ nao-admin (isolamento; admin ve tudo), NPS sem rate-limit (v1), dups (embed-normalize/date-helper/sector-gate), listRecordings 2xN S3 (ideal: worker grava host no manifesto).

=========================================================
# NOVO PLANO: Worker de transcrição resiliente + recuperação de backlog
Plano: docs/superpowers/plans/2026-07-03-worker-transcricao-resiliente.md
Spec:  docs/superpowers/specs/2026-07-03-worker-transcricao-resiliente-design.md
Branch: worker-transcricao-resiliente | BASE inicial: 6520e97
Ordem: Task 1 (text) -> 2 (http) -> 3 (drive) -> 4 (processRecording) -> 5 (reconcile) -> review final.
Tasks 4 e 5: verificacao MANUAL (smoke MinIO/Drive) pelo usuario; CI cobre so unidades puras.
Ops (usuario): acertar relogio do worker (NTP) — possivel causa raiz da queda do Drive.
Task 1: complete (commit 2ed3828, review: spec OK / quality Approved, 7/7 tests). Minors p/ review final: (M) parsePlainTextToUtterances importado mas so usado na Task 4; (M) sem teste de \r\n (baixo risco, utterancesToPlainText so emite \n).
Task 2: complete (commit f49d29d, review: CODE spec OK / quality Approved, 9/9 tests, tsc clean verificado direto). Nota: task-2-report.md ficou com conteudo stale de outro plano (bookkeeping, nao afeta codigo). Minor p/ review final: (M) fetchWithTimeout descarta init.signal do chamador (footgun latente, nao exercitado).
Task 3: complete (commit 2c95bcf, review: spec OK / quality Approved, 14/14 tests). Implementer resolveu inconsistencia do brief (import de driveCreateFolder faltando). Minors p/ review final: (M) find helpers tratam HTTP nao-OK (401/403) como not-found -> mas try/catch da Task 4 cai em s3 (seguro); (M) imports usados na Task 4; (M) sem teste do branch parentId=undefined.
Task 4: complete (commit a0fc838, review OPUS: spec OK / quality Approved, 14/14 tests, tsc clean; 6 riscos nomeados verificados - manifesto sempre, nunca lanca apos manifesto, manifesto antes do delete guardado por gdrive, reuso txt com empty-guard, idempotencia, escopo de vars OK). Minor p/ review final: (M) splitAudio roda mesmo no caminho de reuso de txt (desperdicio de CPU no backlog, nao afeta correcao).
Task 5: complete (commit d098dab, review: spec OK / quality Approved, 14/14 tests, tsc clean; 5 riscos verificados - filtro s3+videoKey, sem re-transcricao, manifesto antes do delete, falha isolada por gravacao + token reset, wiring no loop). Minors p/ review final (ambos herdados do brief): (M) catch loga 'adiada' e reseta token mesmo se so o deleteObject final falhar apos migracao ja concluida (cosmetico); (M) reconcile faz ListObjectsV2 + GetObject por manifesto a cada ciclo 30s -> nota de escala conforme manifests acumulam.
== TODAS AS 5 TASKS DONE na branch worker-transcricao-resiliente. Pendente: review final + smoke manual (usuario) + deploy + NTP. ==
== REVIEW FINAL (opus): "With fixes". Invariantes centrais OK (manifesto sempre, Drive nunca lanca apos manifesto, delete so apos manifesto e so gdrive, sem re-transcricao na recuperacao, videoKey correto). 1 Important corrigido:
  #1 find helpers tratavam HTTP nao-OK (429/401/5xx) como not-found -> criavam pasta/arquivo duplicado em erro transitorio. FIX commit d0defef: lancam em !resp.ok (retryavel; call sites caem em s3 / "adiada"). 17/17 tests.
Minors deferidos (follow-up, nao bloqueiam): (#2) sweep ativo de .mp4 orfaos com manifesto gdrive foi descopado (plano) - orfao inofensivo; (#3) getObjectTextOrNull engole erro nao-404 do GET do txt -> pode re-transcrever (raro); (#4) reconcile re-tenta mp4 fantasma (videoKey aponta p/ objeto inexistente) a cada ciclo -> so ruido de log; (#5) guard de duplicata desliga sem GOOGLE_DRIVE_FOLDER_ID (prod seta o parent).
== BRANCH worker-transcricao-resiliente PRONTA (pos-fix). Pendente: smoke manual (usuario, MinIO/Drive), deploy do worker, NTP no container. ==
== MERGED para main (no-ff, commit 1a07443). Tests 17/17 + tsc OK no resultado. Branch deletada. NAO pushado (main local +98 vs legacy/main). Pendente usuario: smoke MinIO/Drive, deploy do worker, NTP no container. ==
