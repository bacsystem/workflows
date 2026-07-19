export async function runDag(graph, taskFn, options = {}) {
  const { maxConcurrency = Infinity } = options;
  const results = new Map();
  const started = new Map();

  let available = maxConcurrency;
  const waiters = [];
  const acquire = () => (available > 0
    ? (available--, Promise.resolve())
    : new Promise((resolve) => waiters.push(resolve)));
  const release = () => {
    const next = waiters.shift();
    if (next) next();
    else available++;
  };

  function run(taskId) {
    if (started.has(taskId)) return started.get(taskId);

    const promise = (async () => {
      const deps = graph[taskId] ?? [];
      const depOutcomes = await Promise.allSettled(deps.map(run));
      const blockedIndex = depOutcomes.findIndex((outcome) => outcome.status === 'rejected');
      if (blockedIndex !== -1) {
        const blockedBy = deps[blockedIndex];
        // El bloqueador pudo haber fallado él mismo o haber sido skipped por su propia
        // dependencia; el motivo distingue ambos casos y propaga la causa raíz original,
        // no el eslabón intermedio de la cascada.
        const blocker = results.get(blockedBy);
        const rootCauseId = blocker?.status === 'skipped' ? blocker.rootCauseId : blockedBy;
        const reason = blocker?.status === 'skipped'
          ? `blocked by a skipped dependency (task ${blockedBy}); root cause: task ${rootCauseId} failed`
          : `blocked by a failed dependency (task ${blockedBy})`;
        results.set(taskId, { status: 'skipped', reason, rootCauseId });
        throw new Error(`task ${taskId} skipped: ${reason}`);
      }

      // El slot de concurrencia se toma acá, después de resolver dependencias — nunca
      // alrededor del await de arriba. Gatear la espera de dependencias dejaría una tarea
      // bloqueada ocupando un slot que sus propias dependencias podrían necesitar: deadlock.
      await acquire();
      try {
        const result = await taskFn(taskId);
        results.set(taskId, { status: 'done', result });
      } catch (error) {
        results.set(taskId, { status: 'failed', error });
        throw error;
      } finally {
        release();
      }
    })();

    started.set(taskId, promise);
    return promise;
  }

  const allIds = Object.keys(graph).map(Number);
  await Promise.allSettled(allIds.map(run));
  return results;
}
