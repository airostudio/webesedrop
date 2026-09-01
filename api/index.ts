// Vercel serverless entrypoint. The engine's actual app (src/api/server.ts)
// is a normal Fastify app built for a long-lived process (see src/index.ts,
// `pnpm start`) — this adapts it to Vercel's (req, res) => void function
// signature by handing requests to Fastify's underlying HTTP server
// directly, per Fastify's documented approach for serverless platforms.
// vercel.json rewrites every path here, so req.url still carries the real
// path (e.g. /v1/health) for Fastify's own router to dispatch on.
import type { IncomingMessage, ServerResponse } from "node:http";
import { buildServer } from "../src/api/server";
import { getDb } from "../src/db/client";

let appReady: Promise<ReturnType<typeof buildServer>> | undefined;

function getApp() {
  if (!appReady) {
    const app = buildServer(getDb());
    appReady = Promise.resolve(app.ready()).then(() => app);
  }
  return appReady;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await getApp();
  app.server.emit("request", req, res);
}
