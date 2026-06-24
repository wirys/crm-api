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

export const separacaoRoutes = new Elysia({ detail: { tags: ["Expedicao"] }, prefix: "/separacao" })

    // ── GET /separacao ────────────────────────────────────────────────────────
    .get("/", async ({ query }) => {
        const { search, representante, dtaInicio, dtaFim, userId, userGroup } = query as Record<string, string | undefined>;

        const uid     = Number(userId    || 0);
        const ugid    = Number(userGroup || 0);
        const isAdmin = [1, 2, 3, 5, 7].includes(ugid);

        const conds: string[] = ["e.dtaFinalEfetiva IS NULL"];

        // Filtro de carteira — vendedor só vê itens da sua carteira
        if (!isAdmin && uid > 0) conds.push(`c.idRepresentante = ${uid}`);

        if (dtaInicio) conds.push(`e.dtaEntrega >= '${dtaInicio}'`);
        if (dtaFim)    conds.push(`e.dtaEntrega <= '${dtaFim} 23:59:59'`);
        if (representante) {
            const repId = Number(representante);
            if (!isNaN(repId) && repId > 0) conds.push(`c.idRepresentante = ${repId}`);
        }
        if (search) {
            const s = search.replace(/'/g, "''");
            conds.push(`(e.PropostaNo LIKE '%${s}%' OR e.nomComercial LIKE '%${s}%' OR e.nomMaterial LIKE '%${s}%' OR e.Lote LIKE '%${s}%')`);
        }

        const where = `WHERE ${conds.join(" AND ")}`;

        const rows: any[] = await prisma.$queryRawUnsafe(`
            SELECT
                e.id,
                PropostaNo          = ISNULL(e.PropostaNo, ''),
                nomComercial        = ISNULL(e.nomComercial, ''),
                CodMaterial         = ISNULL(e.CodMaterial, ''),
                nomMaterial         = ISNULL(e.nomMaterial, ''),
                Unidade             = ISNULL(e.Unidade, ''),
                Lote                = ISNULL(e.Lote, ''),
                TTKG                = ISNULL(e.TTKG, 0),
                TTCJ                = ISNULL(e.TTCJ, 0),
                e.idSeparacaoStatus,
                StatusSeparacao     = ISNULL(sg_sep.Status, ''),
                CorSeparacao        = ISNULL(sg_sep.CorHTML, ''),
                e.idProducaoStatus,
                StatusProducao      = ISNULL(sg_prod.Status, ''),
                CorProducao         = ISNULL(sg_prod.CorHTML, ''),
                dtaEntrega          = ISNULL(CONVERT(varchar(10), e.dtaEntrega, 23), ''),
                Representante       = ISNULL(rep.Nome, '')
            FROM CRM_PedidosAbertos_ItemExtra e WITH (NOLOCK)
            LEFT JOIN CRM_Proposta p   WITH (NOLOCK) ON e.PropostaNo = p.PropostaNo
            LEFT JOIN CRM_Contato  c   WITH (NOLOCK) ON p.idContato  = c.idContato
            LEFT JOIN CRM_Usuario  rep WITH (NOLOCK) ON c.idRepresentante = rep.idUsuario
            LEFT JOIN CRM_StatusGeral sg_sep  WITH (NOLOCK) ON e.idSeparacaoStatus = sg_sep.id
            LEFT JOIN CRM_StatusGeral sg_prod WITH (NOLOCK) ON e.idProducaoStatus  = sg_prod.id
            ${where}
            ORDER BY e.dtaEntrega ASC, e.id DESC
        `);

        return { data: conv(rows), total: rows.length };
    }, {
        query: t.Object({
            search:        t.Optional(t.String()),
            representante: t.Optional(t.String()),
            dtaInicio:     t.Optional(t.String()),
            dtaFim:        t.Optional(t.String()),
            userId:        t.Optional(t.String()),
            userGroup:     t.Optional(t.String()),
        }),
    })

    // ── GET /separacao/statuses ───────────────────────────────────────────────
    .get("/statuses", async () => {
        const rows: any[] = await prisma.$queryRawUnsafe(`
            SELECT id, Status, CorHTML
            FROM CRM_StatusGeral WITH (NOLOCK)
            WHERE flaSeparacao = 1
            ORDER BY id
        `);
        return conv(rows);
    })

    // ── PATCH /separacao/:id/status ───────────────────────────────────────────
    .patch("/:id/status", async ({ params, body, set }) => {
        const id = Number(params.id);
        const { idStatus } = body;
        try {
            await prisma.$queryRawUnsafe(
                `UPDATE CRM_PedidosAbertos_ItemExtra SET idSeparacaoStatus = ${Number(idStatus)} WHERE id = ${id}`
            );
            return { success: true };
        } catch (e) {
            console.error(e);
            set.status = 500;
            return { error: "Erro ao atualizar status de separação" };
        }
    }, {
        params: t.Object({ id: t.String() }),
        body:   t.Object({ idStatus: t.Number() }),
    });
