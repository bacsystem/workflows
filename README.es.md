# parallel-plan-executor

*[Read this in English](README.md)*

Un `Workflow` de Claude Code que ejecuta un plan de implementación de `cys:plan`,
corriendo las tareas independientes **en paralelo** según un grafo de dependencias
inferido del bloque `Consumes`/`Produces` de cada tarea — en vez de una tarea a la
vez, como hacen los ejecutores secuenciales de planes.

El **código que se genera** es agnóstico de tecnología: ya se validó con proyectos en
Node y en Java/Spring Boot, y no hay nada en el diseño atado a un lenguaje en particular.

Spec de diseño: `docs/cys/specs/2026-07-04-parallel-plan-executor-design.md`.

## ¿Qué tipo de cosa es esto? (¿plugin? ¿skill? ninguno)

Ninguno de los dos. Este repo es un **script de `Workflow`** — un tercer tipo de
extensión de Claude Code, distinto de plugins y skills:

- **No es un plugin**: no se instala con `/plugin` ni desde un marketplace.
- **No es una skill**: no vive bajo `.claude/skills/` ni se invoca con la tool Skill.
- Es un **script para la tool `Workflow` de Claude Code**: clonas este repo en cualquier
  lugar de tu máquina, y Claude Code corre el script por ruta absoluta
  (`scriptPath: <clon>/workflows/parallel-plan-executor.js`) cuando se lo pides.

Lo único que sí se "instala" en el sentido de Claude Code es el comando opcional
`/run-plan` (un solo archivo `.md` que copias — ver más abajo), o el **plugin cys**
que se describe a continuación.

## El plugin cys

**cys** es el plugin de skills de este repo: cinco skills que cubren el flujo completo
**design → plan → run → check → ship**, creado por Christian Bacilio y nombrado en
honor a sus hijas gemelas, **Cielo y Sophia**.

| Skill | Qué hace |
|---|---|
| `cys:design` | idea → spec |
| `cys:plan` | spec → plan de implementación |
| `cys:run` | el Workflow de este repo — se lanza vía `/cys:run-plan` o `commands/run-plan.md`. **Exclusivo de Claude Code** (ver "Soporte multi-IA" abajo). |
| `cys:check` | revisión adversarial / verificación |
| `cys:ship` | commit / bump de SemVer / PR |
| `cys:guide` | índice — qué skill usar en cada momento |

El plugin también trae `/cys:flow` (exclusivo de Claude Code) — el punto
de entrada todo-en-uno: le das un repo destino y una idea, y recorre el
flujo completo (diseño → plan → ejecución paralela) con tus puertas de
aprobación en cada etapa. Usa `/cys:run-plan` cuando ya tengas un plan
aprobado.

## Soporte multi-IA

Las cinco skills de cys que no son el motor (`design`, `plan`, `check`,
`ship`, `guide`) son markdown plano sin acoplamiento a nada específico de
Claude Code, así que se comparten tal cual — mismo directorio `skills/`,
sin copia forkeada — en todas las plataformas de abajo. `cys:run`
(ejecución paralela, el scheduler DAG, revisión adversarial y merge
serializado) es **exclusivo de Claude Code**: en cualquier otra
plataforma, `cys:guide` explica cómo ejecutar las tareas de un plan vos
mismo una vez que `cys:plan` ya generó uno.

### Claude Code

Se instala desde el marketplace autohospedado de este repo:

```
/plugin marketplace add bacsystem/parallel-plan-executor
/plugin install cys@bacsystem
```

La primera línea resuelve la forma corta `owner/repo` de GitHub. Dos
alternativas equivalentes, por si las necesitas:

```
# URL completa de GitHub en vez de la forma corta
/plugin marketplace add https://github.com/bacsystem/parallel-plan-executor

# Un clon local en vez de GitHub (ej. para probar cambios sin commitear)
/plugin marketplace add /ruta/absoluta/a/tu/clon
```

Instalar el plugin también expone el `commands/run-plan.md` de este repo
como el slash command `/cys:run-plan`, y `commands/flow.md` como
`/cys:flow` — sin copiar archivos a mano.

### Cursor

