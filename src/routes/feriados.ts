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

export const feriadosRoutes = new Elysia({ prefix: "/feriados" })

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
    });
