# AetherPlay Games

Published source from [AetherPlay Bench](https://github.com/dairui1/aetherplay-bench).

Each season is released only after its full model matrix closes, preventing later candidates from seeing earlier solutions. Runtime credentials, raw traces, benchmark prompts, manifests, and evaluator output remain outside this repository.

Playable versions are served at [aetherplaybench.dairui1.com](https://aetherplaybench.dairui1.com/).

```text
games/<task-id>/<profile-id>/
  package.json
  src/
  ...candidate-created source and tests
```

The first pilot contains six Signal Drift implementations. Five completed inside the
one-hour generation limit; the `pi-deepseek-v4-flash` directory is the playable build source
left by a run that reached the time limit during its own extended browser tests.
