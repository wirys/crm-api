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
            SELECT idDifal, UF, AliqEst, AliqInt, Sim, Nao, FCP
            FROM CRM_Proposta_Difal WITH (NOLOCK)
            ORDER BY UF
        `);
        return conv(rows);
    })
    .put("/difal/:id", async ({ params, body, set }) => {
        const id = Number(params.id);
        const { AliqEst, AliqInt, Sim, Nao, FCP } = body as any;

        const fields: string[] = [];
        if (AliqEst !== undefined) fields.push(`AliqEst = ${Number(AliqEst)}`);
        if (AliqInt !== undefined) fields.push(`AliqInt = ${Number(AliqInt)}`);
        if (Sim !== undefined) fields.push(`Sim = ${Number(Sim)}`);
        if (Nao !== undefined) fields.push(`Nao = ${Number(Nao)}`);
        if (FCP !== undefined) fields.push(`FCP = ${FCP === null ? 'NULL' : Number(FCP)}`);

        if (!fields.length) { set.status = 400; return { error: "Nenhum campo para atualizar" }; }

        await prisma.$executeRawUnsafe(`
            UPDATE CRM_Proposta_Difal SET ${fields.join(", ")} WHERE idDifal = ${id}
        `);
        return { ok: true };
    });
