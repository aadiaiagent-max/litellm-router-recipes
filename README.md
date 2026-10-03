# litellm-router-recipes

Example proxy configs for [LiteLLM](https://github.com/BerriAI/litellm) (BerriAI/litellm). Not a fork. No LiteLLM source in this repo, just short YAML and a checker.

The proxy config is the usual four sections: `model_list`, `router_settings`, `litellm_settings`, `general_settings`. Field reference: https://docs.litellm.ai/docs/proxy/configs

Secrets are written as `os.environ/OPENAI_API_KEY`. That is LiteLLM's placeholder for `os.getenv`. Nothing here is a real key.

## Recipes

- `recipes/fallback-chain.yaml` — alias `chat`, plus `router_settings.fallbacks` onto `chat-backup`
- `recipes/rpm-cooldown.yaml` — `rpm` on each deployment, `allowed_fails` and `cooldown_time` (seconds)
- `recipes/cache-and-budget.yaml` — `cache` / `cache_params`, and a proxy-wide `max_budget` with `budget_duration`

`max_budget` only blocks spend when the proxy has a database. With no database it fails open. Notes: https://docs.litellm.ai/docs/proxy/users

```bash
node src/check-recipe.mjs recipes/*.yaml
node --test
```

The checker requires `model_name` and `litellm_params.model` on every deployment, and rejects top-level keys other than the four sections above.

To try one, point the proxy at the file (`litellm --config recipes/fallback-chain.yaml`). This repo does not install or vendor the proxy.
