import { Elysia } from "elysia";

import { cors } from "@elysiajs/cors";
import { activitiesRoutes } from "./routes/activities";
import { stockRoutes } from "./routes/stock";

const app = new Elysia()
  .use(cors())
  .use(stockRoutes)
  .use(activitiesRoutes)
  .get("/", () => "Hello Elysia")
  .listen(3000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
