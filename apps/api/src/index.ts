import pino from "pino";
import { assemble, resourceStack, startWith } from "./assemble.ts";
import { readAuthConfig, readConfig, readDatabaseConfig } from "./config.ts";
import { scalarScript } from "./docs-script.ts" with { type: "macro" };
import { createStaticHandler } from "./static.ts";

const config = readConfig();
const authConfig = readAuthConfig();
const logger = pino({ level: config.AIRCASTLE_LOG_LEVEL });
const databaseOptions = readDatabaseConfig();
const resources = resourceStack();

await startWith(resources, async () => {
  const { app } = await assemble(
    {
      auth: authConfig,
      database: databaseOptions,
      logger,
      maxRequestBytes: config.AIRCASTLE_MAX_REQUEST_BYTES,
      docsScript: scalarScript(),
    },
    resources,
  );
  const serveStatic = createStaticHandler({
    root: new URL("../../web/dist/", import.meta.url),
    localAuthEnabled: authConfig.mode === "development",
  });
  const server = Bun.serve({
    hostname: config.AIRCASTLE_HOST,
    port: config.AIRCASTLE_PORT,
    fetch: (request, transport) =>
      /^\/api(?:\/|$)/.test(new URL(request.url).pathname)
        ? app.fetch(request, { peerAddress: transport.requestIP(request)?.address })
        : serveStatic(request),
  });
  resources.defer(() => server.stop(false));
  const close = () => {
    void resources.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on("SIGTERM", close);
  process.on("SIGINT", close);
});
