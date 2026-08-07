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

export const feriadosRoutes = new Elysia({ detail: { tags: ["Admin"] }, prefix: "/feriados" })

    .get("/", async ({ query }) => {
        const { ano } = query as Record<string, string | undefined>;
        const conds: string[] = [];
        if (ano) {
            conds.push(`YEAR(data) = ${Number(ano)}`);
        }
        const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";

        const rows = await prisma.$queryRawUnsafe(`
            SELECT id, data, feriado
            FROM tbFeriado WITH (NOLOCK)
            ${where}
            ORDER BY data ASC
        `);
        return conv(rows);
    }, {
        detail: {
            summary: "Listar feriados",
            description: "Retorna a lista de feriados cadastrados, ordenados por data ascendente. Permite filtrar opcionalmente por ano através do parâmetro de query 'ano'.",
        },
    })

    .post("/", async ({ body, set }) => {
        const { data, feriado } = body;
        try {
            const created = await prisma.tbFeriado.create({
                data: { data: new Date(data), feriado },
            });
            return conv({ success: true, id: created.id });
        } catch (e: any) {
            console.error(e);
            set.status = 500;
            return { error: e.message };
        }
    }, {
        body: t.Object({
            data: t.String(),
            feriado: t.String(),
        }),
        detail: {
            summary: "Criar feriado",
            description: "Cadastra um novo feriado com a data e a descrição/nome informados no corpo da requisição.",
        },
    })

    .patch("/:id", async ({ params, body, set }) => {
        const id = Number(params.id);
        try {
            await prisma.tbFeriado.update({
                where: { id },
                data: {
                    ...(body.data ? { data: new Date(body.data) } : {}),
                    ...(body.feriado ? { feriado: body.feriado } : {}),
                },
            });
            return { success: true };
        } catch (e: any) {
            console.error(e);
            set.status = 500;
            return { error: e.message };
        }
    }, {
        params: t.Object({ id: t.String() }),
        body: t.Object({
            data: t.Optional(t.String()),
            feriado: t.Optional(t.String()),
        }),
        detail: {
            summary: "Atualizar feriado",
            description: "Atualiza parcialmente um feriado pelo id informado na URL. Apenas os campos data e/ou feriado enviados no corpo são alterados.",
        },
    })

    .delete("/:id", async ({ params, set }) => {
        const id = Number(params.id);
        try {
            await prisma.tbFeriado.delete({ where: { id } });
            return { success: true };
        } catch (e: any) {
            console.error(e);
            set.status = 500;
            return { error: e.message };
        }
    }, {
        params: t.Object({ id: t.String() }),
        detail: {
            summary: "Excluir feriado",
            description: "Exclui definitivamente um feriado pelo id informado na URL.",
        },
    });
