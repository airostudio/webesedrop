import { NextResponse } from "next/server";
import { z } from "zod";
import { connectAliExpressApp, exchangeAuthorizationCode, getAuthorizeUrl } from "@/lib/dropshipEngine";

export const runtime = "nodejs";

/**
 * Proxies the one-time AliExpress OAuth bootstrap to the dropship-engine
 * (see /dropship-engine's README) — Beach Footprints' own admin password
 * gates this route, and DROPSHIP_ENGINE_API_KEY (never the AliExpress app
 * credentials themselves) is the only secret this app holds for it.
 *
 * PUT  /api/admin/aliexpress/auth { appKey, appSecret }
 *   -> registers this store's AliExpress Open Platform app with the engine.
 * GET  /api/admin/aliexpress/auth?redirectUri=<callback>
 *   -> { authorizeUrl } — visit it, log in, approve.
 * POST /api/admin/aliexpress/auth { code, redirectUri }
 *   -> { connected: true } once the engine has exchanged the code.
 */
const connectSchema = z.object({ appKey: z.string().min(1), appSecret: z.string().min(1) });

export async function PUT(request: Request) {
  const parsed = connectSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    return NextResponse.json(await connectAliExpressApp(parsed.data));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save AliExpress app credentials" }, { status: 502 });
  }
}

export async function GET(request: Request) {
  const redirectUri = new URL(request.url).searchParams.get("redirectUri");
  if (!redirectUri) return NextResponse.json({ error: "Missing redirectUri query param" }, { status: 400 });

  try {
    return NextResponse.json(await getAuthorizeUrl(redirectUri));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not build authorize URL" }, { status: 502 });
  }
}

const callbackSchema = z.object({ code: z.string().min(1), redirectUri: z.string().min(1) });

export async function POST(request: Request) {
  const parsed = callbackSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    return NextResponse.json(await exchangeAuthorizationCode(parsed.data));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "AliExpress token exchange failed" }, { status: 502 });
  }
}
