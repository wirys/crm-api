import { Elysia, t } from "elysia";
import { prisma } from "../lib/prisma";

function conv(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === "bigint") return Number(obj);
    if (obj instanceof Date) return obj.toISOString();
    if (Array.isArray(obj)) return obj.map(conv);
    if (typeof obj === "object") {
        if (typeof obj.toNumber === "function") return obj.toNumber();
        const out: any = {};
        for (const k in obj) out[k] = conv(obj[k]);
        return out;
    }
    return obj;
}

function parsePermissoes(raw: any): object {
    if (!raw) return {};
    if (typeof raw === "object") return raw;
    try {
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

export const perfisRoutes = new Elysia({ detail: { tags: ["Perfis"] }, prefix: "/perfis" })

    // GET / - List all groups
    .get("/", async () => {
        try {
            const groups: any[] = await prisma.$queryRawUnsafe(`
                SELECT g.*,
                       (SELECT COUNT(*) FROM CRM_Usuario u WHERE u.idGrupo = g.idGrupo) as totalUsuarios
                FROM CRM_Grupo g
                ORDER BY g.idGrupo
            `);

            return conv(groups.map((g: any) => ({
                ...g,
                Permissoes: parsePermissoes(g.Permissoes),
            })));
        } catch (e: any) {
            return { error: e.message };
        }
    })

    // GET /:id - Get single group
    .get("/:id", async ({ params, set }) => {
        try {
            const id = Number(params.id);
            const groups: any[] = await prisma.$queryRawUnsafe(`
                SELECT g.*,
                       (SELECT COUNT(*) FROM CRM_Usuario u WHERE u.idGrupo = g.idGrupo) as totalUsuarios
                FROM CRM_Grupo g
                WHERE g.idGrupo = ${id}
            `);

            if (groups.length === 0) {
                set.status = 404;
                return { error: "Perfil não encontrado" };
            }

            const g = groups[0];
            return conv({
                ...g,
                Permissoes: parsePermissoes(g.Permissoes),
            });
        } catch (e: any) {
            set.status = 500;
            return { error: e.message };
        }
    })

    // POST / - Create new group
    .post("/", async ({ body, set }) => {
        try {
            const { Grupo, Permissoes } = body as any;

            if (!Grupo || !Grupo.trim()) {
                set.status = 400;
                return { error: "Nome do perfil é obrigatório" };
            }

            const result: any[] = await prisma.$queryRawUnsafe(`
                SELECT ISNULL(MAX(idGrupo), 0) + 1 as nextId FROM CRM_Grupo
            `);
            const nextId = Number(result[0].nextId);

            const permissoesJson = Permissoes ? JSON.stringify(Permissoes) : "{}";

            await prisma.$queryRawUnsafe(`
                INSERT INTO CRM_Grupo (idGrupo, Grupo, Menu01, Menu02, Menu03, Menu04, Menu05, Menu06, Menu07, Menu08, Painel, Permissoes)
                VALUES (${nextId}, '${Grupo.replace(/'/g, "''")}', 0, 0, 0, 0, 0, 0, 0, 0, 0, '${permissoesJson.replace(/'/g, "''")}')
            `);

            set.status = 201;
            return conv({ idGrupo: nextId, Grupo, Permissoes: Permissoes || {} });
        } catch (e: any) {
            set.status = 500;
            return { error: e.message };
        }
    })

    // PUT /:id - Update group
    .put("/:id", async ({ params, body, set }) => {
        try {
            const id = Number(params.id);
            const { Grupo, Permissoes } = body as any;

            // Check if group exists
            const existing: any[] = await prisma.$queryRawUnsafe(`
                SELECT idGrupo FROM CRM_Grupo WHERE idGrupo = ${id}
            `);
            if (existing.length === 0) {
                set.status = 404;
                return { error: "Perfil não encontrado" };
            }

            const setClauses: string[] = [];
            if (Grupo !== undefined) {
                setClauses.push(`Grupo = '${Grupo.replace(/'/g, "''")}'`);
            }
            if (Permissoes !== undefined) {
                const permissoesJson = JSON.stringify(Permissoes);
                setClauses.push(`Permissoes = '${permissoesJson.replace(/'/g, "''")}'`);
            }

            if (setClauses.length === 0) {
                set.status = 400;
                return { error: "Nenhum campo para atualizar" };
            }

            await prisma.$queryRawUnsafe(`
                UPDATE CRM_Grupo SET ${setClauses.join(", ")} WHERE idGrupo = ${id}
            `);

            // Return updated record
            const updated: any[] = await prisma.$queryRawUnsafe(`
                SELECT g.*,
                       (SELECT COUNT(*) FROM CRM_Usuario u WHERE u.idGrupo = g.idGrupo) as totalUsuarios
                FROM CRM_Grupo g
                WHERE g.idGrupo = ${id}
            `);

            return conv({
                ...updated[0],
                Permissoes: parsePermissoes(updated[0]?.Permissoes),
            });
        } catch (e: any) {
            set.status = 500;
            return { error: e.message };
        }
    })

    // DELETE /:id - Delete group
    .delete("/:id", async ({ params, set }) => {
        try {
            const id = Number(params.id);

            // Don't allow deleting system groups
            if ([1, 2, 3].includes(id)) {
                set.status = 403;
                return { error: "Não é permitido excluir perfis do sistema" };
            }

            // Check if group exists
            const existing: any[] = await prisma.$queryRawUnsafe(`
                SELECT idGrupo FROM CRM_Grupo WHERE idGrupo = ${id}
            `);
            if (existing.length === 0) {
                set.status = 404;
                return { error: "Perfil não encontrado" };
            }

            // Check if any users are assigned
            const users: any[] = await prisma.$queryRawUnsafe(`
                SELECT COUNT(*) as total FROM CRM_Usuario WHERE idGrupo = ${id}
            `);
            if (Number(users[0].total) > 0) {
                set.status = 409;
                return { error: "Não é possível excluir este perfil pois existem usuários vinculados" };
            }

            await prisma.$queryRawUnsafe(`
                DELETE FROM CRM_Grupo WHERE idGrupo = ${id}
            `);

            return { success: true };
        } catch (e: any) {
            set.status = 500;
            return { error: e.message };
        }
    });
