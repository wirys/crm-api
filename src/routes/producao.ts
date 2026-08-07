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

const ALLOWED_STATUS_FIELDS = [
    "idProducaoStatus",
    "idSeparacaoStatus",
    "idEstoqueStatus",
    "idFinanceiroStatus",
    "idPrioridadeStatus",
    "idSetorStatus",
    "idAcertoCorStatus",
    "idEnvaseStatus",
];

const BASE_JOINS = `
    FROM CRM_PedidosAbertos_ItemExtra e WITH (NOLOCK)
    LEFT JOIN CRM_Proposta p   WITH (NOLOCK) ON e.PropostaNo = p.PropostaNo
    LEFT JOIN CRM_Contato  c   WITH (NOLOCK) ON p.idContato  = c.idContato
    LEFT JOIN CRM_Usuario  rep WITH (NOLOCK) ON c.idRepresentante = rep.idUsuario
    LEFT JOIN CRM_StatusGeral sg_prod WITH (NOLOCK) ON e.idProducaoStatus  = sg_prod.id
    LEFT JOIN CRM_StatusGeral sg_sep  WITH (NOLOCK) ON e.idSeparacaoStatus = sg_sep.id
    LEFT JOIN CRM_StatusGeral sg_pri  WITH (NOLOCK) ON e.idPrioridadeStatus = sg_pri.id
    LEFT JOIN CRM_StatusGeral sg_set  WITH (NOLOCK) ON e.idSetorStatus      = sg_set.id
    LEFT JOIN CRM_StatusGeral sg_ac   WITH (NOLOCK) ON e.idAcertoCorStatus  = sg_ac.id
    LEFT JOIN CRM_StatusGeral sg_env  WITH (NOLOCK) ON e.idEnvaseStatus     = sg_env.id
    LEFT JOIN CRM_StatusGeral sg_est  WITH (NOLOCK) ON e.idEstoqueStatus    = sg_est.id
    LEFT JOIN CRM_StatusGeral sg_fin  WITH (NOLOCK) ON e.idFinanceiroStatus = sg_fin.id
`;

const BASE_SELECT = `
    SELECT
        e.id,
        e.idPropostaDetalhe,
        PropostaNo          = ISNULL(e.PropostaNo, ''),
        dtaEnvio            = ISNULL(CONVERT(varchar(10), e.dtaEnvio, 23), ''),
        nomComercial        = ISNULL(e.nomComercial, ''),
        NCM                 = ISNULL(e.NCM, ''),
        TTKG                = ISNULL(e.TTKG, 0),
        TTCJ                = ISNULL(e.TTCJ, 0),
        CodMaterial         = ISNULL(e.CodMaterial, ''),
        nomMaterial         = ISNULL(e.nomMaterial, ''),
        codMaterialMatriz   = ISNULL(e.codMaterialMatriz, ''),
        Unidade             = ISNULL(e.Unidade, ''),
        PesoEmbalagem       = ISNULL(e.PesoEmbalagem, 0),
        e.idEstoqueStatus,
        e.idFinanceiroStatus,
        e.idProducaoStatus,
        e.idExpedicaoStatus,
        e.idPrioridadeStatus,
        e.idSetorStatus,
        e.idSeparacaoStatus,
        e.idAcertoCorStatus,
        e.idEnvaseStatus,
        Nome                = ISNULL(e.Nome, ''),
        dtaInicio           = ISNULL(CONVERT(varchar(10), e.dtaInicio, 23), ''),
        dtaEntrega          = ISNULL(CONVERT(varchar(10), e.dtaEntrega, 23), ''),
        dtaEnvioReal        = ISNULL(CONVERT(varchar(10), e.dtaEnvioReal, 23), ''),
        Lote                = ISNULL(e.Lote, ''),
        codTotvs            = ISNULL(e.codTotvs, ''),
        dtaFinalEfetiva     = ISNULL(CONVERT(varchar(10), e.dtaFinalEfetiva, 23), ''),
        RendimentoReal      = ISNULL(e.RendimentoReal, 0),
        StatusProducao      = ISNULL(sg_prod.Status, ''),
        CorProducao         = ISNULL(sg_prod.CorHTML, ''),
        StatusSeparacao     = ISNULL(sg_sep.Status, ''),
        CorSeparacao        = ISNULL(sg_sep.CorHTML, ''),
        StatusPrioridade    = ISNULL(sg_pri.Status, ''),
        CorPrioridade       = ISNULL(sg_pri.CorHTML, ''),
        StatusSetor         = ISNULL(sg_set.Status, ''),
        CorSetor            = ISNULL(sg_set.CorHTML, ''),
        StatusAcertoCor     = ISNULL(sg_ac.Status, ''),
        CorAcertoCor        = ISNULL(sg_ac.CorHTML, ''),
        StatusEnvase        = ISNULL(sg_env.Status, ''),
        CorEnvase           = ISNULL(sg_env.CorHTML, ''),
        StatusEstoque       = ISNULL(sg_est.Status, ''),
        CorEstoque          = ISNULL(sg_est.CorHTML, ''),
        StatusFinanceiro    = ISNULL(sg_fin.Status, ''),
        CorFinanceiro       = ISNULL(sg_fin.CorHTML, '')
`;

