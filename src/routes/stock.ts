import { Elysia, t } from "elysia";
import { prisma } from "../lib/prisma";

export const stockRoutes = new Elysia({ detail: { tags: ["Estoque"] }, prefix: '/estoque' })
    .get("/", async ({ query }) => {
        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.max(1, Number(query.limit) || 50);
        const search = query.search || "";
        const offset = (page - 1) * limit;

        try {
            const data = await prisma.$queryRaw`
                SELECT 
                    e.Codigo as CodMaterial, 
                    m.NCM, 
                    e.Descricao, 
                    e.Saldo as 'Quant.Atual',
                    Count(*) OVER() as TotalCount
                FROM CRM_Estoque e
                LEFT JOIN CRM_Produto_Material m ON e.Codigo = m.CodMaterial
                WHERE (${search} = '' OR e.Descricao LIKE ${`%${search}%`} OR e.Codigo LIKE ${`%${search}%`})
                ORDER BY e.Descricao
                OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
            `;

            // Extract total count from the first row if exists
            const total = (data as any[])[0]?.TotalCount ? Number((data as any[])[0].TotalCount) : 0;
            const hasMore = offset + limit < total;

            const serializedData = (data as any[]).map((item: any) => ({
                ...item,
                TotalCount: undefined,
                "Quant.Atual": Number(item['Quant.Atual'])
            }));

            return {
                data: serializedData,
                meta: {
                    page,
                    limit,
                    total,
                    hasMore
                }
            };
        } catch (error) {
            console.error("Error fetching stock:", error);
            return { error: "Failed to fetch stock data" };
        }
    }, {
        query: t.Object({
            page: t.Optional(t.String()),
            limit: t.Optional(t.String()),
            search: t.Optional(t.String())
        }),
        detail: {
            summary: "Listar estoque",
            description: "Retorna a lista paginada de itens de estoque (CRM_Estoque), cruzados com o NCM cadastrado em CRM_Produto_Material. Aceita `page`, `limit` (padrão 50) e `search`, que filtra por descrição ou código do material. Inclui metadados de paginação (`total`, `hasMore`).",
        }
    });
