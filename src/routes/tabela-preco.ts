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
    }, {
        detail: {
            summary: "Listar últimas tabelas de preço importadas",
            description: "Retorna as 10 últimas tabelas de preço cadastradas em tbTabelaPreco (id, usuário, nome/tipo/caminho do arquivo, data de criação e status), ordenadas da mais recente para a mais antiga.",
        },
    })

    .get("/:id/dados", async ({ params }) => {
        const id = Number(params.id);
        const rows = await prisma.$queryRawUnsafe(`
            EXEC sp_CRMTabelaPrecoImportada
        `);
        return conv(rows);
    }, {
        detail: {
            summary: "Obter dados importados de uma tabela de preço",
            description: "Executa a stored procedure sp_CRMTabelaPrecoImportada e retorna os dados já importados para exibição/conferência. O parâmetro :id identifica a tabela de preço, embora a procedure atual não o utilize diretamente.",
        },
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
        detail: {
            summary: "Registrar upload de tabela de preço",
            description: "Cria um novo registro em tbTabelaPreco com status 'Arquivo Importado', associando o nome/tipo do arquivo enviado e o usuário responsável. Gera um nome de arquivo de sistema único baseado em timestamp; não realiza o upload físico do arquivo, apenas o registro de metadados.",
        },
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
        detail: {
            summary: "Importar dados de uma tabela de preço",
            description: "Trunca a tabela tbTabelaPrecoImport e insere os dados recebidos (linha, coluna, valor) em lotes de até 500 registros via INSERT com UNION ALL. Ao final, atualiza o status da tabela de preço :id em tbTabelaPreco para 'Importado'. Note que o truncate afeta todas as tabelas de preço, não apenas a informada em :id.",
        },
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
        detail: {
            summary: "Publicar tabela de preço",
            description: "Executa a stored procedure sp_CRMTabelaPrecoPublicar (mesma rotina do sistema legado) para publicar os dados importados, e atualiza o status da tabela de preço :id em tbTabelaPreco para 'Tabela Publicada'.",
        },
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
        detail: {
            summary: "Excluir tabela de preço",
            description: "Remove os dados importados relacionados em tbTabelaPrecoImport (filtrando por idTabelaPreco) e em seguida exclui o registro da tabela de preço :id em tbTabelaPreco.",
        },
    });
