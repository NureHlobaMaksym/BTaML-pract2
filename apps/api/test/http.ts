import { IncomingMessage, ServerResponse } from "node:http";
import { Duplex } from "node:stream";
import type { Socket } from "node:net";
import type { Express } from "express";

export function request(app: Express, path: string, method = "GET", body?: string) {
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = new Duplex({ read() {}, write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } }) as Socket;
    const req = new IncomingMessage(socket);
    req.complete = true;
    req.method = method;
    req.url = path;
    req.headers = body === undefined ? {} : { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) };
    const res = new ServerResponse(req);
    res.assignSocket(socket);
    res.on("error", reject);
    res.on("finish", () => {
      try {
        const raw = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, body: JSON.parse(raw.slice(raw.indexOf("\r\n\r\n") + 4)) });
      } catch (error) { reject(error); }
    });
    if (body !== undefined) req.push(body);
    req.push(null);
    app(req, res);
  });
}
