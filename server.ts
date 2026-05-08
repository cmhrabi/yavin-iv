import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

void app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url ?? "/", true);
    void handle(req, res, parsedUrl);
  });

  // TODO: attach ws.Server here in the next plan (auth + pubsub fan-out)

  server.listen(port, hostname, () => {
    console.log(`> yavin-iv ready on http://${hostname}:${port}`);
  });
});
