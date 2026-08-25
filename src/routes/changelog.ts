import { Elysia, t } from "elysia";
import { prisma } from "../lib/prisma";
import { getUserContext } from "../lib/user-context";

const SUPER_USER_GROUP = 1;

function isSuperUser(request: Request): boolean {
    const { userGroup } = getUserContext(request);
    return userGroup === SUPER_USER_GROUP;
}

function serialize(row: any) {
    let secoes: any[] = [];
    try { secoes = JSON.parse(row.Secoes || "[]"); } catch { secoes = []; }
    return {
        id: row.id,
        data: row.dtaPublicacao,
        titulo: row.Titulo,
        secoes,
    };
}

const sectionSchema = t.Object({
    heading: t.String(),
    items: t.Array(t.String()),
});

export const changelogRoutes = new Elysia({ detail: { tags: ["Changelog"] }, prefix: "/changelog" })

    // ── GET /changelog ────────────────────────────────────────────────────────
    .get("/", async () => {
        const rows = await prisma.cRM_Changelog.findMany({
            orderBy: { dtaPublicacao: "desc" },
        });
        return rows.map(serialize);
    }, {
        detail: {
            summary: "Listar atualizações publicadas",
            description: "Retorna todas as entradas do changelog, ordenadas da mais recente para a mais antiga. Leitura liberada para qualquer usuário autenticado.",
        },
    })

    // ── POST /changelog ───────────────────────────────────────────────────────
    .post("/", async ({ request, body, set }) => {
        if (!isSuperUser(request)) {
            set.status = 403;
            return { error: "Apenas o super usuário pode publicar atualizações." };
        }
        const { userId } = getUserContext(request);
        const row = await prisma.cRM_Changelog.create({
            data: {
                dtaPublicacao: new Date(body.data),
                Titulo: body.titulo,
                Secoes: JSON.stringify(body.secoes),
                idUsuario: userId || null,
            },
        });
        return serialize(row);
    }, {
        body: t.Object({
            data: t.String(),
            titulo: t.String(),
            secoes: t.Array(sectionSchema),
        }),
        detail: {
            summary: "Publicar nova atualização",
            description: "Cria uma nova entrada no changelog. Restrito ao super usuário (grupo Admin).",
        },
    })

    // ── PUT /changelog/:id ─────────────────────────────────────────────────────
    .put("/:id", async ({ request, params, body, set }) => {
        if (!isSuperUser(request)) {
            set.status = 403;
            return { error: "Apenas o super usuário pode editar atualizações." };
        }
        const id = Number(params.id);
        const row = await prisma.cRM_Changelog.update({
            where: { id },
            data: {
                dtaPublicacao: new Date(body.data),
                Titulo: body.titulo,
                Secoes: JSON.stringify(body.secoes),
                dtaAlteracao: new Date(),
            },
        });
        return serialize(row);
    }, {
        body: t.Object({
            data: t.String(),
            titulo: t.String(),
            secoes: t.Array(sectionSchema),
        }),
        detail: {
            summary: "Editar atualização existente",
            description: "Atualiza data, título e seções de uma entrada do changelog. Restrito ao super usuário (grupo Admin).",
        },
    })

    // ── DELETE /changelog/:id ──────────────────────────────────────────────────
    .delete("/:id", async ({ request, params, set }) => {
        if (!isSuperUser(request)) {
            set.status = 403;
            return { error: "Apenas o super usuário pode remover atualizações." };
        }
        await prisma.cRM_Changelog.delete({ where: { id: Number(params.id) } });
        return { success: true };
    }, {
        detail: {
            summary: "Remover atualização",
            description: "Remove definitivamente uma entrada do changelog. Restrito ao super usuário (grupo Admin).",
        },
    });
