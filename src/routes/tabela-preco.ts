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
        const rows = await prisma.tbTabelaPreco.findMany({
            orderBy: { id: "desc" },
        });
        return conv(rows);
    })

    .get("/:id/dados", async ({ params }) => {
        const id = Number(params.id);
        const rows = await prisma.tbTabelaPrecoImport.findMany({
            where: { idTabelaPreco: id },
            orderBy: [{ Linha: "asc" }, { Coluna: "asc" }],
        });
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
                    Status: "Pendente",
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
            await prisma.$queryRawUnsafe(`DELETE FROM tbTabelaPrecoImport WHERE idTabelaPreco = ${id}`);

            const BATCH_SIZE = 500;
            for (let i = 0; i < dados.length; i += BATCH_SIZE) {
                const batch = dados.slice(i, i + BATCH_SIZE);
                const values = batch
                    .map(d => `(${id}, ${d.linha}, ${d.coluna}, '${(d.valor || '').replace(/'/g, "''")}')`)
                    .join(",");
                await prisma.$queryRawUnsafe(`
                    INSERT INTO tbTabelaPrecoImport (idTabelaPreco, Linha, Coluna, Valor)
                    VALUES ${values}
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
            const importedData = await prisma.tbTabelaPrecoImport.findMany({
                where: { idTabelaPreco: id },
                orderBy: [{ Linha: "asc" }, { Coluna: "asc" }],
            });

            if (importedData.length === 0) {
                set.status = 400;
                return { error: "Nenhum dado importado para publicar" };
            }

            const linhasMap = new Map<number, Map<number, string>>();
            for (const row of importedData) {
                if (row.Linha == null || row.Coluna == null) continue;
                if (!linhasMap.has(row.Linha)) linhasMap.set(row.Linha, new Map());
                linhasMap.get(row.Linha)!.set(row.Coluna, row.Valor || "");
            }

            let updated = 0;
            for (const [linha, colunas] of linhasMap) {
                if (linha <= 1) continue;
                const codProduto = colunas.get(1) || "";
                if (!codProduto) continue;

                const preco7 = parseFloat(colunas.get(2) || "0") || null;
                const preco12 = parseFloat(colunas.get(3) || "0") || null;
                const preco18 = parseFloat(colunas.get(4) || "0") || null;

                const result = await prisma.$queryRawUnsafe(`
                    UPDATE CRM_Produto_Material
                    SET PrecoKg07 = ${preco7 ?? 'NULL'},
                        PrecoKg12 = ${preco12 ?? 'NULL'},
                        PrecoKg18 = ${preco18 ?? 'NULL'},
                        dtaAtualizacao = GETDATE()
                    WHERE CodMaterial = '${codProduto.replace(/'/g, "''")}'
                `);
                updated++;
            }

            await prisma.tbTabelaPreco.update({
                where: { id },
                data: { Status: "Publicado" },
            });

            return { success: true, updated };
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
