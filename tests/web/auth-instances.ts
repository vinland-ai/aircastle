import process from "node:process";
import { randomUUID } from "node:crypto";
import { createServer, request, type IncomingMessage, type ServerResponse } from "node:http";
import { open } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { preview, type PreviewServer } from "vite";
import { startAuthProcess, type AuthProcess } from "@aircastle/api/testing/auth-process";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const webRoot = path.join(repository, "apps/web");
const port = Number(process.env.AUTH_INSTANCES_PORT);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("AUTH_INSTANCES_PORT must be an integer from 1024 to 65535");

type Instance = {
  child: AuthProcess;
  server: PreviewServer;
  log: Awaited<ReturnType<typeof open>>;
};
const instances = new Map<string, Instance>();

function closePreview(server: PreviewServer) {
  return new Promise<void>((resolve, reject) => {
    server.httpServer.close((error) => (error ? reject(error) : resolve()));
    if ("closeAllConnections" in server.httpServer) server.httpServer.closeAllConnections();
  });
}

async function stopInstance(instance: Instance) {
  try {
    await instance.child.close();
  } finally {
    await instance.log.close();
    await closePreview(instance.server);
  }
}

async function startInstance(input: {
  namespace: string;
  log: string;
  environment: Record<string, string>;
}) {
  let apiOrigin: string | undefined;
  const server = await preview({
    root: webRoot,
    configFile: path.join(webRoot, "vite.config.ts"),
    build: { outDir: path.join(webRoot, "reports/build/normal") },
    preview: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "owned-auth-api",
        configurePreviewServer(previewServer) {
          previewServer.middlewares.use((incoming, outgoing, next) => {
            if (!/^\/api(?:\/|$)/.test(incoming.url ?? "")) return next();
            if (!apiOrigin) {
              outgoing.writeHead(503);
              outgoing.end();
              return;
            }
            const proxied = request(
              new URL(incoming.url ?? "/", apiOrigin),
              { method: incoming.method, headers: incoming.headers },
              (response) => {
                outgoing.writeHead(response.statusCode ?? 502, response.headers);
                response.pipe(outgoing);
              },
            );
            proxied.on("error", () => {
              outgoing.writeHead(502);
              outgoing.end();
            });
            incoming.pipe(proxied);
          });
        },
      },
    ],
  });
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Auth instance has no TCP port");
  const origin = `http://127.0.0.1:${address.port}`;
  const log = await open(input.log, "w");
  let child: AuthProcess;
  try {
    const url = process.env.AIRCASTLE_DATABASE_URL;
    if (!url)
      throw new Error(
        "Auth instances need AIRCASTLE_DATABASE_URL; run them through vp run db:test",
      );
    child = await startAuthProcess({
      database: { url, namespace: input.namespace },
      browserOrigin: origin,
      now: Date.now(),
      environment: input.environment,
      output: log.fd,
      deadlines: { ready: 20_000, reply: 5_000, close: 10_000 },
    });
  } catch (error) {
    try {
      await log.close();
    } finally {
      await closePreview(server);
    }
    throw error;
  }
  apiOrigin = child.origin;
  const instance = { child, server, log };
  const id = randomUUID();
  instances.set(id, instance);
  return { id, origin, apiOrigin };
}

async function body(incoming: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function reply(outgoing: ServerResponse, status: number, value: unknown) {
  outgoing.writeHead(status, { "content-type": "application/json" });
  outgoing.end(JSON.stringify(value));
}

function startInput(value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    !("namespace" in value) ||
    typeof value.namespace !== "string" ||
    !("log" in value) ||
    typeof value.log !== "string" ||
    !("environment" in value) ||
    !value.environment ||
    typeof value.environment !== "object" ||
    !Object.values(value.environment).every((entry) => typeof entry === "string")
  )
    return undefined;
  return {
    namespace: value.namespace,
    log: value.log,
    environment: value.environment as Record<string, string>,
  };
}

const controller = createServer(async (incoming, outgoing) => {
  const url = new URL(incoming.url ?? "/", `http://127.0.0.1:${port}`);
  const instanceId = /^\/instances\/([^/]+)/.exec(url.pathname)?.[1];
  try {
    if (incoming.method === "GET" && url.pathname === "/health")
      return reply(outgoing, 200, { status: "ok" });
    if (incoming.method === "POST" && url.pathname === "/instances") {
      const input = startInput(await body(incoming));
      if (!input) return reply(outgoing, 400, { error: "invalid instance request" });
      return reply(outgoing, 200, await startInstance(input));
    }
    const instance = instanceId ? instances.get(instanceId) : undefined;
    if (!instanceId || !instance) return reply(outgoing, 404, { error: "unknown instance" });
    if (incoming.method === "POST" && url.pathname.endsWith("/advance")) {
      const input = await body(incoming);
      const milliseconds =
        input && typeof input === "object" && "milliseconds" in input
          ? input.milliseconds
          : undefined;
      if (typeof milliseconds !== "number")
        return reply(outgoing, 400, { error: "milliseconds required" });
      await instance.child.advance(milliseconds);
      return reply(outgoing, 200, {});
    }
    if (incoming.method === "DELETE") {
      instances.delete(instanceId);
      await stopInstance(instance);
      return reply(outgoing, 200, {});
    }
    return reply(outgoing, 404, { error: "unknown operation" });
  } catch (error) {
    return reply(outgoing, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

const shutdown = () => {
  controller.close();
  void Promise.allSettled([...instances.values()].map(stopInstance)).then(() => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
controller.listen(port, "127.0.0.1");
