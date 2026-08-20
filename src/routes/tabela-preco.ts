import { Elysia, t } from "elysia";
import { prisma } from "../lib/prisma";
import { enqueueJob } from "../lib/job-queue";
import { getCircuitState } from "../lib/circuit-breaker";
import { JOB_TABELA_PRECO_PUBLICAR, JOB_TABELA_PRECO_IMPORTAR } from "../jobs/registry";
import { parseStagingTabelaPreco } from "../jobs/publicar-tabela-preco";

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
            SELECT TOP 15 t.id, t.idUsuario, t.ArquivoNome, t.ArquivoNomeSistema, t.ArquivoTipo,
                   t.CaminhoArquivo, t.dtaCriacao, t.Status,
                   totalCelulas = (SELECT COUNT(*) FROM tbTabelaPrecoImport i WHERE i.idTabelaPreco = t.id)
            FROM tbTabelaPreco t
            ORDER BY t.dtaCriacao DESC
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

        if (!dados || dados.length === 0) {
            set.status = 400;
            return { error: "Nenhum dado recebido para importação." };
        }

        try {
            await prisma.tbTabelaPreco.update({ where: { id }, data: { Status: "Importação Enfileirada" } });
            const jobId = await enqueueJob(JOB_TABELA_PRECO_IMPORTAR, id, { dados });
            set.status = 202;
            return { success: true, jobId, message: "Importação enfileirada para processamento em background." };
        } catch (e: any) {
            console.error(e);
            set.status = 500;
            return { error: "Falha ao enfileirar a importação da tabela de preço.", details: e.message };
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
            summary: "Importar dados de uma tabela de preço (assíncrono)",
            description: "Enfileira um job em background que remove (escopado por idTabelaPreco) e reinsere os dados recebidos (linha, coluna, valor) em tbTabelaPrecoImport, em lotes de até 500 registros, dentro de uma transaction com timeout estendido. Retorna 202 com o jobId imediatamente; use GET /tabela-preco/job/:jobId para acompanhar o status. Ao concluir, atualiza o status da tabela de preço :id para 'Importado'. Qualquer falha desfaz automaticamente as alterações (rollback) e marca o status como 'Erro na Importação', sem afetar dados de outras tabelas de preço. Protegido por circuit breaker.",
        },
    })

    .post("/:id/publicar", async ({ params, set }) => {
        const id = Number(params.id);

        const tabela = await prisma.tbTabelaPreco.findUnique({ where: { id } });
        if (!tabela) {
            set.status = 404;
            return { error: "Tabela de preço não encontrada." };
        }

        try {
            await prisma.tbTabelaPreco.update({ where: { id }, data: { Status: "Publicação Enfileirada" } });
            const jobId = await enqueueJob(JOB_TABELA_PRECO_PUBLICAR, id);
            set.status = 202;
            return { success: true, jobId, message: "Publicação enfileirada para processamento em background." };
        } catch (e: any) {
            console.error(e);
            set.status = 500;
            return { error: "Falha ao enfileirar a publicação da tabela de preço.", details: e.message };
        }
    }, {
        params: t.Object({ id: t.String() }),
        detail: {
            summary: "Publicar tabela de preço (assíncrono)",
            description: "Enfileira um job em background que reprocessa os dados importados (escopados por :id) e faz upsert por chave natural em CRM_Produto_Material/CRM_Produto_Composicao, preservando idMaterial/idComposicao já referenciados em propostas. Retorna 202 com o jobId imediatamente; use GET /tabela-preco/job/:jobId para acompanhar o status. Protegido por circuit breaker: após falhas consecutivas, novas tentativas são pausadas automaticamente por um período antes de tentar de novo.",
        },
    })

    .get("/:id/produtos", async ({ params, set }) => {
        const id = Number(params.id);
        try {
            const { produtos, composicoesParaPublicar } = await parseStagingTabelaPreco(id);

            const composicoesPorImportacao = new Map<number, { nomComposicao: string; PesoEmbalagem: number | null }>();
            for (const c of composicoesParaPublicar) {
                if (c.idComposicaoImportacao != null) {
                    composicoesPorImportacao.set(c.idComposicaoImportacao, { nomComposicao: c.nomComposicao, PesoEmbalagem: c.PesoEmbalagem });
                }
            }

            const grupos = new Map<number, { nomComposicao: string; PesoEmbalagem: number | null; itens: typeof produtos }>();
            const avulsos: typeof produtos = [];

            for (const p of produtos) {
                const comp = p.idComposicaoImportacao != null ? composicoesPorImportacao.get(p.idComposicaoImportacao) : undefined;
                if (comp && p.idComposicaoImportacao != null) {
                    if (!grupos.has(p.idComposicaoImportacao)) {
                        grupos.set(p.idComposicaoImportacao, { ...comp, itens: [] });
                    }
                    grupos.get(p.idComposicaoImportacao)!.itens.push(p);
                } else {
                    avulsos.push(p);
                }
            }

            return conv({
                total: produtos.length,
                composicoes: Array.from(grupos.values()),
                avulsos,
            });
        } catch (e: any) {
            set.status = 404;
            return { error: e.message };
        }
    }, {
        params: t.Object({ id: t.String() }),
        detail: {
            summary: "Pré-visualizar produtos de uma tabela de preço",
            description: "Lê os dados de staging (tbTabelaPrecoImport) de uma tabela de preço :id, sem alterar nada, e retorna os produtos agrupados por composição (com peso de embalagem) e os materiais avulsos. Funciona tanto para tabelas com status 'Importado' quanto 'Publicado', já que o staging é preservado após a publicação — útil para o modal 'Visualizar Produtos' no frontend.",
        },
    })

    .get("/erros", async () => {
        const rows = await prisma.$queryRawUnsafe(`
            SELECT TOP 10 j.id AS jobId, j.tipo, j.idReferencia, j.erro, j.dtaFim, j.dtaCriacao,
                   t.ArquivoNome
            FROM tbJob j
            LEFT JOIN tbTabelaPreco t ON t.id = j.idReferencia
            WHERE j.tipo IN ('${JOB_TABELA_PRECO_IMPORTAR}', '${JOB_TABELA_PRECO_PUBLICAR}')
              AND j.status = 'ERRO'
            ORDER BY j.dtaFim DESC
        `);
        return conv(rows);
    }, {
        detail: {
            summary: "Listar erros recentes de importação/publicação de tabela de preço",
            description: "Retorna os 10 jobs mais recentes com status ERRO dos tipos de importação/publicação de tabela de preço, incluindo o nome do arquivo associado e a mensagem de erro, para exibição em um centro de notificações.",
        },
    })

    .get("/job/:jobId", async ({ params, set }) => {
        const jobId = Number(params.jobId);
        const job = await prisma.tbJob.findUnique({ where: { id: jobId } });
        if (!job) {
            set.status = 404;
            return { error: "Job não encontrado." };
        }
        return conv({
            ...job,
            circuito: getCircuitState(job.tipo),
        });
    }, {
        params: t.Object({ jobId: t.String() }),
        detail: {
            summary: "Consultar status de um job",
            description: "Retorna o status atual de um job em background (PENDENTE, PROCESSANDO, CONCLUIDO, ERRO), número de tentativas, erro (se houver) e o estado do circuit breaker associado ao tipo do job (CLOSED/OPEN/HALF_OPEN).",
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