export const producaoRoutes = new Elysia({ detail: { tags: ["Producao"] }, prefix: "/producao" })

    // ── GET /producao ─── em andamento ───────────────────────────────────────
    .get("/", async ({ query }) => {
        const { search, propostaNo, codMaterial, lote, page, limit, userId, userGroup } = query as Record<string, string | undefined>;

        const uid     = Number(userId    || 0);
        const ugid    = Number(userGroup || 0);
        const isAdmin = [1, 2, 3, 5, 7].includes(ugid);

        const pageNum  = Math.max(1, Number(page  ?? 1));
        const limitNum = Math.max(1, Number(limit ?? 100));
        const offset   = (pageNum - 1) * limitNum;

        const conds: string[] = ["e.dtaFinalEfetiva IS NULL"];

        // Filtro de carteira — vendedor só vê sua própria produção
        if (!isAdmin && uid > 0) conds.push(`c.idRepresentante = ${uid}`);

        if (propostaNo) conds.push(`e.PropostaNo LIKE '%${propostaNo.replace(/'/g, "''")}%'`);
        if (codMaterial) conds.push(`e.CodMaterial LIKE '%${codMaterial.replace(/'/g, "''")}%'`);
        if (lote) conds.push(`e.Lote LIKE '%${lote.replace(/'/g, "''")}%'`);
        if (search) {
            const s = search.replace(/'/g, "''");
            conds.push(`(e.PropostaNo LIKE '%${s}%' OR e.nomComercial LIKE '%${s}%' OR e.nomMaterial LIKE '%${s}%' OR e.Lote LIKE '%${s}%')`);
        }

        const where = `WHERE ${conds.join(" AND ")}`;

        const [rows, countRows] = await Promise.all([
            prisma.$queryRawUnsafe(`
                ${BASE_SELECT}
                ${BASE_JOINS}
                ${where}
                ORDER BY e.dtaEntrega ASC, e.id DESC
                OFFSET ${offset} ROWS FETCH NEXT ${limitNum} ROWS ONLY
            `),
            prisma.$queryRawUnsafe(`
                SELECT Total = COUNT(*) ${BASE_JOINS} ${where}
            `),
        ]);

        return { data: conv(rows), total: conv(countRows)[0]?.Total ?? 0 };
    }, {
        query: t.Object({
            search:      t.Optional(t.String()),
            propostaNo:  t.Optional(t.String()),
            codMaterial: t.Optional(t.String()),
            lote:        t.Optional(t.String()),
            page:        t.Optional(t.String()),
            limit:       t.Optional(t.String()),
        }),
        detail: {
            summary: "Listar itens de produção em andamento",
            description: "Retorna, de forma paginada, os itens de pedidos (CRM_PedidosAbertos_ItemExtra) ainda não concluídos (dtaFinalEfetiva IS NULL), com dados de proposta, cliente, representante e status de produção/separação/prioridade/setor/etc. Aceita busca textual (proposta, cliente, material, lote), filtros por número de proposta, código de material e lote, além de page/limit. Vendedores (userGroup fora de 1,2,3,5,7) só visualizam itens da própria carteira de clientes.",
        },
    })

    // ── GET /producao/filter-options ──────────────────────────────────────────
    .get("/filter-options", async () => {
        const [lotes, materiais] = await Promise.all([
            prisma.$queryRawUnsafe(`
                SELECT DISTINCT Lote FROM CRM_PedidosAbertos_ItemExtra WITH (NOLOCK)
                WHERE Lote IS NOT NULL AND Lote <> ''
                ORDER BY Lote
            `),
            prisma.$queryRawUnsafe(`
                SELECT DISTINCT CodMaterial, nomMaterial FROM CRM_PedidosAbertos_ItemExtra WITH (NOLOCK)
                WHERE CodMaterial IS NOT NULL AND CodMaterial <> ''
                ORDER BY nomMaterial
            `),
        ]);
        return {
            lotes:     conv(lotes).map((r: any) => r.Lote),
            materiais: conv(materiais),
        };
    }, {
        detail: {
            summary: "Listar opções de filtro de produção",
            description: "Retorna, em paralelo, a lista distinta de lotes e a lista distinta de materiais (código e nome) presentes em CRM_PedidosAbertos_ItemExtra, usadas para popular os filtros da tela de produção.",
        },
    })

    // ── GET /producao/statuses ────────────────────────────────────────────────
    .get("/statuses", async () => {
        const rows: any[] = await prisma.$queryRawUnsafe(`
            SELECT id, Status, CorHTML, flaProducao, flaSeparacao, flaEstoque, flaFinanceiro,
                   flaPrioridade, flaSetor, flaAcertoCor, flaEnvase
            FROM CRM_StatusGeral WITH (NOLOCK)
            ORDER BY id
        `);
        const all = conv(rows).map((r: any) => ({
            id: r.id,
            descricao: r.Status,
            cor: r.CorHTML,
            flaProducao: r.flaProducao,
            flaSeparacao: r.flaSeparacao,
            flaEstoque: r.flaEstoque,
            flaFinanceiro: r.flaFinanceiro,
            flaPrioridade: r.flaPrioridade,
            flaSetor: r.flaSetor,
            flaAcertoCor: r.flaAcertoCor,
            flaEnvase: r.flaEnvase,
        }));
        return {
            producao:   all.filter((r: any) => r.flaProducao),
            separacao:  all.filter((r: any) => r.flaSeparacao),
            estoque:    all.filter((r: any) => r.flaEstoque),
            financeiro: all.filter((r: any) => r.flaFinanceiro),
            prioridade: all.filter((r: any) => r.flaPrioridade),
            setor:      all.filter((r: any) => r.flaSetor),
            acertoCor:  all.filter((r: any) => r.flaAcertoCor),
            envase:     all.filter((r: any) => r.flaEnvase),
        };
    }, {
        detail: {
            summary: "Listar status por categoria de produção",
            description: "Retorna todos os status gerais (CRM_StatusGeral) já classificados por categoria (producao, separacao, estoque, financeiro, prioridade, setor, acertoCor, envase) com base nas flags fla* de cada registro, incluindo id, descrição e cor em HTML de cada status.",
        },
    })

    // ── GET /producao/concluidos ──────────────────────────────────────────────
    .get("/concluidos", async ({ query }) => {
        const { search, dtaInicio, dtaFim, page, limit, userId, userGroup } = query as Record<string, string | undefined>;

        const uid     = Number(userId    || 0);
        const ugid    = Number(userGroup || 0);
        const isAdmin = [1, 2, 3, 5, 7].includes(ugid);

        const pageNum  = Math.max(1, Number(page  ?? 1));
        const limitNum = Math.max(1, Number(limit ?? 100));
        const offset   = (pageNum - 1) * limitNum;

        const conds: string[] = ["e.dtaFinalEfetiva IS NOT NULL"];

        if (!isAdmin && uid > 0) conds.push(`c.idRepresentante = ${uid}`);

        if (dtaInicio) conds.push(`e.dtaFinalEfetiva >= '${dtaInicio}'`);
        if (dtaFim)    conds.push(`e.dtaFinalEfetiva <= '${dtaFim} 23:59:59'`);
        if (search) {
            const s = search.replace(/'/g, "''");
            conds.push(`(e.PropostaNo LIKE '%${s}%' OR e.nomComercial LIKE '%${s}%' OR e.nomMaterial LIKE '%${s}%' OR e.Lote LIKE '%${s}%')`);
        }

        const where = `WHERE ${conds.join(" AND ")}`;

        const [rows, countRows] = await Promise.all([
            prisma.$queryRawUnsafe(`
                ${BASE_SELECT}
                ${BASE_JOINS}
                ${where}
                ORDER BY e.dtaFinalEfetiva DESC, e.id DESC
                OFFSET ${offset} ROWS FETCH NEXT ${limitNum} ROWS ONLY
            `),
            prisma.$queryRawUnsafe(`
                SELECT Total = COUNT(*) ${BASE_JOINS} ${where}
            `),
        ]);

        return { data: conv(rows), total: conv(countRows)[0]?.Total ?? 0 };
    }, {
        query: t.Object({
            search:    t.Optional(t.String()),
            dtaInicio: t.Optional(t.String()),
            dtaFim:    t.Optional(t.String()),
            page:      t.Optional(t.String()),
            limit:     t.Optional(t.String()),
        }),
        detail: {
            summary: "Listar itens de produção concluídos",
            description: "Retorna, de forma paginada, os itens de pedidos (CRM_PedidosAbertos_ItemExtra) já concluídos (dtaFinalEfetiva IS NOT NULL), ordenados pela data de conclusão mais recente. Aceita busca textual, filtro por período de conclusão (dtaInicio/dtaFim) e page/limit. Vendedores (userGroup fora de 1,2,3,5,7) só visualizam itens da própria carteira de clientes.",
        },
    })

    // ── PATCH /producao/:id/status ────────────────────────────────────────────
    .patch("/:id/status", async ({ params, body, set }) => {
        const id = Number(params.id);
        const { field, idStatus } = body;

        if (!ALLOWED_STATUS_FIELDS.includes(field)) {
            set.status = 400;
            return { error: `Campo '${field}' não permitido. Campos válidos: ${ALLOWED_STATUS_FIELDS.join(", ")}` };
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
        body:   t.Object({ field: t.String(), idStatus: t.Number() }),
        detail: {
            summary: "Atualizar campo de status de um item de produção",
            description: "Atualiza um dos campos de status (idProducaoStatus, idSeparacaoStatus, idEstoqueStatus, idFinanceiroStatus, idPrioridadeStatus, idSetorStatus, idAcertoCorStatus ou idEnvaseStatus) do item :id em CRM_PedidosAbertos_ItemExtra. O nome do campo é validado contra uma lista de campos permitidos (ALLOWED_STATUS_FIELDS); campos fora dessa lista retornam erro 400.",
        },
    })

    // ── PATCH /producao/:id/concluir ──────────────────────────────────────────
    .patch("/:id/concluir", async ({ params, set }) => {
        const id = Number(params.id);
        try {
            await prisma.$queryRawUnsafe(
                `UPDATE CRM_PedidosAbertos_ItemExtra SET dtaFinalEfetiva = GETDATE() WHERE id = ${id}`
            );
            return { success: true };
        } catch (e) {
            console.error(e);
            set.status = 500;
            return { error: "Erro ao concluir item" };
        }
    }, {
        params: t.Object({ id: t.String() }),
        detail: {
            summary: "Concluir item de produção",
            description: "Marca o item :id de CRM_PedidosAbertos_ItemExtra como concluído, gravando a data/hora atual (GETDATE) no campo dtaFinalEfetiva. Esse campo é o que determina se o item aparece na listagem de itens em andamento ou de concluídos.",
        },
    });
