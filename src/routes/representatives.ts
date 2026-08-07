import {Elysia} from "elysia";
import {prisma} from "../lib/prisma";

export const representativesRoutes = new Elysia({ detail: { tags: ["Contatos"] }, prefix: "/representatives" })
    .get("/", async () => {
        return prisma.cRM_Usuario.findMany({
            orderBy: {Nome: "asc"},
        });
    }, {
        detail: {
            summary: "Listar representantes/usuários",
            description: "Retorna todos os usuários cadastrados em CRM_Usuario, ordenados alfabeticamente pelo nome, utilizados como representantes/atendentes no CRM.",
        },
    })