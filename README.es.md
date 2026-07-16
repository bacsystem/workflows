# parallel-plan-executor

*[Read this in English](README.md)*

Un `Workflow` de Claude Code que ejecuta un plan de implementación de
`superpowers:writing-plans`, corriendo las tareas independientes **en paralelo** según un
grafo de dependencias inferido del bloque `Consumes`/`Produces` de cada tarea — en vez de
una tarea a la vez, como hace por defecto `superpowers:subagent-driven-development`.

El **código que se genera** es agnóstico de tecnología: ya se validó con proyectos en
Node y en Java/Spring Boot, y no hay nada en el diseño atado a un lenguaje en particular.

Spec de diseño: `docs/superpowers/specs/2026-07-04-parallel-plan-executor-design.md`.

## Requisitos

- **[Claude Code](https://claude.com/claude-code)**, con acceso a la tool `Workflow`.
  Esto **no es opcional ni intercambiable**: el script de `workflows/parallel-plan-executor.js`
  está escrito contra las primitivas que provee esa tool (`agent()`, `pipeline()`,
  `parallel()`, etc.). No es un estándar abierto que otro asistente de IA (ChatGPT,
  Gemini, etc.) pueda interpretar — el workflow en sí depende de Claude Code. Lo que sí es
  agnóstico es el **proyecto que termina automatizando**: puede ser Go, Node, Java, o
  cualquier stack que el plan describa.
- **Node.js >= 20** (para `bin/parse-plan.js` y la suite de tests — ninguna dependencia
  de runtime, todo con el Node estándar).
- Git, y un repo con working tree limpio para el proyecto que vas a automatizar.
- `gh` (GitHub CLI) instalado y autenticado, **solo si** vas a usar `openPr: true` (para
  que el workflow pueda crear el PR final).

## Instalación

```bash
# 1. Cloná este repositorio (donde vive el workflow) en tu máquina
git clone <url-de-este-repo> parallel-plan-executor
cd parallel-plan-executor

# 2. Verificá tu versión de Node (debe ser >= 20)
node --version

# 3. Instalá (no hay dependencias de runtime; esto solo deja los scripts de npm listos)
npm install

# 4. Corré la suite de tests para confirmar que todo funciona en tu entorno
npm test

# 5. Generá el artefacto del workflow (regenera workflows/parallel-plan-executor.js
#    a partir del template — hacelo también cada vez que cambies algo en src/)
npm run build
```

Con esto el repo queda listo. El workflow se invoca **desde una sesión de Claude Code**
(no hace falta publicarlo en npm ni instalarlo globalmente) — ver la sección de Uso.

## Cómo funciona

1. `bin/parse-plan.js` lee un archivo de plan y calcula la lista de tareas + el grafo de
   dependencias (Node puro, con tests unitarios completos — ver `tests/`).
2. `workflows/parallel-plan-executor.js` (generado a partir de
   `workflows/parallel-plan-executor.template.js` con `npm run build`) toma ese grafo y
   corre cada tarea en su propio worktree de git vía `agent()`, arrancando una tarea en
   cuanto sus dependencias específicas terminan, sin esperar a un lote completo.
3. Cada tarea pasa por un agente de revisión adversarial en vez de un checkpoint humano
   por tarea, porque un `Workflow` no puede pausarse a mitad de la corrida para
   preguntarte algo.
4. Los merges pasan de a uno, serializados, respetando el orden de dependencias.
5. Al final se genera un reporte único y, si al menos una tarea se integró, un agente de
   **Handoff** prepara el cierre estilo git-flow (ver más abajo).

## Guía paso a paso (si es tu primera vez)

Esta sección es para quien nunca corrió el workflow y quiere ir sin perderse. Si ya lo
conocés, la sección "Uso" de abajo es la referencia rápida.

### Paso 0 — Lo que necesitás tener listo antes de empezar

- **Un plan de implementación aprobado**, con tareas numeradas y sus bloques
  `Consumes`/`Produces` (el formato que produce la skill `superpowers:writing-plans`).
  Si todavía no tenés uno, pedile a Claude Code, en el repo de tu proyecto: *"ayudame a
  escribir un plan de implementación para [tu feature]"* — eso corre la skill
  correspondiente y te deja el archivo del plan listo.
- **El repo que vas a automatizar**, con el working tree limpio (`git status` sin
  cambios pendientes) y, si vas a pedir `openPr: true` al final, con un remoto de GitHub
  ya configurado y `gh auth status` en verde.
- Este repo (`parallel-plan-executor`) clonado e instalado — ver "Instalación" más
  arriba. No hace falta que esté en la misma carpeta que tu proyecto: las rutas que le
  vas a pasar son siempre absolutas.

### Paso 1 — Abrí una sesión de Claude Code

Puede ser en la carpeta de tu proyecto, en la de este repo, o en cualquier otra: el
workflow no depende de dónde esté corriendo tu sesión de Claude Code, siempre que le
des rutas absolutas al plan y al repo destino.

### Paso 2 — Pedíselo a Claude Code en español, con lenguaje natural

**No hace falta escribir el JSON de `args` a mano.** Eso es trabajo de Claude Code: vos
le contás qué querés en una frase, con estos datos:

- la ruta de tu plan (`planPath`),
- la ruta de tu proyecto destino (`repoPath`),
- el nombre de la rama de integración (`integrationBranch`) — una rama feature efímera
  creada desde `develop`, **nunca** `develop`/`main` directamente (ver la topología
  recomendada más abajo),
- si querés que al final pushee y abra el PR (`openPr`) y contra qué rama (`pr.base`),
- **tu autorización explícita para los merges**, nombrando las ramas — esto es
  importante, ver el recuadro de abajo.

Ejemplo real (parecido a lo que se usó para escribir este mismo fix):

> "Lanzá el workflow parallel-plan-executor sobre mi proyecto en `D:/mi-proyecto`. El
> plan está en `docs/plans/2026-07-16-mi-feature.md`, ya aprobado. Integration branch:
> `feature/mi-feature`. Al final, pusheá y creá el PR contra `develop`. Autorizo mergear
> las ramas task-1 a task-6."

Claude Code se encarga de correr `bin/parse-plan.js` sobre tu plan, armar los `args`, e
invocar la tool `Workflow` con el script de este repo — vos no tocás JSON en ningún
momento.

> **¿Por qué nombrar las ramas en tu autorización?** Si el entorno tiene el clasificador
> de permisos de Claude Code en modo automático, puede exigir que un humano autorice
> explícitamente los merges — y esa autorización necesita nombrar la acción concreta
> ("mergear task-1 a task-6"), no un simple "sí" o "dale". Decirlo de entrada, con las
> ramas nombradas, evita que el run se trabe a mitad de camino. Ver la nota de permisos
> más abajo para el detalle técnico.

### Paso 3 — Qué vas a ver mientras corre

El workflow corre en segundo plano — no se queda esperando tu respuesta. Vas a ver:

- Una barra de progreso de texto tipo `[####----] 2/6 tasks settled` cada vez que una
  tarea termina (mergeada, fallida o saltada).
- Un aviso `Task N: started (implement)` apenas arranca cada tarea, para que sepas que
  no se colgó durante los minutos que tarda la implementación.

Podés preguntarle a Claude Code *"¿cómo va el workflow?"* en cualquier momento — va a
revisar el estado real y contarte qué tareas terminaron, cuáles están en curso y si hubo
algún problema. También podés abrir el panel `/workflows` de Claude Code para ver el
detalle por fase (Implement, Review, Merge, Final review, Handoff), cuántos agentes y
tokens llevó cada una, y el tiempo de cada agente.

### Paso 4 — Si algo se traba

Lo más común es que un merge quede marcado como bloqueado por precaución, **incluso
habiendo autorizado de entrada** — es una medida de seguridad del entorno, no un error
de tu plan. Si eso pasa:

1. Preguntale a Claude Code qué pasó (va a poder explicarte la causa concreta).
2. Repetí tu autorización nombrando las ramas específicas que faltan ("autorizo mergear
   task-2 y task-3") y pedile que reintente.
3. El run es recuperable: nada de lo ya hecho se pierde. Las tareas que ya terminaron
   (implementadas, revisadas, mergeadas) no se vuelven a correr — solo se reintenta lo
   que quedó pendiente.

### Paso 5 — Cuando termina

- Si **al menos una tarea se integró**, vas a tener un archivo
  `.superpowers/sdd/handoff.md` en tu proyecto con: el título y cuerpo de PR sugeridos,
  la versión SemVer propuesta, y un checklist de limpieza (qué ramas `task-N` borrar y
  cuándo).
- Si pediste `openPr: true`, el PR **ya va a estar creado** en GitHub contra la rama que
  indicaste — revisalo vos y mergealo cuando estés conforme. El workflow nunca mergea el
  PR por su cuenta; esa decisión siempre queda en tus manos.
- Si alguna tarea falló o quedó bloqueada, el reporte final te va a decir exactamente
  cuál y por qué — y cuáles otras tareas se saltearon en cascada por depender de ella.

### Errores comunes

| Lo que ves | Qué significa |
|---|---|
| `args.tasks must be a non-empty array` | El plan no tiene tareas parseables, o el parseo del plan no se hizo bien. Revisá que tu plan tenga bloques `### Task N:` con `Consumes`/`Produces`. |
| Un merge queda `CONFLICT` sin conflicto real de git | Casi siempre es el clasificador de permisos pidiendo autorización explícita — ver Paso 4. |
| El run se corta a mitad de camino | Es recuperable: Claude Code puede retomarlo sin perder el trabajo ya hecho. |
| El agente tarda varios minutos "sin hacer nada" al arrancar la primera tarea | Es normal — el primer `implement` incluye instalar/preparar el entorno del proyecto; vas a ver el aviso de progreso apenas termina. |

## Uso

```bash
# 1. Calculá el grafo de tareas para tu plan
#    (la salida por stdout es JSON puro; los warnings de ambigüedad — p. ej. dos tareas
#    que declaran el mismo símbolo en Produces — van a stderr y también quedan en el
#    campo "warnings" del JSON)
node bin/parse-plan.js /ruta/a/tu-plan.md > /tmp/plan-graph.json

# 2. Pedile a Claude Code que invoque la tool Workflow con:
#    scriptPath: "<este-repo>/workflows/parallel-plan-executor.js"
#    args: { tasks: <el campo "tasks" de plan-graph.json>,
#            graph: <el campo "graph" de plan-graph.json>,
#            planPath: "/ruta/a/tu-plan.md",
#            repoPath: "/ruta/a/tu/proyecto",
#            integrationBranch: "feature/mi-plan",  # rama a la que se mergea cada tarea (obligatorio)
#            openPr: true,                          # opcional: pushear y abrir el PR al final
#            pr: { base: "develop", assignees: ["yo"], labels: ["story"],
#                  milestone: "v1.2", closes: 42 },  # campos opcionales del PR (contrato git-flow)
#            mergeAuthorization: "Autorizo mergear las ramas task-1 a task-N contra <rama>"
#            }  # opcional pero recomendado: tu autorización explícita, para que el agente
#               # de merge no tenga que adivinar si ya diste consentimiento (ver nota de
#               # permisos más abajo)
```

## Fase de Handoff (v0.5.0)

Cuando al menos una tarea se integró, un agente final de **handoff** prepara el cierre
estilo git-flow — sin ejecutarlo. Escribe `.superpowers/sdd/handoff.md` en el repo
destino con: un título de PR sugerido en formato Conventional Commit, un body de PR
completo (Summary / Type of change / Main changes / Version / Checklist), el bump de
SemVer propuesto según los commits de la corrida (reglas de git-flow, incluido `0.x`), el
veredicto de la revisión final, y un checklist de limpieza posterior.

Con **`openPr: true`** (consentimiento explícito dado al lanzar) además pushea la rama
de integración y **crea** el pull request vía `gh` contra `pr.base` (por defecto
`develop`), aplicando los campos opcionales de `pr` — assignees, labels, milestone, y
`Closes #<closes>` en el body. **Nunca mergea el PR**: esa puerta siempre es humana.

## Topología de ramas recomendada (validada en el piloto 4)

Apuntá `integrationBranch` a una **rama feature efímera creada desde `develop`** — nunca
directamente a `develop`/`main`:

```
master (release)                 ← nunca la tocan los agentes
  └── develop (integración)      ← nunca la tocan los agentes
        └── feature/<plan>       ← integrationBranch: acá mergean las ramas de tarea ★
              ├── task-1         ← un worktree aislado por implementador
              └── task-N
```

Por qué: la rama principal queda protegida por construcción (código escrito por agentes
nunca aterriza en una rama compartida sin revisión humana), una corrida fallida cuesta un
solo `git branch -D`, y la puerta humana queda exactamente donde debe estar — el único PR
`feature/<plan> → develop` que abrís vos con la skill `git-flow` una vez que revisaste la
rama terminada.

**Nota sobre permisos**: si corrés bajo el modo automático de Claude Code, el
clasificador de permisos puede exigir autorización humana para los agentes de merge del
workflow, sin importar la rama destino — y esa autorización debe llegar al agente que
hace el merge, no solo mencionarse en la conversación con vos. Por eso conviene pasar
`mergeAuthorization` con tu frase textual (nombrando las ramas) en `args`: sin ese campo,
el agente de merge no tiene forma de saber que ya diste consentimiento, y algunos
subagentes eligieron autobloquearse por precaución incluso habiendo autorización — de
forma inconsistente entre tareas del mismo run (ver hallazgo F8 en
`docs/pilots/2026-07-15-pilot-stats-bitacora.md`).

## Chequeos de seguridad (v0.2)

- **Validación de arranque**: el workflow valida `args` antes de lanzar cualquier agente
  — un grafo cíclico o un id presente en `graph` pero ausente en `tasks` falla rápido con
  un error claro, en vez de dejar a `runDag` en un deadlock silencioso.
- **Encadenamiento por archivo compartido**: las tareas que tocan el mismo archivo se
  serializan como una cadena (cada una depende de la última que lo tocó), así que nunca
  corren en paralelo entre sí.
- **Warnings de productor duplicado**: dos tareas que declaran el mismo símbolo en
  `Produces` se marcan como warning (el primer productor sigue ganando); no aborta la
  corrida.
- **Las razones de skip apuntan a la causa raíz**: una tarea saltada por cascada reporta
  la tarea que originalmente falló, no el eslabón intermedio saltado.

## Limitaciones conocidas (v1)

- Solo cuentan los símbolos entre comillas invertidas en `Consumes`/`Produces` (p. ej.
  `` - Produces: la factory `createWidget()` `` produce `createWidget`). La prosa suelta
  se ignora a propósito: extraer cada identificador convertía palabras como "the" o
  "None" en símbolos y creaba dependencias espurias — incluso ciclos falsos — entre
  tareas no relacionadas. `Consumes: None` es entonces simplemente una lista vacía.
- El parser de `Consumes`/`Produces` lee una línea a la vez — un valor que se corta a una
  segunda línea en la prosa del plan no se captura. Una dependencia perdida **no**
  desordena silenciosamente las tareas: la tarea arranca sin su dependencia real en su
  lugar, así que falla ruidosamente (o se autoreporta `BLOCKED`) y sus dependientes
  transitivos se saltan, todo esto visible en el reporte final. Se evaluó y se pospuso un
  mecanismo de reintento posterior (ver spec de diseño §7) — hoy la única mitigación es
  mantener `Consumes`/`Produces` en una sola línea por entrada.
- No hay re-ejecución especulativa de una tarea anormalmente lenta (evaluado y pospuesto,
  ver spec de diseño §7) — dimensionar bien las tareas en el plan es la mitigación actual.
- Las ramas `task-<id>` de tareas fallidas o BLOCKED sobreviven a la corrida a propósito:
  preservan el estado parcial que exista para diagnóstico. Limpialas después con
  `git branch -D task-<id>` cuando ya no las necesites.
