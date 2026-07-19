# Example: seeing real inferred parallelism in 5 minutes

This is the smallest plan that still shows cys's actual differentiator —
not a description of parallel execution, something you can parse and
read yourself right now.

1. From this repo's root, run:

   ```
   node bin/parse-plan.js examples/hello-parallel/plan.md
   ```

2. Look at the printed `graph`. You'll see:

   ```json
   { "1": [], "2": [1], "3": [1], "4": [2, 3] }
   ```

3. Task 2 (`Greeter`) and Task 3 (`Farewell`) both depend on Task 1
   (`Logger`) — but **not on each other**. That missing edge between 2
   and 3 is the whole point: `cys:run` sees no dependency between them
   and executes both at the same time, each in its own git worktree,
   instead of one after the other just because they're listed in order.
   Task 4 (`Session`) then waits for both.

4. To actually run this plan in parallel (not just read its graph), point
   `cys:run` / `/cys:run-plan` at `examples/hello-parallel/plan.md`
   against a throwaway git repo of your own — see the main
   [README](../README.md#using-cys) for the full launch steps.
