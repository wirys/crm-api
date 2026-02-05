import { Elysia } from "elysia";

import { cors } from "@elysiajs/cors";
import { activitiesRoutes } from "./routes/activities";
import { authRoutes } from "./routes/auth";
import { contactsRoutes } from "./routes/contacts";
import { stockRoutes } from "./routes/stock";
import { usersRoutes } from "./routes/users";

const app = new Elysia()
  .use(cors())
  .use(stockRoutes)
  .use(authRoutes)
  .use(usersRoutes)
  .use(contactsRoutes)
  .use(activitiesRoutes)
  .get("/", () => "Hello Elysia")
  .listen(3000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
