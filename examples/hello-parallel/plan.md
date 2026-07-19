# Hello Parallel Implementation Plan

> **For agentic workers:** execute this plan with the
> parallel-plan-executor Workflow (cys:run / the /cys:run-plan command).
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a tiny plan whose own dependency graph demonstrates real
inferred parallelism — Tasks 2 and 3 don't depend on each other, so cys
runs them at the same time.

**Architecture:** Task 1 creates a shared logger; Tasks 2 and 3 each add
one independent module that uses it; Task 4 wires both together.

**Tech Stack:** Node.js (ESM).

## Global Constraints

- Node >= 20.

---

### Task 1: Logger

**Files:**
- Create: `src/logger.js`
- Test: `tests/logger.test.js`

**Interfaces:**
- Consumes: None
- Produces: `log(message)`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { log } from '../src/logger.js';

test('log returns the formatted message', () => {
  assert.equal(log('hi'), '[log] hi');
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `node --test tests/logger.test.js`
Expected: FAIL — `src/logger.js` doesn't exist yet.

- [ ] **Step 3: Write the minimal implementation**

```js
export function log(message) {
  return `[log] ${message}`;
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `node --test tests/logger.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/logger.js tests/logger.test.js
git commit -m "feat: add logger"
```

### Task 2: Greeter

**Files:**
- Create: `src/greeter.js`
- Test: `tests/greeter.test.js`

**Interfaces:**
- Consumes: `log`
- Produces: `greet(name)`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greet } from '../src/greeter.js';

test('greet returns a greeting', () => {
  assert.equal(greet('Ada'), 'Hello, Ada!');
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `node --test tests/greeter.test.js`
Expected: FAIL — `src/greeter.js` doesn't exist yet.

- [ ] **Step 3: Write the minimal implementation**

```js
export function greet(name) {
  return `Hello, ${name}!`;
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `node --test tests/greeter.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/greeter.js tests/greeter.test.js
git commit -m "feat: add greeter"
```

### Task 3: Farewell

**Files:**
- Create: `src/farewell.js`
- Test: `tests/farewell.test.js`

**Interfaces:**
- Consumes: `log`
- Produces: `farewell(name)`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { farewell } from '../src/farewell.js';

test('farewell returns a goodbye', () => {
  assert.equal(farewell('Ada'), 'Goodbye, Ada!');
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `node --test tests/farewell.test.js`
Expected: FAIL — `src/farewell.js` doesn't exist yet.

- [ ] **Step 3: Write the minimal implementation**

```js
export function farewell(name) {
  return `Goodbye, ${name}!`;
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `node --test tests/farewell.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/farewell.js tests/farewell.test.js
git commit -m "feat: add farewell"
```

### Task 4: Session (uses both greeter and farewell)

**Files:**
- Create: `src/session.js`
- Test: `tests/session.test.js`

**Interfaces:**
- Consumes: `greet`, `farewell`
- Produces: `session(name)`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { session } from '../src/session.js';

test('session greets then says farewell', () => {
  assert.deepEqual(session('Ada'), ['Hello, Ada!', 'Goodbye, Ada!']);
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `node --test tests/session.test.js`
Expected: FAIL — `src/session.js` doesn't exist yet.

- [ ] **Step 3: Write the minimal implementation**

```js
import { greet } from './greeter.js';
import { farewell } from './farewell.js';

export function session(name) {
  return [greet(name), farewell(name)];
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `node --test tests/session.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/session.js tests/session.test.js
git commit -m "feat: add session"
```
