import { pathToFileURL } from "node:url";
import { createXecutorServer } from "./xecutor/server.js";

export async function startXecutor(options = {}) {
  const app = createXecutorServer(options);
  const address = await app.listen();
  return { ...app, address };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  startXecutor().then(({ host, port }) => {
    process.stdout.write(`THE XECUTOR — simulation-only approval gateway\nhttp://${host}:${port}\nLIVE BROKER ROUTE: ABSENT\n`);
  }).catch((error) => {
    process.stderr.write(`The Xecutor refused to start: ${error.message}\n`);
    process.exitCode = 1;
  });
}
