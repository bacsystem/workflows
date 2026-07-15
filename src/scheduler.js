export async function runDag(graph, taskFn) {
  const results = new Map();
  const started = new Map();

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

      try {
        const result = await taskFn(taskId);
        results.set(taskId, { status: 'done', result });
      } catch (error) {
        results.set(taskId, { status: 'failed', error });
        throw error;
      }
    })();

    started.set(taskId, promise);
    return promise;
  }

  const allIds = Object.keys(graph).map(Number);
  await Promise.allSettled(allIds.map(run));
  return results;
}
