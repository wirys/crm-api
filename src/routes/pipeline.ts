import { Elysia, t } from "elysia";
import { prisma } from "../lib/prisma";
import { enviarPropostaParaProducao } from "../lib/producao";

function convertBigIntToNumber(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'bigint') return Number(obj);
    if (obj instanceof Date) return obj.toISOString();
    if (typeof obj === 'object' && typeof obj.toNumber === 'function') return obj.toNumber();
    if (typeof obj === 'object') {
        if (Array.isArray(obj)) return obj.map(item => convertBigIntToNumber(item));
        const converted: any = {};
        for (const key of Object.keys(obj)) {
            converted[key] = convertBigIntToNumber(obj[key]);
        }
        return converted;
    }
    return obj;
}

export const pipelineRoutes = new Elysia({ detail: { tags: ["Pipeline"] }, prefix: "/pipeline" })
    .get("/", async ({ query }) => {
        const {
            estagioProposta,
            dtaInicio,
            dtaFim,
            userId,
            userGroup
        } = query;

        const groupNum = Number(userGroup) || 0;
        const isAdmin = [1, 2, 3, 5, 7].includes(groupNum);
        const statusFilter = (estagioProposta || "1,2,3,4,6,7,8,9")
            .split(",").map(Number).filter(n => !isNaN(n) && n > 0).join(",") || "1";
        const flaAcesso = isAdmin ? 9999 : (Number(userId) || 0);
        const dta1 = dtaInicio || "0";
        const dta2 = dtaFim || "0";

        const results: any[] = await prisma.$queryRawUnsafe(`
            SELECT
                t1.idProposta,
                t1.id,
                t1.PropostaNo,
                t1.idStatus,
                t1.TotalValor,
                t1.ObsChecagem,
                t1.Possibilidade,
                t1.GanhoEstimado,
                DataPossivel = ISNULL(CONVERT(varchar(10), t1.DataPossivel, 23), ''),
                Representante = ISNULL(t6.Nome, 'N/D'),
                CriadoPor = ISNULL(t2.Nome, 'N/D'),
                Status = t3.Status,
                CorHTML = t3.CorHTML,
                RazaoSocial = ISNULL(NULLIF(t4.nomComercial, ''), t4.nomContato),
                ContatoEmpresa = t4.nomContato,
                t1.idContato,
                CondicaoPagamento = ISNULL(t5.Titulo, '')
            FROM CRM_Proposta AS t1 WITH (NOLOCK)
            LEFT JOIN CRM_Usuario AS t2 WITH (NOLOCK) ON t1.idUsuario = t2.idUsuario
            LEFT JOIN CRM_Proposta_Status AS t3 WITH (NOLOCK) ON t1.idStatus = t3.idStatus
            LEFT JOIN CRM_Contato AS t4 WITH (NOLOCK) ON t1.idContato = t4.idContato
            LEFT JOIN CRM_Proposta_CondicaoPagamento AS t5 WITH (NOLOCK) ON t1.idCondicaoPagamento = t5.idCondicaoPagamento
            LEFT JOIN CRM_Usuario AS t6 WITH (NOLOCK) ON t4.idRepresentante = t6.idUsuario
            WHERE t1.PropostaNo IS NOT NULL
                AND t1.idStatus IN (${statusFilter})
                ${flaAcesso !== 9999 ? `AND (t1.idUsuario = ${flaAcesso} OR t4.idRepresentante = ${flaAcesso})` : ''}
                ${dta1 !== "0" && dta2 !== "0" ? `AND t1.DataPossivel BETWEEN '${dta1}' AND '${dta2}'` : ''}
            ORDER BY t1.idProposta DESC
        `);

        return convertBigIntToNumber(results.map(r => ({
            idProposta: r.idProposta,
            id: r.id,
            propostaNo: r.PropostaNo,
            razaoSocial: r.RazaoSocial || "",
            representante: r.Representante || "N/D",
            criadoPor: r.CriadoPor || "N/D",
            status: r.Status || "",
            corHTML: r.CorHTML || "#cccccc",
            idStatus: r.idStatus,
            totalValor: Number(r.TotalValor || 0),
            obsChecagem: r.ObsChecagem || "",
            possibilidade: Number(r.Possibilidade || 0),
            ganhoEstimado: Number(r.GanhoEstimado || 0),
            dataPossivel: r.DataPossivel || "",
            contatoEmpresa: r.ContatoEmpresa || "",
            idContato: r.idContato || 0,
            condicaoPagamento: r.CondicaoPagamento || "",
        })));
    }, {
        query: t.Object({
            estagioProposta: t.Optional(t.String()),
            dtaInicio: t.Optional(t.String()),
            dtaFim: t.Optional(t.String()),
            userId: t.Optional(t.String()),
            userGroup: t.Optional(t.String()),
        }),
        detail: {
            summary: "Listar propostas do pipeline",
            description: "Retorna as propostas comerciais (CRM_Proposta) que possuem número de proposta preenchido, com dados de status, representante, contato e condição de pagamento. Filtra por lista de idStatus (estagioProposta), por período de DataPossivel (dtaInicio/dtaFim) e restringe por usuário/representante quando o grupo do usuário não é administrativo (grupos 1, 2, 3, 5 e 7 têm acesso total)."
        }
    })
    .get("/statuses", async () => {
        const statuses: any[] = await prisma.$queryRaw`SELECT idStatus, Status, CorHTML FROM CRM_Proposta_Status ORDER BY Status`;
        return statuses;
    }, {
        detail: {
            summary: "Listar status de proposta",
            description: "Retorna todos os status possíveis de propostas (CRM_Proposta_Status) com id, nome e cor associada, ordenados alfabeticamente pelo nome do status."
        }
    })
    .get("/filter-options", async () => {
        const [representantes, contatos, statuses] = await Promise.all([
            prisma.$queryRawUnsafe(`
                SELECT DISTINCT t3.idUsuario as id, UPPER(t3.Nome) as nome
                FROM CRM_Proposta AS t1 WITH (NOLOCK)
                INNER JOIN CRM_Contato AS t2 WITH (NOLOCK) ON t1.idContato = t2.idContato
                INNER JOIN CRM_Usuario AS t3 WITH (NOLOCK) ON t2.idRepresentante = t3.idUsuario
                WHERE t1.PropostaNo IS NOT NULL
                ORDER BY nome
            `),
            prisma.$queryRawUnsafe(`
                SELECT DISTINCT t1.idContato as id,
                       ISNULL(NULLIF(t2.nomComercial, ''), t2.nomContato) as nome
                FROM CRM_Proposta AS t1 WITH (NOLOCK)
                INNER JOIN CRM_Contato AS t2 WITH (NOLOCK) ON t1.idContato = t2.idContato
                WHERE t1.PropostaNo IS NOT NULL
                ORDER BY nome
            `),
            prisma.$queryRawUnsafe(`SELECT idStatus, Status, CorHTML FROM CRM_Proposta_Status WITH (NOLOCK) ORDER BY Status`),
        ]);
        return { representantes, contatos, statuses };
    }, {
        detail: {
            summary: "Listar opções de filtro do pipeline",
            description: "Retorna, em paralelo, as listas distintas de representantes, contatos e status vinculados a propostas com número preenchido, para popular os filtros da tela de pipeline."
        }
    })
    .get("/chart-data", async () => {
        const data: any[] = await prisma.$queryRaw`
            SELECT t2.Status, t2.CorHTML, COUNT(*) as Freq
            FROM CRM_Proposta as t1
            LEFT OUTER JOIN CRM_Proposta_Status as t2 ON t1.idStatus = t2.idStatus
            GROUP BY t2.Status, t2.CorHTML
            ORDER BY COUNT(*) ASC
        `;
        return data.map(d => ({
            status: d.Status,
            cor: d.CorHTML,
            frequencia: Number(d.Freq)
        }));
    }, {
        detail: {
            summary: "Obter dados do gráfico de propostas por status",
            description: "Agrupa todas as propostas (CRM_Proposta) por status, retornando o nome do status, a cor associada e a quantidade de propostas em cada status, ordenado do menor para o maior."
        }
    })
    .get("/resumo-status", async () => {
        const data: any[] = await prisma.$queryRaw`EXEC sp_CRMResumoStatus`;
        return convertBigIntToNumber(data);
    }, {
        detail: {
            summary: "Obter resumo de propostas por status",
            description: "Executa a stored procedure sp_CRMResumoStatus, que retorna um resumo consolidado das propostas agrupadas por status."
        }
    })
    .put("/status/:id", async ({ params, body, set }) => {
        const id = parseInt(params.id);

        const current = await prisma.cRM_Proposta.findUnique({
            where: { idProposta: id },
            select: { idStatus: true }
        });
        if (current && current.idStatus !== null && current.idStatus >= 3) {
            set.status = 403;
            return { error: "Proposta já validada e não pode mais ter a etiqueta alterada" };
        }

        await prisma.cRM_Proposta.update({
            where: { idProposta: id },
            data: { idStatus: body.idStatus }
        });

        // idStatus 5 = "Aprovado pelo cliente" — envia os itens da proposta para a Produção
        if (body.idStatus === 5) {
            await enviarPropostaParaProducao(id);
        }

        return { success: true };
    }, {
        body: t.Object({ idStatus: t.Number() }),
        detail: {
            summary: "Atualizar status da proposta",
            description: "Atualiza o idStatus de uma proposta (CRM_Proposta) pelo id na URL. Bloqueado (403) se a proposta já estiver com idStatus >= 3 (Validado ou posterior). Regra de negócio: quando o novo idStatus é 5 (\"Aprovado pelo cliente\"), os itens da proposta (CRM_Proposta_Detalhe) são automaticamente inseridos em CRM_PedidosAbertos_ItemExtra para envio à Produção, evitando duplicidade ao checar itens já existentes."
        }
    })
    .put("/obs/:id", async ({ params, body }) => {
        const id = parseInt(params.id);
        await prisma.cRM_Proposta.update({
            where: { idProposta: id },
            data: { ObsChecagem: body.obs }
        });
        return { success: true };
    }, {
        body: t.Object({ obs: t.String() }),
        detail: {
            summary: "Atualizar observação de checagem da proposta",
            description: "Atualiza o campo ObsChecagem de uma proposta (CRM_Proposta) identificada pelo id na URL, com o texto informado no corpo da requisição."
        }
    })
    .put("/possibilidade/:id", async ({ params, body }) => {
        const id = parseInt(params.id);
        await prisma.cRM_Proposta.update({
            where: { idProposta: id },
            data: { Possibilidade: body.valor }
        });
        return { success: true };
    }, {
        body: t.Object({ valor: t.Number() }),
        detail: {
            summary: "Atualizar possibilidade de fechamento da proposta",
            description: "Atualiza o campo Possibilidade (percentual/probabilidade de fechamento) de uma proposta (CRM_Proposta) identificada pelo id na URL."
        }
    })
    .put("/ganho-estimado/:id", async ({ params, body }) => {
        const id = parseInt(params.id);
        await prisma.cRM_Proposta.update({
            where: { idProposta: id },
            data: { GanhoEstimado: body.valor }
        });
        return { success: true };
    }, {
        body: t.Object({ valor: t.Number() }),
        detail: {
            summary: "Atualizar ganho estimado da proposta",
            description: "Atualiza o campo GanhoEstimado (valor estimado de ganho) de uma proposta (CRM_Proposta) identificada pelo id na URL."
        }
    })
    .put("/data-possivel/:id", async ({ params, body }) => {
        const id = parseInt(params.id);
        await prisma.cRM_Proposta.update({
            where: { idProposta: id },
            data: { DataPossivel: body.data ? new Date(body.data) : null }
        });
        return { success: true };
    }, {
        body: t.Object({ data: t.String() }),
        detail: {
            summary: "Atualizar data possível de fechamento da proposta",
            description: "Atualiza o campo DataPossivel de uma proposta (CRM_Proposta) identificada pelo id na URL. Se a data informada for vazia, o campo é definido como nulo."
        }
    })
    .delete("/:id", async ({ params }) => {
        const id = parseInt(params.id);
        await prisma.cRM_Proposta.delete({
            where: { idProposta: id }
        });
        return { success: true };
    }, {
        detail: {
            summary: "Excluir proposta",
            description: "Remove definitivamente uma proposta (CRM_Proposta) do banco de dados a partir do id informado na URL."
        }
    });
