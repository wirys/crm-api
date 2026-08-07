import { Elysia } from "elysia";
import { prisma } from "../lib/prisma";

function conv(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === "bigint") return Number(obj);
    if (Array.isArray(obj)) return obj.map(conv);
    if (typeof obj === "object") {
        if (typeof obj.toNumber === "function") return obj.toNumber();
        const out: any = {};
        for (const k in obj) out[k] = conv(obj[k]);
        return out;
    }
    return obj;
}

export const fiscalRoutes = new Elysia({ prefix: "/fiscal" })
    .get("/difal", async () => {
        const rows: any[] = await prisma.$queryRawUnsafe(`
            SELECT idDifal, UF, AliqEst, AliqInt, FCP
            FROM CRM_Proposta_Difal WITH (NOLOCK)
            ORDER BY UF
        `);
        return conv(rows);
    }, {
        detail: {
            summary: "Listar alíquotas de DIFAL por UF",
            description: "Retorna todas as alíquotas de DIFAL (AliqEst, AliqInt, FCP) cadastradas por unidade federativa, ordenadas alfabeticamente pela UF.",
        },
    })
    .put("/difal/:id", async ({ params, body, set }) => {
        const id = Number(params.id);
        const { AliqEst, AliqInt, FCP } = body as any;

        const fields: string[] = [];
        if (AliqEst !== undefined) fields.push(`AliqEst = ${Number(AliqEst)}`);
        if (AliqInt !== undefined) fields.push(`AliqInt = ${Number(AliqInt)}`);
        if (FCP !== undefined) fields.push(`FCP = ${FCP === null ? 'NULL' : Number(FCP)}`);

        if (!fields.length) { set.status = 400; return { error: "Nenhum campo para atualizar" }; }

        await prisma.$executeRawUnsafe(`
            UPDATE CRM_Proposta_Difal SET ${fields.join(", ")} WHERE idDifal = ${id}
        `);
        return { ok: true };
    }, {
        detail: {
            summary: "Atualizar alíquotas de DIFAL",
            description: "Atualiza os campos `AliqEst`, `AliqInt` e/ou `FCP` do registro de DIFAL identificado por `id`. Apenas os campos enviados no corpo da requisição são atualizados; retorna erro 400 se nenhum campo válido for informado.",
        },
    });
