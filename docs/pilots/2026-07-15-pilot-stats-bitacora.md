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

## Qué funcionó bien (hasta ahora)

- Parser + grafo: el plan de 4 tareas produjo el DAG exacto sin warnings al primer intento.
- Validación de arranque: atajó un args malformado en milisegundos, sin gastar agentes.

## Pendiente de observar en el run

- [ ] `implement-1` e `implement-2` corriendo simultáneos (la tesis del proyecto).
- [ ] Task 3 no arranca hasta que 1 y 2 mergearon (join del DAG).
- [ ] Reviews adversariales: ¿PASS a la primera o ronda de fix? (si hay fix, se ejercita
  el camino del checkout-en-worktree, el más frágil).
- [ ] Merges serializados sin corrupción del working tree.
- [ ] Ledger `.superpowers/sdd/progress.md` legible y con duraciones reales.
- [ ] Review final de rama completa con hallazgos útiles (¿o ruido?).
- [ ] Suite del piloto en verde al final: `npm test` en `pilot-stats`.
