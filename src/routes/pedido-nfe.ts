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

const BASE_JOINS = `
    FROM CRM_PedidosAbertos_ItemExtra e WITH (NOLOCK)
    LEFT JOIN CRM_Proposta p   WITH (NOLOCK) ON e.PropostaNo = p.PropostaNo
    LEFT JOIN CRM_Contato  c   WITH (NOLOCK) ON p.idContato  = c.idContato
    LEFT JOIN CRM_Usuario  rep WITH (NOLOCK) ON c.idRepresentante = rep.idUsuario
    LEFT JOIN CRM_StatusGeral sg_est WITH (NOLOCK) ON e.idEstoqueStatus    = sg_est.id
    LEFT JOIN CRM_StatusGeral sg_fin WITH (NOLOCK) ON e.idFinanceiroStatus = sg_fin.id
    LEFT JOIN CRM_StatusGeral sg_prod WITH (NOLOCK) ON e.idProducaoStatus  = sg_prod.id
    LEFT JOIN CRM_StatusGeral sg_exp WITH (NOLOCK) ON e.idExpedicaoStatus  = sg_exp.id
    LEFT JOIN CRM_StatusGeral sg_pri WITH (NOLOCK) ON e.idPrioridadeStatus = sg_pri.id
    LEFT JOIN CRM_StatusGeral sg_sep WITH (NOLOCK) ON e.idSeparacaoStatus  = sg_sep.id
    LEFT JOIN CRM_StatusGeral sg_set WITH (NOLOCK) ON e.idSetorStatus      = sg_set.id
    LEFT JOIN CRM_StatusGeral sg_ac  WITH (NOLOCK) ON e.idAcertoCorStatus  = sg_ac.id
    LEFT JOIN CRM_StatusGeral sg_env WITH (NOLOCK) ON e.idEnvaseStatus     = sg_env.id
`;

const BASE_SELECT = `
    SELECT
        e.id,
        e.idPropostaDetalhe,
        PropostaNo          = ISNULL(e.PropostaNo, ''),
        dtaEnvio            = ISNULL(CONVERT(varchar(10), e.dtaEnvio, 23), ''),
        nomComercial        = ISNULL(e.nomComercial, ''),
        NCM                 = ISNULL(e.NCM, ''),
        CodMaterial         = ISNULL(e.CodMaterial, ''),
        nomMaterial         = ISNULL(e.nomMaterial, ''),
        Unidade             = ISNULL(e.Unidade, ''),
        PesoEmbalagem       = ISNULL(e.PesoEmbalagem, 0),
        TTKG                = ISNULL(e.TTKG, 0),
        TTCJ                = ISNULL(e.TTCJ, 0),
        Lote                = ISNULL(e.Lote, ''),
        codTotvs            = ISNULL(e.codTotvs, ''),
        Representante       = ISNULL(rep.Nome, ''),
        Cliente             = ISNULL(c.nomComercial, ''),
        e.idEstoqueStatus,
        e.idFinanceiroStatus,
        e.idProducaoStatus,
        e.idExpedicaoStatus,
        StatusEstoque       = ISNULL(sg_est.Status, ''),
        CorEstoque          = ISNULL(sg_est.CorHTML, ''),
        StatusFinanceiro    = ISNULL(sg_fin.Status, ''),
        CorFinanceiro       = ISNULL(sg_fin.CorHTML, ''),
        StatusProducao      = ISNULL(sg_prod.Status, ''),
        CorProducao         = ISNULL(sg_prod.CorHTML, ''),
        StatusExpedicao     = ISNULL(sg_exp.Status, ''),
        CorExpedicao        = ISNULL(sg_exp.CorHTML, ''),
        StatusPrioridade    = ISNULL(sg_pri.Status, ''),
        CorPrioridade       = ISNULL(sg_pri.CorHTML, ''),
        StatusSeparacao     = ISNULL(sg_sep.Status, ''),
        CorSeparacao        = ISNULL(sg_sep.CorHTML, ''),
        StatusSetor         = ISNULL(sg_set.Status, ''),
        CorSetor            = ISNULL(sg_set.CorHTML, ''),
        StatusAcertoCor     = ISNULL(sg_ac.Status, ''),
        CorAcertoCor        = ISNULL(sg_ac.CorHTML, ''),
        StatusEnvase        = ISNULL(sg_env.Status, ''),
        CorEnvase           = ISNULL(sg_env.CorHTML, ''),
        dtaInicio           = ISNULL(CONVERT(varchar(10), e.dtaInicio, 23), ''),
        dtaEntrega          = ISNULL(CONVERT(varchar(10), e.dtaEntrega, 23), ''),
        dtaFinalEfetiva     = ISNULL(CONVERT(varchar(10), e.dtaFinalEfetiva, 23), '')
`;

