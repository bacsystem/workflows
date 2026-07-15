# Bitácora del piloto — pilot-stats (2026-07-15)

Primer run end-to-end real del `parallel-plan-executor` (v0.4.0) sobre un proyecto
descartable: mini librería de estadísticas en Node puro, 4 tareas
(`sum`/`mean` ∥ `median` → `summarize` → CLI). Grafo esperado: `1:[], 2:[], 3:[1,2], 4:[3]`.

Objetivo: validar el flujo completo con agentes reales — paralelismo, join del DAG,
reviews adversariales, merges serializados — y registrar todo lo que falle o sorprenda.

## Entorno

- Windows 11, Git Bash, Node 24, `core.autocrlf=true` (relevante: ya causó un hallazgo).
- Repo piloto: `D:/github/pilot-stats`, rama de integración `main`, un commit inicial.
- Workflow: artefacto `workflows/parallel-plan-executor.js` construido de `develop` (v0.4.0).

## Checklist previo al lanzamiento

- [x] `node bin/parse-plan.js` → grafo exactamente el diseñado, **0 warnings**.
- [x] Repo piloto limpio y commiteado.
- [x] `integrationBranch: "main"` explícita (requisito nuevo de v0.4.0).

## Hallazgos

### F1 — El diálogo de permisos rechaza el artefacto con CRLF (workaround)

Al invocar la tool `Workflow` con `scriptPath`, el handler de permisos rechazó el
script: "contains control characters" — el working copy del artefacto tenía CRLF por
`core.autocrlf=true` (git lo smudgea al hacer checkout). **Workaround**: re-correr
`npm run build` justo antes de lanzar (el build escribe LF). Misma familia que los dos
bugs de CRLF ya corregidos en 0.2.1/0.3.0 — el entorno Windows sigue encontrando
variantes. Posible fix definitivo: `.gitattributes` con `eol=lf` para `workflows/*.js`.

### F2 — El harness entrega `args` como string JSON, no como objeto (bug real, corregido)

Primer lanzamiento: murió en 9 ms con `args.tasks must be a non-empty array`.
Causa: `args` llegó al script como **string** JSON; el destructuring dio `undefined`.

- ✅ **Lo bueno**: la validación fail-fast (v0.2.0) hizo exactamente su trabajo — 0
  agentes lanzados, costo cero, error inmediato. Sin ella, `runDag` habría deadlockeado
  en silencio.
- ❌ **Lo malo**: el mensaje culpa a `tasks` cuando el problema era la forma de `args`
  entera; y el template no toleraba la entrega como string.
- **Fix aplicado**: el template parsea `args` si llega como string
  (`typeof args === 'string' ? JSON.parse(args) : args`), con test de build. PR a develop.

### F3 — `isolation: 'worktree'` aísla el repo de la SESIÓN, no `repoPath` (estructural, el hallazgo del piloto)

La suposición de diseño era que cada implementador trabajaba en un worktree aislado del
repo objetivo. En la realidad, el aislamiento del harness aplica al repo donde corre la
sesión (`D:/github/workflows`) — los dos implementadores paralelos compartieron el
**único working tree** de `D:/github/pilot-stats`. La carrera predicha ocurrió de verdad:

1. El implementador 2 hizo `git switch -c task-2`; el implementador 1 movió HEAD a
   `task-1` antes de que el 2 commiteara → **el commit de median aterrizó en `task-1`**.
2. Ambos agentes se dieron cuenta, se auto-remediaron (el 2 re-apuntó su rama con
   `git branch -f task-2 dd4da63`; el 1 reconstruyó `task-1` cherry-pickeando solo su
   commit) y **lo reportaron honestamente en `concerns`**.

El run sobrevivió por la adaptabilidad de los agentes, **no por diseño**. Con más tareas
paralelas o agentes menos cuidadosos, esto es corrupción de ramas. Fix propuesto: el
prompt de `implement` debe ordenar crear un worktree propio del repo objetivo
(`git worktree add <dir> -b task-N` + limpieza al terminar) en vez de confiar en
`isolation: 'worktree'`, que aísla el repo equivocado.

### F4 — `task-brief` escribe el brief en el cwd del agente, no en el repo objetivo

Consecuencia del mismo malentendido: para la task 4 el brief quedó en el worktree de la
sesión (`workflows/.claude/worktrees/...`), no en `pilot-stats/.superpowers/sdd/`. La
review lee el brief desde el repo objetivo — funcionó igual (el reviewer se adaptó), pero
el contrato de paths entre implement y review es frágil. Mismo fix que F3: anclar el cwd
del agente al repo objetivo.

### F5 — La barra de progreso solo se emite al cierre de cada tarea (UX)

Durante los ~10 minutos del primer implement no hubo ninguna línea de progreso — la
barra `[####----] N/4` se emite solo en `settle()`. Mejora pendiente: `log()` también al
*inicio* de cada tarea ("Task N started (implement)"), para que el usuario vea vida
durante la fase larga.

## Resultado final del run

**Las 4 tareas completas, review final limpia, 25/25 tests en `main`.**

| Métrica | Valor |
|---|---|
| Agentes | 19 (4 implement, 4 review, 4 merge, 4 ledger, review final, +2) |
| Tokens de subagentes | ~514k |
| Duración total | ~36 min |
| Rondas de fix | 0 (las 4 reviews dieron PASS/APPROVED a la primera) |
| Ledger | 4 líneas correctas con duraciones (9m37s, 1m41s, 3m15s, 2m45s) |

## Qué funcionó bien

