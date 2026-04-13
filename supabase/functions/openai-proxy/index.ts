// OpenAI API Proxy — authenticates user, logs usage, forwards to OpenAI
// Used only for GPT-4o audit step. Deploy: supabase functions deploy openai-proxy
// Secrets: OPENAI_API_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const OPENAI_URL = "https://api.openai.com/v1/chat/completions"

const COST_RATES: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-5.4": { input: 5.0, output: 20.0 },
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
      },
    })
  }

  if (req.method !== "POST") {
    return jsonError("Method not allowed", 405)
  }

  const authHeader = req.headers.get("Authorization") || ""
  const token = authHeader.replace("Bearer ", "")
  if (!token) return jsonError("Missing auth token", 401)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const openaiKey = Deno.env.get("OPENAI_API_KEY")
  if (!openaiKey) return jsonError("Proxy not configured", 500)

  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: { user }, error: authErr } = await userClient.auth.getUser()
  if (authErr || !user) return jsonError("Invalid or expired token", 401)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonError("Invalid JSON body", 400)
  }

  const model = String(body.model || "")

  const openaiRes = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${openaiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!openaiRes.ok) {
    const errBody = await openaiRes.text()
    return new Response(errBody, {
      status: openaiRes.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    })
  }

  const data = await openaiRes.json()
  const usage = data.usage || {}
  const tokensIn = usage.prompt_tokens || 0
  const tokensOut = usage.completion_tokens || 0

  // Log usage
  const adminClient = createClient(supabaseUrl, serviceKey)
  const rates = COST_RATES[model] || { input: 2.5, output: 10.0 }
  const costCents = ((tokensIn * rates.input) / 1_000_000 + (tokensOut * rates.output) / 1_000_000) * 100

  await adminClient.from("builder_usage").insert({
    user_id: user.id,
    model,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cost_cents: costCents,
    endpoint: "openai-proxy",
  })

  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  })
})

function jsonError(msg: string, status: number) {
  return new Response(JSON.stringify({ error: { message: msg } }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  })
}
