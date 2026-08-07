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

export const lixeiraRoutes = new Elysia({ detail: { tags: ["Contatos"] }, prefix: "/lixeira" })

    // ── GET /lixeira/contatos ─────────────────────────────────────────────────
    .get("/contatos", async ({ query }) => {
        const { search, page, limit } = query as Record<string, string | undefined>;

        const pageNum  = Math.max(1, Number(page  ?? 1));
        const limitNum = Math.max(1, Number(limit ?? 100));
        const offset   = (pageNum - 1) * limitNum;

        const conds: string[] = [];

        if (search) {
            const s = search.replace(/'/g, "''");
            conds.push(`(nomContato LIKE '%${s}%' OR nomComercial LIKE '%${s}%' OR ISNULL(CNPJ,'') LIKE '%${s}%')`);
        }

        const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

        const [rows, countRows] = await Promise.all([
            prisma.$queryRawUnsafe(`
                SELECT
                    idContato,
                    nomContato      = ISNULL(nomContato, ''),
                    nomComercial    = ISNULL(nomComercial, ''),
                    CNPJ            = ISNULL(CNPJ, ''),
                    Telefone        = ISNULL(Telefone, ''),
                    email           = ISNULL(email, ''),
                    idRepresentante = ISNULL(idRepresentante, 0)
                FROM CRM_Contato_Lixeira WITH (NOLOCK)
                ${where}
                ORDER BY nomComercial
                OFFSET ${offset} ROWS FETCH NEXT ${limitNum} ROWS ONLY
            `),
            prisma.$queryRawUnsafe(`
                SELECT Total = COUNT(*) FROM CRM_Contato_Lixeira WITH (NOLOCK) ${where}
            `),
        ]);

        return { data: conv(rows), total: conv(countRows)[0]?.Total ?? 0 };
    }, {
        query: t.Object({
            search: t.Optional(t.String()),
            page:   t.Optional(t.String()),
            limit:  t.Optional(t.String()),
        }),
        detail: {
            summary: "Listar contatos na lixeira",
            description: "Retorna, de forma paginada, os contatos removidos armazenados em CRM_Contato_Lixeira, com busca opcional por nome, nome comercial ou CNPJ. Aceita page e limit para paginação (padrão página 1, limite 100) e retorna também o total de registros encontrados."
        }
    })

    // ── POST /lixeira/contatos/:id/restaurar ─────────────────────────────────
    .post("/contatos/:id/restaurar", async ({ params, set }) => {
        set.status = 422;
        return {
            success: false,
            message: "Restauração não suportada automaticamente - contate o administrador",
        };
    }, {
        params: t.Object({ id: t.String() }),
        detail: {
            summary: "Restaurar contato da lixeira",
            description: "Endpoint de restauração de um contato da lixeira (CRM_Contato_Lixeira) pelo id na URL. Atualmente não implementado: sempre retorna status 422 informando que a restauração automática não é suportada e que é necessário contatar o administrador."
        }
    })

    // ── DELETE /lixeira/contatos/:id ──────────────────────────────────────────
    .delete("/contatos/:id", async ({ params, set }) => {
        const id = Number(params.id);
        try {
            await prisma.$queryRawUnsafe(
                `DELETE FROM CRM_Contato_Lixeira WHERE idContato = ${id}`
            );
            return { success: true };
        } catch (e) {
            console.error(e);
            set.status = 500;
            return { error: "Erro ao excluir contato da lixeira" };
        }
    }, {
        params: t.Object({ id: t.String() }),
        detail: {
            summary: "Excluir contato da lixeira permanentemente",
            description: "Remove definitivamente um contato da tabela CRM_Contato_Lixeira pelo id informado na URL, sem possibilidade de restauração."
        }
    });