- Parser + grafo: DAG exacto sin warnings al primer intento.
- Validación de arranque: atajó un args malformado en milisegundos, sin gastar agentes (F2).
- **El orden del DAG se respetó**: merges 2 → 1 → 3 → 4; la task 3 no arrancó hasta que
  1 y 2 estaban mergeadas; historial de `main` limpio y consistente.
- **La review final de rama completa agregó valor real**, no ruido: detectó drift de
  convenciones de mensajes de error entre las tasks 1 y 2 (que corrieron en paralelo sin
  contrato común) y validación duplicada — hallazgos genuinamente cross-task que las
  reviews individuales no podían ver. Hasta señaló que la duplicación era consecuencia
  de la estructura del plan, no error de los implementadores.
- Los agentes reportaron `concerns` honestos y accionables (incluida la carrera F3, con
  remediación documentada).
- TDD real en las 4 tareas: RED verificado antes de implementar, GREEN al cerrar.
- El ledger y los tiempos de pared (de los propios agentes) salieron correctos.

## Veredicto (piloto 1)

El workflow **funciona end-to-end**: produce código correcto, testeado, con historial
git limpio y reportes trazables. Pero **F3 es bloqueante para uso real con paralelismo**:
el aislamiento de implementadores no existe cuando el workflow apunta a un repo externo
(el caso de uso principal). Corregir F3/F4 (worktrees propios del repo objetivo) antes
del próximo run; F1 (CRLF del artefacto) merece un `.gitattributes`; F5 es cosmético.

---

# Piloto 2 — pilot-stats-2 (mismo día, v0.4.2)

Mismo plan de 4 tareas en un repo fresco, corrido desde la rama con los fixes
F1/F3/F4/F5 (PR #9), para validación 1:1 contra el piloto 1.

## Fixes validados

| Hallazgo | Resultado en el piloto 2 |
|---|---|
| **F3** (carrera de working tree) | ✅ Eliminada. Tareas 1 y 2 arrancaron con 3 s de diferencia, cada una en su worktree (`.worktrees/task-N`), commits en las ramas correctas desde el primer intento, `main` nunca se movió. |
| **F4** (brief fuera del repo) | ✅ Briefs en `pilot-stats-2/.superpowers/sdd/`. |
| **F5** (barra muda) | ✅ `Task N: started (implement)` visible al arrancar cada tarea. |
| **F1** (CRLF del artefacto) | ✅ Lanzamiento a la primera, sin re-build manual. |

**Paralelismo real medido**: el par 1∥2 tardó **2m46s de reloj** (2m34s y 2m43s
solapados) contra ~13 minutos contaminados por contención en el piloto 1. La review
final destacó además que los contratos de error de las dos tareas paralelas salieron
**consistentes sin coordinación** — en el piloto 1 habían divergido (drift de mensajes).

## Hallazgo nuevo

### F6 — El clasificador de permisos del harness puede denegar agentes de merge a mitad del run

El agente `merge-3` fue bloqueado por el clasificador de seguridad de la sesión ("merge
sin revisión humana") — el mismo que había bloqueado un `gh pr merge` del orquestador
más temprano. **El workflow degradó exactamente como fue diseñado**: task 3 FAILED, task
4 SKIPPED en cascada con la causa raíz correcta, y la review final detectó con precisión
el estado ("task-3 completa-pero-sin-mergear, merge sin conflicto posible; task 4 nunca
construida — ready to merge: No").

- Implicación: en entornos con clasificador activo, los merges del workflow necesitan
  autorización humana previa/explícita, o el run queda a medias con trabajo varado en
  ramas (recuperable: el diseño con `resumeFromRunId` + merge manual autorizado funcionó).
- Recuperación ejercitada: merge manual de `task-3` autorizado por el usuario (20/20
  tests en verde) + resume del run — las tareas 1-3 se reprodujeron desde caché y la
  task 4 corrió fresca.

Menor: en el objeto `results` retornado, el `error` de una tarea failed serializa como
`{}` (los `Error` de JS no sobreviven a JSON); el mensaje sí está en el log de resumen.

## Desenlace del piloto 2 (resume + merges autorizados)

Con el merge manual de `task-3` autorizado por el usuario, el **resume**
(`resumeFromRunId`) funcionó como está diseñado: las tareas 1-3 se reprodujeron desde
caché, `merge-3` encontró el merge hecho y reportó MERGED (el ledger ganó su línea de
task 3), y la **task 4 corrió fresca**: implement en su worktree + review PASS (23/23
tests en su rama). El clasificador volvió a bloquear `merge-4` (F6, segunda ocurrencia
— su justificación pide autorización que *nombre* específicamente la acción), así que el
merge final también fue manual y autorizado.

**Estado final del repo piloto: plan 4/4 completo, 23/23 tests en `main`, CLI verificado
de punta a punta** (`stats-cli 1 2 3 4` → JSON correcto). La review final del resume
además dejó recomendaciones de mejora *del formato de plan* (p. ej. `Consumes: None` en
tareas hermanas produce validación duplicada por construcción — un plan podría declarar
una task-0 de helpers compartidos).

## Métricas (run inicial del piloto 2, antes del resume)

| Métrica | Piloto 1 | Piloto 2 |
|---|---|---|
| Agentes | 19 | 12 (run cortado en merge-3) |
| Tokens de subagentes | ~514k | ~291k |
| Par paralelo 1∥2 (reloj) | ~13 min (contención) | **2m46s** |
| Incidentes de ramas | 1 (auto-remediado) | **0** |
| Rondas de fix | 0 | 0 |
