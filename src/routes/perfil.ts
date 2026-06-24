import { Elysia, t } from "elysia";
import { prisma } from "../lib/prisma";

function conv(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === "bigint") return Number(obj);
    if (obj instanceof Date) return obj;
    if (Array.isArray(obj)) return obj.map(conv);
    if (typeof obj === "object") {
        if (typeof obj.toNumber === "function") return obj.toNumber();
        const out: any = {};
        for (const k in obj) out[k] = conv(obj[k]);
        return out;
    }
    return obj;
}

export const perfilRoutes = new Elysia({ detail: { tags: ["Usuarios"] }, prefix: "/perfil" })

    // ── GET /perfil/:id ───────────────────────────────────────────────────────
    .get("/:id", async ({ params, set }) => {
        const id = Number(params.id);
        try {
            const user = await (prisma as any).cRM_Usuario.findUnique({
                where: { idUsuario: id },
            });
            if (!user) {
                set.status = 404;
                return { error: "Usuário não encontrado" };
            }
            const { Senha, ...rest } = user;
            return conv(rest);
        } catch (e) {
            console.error(e);
            set.status = 500;
            return { error: "Erro ao buscar perfil" };
        }
    }, {
        params: t.Object({ id: t.String() }),
    })

    // ── PATCH /perfil/:id ─────────────────────────────────────────────────────
    .patch("/:id", async ({ params, body, set }) => {
        const id = Number(params.id);
        const data: any = {};

        if (body.Nome     !== undefined) data.Nome     = body.Nome;
        if (body.Email    !== undefined) data.Email    = body.Email;
        if (body.Telefone !== undefined) data.Telefone = body.Telefone;
        if (body.Titulo   !== undefined) data.Titulo   = body.Titulo;

        try {
            const user = await (prisma as any).cRM_Usuario.update({
                where: { idUsuario: id },
                data,
            });
            const { Senha, ...rest } = user;
            return conv(rest);
        } catch (e) {
            console.error(e);
            set.status = 500;
            return { error: "Erro ao atualizar perfil" };
        }
    }, {
        params: t.Object({ id: t.String() }),
        body: t.Object({
            Nome:     t.Optional(t.String()),
            Email:    t.Optional(t.String()),
            Telefone: t.Optional(t.String()),
            Titulo:   t.Optional(t.String()),
        }),
    })

    // ── PATCH /perfil/:id/senha ───────────────────────────────────────────────
    .patch("/:id/senha", async ({ params, body, set }) => {
        const id = Number(params.id);
        const { senhaAtual, novaSenha } = body;

        try {
            const user = await (prisma as any).cRM_Usuario.findUnique({
                where: { idUsuario: id },
            });

            if (!user) {
                set.status = 404;
                return { error: "Usuário não encontrado" };
            }

            if (user.Senha !== senhaAtual) {
                set.status = 401;
                return { error: "Senha atual incorreta" };
            }

            await prisma.$queryRawUnsafe(
                `UPDATE CRM_Usuario SET Senha = '${novaSenha.replace(/'/g, "''")}' WHERE idUsuario = ${id}`
            );

            return { success: true };
        } catch (e) {
            console.error(e);
            set.status = 500;
            return { error: "Erro ao alterar senha" };
        }
    }, {
        params: t.Object({ id: t.String() }),
        body: t.Object({
            senhaAtual: t.String(),
            novaSenha:  t.String(),
        }),
    });
