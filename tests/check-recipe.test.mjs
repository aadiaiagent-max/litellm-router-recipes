import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkRecipe, parseYaml } from "../src/check-recipe.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const recipesDir = join(root, "recipes");

const shipped = [
  "fallback-chain.yaml",
  "rpm-cooldown.yaml",
  "cache-and-budget.yaml",
  "latency-routing.yaml",
];

function load(name) {
  return parseYaml(readFileSync(join(recipesDir, name), "utf8"));
}

test("shipped recipes pass the checker", () => {
  const onDisk = readdirSync(recipesDir).filter((name) => name.endsWith(".yaml")).sort();
  assert.deepEqual(onDisk, [...shipped].sort());
  for (const name of shipped) {
    const result = checkRecipe(load(name));
    assert.equal(result.ok, true, `${name}: ${result.errors.join("; ")}`);
  }
});

test("fallback recipe points chat at chat-backup", () => {
  const doc = load("fallback-chain.yaml");
  assert.equal(doc.router_settings.fallbacks[0].chat[0], "chat-backup");
  assert.equal(doc.model_list[0].litellm_params.api_key, "os.environ/OPENAI_API_KEY");
});

test("cooldown recipe keeps rpm and cooldown_time", () => {
  const doc = load("rpm-cooldown.yaml");
  assert.equal(doc.router_settings.cooldown_time, 60);
  assert.equal(doc.router_settings.allowed_fails, 2);
  assert.equal(doc.model_list[1].litellm_params.rpm, 30);
});

test("budget recipe uses documented cache and max_budget keys", () => {
  const doc = load("cache-and-budget.yaml");
  assert.equal(doc.litellm_settings.cache, true);
  assert.equal(doc.litellm_settings.cache_params.type, "redis");
  assert.equal(doc.litellm_settings.max_budget, 25);
  assert.equal(doc.litellm_settings.budget_duration, "1d");
});

test("missing litellm_params.model is rejected", () => {
  const doc = parseYaml(`
model_list:
  - model_name: chat
    litellm_params:
      api_key: os.environ/OPENAI_API_KEY
`);
  const result = checkRecipe(doc);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("litellm_params.model")));
});

test("missing model_name is rejected", () => {
  const doc = parseYaml(`
model_list:
  - litellm_params:
      model: openai/gpt-4o-mini
`);
  const result = checkRecipe(doc);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("model_name")));
});

test("unknown top-level keys are rejected", () => {
  const doc = parseYaml(`
model_list:
  - model_name: chat
    litellm_params:
      model: openai/gpt-4o-mini
not_a_real_section: 1
`);
  const result = checkRecipe(doc);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("unknown top-level key: not_a_real_section")));
});

test("latency recipe sets latency-based-routing", () => {
  const doc = load("latency-routing.yaml");
  assert.equal(doc.router_settings.routing_strategy, "latency-based-routing");
  assert.equal(doc.model_list.length, 2);
  assert.equal(checkRecipe(doc).ok, true);
  assert.equal(doc.model_list[1].litellm_params.api_key, "os.environ/GROQ_API_KEY");
});
