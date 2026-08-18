import type { Params } from "nestjs-pino";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Finishes the pino wiring the project already paid for.
 *
 * `nestjs-pino` and `pino-http` have been dependencies with nothing importing
 * them, which made one specific thing quietly untrue: the global exception
 * filter's `requestIdOf()` reads `request.id`, a property only pino-http sets.
 * With no logger installed that branch was unreachable, so every error
 * response carried a freshly minted UUID that appeared in no log line
 * anywhere — a correlation id that correlated with nothing.
 *
 * With this registered, the id in an error envelope is the id on every log
 * line for that request, which is the entire point of the field.
 */
export function loggerConfig(isDevelopment: boolean): Params {
  return {
    pinoHttp: {
      level: isDevelopment ? "debug" : "info",

      /**
       * Reuse an inbound `x-request-id` when there is one, mint a UUID
       * otherwise, and echo it back on the response.
       *
       * Reusing matters as soon as anything sits in front of this — a proxy or
       * the Next.js app calling the API server-side. If we minted a fresh id
       * per hop, a customer-reported id would identify one leg of a request
       * and the logs for the other leg would be unfindable.
       */
      genReqId: (request: IncomingMessage, response: ServerResponse) => {
        const inbound = request.headers["x-request-id"];
        const id = (Array.isArray(inbound) ? inbound[0] : inbound) ?? randomUUID();

        response.setHeader("x-request-id", id);

        return id;
      },

      /**
       * Redaction is not optional and not a nicety.
       *
       * Authorization and cookie headers are credentials; logging them puts a
       * session in a log aggregator that is backed up, searched, and shared
       * more widely than the database ever is. `remove: true` drops the keys
       * rather than writing "[Redacted]", so nothing downstream can be fooled
       * into treating the placeholder as a value.
       */
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "res.headers['set-cookie']",
          // The order lookup body is an order number plus an email, which
          // together are the entire authentication of that endpoint.
          "req.body.email",
        ],
        remove: true,
      },

      /**
       * Health checks are the majority of production log volume and carry no
       * information — a probe every few seconds, forever. Silenced at the
       * autologging level rather than filtered later, so they cost nothing.
       */
      autoLogging: {
        ignore: (request: IncomingMessage) => request.url?.startsWith("/api/v1/health") ?? false,
      },

      /**
       * Pretty output in development only. In production the transport is
       * plain JSON on stdout for whatever collects it — pino-pretty in a
       * container is CPU spent making logs harder to parse.
       */
      transport: isDevelopment
        ? { target: "pino-pretty", options: { singleLine: true, translateTime: "HH:MM:ss" } }
        : undefined,
    },
  };
}
