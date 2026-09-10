import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const page = await readFile(join(root, "live.html"));
const port = Number(process.env.M3_LIVE_PORT || 5173);

const server = createServer((request, response) => {
  if (request.method !== "GET"
      || !["/", "/auth/callback"].includes(new URL(request.url, "http://localhost").pathname)) {
    response.writeHead(404, { "Cache-Control": "no-store" });
    response.end();
    return;
  }
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer"
  });
  response.end(page);
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`M3 live browser harness ready at http://localhost:${port}\n`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
