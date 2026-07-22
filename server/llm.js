// llm.js — one interface, two providers (OpenAI + Anthropic), plus a mock.
//
// callStructured(): forces a JSON object matching a JSON Schema (v17 verdict).
// callText():       returns free-form text (the Marquee article).
//
// No SDK dependency — uses global fetch (Node >= 20). Provider + model are
// resolved by config.js; every call reports which engine produced it so the
// archive's engine tag stays honest.

import { DEFAULT_MODELS, ENGINE_TAG, keyFor } from "./config.js";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export function engineTag(provider) {
  return ENGINE_TAG[provider] || provider;
}

async function postJSON(url, headers, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${url} -> ${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
  }
  return res.json();
}

// ---- OpenAI ----
async function openaiStructured({ system, user, schema, model, maxTokens }) {
  const data = await postJSON(
    OPENAI_URL,
    { authorization: `Bearer ${keyFor("openai")}` },
    {
      model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "bench_verdict", schema, strict: true }
      }
    }
  );
  return JSON.parse(data.choices[0].message.content);
}

async function openaiText({ system, user, model, maxTokens }) {
  const data = await postJSON(
    OPENAI_URL,
    { authorization: `Bearer ${keyFor("openai")}` },
    {
      model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    }
  );
  return data.choices[0].message.content;
}

// ---- Anthropic ----
async function anthropicStructured({ system, user, schema, model, maxTokens }) {
  const data = await postJSON(
    ANTHROPIC_URL,
    { "x-api-key": keyFor("anthropic"), "anthropic-version": ANTHROPIC_VERSION },
    {
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
      tools: [
        {
          name: "emit_verdict",
          description: "Return the structured v17 verdict.",
          input_schema: schema
        }
      ],
      tool_choice: { type: "tool", name: "emit_verdict" }
    }
  );
  const block = (data.content || []).find((b) => b.type === "tool_use");
  if (!block) throw new Error("anthropic: no tool_use block returned");
  return block.input;
}

async function anthropicText({ system, user, model, maxTokens }) {
  const data = await postJSON(
    ANTHROPIC_URL,
    { "x-api-key": keyFor("anthropic"), "anthropic-version": ANTHROPIC_VERSION },
    {
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }]
    }
  );
  return (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

// ---- Public API ----

// opts: { provider, model?, maxTokens?, mock? }
export async function callStructured({ system, user, schema }, opts) {
  const { provider, model, maxTokens = 4096, mock } = opts;
  if (mock) return mock.structured({ system, user, schema });
  if (!provider) throw new Error("no model provider resolved (set a key or MODEL_PROVIDER)");
  const m = model || DEFAULT_MODELS[provider];
  const args = { system, user, schema, model: m, maxTokens };
  return provider === "openai" ? openaiStructured(args) : anthropicStructured(args);
}

export async function callText({ system, user }, opts) {
  const { provider, model, maxTokens = 2048, mock } = opts;
  if (mock) return mock.text({ system, user });
  if (!provider) throw new Error("no model provider resolved (set a key or MODEL_PROVIDER)");
  const m = model || DEFAULT_MODELS[provider];
  const args = { system, user, model: m, maxTokens };
  return provider === "openai" ? openaiText(args) : anthropicText(args);
}
