import { createHash } from "node:crypto";
import { createServer, type Socket } from "node:net";
import { expect, onTestFinished, test } from "vite-plus/test";
import postgres from "postgres";
import { AuthStorageError } from "@aircastle/core";
import { withStore } from "../test-support/auth-store.ts";

test("a driver failure keeps its cause and SQLSTATE without its message", async () => {
  await withStore(async ({ auth }) => {
    const user = {
      id: "user-1",
      name: "Alex",
      email: "alex@example.test",
      createdAt: 1,
      updatedAt: 1,
    };
    await auth.transaction((tx) => tx.insertUser(user));
    const failure = await auth
      .transaction((tx) => tx.insertUser({ ...user, id: "user-2" }))
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(failure).toBeInstanceOf(AuthStorageError);
    if (!(failure instanceof AuthStorageError)) throw new Error("Expected a storage failure");
    expect(failure.kind).toBe("unavailable");
    expect(failure.code).toBe("23505");
    expect(failure.message).toBe("unavailable");
    expect(failure.cause).toBeInstanceOf(postgres.PostgresError);
  });
});

test.each([
  ["a TypeError", () => Promise.reject(new TypeError("callback bug")), { name: "TypeError" }],
  [
    "a Node TypeError with an ERR_ code",
    async () => {
      createHash("sha256").update(JSON.parse("null"));
    },
    { name: "TypeError", code: "ERR_INVALID_ARG_TYPE" },
  ],
  [
    "an Error with an arbitrary code",
    () => Promise.reject(Object.assign(new Error("callback bug"), { code: "ANY_CODE" })),
    { code: "ANY_CODE" },
  ],
  [
    "an AggregateError that holds a TypeError",
    () =>
      Promise.reject(
        new AggregateError([
          Object.assign(new Error("connect ECONNREFUSED"), {
            code: "ECONNREFUSED",
            syscall: "connect",
          }),
          new TypeError("callback bug"),
        ]),
      ),
    { name: "AggregateError" },
  ],
  [
    "an empty AggregateError",
    () => Promise.reject(new AggregateError([])),
    { name: "AggregateError" },
  ],
] as const)(
  "%s inside a transaction is not reported as a storage failure",
  async (_, fault, raised) => {
    await withStore(async ({ auth }) => {
      const failure = await auth.transaction(fault).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(failure).not.toBeInstanceOf(AuthStorageError);
      expect(failure).toMatchObject(raised);
    });
  },
);

function message(type: string, body: string | Buffer) {
  const bytes = Buffer.from(body);
  const header = Buffer.alloc(5);
  header.write(type);
  header.writeUInt32BE(bytes.length + 4, 1);
  return Buffer.concat([header, bytes]);
}

function authentication(step: number, data = "") {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(step);
  return message("R", Buffer.concat([head, Buffer.from(data)]));
}

async function scriptedServer(script: ((packet: Buffer) => string | Buffer | undefined)[]) {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    let step = 0;
    socket.on("error", () => sockets.delete(socket));
    socket.on("data", (packet) => {
      const reply = script[step++]?.(packet);
      if (reply === undefined) socket.destroy();
      else socket.write(reply);
    });
  });
  const port = await new Promise<number>((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address !== null ? address.port : 0);
    }),
  );
  onTestFinished(() => {
    for (const socket of sockets) socket.destroy();
    server.close();
  });
  return `postgres://aircastle:secret@127.0.0.1:${port}/aircastle`;
}

test.each([
  [
    "refused",
    () => postgres("postgres://aircastle@127.0.0.1:1/aircastle", { max: 1, connect_timeout: 2 }),
    "ECONNREFUSED",
  ],
  [
    "refused localhost",
    () => postgres("postgres://aircastle@localhost:1/aircastle", { max: 1, connect_timeout: 2 }),
    "ECONNREFUSED",
  ],
  [
    "TLS-required connection to a server without TLS",
    async () =>
      postgres(await scriptedServer([() => "N"]), { max: 1, connect_timeout: 2, ssl: "require" }),
    "ECONNRESET",
  ],
  [
    "TLS connection answered in plain text",
    async () =>
      postgres(await scriptedServer([() => "S", () => message("E", "not a TLS record")]), {
        max: 1,
        connect_timeout: 2,
        ssl: "require",
      }),
    "ERR_SSL_WRONG_VERSION_NUMBER",
  ],
  [
    "SCRAM connection with a wrong server signature",
    async () =>
      postgres(
        await scriptedServer([
          () => authentication(10, "SCRAM-SHA-256\0\0"),
          (packet) =>
            authentication(
              11,
              `r=${/r=([^,\0]+)/u.exec(packet.toString())?.[1]}server,s=${Buffer.from("salt").toString("base64")},i=4096`,
            ),
          () => authentication(12, `v=${Buffer.from("wrong").toString("base64")}`),
        ]),
        { max: 1, connect_timeout: 2 },
      ),
    "SASL_SIGNATURE_MISMATCH",
  ],
  [
    "protocol-negotiating",
    async () =>
      postgres(await scriptedServer([() => message("v", Buffer.alloc(8))]), {
        max: 1,
        connect_timeout: 2,
      }),
    "MESSAGE_NOT_SUPPORTED",
  ],
  [
    "ended",
    async () => {
      const client = postgres("postgres://aircastle@127.0.0.1:1/aircastle", { max: 1 });
      await client.end({ timeout: 0 });
      return client;
    },
    "CONNECTION_ENDED",
  ],
] as const)(
  "a %s postgres.js connection is reported as unavailable with its code",
  async (_, connect, code) => {
    await withStore(async ({ auth }) => {
      const client = await connect();
      try {
        const failure = await auth
          .transaction(async () => {
            await client`SELECT 1`;
          })
          .then(
            () => undefined,
            (error: unknown) => error,
          );
        expect(failure).toBeInstanceOf(AuthStorageError);
        expect(failure).toMatchObject({ kind: "unavailable", code, message: "unavailable" });
      } finally {
        await client.end({ timeout: 0 });
      }
    });
  },
);

test.each([
  ["an untrusted certificate", { code: "DEPTH_ZERO_SELF_SIGNED_CERT" }],
  ["an expired certificate", { code: "CERT_HAS_EXPIRED" }],
  [
    "a certificate for another host",
    {
      code: "ERR_TLS_CERT_ALTNAME_INVALID",
      reason: "Host: db.example. is not in the cert's altnames",
    },
  ],
] as const)("%s refused by TLS is reported as unavailable with its code", async (_, fields) => {
  await withStore(async ({ auth }) => {
    const failure = await auth
      .transaction(() => Promise.reject(Object.assign(new Error("TLS verification"), fields)))
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(failure).toBeInstanceOf(AuthStorageError);
    expect(failure).toMatchObject({
      kind: "unavailable",
      code: fields.code,
      message: "unavailable",
    });
  });
});
