// Serve published apps by slug — returns the app HTML with correct content-type
// URL: /functions/v1/serve-app?slug=my-app-name
// Deploy: supabase functions deploy serve-app

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    })
  }

  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 })
  }

  const url = new URL(req.url)
  const slug = url.searchParams.get("slug")

  if (!slug) {
    return new Response(
      `<!DOCTYPE html><html><head><title>Builder Apps</title></head>
       <body style="font-family:sans-serif;padding:40px;text-align:center">
       <h1>Builder Apps</h1><p>Provide a <code>?slug=app-name</code> parameter to view an app.</p>
       </body></html>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } }
    )
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const client = createClient(supabaseUrl, serviceKey)

  const { data, error } = await client
    .from("builder_apps")
    .select("code, name")
    .eq("slug", slug)
    .eq("published", true)
    .single()

  if (error || !data || !data.code) {
    return new Response(
      `<!DOCTYPE html><html><head><title>Not Found</title></head>
       <body style="font-family:sans-serif;padding:40px;text-align:center">
       <h1>App Not Found</h1><p>No published app with slug "<strong>${escHtml(slug)}</strong>" was found.</p>
       </body></html>`,
      {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }
    )
  }

  return new Response(data.code, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
      "Access-Control-Allow-Origin": "*",
      "X-App-Name": data.name || "Untitled",
    },
  })
})

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
