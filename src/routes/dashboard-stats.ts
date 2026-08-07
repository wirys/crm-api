import { Elysia, t } from "elysia";
import { prisma } from "../lib/prisma";
import { getUserContext } from "../lib/user-context";

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
    .get("/overview", async ({ request }) => {
        const { userId, isAdmin } = getUserContext(request);
        const repFilter = !isAdmin && userId > 0;
        const repJoinProposta = repFilter ? `JOIN CRM_Contato c WITH (NOLOCK) ON p.idContato = c.idContato AND c.idRepresentante = ${userId}` : "";
        const repWhereContato = repFilter ? `AND t1.idRepresentante = ${userId}` : "";
        const repJoinAtividade = repFilter ? `JOIN CRM_Contato c WITH (NOLOCK) ON cu.idContato = c.idContato AND c.idRepresentante = ${userId}` : "";

        const [
            totalPropostasRows,
            totalContatosRows,
            propostasPorStatusRows,
            atividadesHojeRows,
            atividadesVencidasRows,
        ] = await Promise.all([
            prisma.$queryRawUnsafe(`SELECT Total = COUNT(*) FROM CRM_Proposta p WITH (NOLOCK) ${repJoinProposta}`),
            prisma.$queryRawUnsafe(`
                SELECT Total = COUNT(*)
                FROM CRM_Contato t1 WITH (NOLOCK)
                WHERE idStatus NOT IN (
                    SELECT idStatus FROM CRM_Proposta_Status WITH (NOLOCK)
                    WHERE Status IN ('Lixeira', 'Excluído', 'Deletado')
                )
                ${repWhereContato}
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
                ${repJoinProposta}
                GROUP BY p.idStatus, s.Status, s.CorHTML
                ORDER BY Total DESC
            `),
            prisma.$queryRawUnsafe(`
                SELECT Total = COUNT(*)
                FROM CRM_ContatoUpdate cu WITH (NOLOCK)
                ${repJoinAtividade}
                WHERE CAST(cu.dtaProximoContato AS DATE) = CAST(GETDATE() AS DATE)
            `),
            prisma.$queryRawUnsafe(`
                SELECT Total = COUNT(*)
                FROM CRM_ContatoUpdate cu WITH (NOLOCK)
                ${repJoinAtividade}
                WHERE cu.dtaProximoContato < GETDATE()
                  AND CAST(cu.dtaProximoContato AS DATE) < CAST(GETDATE() AS DATE)
            `),
        ]);

        const totalPropostas     = conv(totalPropostasRows as any[])[0]?.Total ?? 0;
        const totalContatos      = conv(totalContatosRows as any[])[0]?.Total ?? 0;
        const propostasPorStatus = conv(propostasPorStatusRows as any[]);
        const atividadesHoje     = conv(atividadesHojeRows as any[])[0]?.Total ?? 0;
        const atividadesVencidas = conv(atividadesVencidasRows as any[])[0]?.Total ?? 0;

        return { totalPropostas, totalContatos, propostasPorStatus, atividadesHoje, atividadesVencidas };
    }, {
        detail: {
            summary: "Obter visão geral do dashboard",
            description: "Retorna indicadores gerais: total de propostas, total de contatos ativos (exclui contatos com status de Lixeira/Excluído/Deletado), propostas agrupadas por status com valor somado, atividades com follow-up para hoje e atividades vencidas. Se o usuário autenticado não for admin, os dados são restritos às propostas/contatos/atividades do próprio representante.",
        },
    })

    // ── GET /dashboard-stats/propostas-por-mes ────────────────────────────────
    .get("/propostas-por-mes", async ({ request }) => {
        const { userId, isAdmin } = getUserContext(request);
        const repJoin = !isAdmin && userId > 0
            ? `JOIN CRM_Contato c WITH (NOLOCK) ON p.idContato = c.idContato AND c.idRepresentante = ${userId}`
            : "";
        const rows: any[] = await prisma.$queryRawUnsafe(`
            SELECT
                Ano   = YEAR(p.dtaCriacao),
                Mes   = MONTH(p.dtaCriacao),
                Total = COUNT(*),
                Valor = SUM(ISNULL(p.TotalValor, 0))
            FROM CRM_Proposta p WITH (NOLOCK)
            ${repJoin}
            WHERE p.dtaCriacao >= DATEADD(MONTH, -11, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1))
            GROUP BY YEAR(p.dtaCriacao), MONTH(p.dtaCriacao)
            ORDER BY Ano, Mes
        `);
        return conv(rows);
    }, {
        detail: {
            summary: "Obter propostas agrupadas por mês",
            description: "Retorna a quantidade e o valor total de propostas criadas em cada um dos últimos 12 meses (mês atual incluído), agrupados por ano e mês. Se o usuário autenticado não for admin, restringe o resultado às propostas dos contatos do próprio representante.",
        },
    })

    // ── GET /dashboard-stats/representantes ───────────────────────────────────
    .get("/representantes", async ({ request }) => {
        const { userId, isAdmin } = getUserContext(request);
        const repWhere = !isAdmin && userId > 0
            ? `WHERE c.idRepresentante = ${userId}`
            : "";
        const rows: any[] = await prisma.$queryRawUnsafe(`
            SELECT TOP 10
                u.idUsuario,
                Representante = ISNULL(u.Nome, 'N/D'),
                Total         = COUNT(p.idProposta),
                Valor         = SUM(ISNULL(p.TotalValor, 0))
            FROM CRM_Proposta p WITH (NOLOCK)
            JOIN CRM_Contato c WITH (NOLOCK) ON p.idContato = c.idContato
            JOIN CRM_Usuario u WITH (NOLOCK) ON c.idRepresentante = u.idUsuario
            ${repWhere}
            GROUP BY u.idUsuario, u.Nome
            ORDER BY SUM(ISNULL(p.TotalValor, 0)) DESC
        `);
        return conv(rows);
    }, {
        detail: {
            summary: "Ranking de representantes por valor de propostas",
            description: "Retorna o top 10 representantes com maior valor total de propostas, com a quantidade de propostas e o valor somado, ordenados do maior para o menor valor. Se o usuário autenticado não for admin, o resultado é restrito ao próprio representante.",
        },
    })

    // ── GET /dashboard-stats/consolidado ─────────────────────────────────────
    .get("/consolidado", async ({ query, request }) => {
        const { userId, isAdmin } = getUserContext(request);
        const { idUsuario, ano, mes } = query as Record<string, string | undefined>;

        const conds: string[] = [];
        if (!isAdmin && userId > 0) {
            conds.push(`idUsuario = ${userId}`);
        } else if (idUsuario) {
            conds.push(`idUsuario = ${Number(idUsuario)}`);
        }
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
        detail: {
            summary: "Listar atividades consolidadas",
            description: "Retorna registros da tabela de atividades consolidadas (CRM_AtividadeConsolidada), ordenados pela data de referência mais recente primeiro. Se o usuário não for admin, filtra automaticamente pelo próprio idUsuario; caso seja admin, pode filtrar por idUsuario informado na query. Também permite filtrar por ano e mês de referência.",
        },
    });