const ALLOWED_STATUS_FIELDS = [
    "idEstoqueStatus",
    "idFinanceiroStatus",
    "idProducaoStatus",
    "idExpedicaoStatus",
    "idPrioridadeStatus",
    "idSetorStatus",
    "idSeparacaoStatus",
    "idAcertoCorStatus",
    "idEnvaseStatus",
];

export const pedidoNfeRoutes = new Elysia({ detail: { tags: ["Pedidos"] }, prefix: "/pedido-nfe" })

    .get("/", async ({ query }) => {
        const { search, propostaNo, codMaterial, representante, dtaInicio, dtaFim, page, limit, userId, userGroup } = query as Record<string, string | undefined>;

        const uid = Number(userId || 0);
        const ugid = Number(userGroup || 0);
        const isAdmin = [1, 2, 3, 5, 7].includes(ugid);

        const pageNum = Math.max(1, Number(page ?? 1));
        const limitNum = Math.max(1, Number(limit ?? 50));
        const offset = (pageNum - 1) * limitNum;

        const conds: string[] = [];

        if (!isAdmin && uid > 0) conds.push(`c.idRepresentante = ${uid}`);

        if (propostaNo) conds.push(`e.PropostaNo LIKE '%${propostaNo.replace(/'/g, "''")}%'`);
        if (codMaterial) conds.push(`e.CodMaterial LIKE '%${codMaterial.replace(/'/g, "''")}%'`);
        if (representante) conds.push(`rep.Nome LIKE '%${representante.replace(/'/g, "''")}%'`);
        if (dtaInicio) conds.push(`e.dtaEnvio >= '${dtaInicio}'`);
        if (dtaFim) conds.push(`e.dtaEnvio <= '${dtaFim} 23:59:59'`);
        if (search) {
            const s = search.replace(/'/g, "''");
            conds.push(`(e.PropostaNo LIKE '%${s}%' OR e.nomComercial LIKE '%${s}%' OR e.nomMaterial LIKE '%${s}%' OR c.nomComercial LIKE '%${s}%' OR e.Lote LIKE '%${s}%')`);
        }

        const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";

        try {
            const [rows, countRows] = await Promise.all([
                prisma.$queryRawUnsafe(`
                    ${BASE_SELECT}
                    ${BASE_JOINS}
                    ${where}
                    ORDER BY e.dtaEnvio DESC, e.id DESC
                    OFFSET ${offset} ROWS FETCH NEXT ${limitNum} ROWS ONLY
                `),
                prisma.$queryRawUnsafe(`
                    SELECT Total = COUNT(*) ${BASE_JOINS} ${where}
                `),
            ]);

            const total = conv(countRows)[0]?.Total ?? 0;
            return {
                data: conv(rows),
                meta: { page: pageNum, limit: limitNum, total, hasMore: offset + limitNum < total }
            };
        } catch (error: any) {
            console.error('Erro ao buscar pedidos:', error);
            return { data: [], meta: { page: 1, limit: 50, total: 0, hasMore: false }, error: error?.message };
        }
    }, {
        detail: {
            summary: "Listar itens de pedidos/NFe com paginação e filtros",
            description: "Retorna, com paginação (page/limit), os itens de pedidos abertos (CRM_PedidosAbertos_ItemExtra) com joins de proposta, contato, representante e todos os status gerais (estoque, financeiro, produção, expedição, prioridade, separação, setor, acerto de cor e envase). Permite filtrar por número da proposta, código do material, nome do representante, intervalo de data de envio (dtaInicio/dtaFim) e busca textual (search) em proposta, nome comercial, material, cliente e lote. Se o usuário não for admin (grupo 1, 2, 3, 5 ou 7), restringe automaticamente os resultados aos pedidos da carteira do representante (userId).",
        },
    })

    .get("/statuses", async () => {
        const rows: any[] = await prisma.$queryRawUnsafe(`
            SELECT id, Status, CorHTML, flaFinanceiro, flaEstoque, flaProducao, flaExpedicao
            FROM CRM_StatusGeral WITH (NOLOCK)
            ORDER BY id
        `);
        const all = conv(rows);
        return {
            financeiro: all.filter((r: any) => r.flaFinanceiro),
            estoque: all.filter((r: any) => r.flaEstoque),
            producao: all.filter((r: any) => r.flaProducao),
            expedicao: all.filter((r: any) => r.flaExpedicao),
        };
    }, {
        detail: {
            summary: "Listar status gerais agrupados por categoria",
            description: "Retorna todos os status cadastrados em CRM_StatusGeral, já agrupados em quatro listas (financeiro, estoque, producao, expedicao) conforme os flags flaFinanceiro, flaEstoque, flaProducao e flaExpedicao, para uso em selects de atualização de status de pedidos.",
        },
    })

    .patch("/:id/status", async ({ params, body, set }) => {
        const id = Number(params.id);
        const { field, idStatus } = body;

        if (!ALLOWED_STATUS_FIELDS.includes(field)) {
            set.status = 400;
            return { error: `Campo '${field}' não permitido.` };
        }

        try {
            await prisma.$queryRawUnsafe(
                `UPDATE CRM_PedidosAbertos_ItemExtra SET ${field} = ${Number(idStatus)} WHERE id = ${id}`
            );
            return { success: true };
        } catch (e) {
            console.error(e);
            set.status = 500;
            return { error: "Erro ao atualizar status" };
        }
    }, {
        params: t.Object({ id: t.String() }),
        body: t.Object({ field: t.String(), idStatus: t.Number() }),
        detail: {
            summary: "Atualizar status de um item de pedido",
            description: "Atualiza um campo de status específico de um item de pedido (CRM_PedidosAbertos_ItemExtra) identificado por :id. O campo a ser alterado (field) deve constar na lista de campos permitidos (idEstoqueStatus, idFinanceiroStatus, idProducaoStatus, idExpedicaoStatus, idPrioridadeStatus, idSetorStatus, idSeparacaoStatus, idAcertoCorStatus, idEnvaseStatus); requisições com outros campos retornam 400.",
        },
    })

    .get("/filtros/representantes", async () => {
        const reps = await prisma.$queryRawUnsafe(`
            SELECT DISTINCT u.idUsuario, u.Nome
            FROM CRM_Usuario u WITH (NOLOCK)
            WHERE u.flaAtivo = 1
            ORDER BY u.Nome
        `);
        return conv(reps);
    }, {
        detail: {
            summary: "Listar representantes para filtro de pedidos",
            description: "Retorna a lista distinta de usuários ativos (flaAtivo = 1) da tabela CRM_Usuario, contendo apenas idUsuario e Nome, ordenados por nome, para popular o filtro de representante na tela de pedidos/NFe.",
        },
    })

    .get("/filtros/propostas", async () => {
        const rows = await prisma.$queryRawUnsafe(`
            SELECT DISTINCT TOP 1000 PropostaNo
            FROM CRM_PedidosAbertos_ItemExtra WITH (NOLOCK)
            WHERE PropostaNo IS NOT NULL AND PropostaNo <> ''
            ORDER BY PropostaNo DESC
        `);
        return conv(rows);
    }, {
        detail: {
            summary: "Listar números de proposta para filtro de pedidos",
            description: "Retorna até 1000 números de proposta distintos e não vazios (PropostaNo) da tabela CRM_PedidosAbertos_ItemExtra, ordenados do mais recente para o mais antigo, para popular o filtro de proposta na tela de pedidos/NFe.",
        },
    });
