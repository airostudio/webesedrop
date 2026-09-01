import { buildServer } from "./api/server";
import { getDb } from "./db/client";

const port = Number(process.env.PORT ?? 3100);
const app = buildServer(getDb());

app
  .listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`dropship-engine listening on :${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
