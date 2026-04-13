// Claude API Proxy — authenticates user, rate-limits, streams response, logs usage
// Deploy: supabase functions deploy claude-proxy
// Secrets: ANTHROPIC_API_KEY, SUPABASE_SERVICE_ROLE_KEY (auto-available)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
const DAILY_TOKEN_LIMIT = 1_000_000 // 1M tokens/day free tier

// Cost rates per 1M tokens (USD)
const COST_RATES: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4.0 },
}

Deno.serve(async (req: Request) => {
  // CORS preflight
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

  // ---- Authenticate ----
  const authHeader = req.headers.get("Authorization") || ""
  const token = authHeader.replace("Bearer ", "")
  if (!token) return jsonError("Missing auth token", 401)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")
  if (!anthropicKey) return jsonError("Proxy not configured", 500)

  // Verify the JWT and get user
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: { user }, error: authErr } = await userClient.auth.getUser()
  if (authErr || !user) return jsonError("Invalid or expired token", 401)

  // ---- Rate limit check ----
  const adminClient = createClient(supabaseUrl, serviceKey)
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const { data: usageRows } = await adminClient
    .from("builder_usage")
    .select("tokens_in, tokens_out")
    .eq("user_id", user.id)
    .gte("created_at", todayStart.toISOString())

  const todayTokens = (usageRows || []).reduce(
    (sum: number, r: { tokens_in: number; tokens_out: number }) => sum + r.tokens_in + r.tokens_out,
    0
  )
  if (todayTokens >= DAILY_TOKEN_LIMIT) {
    return jsonError("Daily token limit reached. Upgrade for more usage.", 429)
  }

  // ---- Validate request body ----
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonError("Invalid JSON body", 400)
  }

  const model = String(body.model || "")
  if (!model.startsWith("claude-")) {
    return jsonError("Invalid model", 400)
  }

  const isStreaming = body.stream === true

  // ---- Forward to Anthropic ----
  const anthropicHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": anthropicKey,
    "anthropic-version": "2023-06-01",
  }
  // Forward beta headers if present
  const beta = body["anthropic-beta"] as string | undefined
  if (beta) {
    anthropicHeaders["anthropic-beta"] = beta
    delete body["anthropic-beta"]
  } else {
    anthropicHeaders["anthropic-beta"] = "prompt-caching-2024-07-31"
  }

  const anthropicRes = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: anthropicHeaders,
    body: JSON.stringify(body),
  })

  if (!anthropicRes.ok) {
    const errBody = await anthropicRes.text()
    return new Response(errBody, {
      status: anthropicRes.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    })
  }

  if (isStreaming) {
    // Stream SSE response back, capture usage from final events
    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const encoder = new TextEncoder()
    let streamUsage = { input_tokens: 0, output_tokens: 0 }

    // Process stream in background
    ;(async () => {
      const reader = anthropicRes.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value, { stream: true })
          buffer += chunk

          // Forward the raw chunk to the client
          await writer.write(encoder.encode(chunk))

          // Parse SSE lines to extract usage
          const lines = buffer.split("\n")
          buffer = lines.pop() || ""
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue
            const data = line.substring(6)
            if (data === "[DONE]") continue
            try {
              const evt = JSON.parse(data)
              if (evt.type === "message_start" && evt.message?.usage) {
                streamUsage.input_tokens = evt.message.usage.input_tokens || 0
              }
              if (evt.type === "message_delta" && evt.usage) {
                streamUsage.output_tokens += evt.usage.output_tokens || 0
              }
            } catch { /* parse errors are fine for partial lines */ }
          }
        }
      } finally {
        writer.close()
        // Log usage after stream completes
        _logUsage(adminClient, user.id, model, streamUsage.input_tokens, streamUsage.output_tokens)
      }
    })()

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      },
    })
  } else {
    // Non-streaming: parse response, log usage, forward
    const data = await anthropicRes.json()
    const usage = data.usage || {}
    _logUsage(adminClient, user.id, model, usage.input_tokens || 0, usage.output_tokens || 0)

    return new Response(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    })
  }
})

async function _logUsage(
  client: ReturnType<typeof createClient>,
  userId: string,
  model: string,
  tokensIn: number,
  tokensOut: number
) {
  const rates = COST_RATES[model] || { input: 3.0, output: 15.0 }
  const costCents = ((tokensIn * rates.input) / 1_000_000 + (tokensOut * rates.output) / 1_000_000) * 100

  await client.from("builder_usage").insert({
    user_id: userId,
    model,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cost_cents: costCents,
    endpoint: "claude-proxy",
  })
}

function jsonError(msg: string, status: number) {
  return new Response(JSON.stringify({ error: { message: msg } }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  })
}
