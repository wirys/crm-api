import {Elysia} from "elysia";
import {prisma} from "../lib/prisma";

export const representativesRoutes = new Elysia({ prefix: "/representatives" })
    .get("/", async () => {
        return prisma.cRM_Usuario.findMany({
            orderBy: {Nome: "asc"},
        });
    })