# Scenario Configurator

The Scenario Configurator turns a short natural-language brief into a fully specified AI Town scenario. It ships with a frontend UI, Convex backend actions, a schema contract, and a mapping pipeline that loads a new town in a single flow.

```
+-----------------+       +-------------------------+       +-------------------+
| Scenario Brief  | ----> | Convex generateScenario | ----> | Scenario JSON     |
+-----------------+       +-------------------------+       +---------+---------+
                                                                    |
                                                                    v
                                                         +----------------------+
                                                         | validateScenario     |
                                                         | + repair fallback    |
                                                         +----------+-----------+
                                                                    |
                                                       +------------v-------------+
                                                       | applyScenarioInternal    |
                                                       |  • resetWorld            |
                                                       |  • asset pipeline       |
                                                       |  • scenario snapshots   |
                                                       +------------+-------------+
                                                                    |
                                         +--------------------------v--------------------------+
                                         | AI Town tables (worlds, maps, descriptions, memory) |
                                         +-----------------------------------------------------+
```

The configurator also supports exporting/importing scenarios and optional asset generation. Tests cover schema behaviour, the mapping adapter, and an end-to-end Convex application of a scenario with placeholder sprites.

---

## Environment Variables

Copy `.env.example` to `.env` and adjust as needed.

- `OPENAI_API_KEY` – API key for any OpenAI-compatible endpoint.
- `OPENAI_BASE_URL` – Base URL override (Together, Ollama proxy, etc.). Defaults to `https://api.openai.com/v1`.
- `OPENAI_CHAT_MODEL` – Chat model name (`gpt-4o-mini` by default).
- `OPENAI_EMBEDDING_MODEL` – Embedding model (`text-embedding-3-small` by default).
- `ASSET_PROVIDER` – `none` | `placeholder` | `replicate` | `fal`. Defaults to `placeholder`.
- `MODERATION_ENABLED` – `true` (default) or `false` to bypass the moderation gate.
- Optional provider keys:
  - `REPLICATE_API_TOKEN` for the Replicate stub.
  - `FAL_KEY` for the FAL.ai stub.

The Convex runtime reads these values; restart `convex dev` after changing them.

---

## Quickstart

```bash
pnpm install
npx convex dev
pnpm dev
# Open http://localhost:5173/configurator
```

1. Fill in the **Scenario Brief** form.
2. Click **Generate Scenario** – the LLM produces canonical JSON.
3. Review / edit the JSON in the Monaco-powered editor (with schema validation).
4. Click **Apply & Run** to reset the world, apply the scenario, and launch the town.

Use the **Developer Console** to inspect structured logs (moderation decisions, token usage, repair steps, asset warnings).

---

## LLM Vendors & Moderation

The Convex action `generateScenario` targets any OpenAI-compatible endpoint. Provide `OPENAI_BASE_URL` to switch to Together or a local proxy. The UI exposes advanced options for temperature, `top_p`, seed, and model name so deterministic runs are easy. Moderation is enabled by default via a lightweight JSON classifier; toggle it off from the UI (or set `MODERATION_ENABLED=false`) for research environments.

---

## Asset Providers

The asset pipeline lives in `src/configurator/assets/`.

- `ASSET_PROVIDER=placeholder` (default) generates deterministic 24×24 PNG data URLs with unique colours per agent. Generated refs are stored in the scenario snapshot and reported back to the UI.
- `ASSET_PROVIDER=none` leaves sprites untouched.
- `ASSET_PROVIDER=replicate` / `fal` currently provide graceful fallbacks and log TODO warnings if the respective API keys are missing.

Adjust or extend `applyAssetPipeline` to plug in additional providers.

---

## Export / Import & Snapshots

- **Export**: pulls the latest configurator snapshot; if none exists, it synthesises a best-effort scenario from the current world.
- **Import**: validates (and repairs when possible) uploaded JSON before applying it via the same pipeline.
- Snapshots (including asset refs) live in the `configuratorScenarioSnapshots` table. Re-applying the same scenario automatically versions names (`Scenario-v2`, etc.).

---

## Adapting to Schema or Table Changes

The adapter in `src/configurator/mapping/aiTownAdapter.ts` centralises table assumptions. If AI Town renames tables or introduces new fields, update the adapter and (optionally) `applyScenarioInternal` to reflect the changes. Tests in `tests/` assert referential integrity—extend them when the storage model evolves.

Known limitations:

- Schedule and activity data are stored in the scenario snapshot but not yet consumed by the live simulation loop.
- The Replicate and FAL asset providers are stubs; extend `applyAssetPipeline` to call real services once credentials are available.
- Monaco Editor loads from a CDN; offline environments automatically fall back to a textarea editor.

---

Happy town building!
