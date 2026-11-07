import { request as httpRequest } from "node:http";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { browserOrigin, start } from "./fixture.ts";
import { startAuthProcess } from "./auth-process.ts";

export async function authProcess(url: string, namespace: string) {
  const child = await startAuthProcess({
    database: { url, namespace },
    browserOrigin,
    now: start,
    deadlines: { ready: 5_000, reply: 5_000, close: 5_000 },
  });
  return {
    close: child.close,
    inbox: child.inbox,
    async request(path: string, body?: unknown, cookie?: string) {
      const serializedBody = body === undefined ? undefined : JSON.stringify(body);
      const response = await new Promise<IncomingMessage>((resolve, reject) => {
        const request = httpRequest(
          `${child.origin}/api${path}`,
          {
            method: body === undefined ? "GET" : "POST",
            headers: {
              host: new URL(browserOrigin).host,
              origin: browserOrigin,
              ...(cookie ? { cookie } : {}),
              ...(body === undefined ? {} : { "content-type": "application/json" }),
            },
          },
          resolve,
        );
        request.once("error", reject);
        request.end(serializedBody);
      });
      const headers = new Headers();
      for (let index = 0; index < response.rawHeaders.length; index += 2) {
        headers.append(response.rawHeaders[index]!, response.rawHeaders[index + 1]!);
      }
      const emptyBody = [204, 205, 304].includes(response.statusCode!);
      if (emptyBody) response.resume();
      return new Response(emptyBody ? null : Readable.toWeb(response), {
        status: response.statusCode!,
        statusText: response.statusMessage!,
        headers,
      });
    },
  };
}
