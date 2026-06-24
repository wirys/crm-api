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

export const dashboardStatsRoutes = new Elysia({ detail: { tags: ["Dashboard"] }, prefix: "/dashboard-stats" })

    // ── GET /dashboard-stats/overview ─────────────────────────────────────────
    .get("/overview", async () => {
        const [
            totalPropostasRows,
            totalContatosRows,
            propostasPorStatusRows,
            atividadesHojeRows,
            atividadesVencidasRows,
        ] = await Promise.all([
            prisma.$queryRawUnsafe(`SELECT Total = COUNT(*) FROM CRM_Proposta WITH (NOLOCK)`),
            prisma.$queryRawUnsafe(`
                SELECT Total = COUNT(*)
                FROM CRM_Contato WITH (NOLOCK)
                WHERE idStatus NOT IN (
                    SELECT idStatus FROM CRM_Proposta_Status WITH (NOLOCK)
                    WHERE Status IN ('Lixeira', 'Excluído', 'Deletado')
                )
            `),
            prisma.$queryRawUnsafe(`
                SELECT
                    p.idStatus,
                    Status   = ISNULL(s.Status, 'N/D'),
                    CorHTML  = ISNULL(s.CorHTML, '#6b7280'),
                    Total    = COUNT(*),
                    Valor    = SUM(ISNULL(p.TotalValor, 0))
                FROM CRM_Proposta p WITH (NOLOCK)
                LEFT JOIN CRM_Proposta_Status s WITH (NOLOCK) ON p.idStatus = s.idStatus
                GROUP BY p.idStatus, s.Status, s.CorHTML
                ORDER BY Total DESC
            `),
            prisma.$queryRawUnsafe(`
                SELECT Total = COUNT(*)
                FROM CRM_ContatoUpdate WITH (NOLOCK)
                WHERE CAST(dtaProximoContato AS DATE) = CAST(GETDATE() AS DATE)
            `),
            prisma.$queryRawUnsafe(`
                SELECT Total = COUNT(*)
                FROM CRM_ContatoUpdate WITH (NOLOCK)
                WHERE dtaProximoContato < GETDATE()
                  AND CAST(dtaProximoContato AS DATE) < CAST(GETDATE() AS DATE)
            `),
        ]);

        const totalPropostas     = conv(totalPropostasRows as any[])[0]?.Total ?? 0;
        const totalContatos      = conv(totalContatosRows as any[])[0]?.Total ?? 0;
        const propostasPorStatus = conv(propostasPorStatusRows as any[]);
        const atividadesHoje     = conv(atividadesHojeRows as any[])[0]?.Total ?? 0;
        const atividadesVencidas = conv(atividadesVencidasRows as any[])[0]?.Total ?? 0;

        return { totalPropostas, totalContatos, propostasPorStatus, atividadesHoje, atividadesVencidas };
    })

    // ── GET /dashboard-stats/propostas-por-mes ────────────────────────────────
    .get("/propostas-por-mes", async () => {
        const rows: any[] = await prisma.$queryRawUnsafe(`
            SELECT
                Ano   = YEAR(dtaCriacao),
                Mes   = MONTH(dtaCriacao),
                Total = COUNT(*),
                Valor = SUM(ISNULL(TotalValor, 0))
            FROM CRM_Proposta WITH (NOLOCK)
            WHERE dtaCriacao >= DATEADD(MONTH, -11, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1))
            GROUP BY YEAR(dtaCriacao), MONTH(dtaCriacao)
            ORDER BY Ano, Mes
        `);
        return conv(rows);
    })

    // ── GET /dashboard-stats/representantes ───────────────────────────────────
    .get("/representantes", async () => {
        const rows: any[] = await prisma.$queryRawUnsafe(`
            SELECT TOP 10
                u.idUsuario,
                Representante = ISNULL(u.Nome, 'N/D'),
                Total         = COUNT(p.idProposta),
                Valor         = SUM(ISNULL(p.TotalValor, 0))
            FROM CRM_Proposta p WITH (NOLOCK)
            JOIN CRM_Contato c WITH (NOLOCK) ON p.idContato = c.idContato
            JOIN CRM_Usuario u WITH (NOLOCK) ON c.idRepresentante = u.idUsuario
            GROUP BY u.idUsuario, u.Nome
            ORDER BY SUM(ISNULL(p.TotalValor, 0)) DESC
        `);
        return conv(rows);
    })

    // ── GET /dashboard-stats/consolidado ─────────────────────────────────────
    .get("/consolidado", async ({ query }) => {
        const { idUsuario, ano, mes } = query as Record<string, string | undefined>;

        const conds: string[] = [];
        if (idUsuario) conds.push(`idUsuario = ${Number(idUsuario)}`);
        if (ano)       conds.push(`YEAR(dtaReferencia) = ${Number(ano)}`);
        if (mes)       conds.push(`MONTH(dtaReferencia) = ${Number(mes)}`);

        const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

        const rows: any[] = await prisma.$queryRawUnsafe(`
            SELECT * FROM CRM_AtividadeConsolidada WITH (NOLOCK) ${where} ORDER BY dtaReferencia DESC
        `);
        return conv(rows);
    }, {
        query: t.Object({
            idUsuario: t.Optional(t.String()),
            ano:       t.Optional(t.String()),
            mes:       t.Optional(t.String()),
        }),
    });
