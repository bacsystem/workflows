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

## Veredicto

El workflow **funciona end-to-end**: produce código correcto, testeado, con historial
git limpio y reportes trazables. Pero **F3 es bloqueante para uso real con paralelismo**:
el aislamiento de implementadores no existe cuando el workflow apunta a un repo externo
(el caso de uso principal). Corregir F3/F4 (worktrees propios del repo objetivo) antes
del próximo run; F1 (CRLF del artefacto) merece un `.gitattributes`; F5 es cosmético.
