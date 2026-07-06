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

export const tabelaPrecoRoutes = new Elysia({ detail: { tags: ["Tabela de Preco"] }, prefix: "/tabela-preco" })

    .get("/", async () => {
        const rows = await prisma.$queryRawUnsafe(`
            SELECT TOP 10 id, idUsuario, ArquivoNome, ArquivoNomeSistema, ArquivoTipo,
                   CaminhoArquivo, dtaCriacao, Status
            FROM tbTabelaPreco
            ORDER BY dtaCriacao DESC
        `);
        return conv(rows);
    })

    .get("/:id/dados", async ({ params }) => {
        const id = Number(params.id);
        const rows = await prisma.$queryRawUnsafe(`
            EXEC sp_CRMTabelaPrecoImportada
        `);
        return conv(rows);
    })

    .post("/upload", async ({ body, set }) => {
        const { fileName, fileType, userId } = body;

        try {
            const registro = await prisma.tbTabelaPreco.create({
                data: {
                    idUsuario: Number(userId),
                    ArquivoNome: fileName,
                    ArquivoTipo: fileType,
                    ArquivoNomeSistema: `tabela_${Date.now()}.xlsx`,
                    CaminhoArquivo: `/uploads/tabela-preco/`,
                    dtaCriacao: new Date(),
                    Status: "Arquivo Importado",
                },
            });
            return conv({ success: true, id: registro.id });
        } catch (e: any) {
            console.error(e);
            set.status = 500;
            return { error: e.message };
        }
    }, {
        body: t.Object({
            fileName: t.String(),
            fileType: t.String(),
            userId: t.String(),
        }),
    })

    .post("/:id/importar", async ({ params, body, set }) => {
        const id = Number(params.id);
        const { dados } = body as { dados: { linha: number; coluna: number; valor: string }[] };

        try {
            // Legado faz TRUNCATE antes de importar (não usa idTabelaPreco)
            await prisma.$queryRawUnsafe(`TRUNCATE TABLE tbTabelaPrecoImport`);

            const BATCH_SIZE = 500;
            for (let i = 0; i < dados.length; i += BATCH_SIZE) {
                const batch = dados.slice(i, i + BATCH_SIZE);
                const values = batch
                    .map(d => `SELECT ${d.linha}, ${d.coluna}, '${(d.valor || '').replace(/'/g, "''")}'`)
                    .join(" UNION ALL ");
                await prisma.$queryRawUnsafe(`
                    INSERT INTO tbTabelaPrecoImport (Linha, Coluna, Valor)
                    ${values}
                `);
            }

            await prisma.tbTabelaPreco.update({
                where: { id },
                data: { Status: "Importado" },
            });

            return { success: true, totalLinhas: dados.length };
        } catch (e: any) {
            console.error(e);
            set.status = 500;
            return { error: e.message };
        }
    }, {
        params: t.Object({ id: t.String() }),
        body: t.Object({
            dados: t.Array(t.Object({
                linha: t.Number(),
                coluna: t.Number(),
                valor: t.String(),
            })),
        }),
    })

    .post("/:id/publicar", async ({ params, set }) => {
        const id = Number(params.id);

        try {
            // Usa a mesma stored procedure do legado
            await prisma.$queryRawUnsafe(`EXEC sp_CRMTabelaPrecoPublicar`);

            await prisma.tbTabelaPreco.update({
                where: { id },
                data: { Status: "Tabela Publicada" },
            });

            return { success: true };
        } catch (e: any) {
            console.error(e);
            set.status = 500;
            return { error: e.message };
        }
    }, {
        params: t.Object({ id: t.String() }),
    })

    .delete("/:id", async ({ params, set }) => {
        const id = Number(params.id);
        try {
            await prisma.$queryRawUnsafe(`DELETE FROM tbTabelaPrecoImport WHERE idTabelaPreco = ${id}`);
            await prisma.tbTabelaPreco.delete({ where: { id } });
            return { success: true };
        } catch (e: any) {
            console.error(e);
            set.status = 500;
            return { error: e.message };
        }
    }, {
        params: t.Object({ id: t.String() }),
    });
