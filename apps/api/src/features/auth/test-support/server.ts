import pino from "pino";
import { assemble, resourceStack, startWith } from "../../../assemble.ts";
import { readAuthConfig, readDatabaseConfig } from "../../../config.ts";

let now = Number(process.env.AUTH_TEST_NOW ?? Date.UTC(2026, 0, 1));
if (!Number.isSafeInteger(now)) throw new Error("AUTH_TEST_NOW must be Unix milliseconds");
const resources = resourceStack();
const { app, inbox } = await startWith(resources, () =>
  assemble(
    {
      auth: readAuthConfig(),
      database: readDatabaseConfig(),
      logger: pino({ level: "silent" }),
      clock: () => now,
    },
    resources,
  ),
);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request, transport) =>
    app.fetch(request, {
      peerAddress: transport.requestIP(request)?.address,
    }),
});
resources.defer(() => server.stop(true));
const origin = `http://127.0.0.1:${server.port}`;
console.log(`AIRCASTLE_TEST_URL=${origin}`);
process.send?.({ kind: "ready", origin });
process.on("message", (message: unknown) => {
  if (typeof message !== "object" || message === null || !("kind" in message)) return;
  if (message.kind === "inbox" && "id" in message) {
    process.send?.({ kind: "inbox", id: message.id, entries: inbox?.list() ?? [] });
    return;
  }
  if (message.kind !== "advance" || !("milliseconds" in message) || !("id" in message)) return;
  if (
    typeof message.milliseconds !== "number" ||
    !Number.isSafeInteger(message.milliseconds) ||
    message.milliseconds < 0
  )
    return;
  now += message.milliseconds;
  process.send?.({ kind: "advanced", id: message.id });
});
const close = () => {
  void Promise.allSettled([resources.close()]).then(([outcome]) =>
    process.exit(outcome?.status === "fulfilled" ? 0 : 1),
  );
};
process.on("SIGTERM", close);
process.on("SIGINT", close);
process.on("disconnect", close);
