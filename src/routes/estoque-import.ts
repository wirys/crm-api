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

export const estoqueImportRoutes = new Elysia({ detail: { tags: ["Estoque"] }, prefix: "/estoque-import" })

    .post("/", async ({ body, set }) => {
        const { dados } = body as { dados: { Codigo: string; Descricao: string; Saldo: number; NCM?: string; Unidade?: string }[] };

        try {
            await prisma.$queryRawUnsafe(`TRUNCATE TABLE CRM_Estoque`);

            const BATCH_SIZE = 500;
            for (let i = 0; i < dados.length; i += BATCH_SIZE) {
                const batch = dados.slice(i, i + BATCH_SIZE);
                const values = batch
                    .map(d => `('${(d.Codigo || '').replace(/'/g, "''")}', '${(d.Descricao || '').replace(/'/g, "''")}', ${d.Saldo || 0}, '${(d.Unidade || '').replace(/'/g, "''")}')`)
                    .join(",");
                await prisma.$queryRawUnsafe(`
                    INSERT INTO CRM_Estoque (Codigo, Descricao, Saldo, Unidade)
                    VALUES ${values}
                `);
            }

            return { success: true, totalLinhas: dados.length };
        } catch (e: any) {
            console.error(e);
            set.status = 500;
            return { error: e.message };
        }
    }, {
        body: t.Object({
            dados: t.Array(t.Object({
                Codigo: t.String(),
                Descricao: t.String(),
                Saldo: t.Number(),
                NCM: t.Optional(t.String()),
                Unidade: t.Optional(t.String()),
            })),
        }),
        detail: {
            summary: "Importar estoque em lote",
            description: "Substitui integralmente o conteúdo da tabela CRM_Estoque (TRUNCATE) e insere os itens recebidos em `dados` (Código, Descrição, Saldo e Unidade), processando em lotes de 500 registros por INSERT. Retorna o total de linhas importadas.",
        },
    });