Cursor no tiene un comando tipo `/plugin marketplace add <repo>` como
Claude Code, pero sí tiene una vía de "instalar desde un repo local" en
su propia UI de Settings (confirmado funcionando de verdad — la UI de
plugins de Cursor cambió después de escribir esta sección por primera
vez, así que confiá en estos pasos antes que en cualquier captura vieja
que encuentres en otro lado):

1. Clona este repo (ver [Instalación](#instalación) abajo — para solo
   usar las skills alcanza con clonar, no hace falta compilar el
   artefacto del workflow ni correr su suite de tests).
2. En Cursor: **Settings → Plugins** (o el panel **Customize**, si tu
   versión ya movió la gestión de plugins ahí) → **+ Add** → **From
   Local Repo** → apuntá a la ruta absoluta de tu clon.
3. `cys` aparece bajo un grupo "Bacsystem" (viene del campo `author` de
   `plugin.json`) con un botón **Add** — hacé clic. Cuando diga
   **Added**, las skills ya están activas, sin necesidad de recargar.

Invocá las skills igual que cualquier otra skill de Cursor (ej.
`/design`, `/plan`).

<details>
<summary>Si no te aparece "From Local Repo" o cys no aparece después de agregarlo</summary>

- **¿Usaste un symlink a mano y no aparece?** Revisá que el symlink use
  la ruta **absoluta** de tu clon, no una relativa — `ln -s
  parallel-plan-executor ~/.cursor/plugins/local/cys` (relativa) queda
  roto porque se resuelve contra la carpeta *donde vive el symlink*
  (`~/.cursor/plugins/local/`), no contra donde corriste el comando.
  Confirmalo con `ls -la ~/.cursor/plugins/local/cys` — tiene que mostrar
  la ruta absoluta completa apuntando a tu clon real, no solo el nombre
  de una carpeta.
- **Estás viendo la página vieja de "Plugins" y no aparece nada
  instalado que reconozcas**: Cursor puede mostrar un aviso arriba de
  esa página ("Plugins are moving to Customize") — hacé clic en **"Open
  Customize"** y repetí los pasos 2-3 de ahí, es la vista que realmente
  está activa hoy.
- Si ninguna de las dos aplica, queda el mecanismo alternativo (más
  viejo, puede no aplicar a tu versión de Cursor) descrito abajo.

</details>

<details>
<summary>Alternativa: symlink a la carpeta de plugins locales de Cursor</summary>

Si tu versión de Cursor no tiene el flujo "From Local Repo", el
mecanismo documentado más viejo sigue funcionando: enlazá el clon a la
carpeta de plugins locales de Cursor (`~/.cursor/plugins/local/<nombre>`
en macOS/Linux, según la
[documentación de plugins de Cursor](https://cursor.com/docs/plugins)).
Un symlink es preferible a una copia, para que los `git pull` futuros se
reflejen solos — **usá siempre la ruta absoluta de tu clon como destino
del symlink**, no una relativa (una ruta relativa se resuelve contra la
carpeta del symlink, no contra donde corriste el comando, y queda rota en
silencio):

**macOS / Linux:**
```
mkdir -p ~/.cursor/plugins/local
ln -s /ruta/absoluta/a/tu/clon ~/.cursor/plugins/local/cys
```

**Windows (PowerShell):**
```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.cursor\plugins\local" | Out-Null
New-Item -ItemType Junction -Path "$env:USERPROFILE\.cursor\plugins\local\cys" -Target "C:\ruta\absoluta\a\tu\clon"
```
Una junction (`New-Item -ItemType Junction`, o `mklink /J` desde
`cmd.exe`) funciona sin permisos de administrador, a diferencia de un
symlink de directorio normal (`New-Item -ItemType SymbolicLink` /
`mklink /D`), que necesita una consola elevada o tener el Modo
Desarrollador activado.

Después, recargá Cursor (Paleta de comandos → "Developer: Reload
Window") para que lo tome.
</details>

## Requisitos

- **[Claude Code](https://claude.com/claude-code)**, con acceso a la tool `Workflow`.
  Esto **no es opcional ni intercambiable**: el script de `workflows/parallel-plan-executor.js`
  está escrito contra las primitivas que provee esa tool (`agent()`, `pipeline()`,
  `parallel()`, etc.). No es un estándar abierto que otro asistente de IA (ChatGPT,
  Gemini, etc.) pueda interpretar — el workflow en sí depende de Claude Code. Lo que sí es
  agnóstico es el **proyecto que termina automatizando**: puede ser Go, Node, Java, o
  cualquier stack que el plan describa.
- **El plugin cys** (ver arriba) para escribir planes con `cys:plan`. El motor es
  totalmente autocontenido: el workflow trae sus propios scripts
  `task-brief`/`review-package` en `bin/` y registra las corridas bajo `.cys/`.
  Cualquier plan que siga el formato `### Task N:` + `Consumes`/`Produces` funciona,
  sin importar qué herramienta lo escribió.
- **Node.js >= 20** (para `bin/parse-plan.js` y la suite de tests — ninguna dependencia
  de runtime, todo con el Node estándar).
- Git, y un repo con working tree limpio para el proyecto que vas a automatizar.
- `gh` (GitHub CLI) instalado y autenticado, **solo si** vas a usar `openPr: true` (para
  que el workflow pueda crear el PR final).

## Instalación

```bash
# 1. Clona este repositorio (donde vive el workflow) en tu máquina.
#    DÓNDE: donde quieras — tu carpeta de usuario, un directorio de herramientas, etc.
#    NO necesita estar dentro de .claude/, y NO necesita estar al lado de los proyectos
#    que vas a automatizar; todas las rutas que le pases después son absolutas.
git clone <url-de-este-repo> parallel-plan-executor
cd parallel-plan-executor

# 2. Verifica tu versión de Node (debe ser >= 20)
node --version

# 3. Instala (no hay dependencias de runtime; esto solo deja los scripts de npm listos)
npm install

# 4. Corre la suite de tests para confirmar que todo funciona en tu entorno
npm test

# 5. Genera el artefacto del workflow (regenera workflows/parallel-plan-executor.js
#    a partir del template — hazlo también cada vez que cambies algo en src/)
npm run build
```

Con esto el repo queda listo. El workflow se invoca **desde una sesión de Claude Code**
(no hace falta publicarlo en npm ni instalarlo globalmente) — ver la sección de Uso.
Antes de tu primera corrida real, haz también la **configuración de permisos** de abajo
(una sola vez) para que los merges de tareas no se bloqueen a mitad de corrida.

## Configuración de permisos, una sola vez (merges)

Los agentes de merge del workflow corren `git merge` dentro de tu repo destino. Claude
Code trata a un agente mergeando código como una acción sensible, y lo que pasa depende
de tu modo de permisos:

- **Modo normal (default)**: no hay nada que configurar. La primera vez que un agente de
  merge corre `git merge`, te aparece el diálogo nativo de permisos de Claude Code —
  **Allow once / Allow always / Deny**. Elige "Allow always" en el primero y el resto de
  la corrida fluye sin volver a preguntar.
- **Modo automático**: por defecto no hay diálogo — un clasificador automático decide
  solo, y puede bloquear los merges de agentes incluso habiendo autorizado tú mismo la
  corrida de entrada (ver la nota de permisos más abajo para el porqué). Para tener el
  mismo diálogo yes/no del modo normal, agrega una **regla `ask`** al
  `.claude/settings.json` del **proyecto destino** (crea el archivo si no existe):

```json
{
  "permissions": {
    "ask": [
      "Bash(git merge:*)",
      "Bash(git -C * merge *)"
    ]
  }
}
```

Con esa regla puesta, cada `git merge` de cualquier agente se pausa y te pregunta **a
ti**, de forma determinística, sin importar el modo — solo haces clic, nunca escribes.
Si prefieres que no te pregunte nunca, usa `"allow"` en vez de `"ask"` (la corrida queda
100% sin manos; la puerta humana se muda a la revisión del PR final).

## Cómo funciona

1. `bin/parse-plan.js` lee un archivo de plan y calcula la lista de tareas + el grafo de
   dependencias (Node puro, con tests unitarios completos — ver `tests/`).
2. `workflows/parallel-plan-executor.js` (generado a partir de
   `workflows-src/parallel-plan-executor.template.js` con `npm run build`) toma ese grafo y
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
conoces, la sección "Uso" de abajo es la referencia rápida.

### Paso 0 — Lo que necesitas tener listo antes de empezar

- **Un plan de implementación aprobado**, con tareas numeradas y sus bloques
  `Consumes`/`Produces` (el formato que produce la skill `cys:plan`). Si todavía no
  tienes uno, pídele a Claude Code, en el repo de tu proyecto: *"ayúdame a escribir un
  plan de implementación para [tu feature]"* — con el plugin cys instalado eso corre
  `cys:design` → `cys:plan` y te deja el archivo del plan listo.
- **El repo que vas a automatizar**, con el working tree limpio (`git status` sin
  cambios pendientes) y, si vas a pedir `openPr: true` al final, con un remoto de GitHub
  ya configurado y `gh auth status` en verde.
- Este repo (`parallel-plan-executor`) clonado e instalado — ver "Instalación" más
  arriba. No hace falta que esté en la misma carpeta que tu proyecto: las rutas que le
  vas a pasar son siempre absolutas.

### Paso 1 — Abre una sesión de Claude Code

Puede ser en la carpeta de tu proyecto, en la de este repo, o en cualquier otra: el
workflow no depende de dónde esté corriendo tu sesión de Claude Code, siempre que le
des rutas absolutas al plan y al repo destino.

### Paso 2 — Pídeselo a Claude Code en español, con lenguaje natural

**No hace falta escribir el JSON de `args` a mano.** Eso es trabajo de Claude Code: tú
le cuentas qué quieres en una frase, con estos datos:

- la ruta de tu plan (`planPath`),
- la ruta de tu proyecto destino (`repoPath`),
- el nombre de la rama de integración (`integrationBranch`) — una rama feature efímera
  creada desde `develop`, **nunca** `develop`/`main` directamente (ver la topología
  recomendada más abajo),
- si quieres que al final pushee y abra el PR (`openPr`) y contra qué rama (`pr.base`),
- **tu autorización explícita para los merges**, nombrando las ramas — esto es
  importante, ver el recuadro de abajo.

Ejemplo real (parecido a lo que se usó para escribir este mismo fix):

> "Lanza el workflow parallel-plan-executor sobre mi proyecto en `D:/mi-proyecto`. El
> plan está en `docs/plans/2026-07-16-mi-feature.md`, ya aprobado. Integration branch:
> `feature/mi-feature`. Al final, haz push y crea el PR contra `develop`. Autorizo
> mergear las ramas task-1 a task-6."

Claude Code se encarga de correr `bin/parse-plan.js` sobre tu plan, armar los `args`, e
invocar la tool `Workflow` con el script de este repo — tú no tocas JSON en ningún
momento.

> **¿Por qué nombrar las ramas en tu autorización?** Si el entorno tiene el clasificador
> de permisos de Claude Code en modo automático, puede exigir que un humano autorice
> explícitamente los merges — y esa autorización necesita nombrar la acción concreta
> ("mergear task-1 a task-6"), no un simple "sí" u "ok". Decirlo de entrada, con las
> ramas nombradas, evita que el run se trabe a mitad de camino. Ver la nota de permisos
> más abajo para el detalle técnico.

### Paso 3 — Qué vas a ver mientras corre

El workflow corre en segundo plano — no se queda esperando tu respuesta. Vas a ver:

- Una barra de progreso de texto tipo `[####----] 2/6 tasks settled` cada vez que una
  tarea termina (mergeada, fallida o saltada).
- Un aviso `Task N: started (implement)` apenas arranca cada tarea, para que sepas que
  no se colgó durante los minutos que tarda la implementación.

Puedes preguntarle a Claude Code *"¿cómo va el workflow?"* en cualquier momento — va a
revisar el estado real y contarte qué tareas terminaron, cuáles están en curso y si hubo
algún problema. También puedes abrir el panel `/workflows` de Claude Code para ver el
detalle por fase (Implement, Review, Merge, Final review, Handoff), cuántos agentes y
tokens llevó cada una, y el tiempo de cada agente.

### Paso 4 — Si algo se traba

Lo más común es que un merge quede marcado como bloqueado por precaución, **incluso
habiendo autorizado de entrada** — es una medida de seguridad del entorno, no un error
de tu plan. Si eso pasa:

1. Pregúntale a Claude Code qué pasó (va a poder explicarte la causa concreta).
2. Repite tu autorización nombrando las ramas específicas que faltan ("autorizo mergear
   task-2 y task-3") y pídele que reintente.
3. El run es recuperable: nada de lo ya hecho se pierde. Las tareas que ya terminaron
   (implementadas, revisadas, mergeadas) no se vuelven a correr — solo se reintenta lo
   que quedó pendiente.

### Paso 5 — Cuando termina

- Si **al menos una tarea se integró**, vas a tener un archivo
  `.cys/handoff.md` en tu proyecto con: el título y cuerpo de PR sugeridos,
  la versión SemVer propuesta, y un checklist de limpieza (qué ramas `task-N` borrar y
  cuándo).
- Si pediste `openPr: true`, el PR **ya va a estar creado** en GitHub contra la rama que
  indicaste — revísalo tú y haz el merge cuando estés conforme. El workflow nunca mergea
  el PR por su cuenta; esa decisión siempre queda en tus manos.
- Si alguna tarea falló o quedó bloqueada, el reporte final te va a decir exactamente
  cuál y por qué — y cuáles otras tareas se saltearon en cascada por depender de ella.

### Errores comunes

| Lo que ves | Qué significa |
|---|---|
| `args.tasks must be a non-empty array` | El plan no tiene tareas parseables, o el parseo del plan no se hizo bien. Revisa que tu plan tenga bloques `### Task N:` con `Consumes`/`Produces`. |
| Un merge queda `CONFLICT` sin conflicto real de git | Casi siempre es el clasificador de permisos pidiendo autorización explícita — ver Paso 4. |
| El run se corta a mitad de camino | Es recuperable: Claude Code puede retomarlo sin perder el trabajo ya hecho. |
| El agente tarda varios minutos "sin hacer nada" al arrancar la primera tarea | Es normal — el primer `implement` incluye instalar/preparar el entorno del proyecto; vas a ver el aviso de progreso apenas termina. |

## Uso

```bash
# 1. Calcula el grafo de tareas para tu plan
#    (la salida por stdout es JSON puro; los warnings de ambigüedad — p. ej. dos tareas
#    que declaran el mismo símbolo en Produces — van a stderr y también quedan en el
#    campo "warnings" del JSON)
node bin/parse-plan.js /ruta/a/tu-plan.md > /tmp/plan-graph.json

# 2. Pídele a Claude Code que invoque la tool Workflow con:
#    scriptPath: "<este-repo>/workflows/parallel-plan-executor.js"
#    args: { tasks: <el campo "tasks" de plan-graph.json>,
#            graph: <el campo "graph" de plan-graph.json>,
#            planPath: "/ruta/a/tu-plan.md",
#            repoPath: "/ruta/a/tu/proyecto",
#            integrationBranch: "feature/mi-plan",  # rama a la que se mergea cada tarea (obligatorio)
#            executorPath: "<este-repo>",           # ruta absoluta de este clon: el workflow
#                                                   # corre sus scripts bin/ por ruta exacta (obligatorio)
#            openPr: true,                          # opcional: pushear y abrir el PR al final
#            pr: { base: "develop", assignees: ["yo"], labels: ["story"],
#                  milestone: "v1.2", closes: 42 },  # campos opcionales del PR (contrato git-flow)
#            mergeAuthorization: "Autorizo mergear las ramas task-1 a task-N contra <rama>"
#            }  # opcional pero recomendado: tu autorización explícita, para que el agente
#               # de merge no tenga que adivinar si ya diste consentimiento (ver nota de
#               # permisos más abajo)
```

## Opcional: el comando `/run-plan`

Si prefieres no escribir la solicitud en lenguaje natural de la guía paso a paso cada vez,
este repo trae un comando personalizado de Claude Code que la envuelve:
`commands/run-plan.md`.

### Cómo instalarlo

1. Copia `commands/run-plan.md` de este repo a alguna de estas dos ubicaciones:
   - `~/.claude/commands/run-plan.md` — disponible en **todos** tus proyectos en esta
     máquina, o
   - `<tu-proyecto>/.claude/commands/run-plan.md` — disponible solo dentro de ese
     proyecto puntual.

   Para la mayoría de los casos conviene la global (`~/.claude/commands/`), porque esta
   herramienta está pensada para invocarse contra otros proyectos, no solo el que la
   contiene.

2. Abre el archivo copiado y reemplaza el placeholder `REPO = ...` cerca del comienzo por
   la ruta absoluta donde clonaste **este** repo (`parallel-plan-executor`), por ejemplo
   `REPO = /home/tu-usuario/parallel-plan-executor`. Es lo único que hay que editar — el
   comando no tiene otra forma de encontrar el script del workflow.

3. Listo — no hace falta reiniciar nada. Claude Code toma los comandos bajo
   `.claude/commands/` la próxima vez que los uses.

### Cómo usarlo

```
/run-plan /ruta/a/tu-plan.md /ruta/a/tu/proyecto feature/mi-plan
```

Los tres argumentos son opcionales de escribir de entrada — el comando te va a preguntar
lo que falte, más lo que la sección "Uso" de arriba lista como opcional (`openPr`,
campos de `pr`, tu autorización de merge). Nunca inventa tu texto de autorización por su
cuenta; siempre te pide que nombres tú las ramas.

## Fase de Handoff (v0.5.0)

Cuando al menos una tarea se integró, un agente final de **handoff** prepara el cierre
estilo git-flow — sin ejecutarlo. Escribe `.cys/handoff.md` en el repo
destino con: un título de PR sugerido en formato Conventional Commit, un body de PR
completo (Summary / Type of change / Main changes / Version / Checklist), el bump de
SemVer propuesto según los commits de la corrida (reglas de git-flow, incluido `0.x`), el
veredicto de la revisión final, y un checklist de limpieza posterior.

Con **`openPr: true`** (consentimiento explícito dado al lanzar) además pushea la rama
de integración y **crea** el pull request vía `gh` contra `pr.base` (por defecto
`develop`), aplicando los campos opcionales de `pr` — assignees, labels, milestone, y
`Closes #<closes>` en el body. **Nunca mergea el PR**: esa puerta siempre es humana.

## Topología de ramas recomendada (validada en el piloto 4)

Apunta `integrationBranch` a una **rama feature efímera creada desde `develop`** — nunca
directamente a `develop`/`main`:

```
main (release)                   ← nunca la tocan los agentes
  └── develop (integración)      ← nunca la tocan los agentes
        └── feature/<plan>       ← integrationBranch: acá mergean las ramas de tarea ★
              ├── task-1         ← un worktree aislado por implementador
              └── task-N
```

Por qué: la rama principal queda protegida por construcción (código escrito por agentes
nunca aterriza en una rama compartida sin revisión humana), una corrida fallida cuesta un
solo `git branch -D`, y la puerta humana queda exactamente donde debe estar — el único PR
`feature/<plan> → develop` que abres tú con la skill `git-flow` una vez que revisaste la
rama terminada.

**Nota sobre permisos (lee esto si un merge se bloquea)**: bajo el modo automático de
Claude Code, un clasificador automático juzga cada acción de agente por su cuenta, y un
`git merge` ejecutado por un agente es exactamente el patrón que vigila. Pasar tu
autorización textual vía `args.mergeAuthorization` ayuda a que el *propio agente de
merge* no se autobloquee por precaución (hallazgo F8 en
`docs/pilots/2026-07-15-pilot-stats-bitacora.md`) — pero **no** obliga al clasificador:
en una corrida real posterior, el clasificador rechazó explícitamente ese texto relayado
como consentimiento "autoafirmado, no verificable" y bloqueó el merge igual. El fix
determinístico es la **configuración de permisos de una sola vez** al comienzo de este
README: una regla `ask` (o `allow`) para `git merge` en el `.claude/settings.json` del
proyecto destino, agregada por ti. Las reglas tienen precedencia sobre el modo — con la
regla puesta tienes un diálogo simple de yes/no (o allow silencioso) en vez del juicio
del clasificador.

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
  preservan el estado parcial que exista para diagnóstico. Límpialas después con
  `git branch -D task-<id>` cuando ya no las necesites.

## Reportar un bug

Abrí un issue en
[github.com/bacsystem/parallel-plan-executor/issues](https://github.com/bacsystem/parallel-plan-executor/issues)
(la plantilla te va a guiar). Lo más útil que podés adjuntar es algo que
cys ya generó solo — no hace falta armar una repro desde cero:

- `.cys/pending.md`, si la revisión final de la corrida o un `cys:check`
  ya registró un hallazgo sobre esto.
- `.cys/task-<id>-report.md`, de la tarea específica que falló.
- `review-*.diff`, si una revisión marcó algo.
- El stderr/stdout exacto de un comando que falló (ej. `node bin/parse-plan.js`).
