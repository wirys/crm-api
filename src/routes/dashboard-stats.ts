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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseIntList(raw: string | undefined): number[] | null {
    if (!raw) return null;
    const ids = raw.split(",").map(v => Number(v.trim())).filter(v => Number.isInteger(v) && v > 0);
    return ids.length ? ids : null;
}

function parseDate(raw: string | undefined): string | null {
    if (!raw || !DATE_RE.test(raw)) return null;
    return raw;
}

interface DashboardFilters {
    dataInicio: string | null;
    dataFim: string | null;
    idStatus: number[] | null;
    representantes: number[] | null;
}

function readFilters(request: Request, query: Record<string, string | undefined>): DashboardFilters {
    const { userId, isAdmin } = getUserContext(request);
    const queryReps = parseIntList(query.idRepresentante);
    // Não-admin sempre restrito ao próprio representante; admin pode filtrar por lista, senão vê tudo.
    const representantes = !isAdmin && userId > 0 ? [userId] : queryReps;
    return {
        dataInicio: parseDate(query.dataInicio),
        dataFim: parseDate(query.dataFim),
        idStatus: parseIntList(query.idStatus),
        representantes,
    };
}

function propostaJoinContato(filters: DashboardFilters): string {
    return filters.representantes
        ? `JOIN CRM_Contato c WITH (NOLOCK) ON p.idContato = c.idContato AND c.idRepresentante IN (${filters.representantes.join(",")})`
        : "";
}

function propostaWhere(filters: DashboardFilters, alias = "p"): string {
    const conds: string[] = [];
    if (filters.dataInicio) conds.push(`${alias}.dtaCriacao >= '${filters.dataInicio}'`);
    if (filters.dataFim) conds.push(`${alias}.dtaCriacao < DATEADD(DAY, 1, '${filters.dataFim}')`);
    if (filters.idStatus) conds.push(`${alias}.idStatus IN (${filters.idStatus.join(",")})`);
    return conds.length ? `AND ${conds.join(" AND ")}` : "";
}

function contatoJoinRep(filters: DashboardFilters, alias: string): string {
    return filters.representantes
        ? `JOIN CRM_Contato c WITH (NOLOCK) ON ${alias}.idContato = c.idContato AND c.idRepresentante IN (${filters.representantes.join(",")})`
        : "";
}

const filterQuerySchema = {
    dataInicio: t.Optional(t.String()),
    dataFim: t.Optional(t.String()),
    idStatus: t.Optional(t.String()),
    idRepresentante: t.Optional(t.String()),
};

export const dashboardStatsRoutes = new Elysia({ detail: { tags: ["Dashboard"] }, prefix: "/dashboard-stats" })

    // ── GET /dashboard-stats/overview ─────────────────────────────────────────
    .get("/overview", async ({ request, query }) => {
        const filters = readFilters(request, query as Record<string, string | undefined>);
        const repJoinProposta = propostaJoinContato(filters);
        const propWhere = propostaWhere(filters, "p");
        const repWhereContato = filters.representantes ? `AND t1.idRepresentante IN (${filters.representantes.join(",")})` : "";
        const repJoinAtividade = contatoJoinRep(filters, "cu");

        const [
            totalPropostasRows,
            totalContatosRows,
            propostasPorStatusRows,
            atividadesHojeRows,
            atividadesVencidasRows,
        ] = await Promise.all([
            prisma.$queryRawUnsafe(`SELECT Total = COUNT(*) FROM CRM_Proposta p WITH (NOLOCK) ${repJoinProposta} WHERE 1=1 ${propWhere}`),
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
                WHERE 1=1 ${propWhere}
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
        const valorTotal = propostasPorStatus.reduce((acc: number, s: any) => acc + Number(s.Valor || 0), 0);

        return { totalPropostas, totalContatos, propostasPorStatus, atividadesHoje, atividadesVencidas, valorTotal };
    }, {
        query: t.Object(filterQuerySchema),
        detail: {
            summary: "Obter visão geral do dashboard",
            description: "Retorna indicadores gerais: total de propostas, total de contatos ativos, propostas agrupadas por status com valor somado, atividades de hoje e vencidas. Aceita filtros opcionais dataInicio/dataFim (YYYY-MM-DD, sobre dtaCriacao da proposta), idStatus (lista separada por vírgula) e idRepresentante (lista separada por vírgula, apenas para admins — não-admins são sempre restritos ao próprio representante).",
        },
    })

    // ── GET /dashboard-stats/propostas-por-mes ────────────────────────────────
    .get("/propostas-por-mes", async ({ request, query }) => {
        const filters = readFilters(request, query as Record<string, string | undefined>);
        const repJoin = propostaJoinContato(filters);
        const statusCond = filters.idStatus ? `AND p.idStatus IN (${filters.idStatus.join(",")})` : "";

        const periodoCond = filters.dataInicio && filters.dataFim
            ? `p.dtaCriacao >= '${filters.dataInicio}' AND p.dtaCriacao < DATEADD(DAY, 1, '${filters.dataFim}')`
            : `p.dtaCriacao >= DATEADD(MONTH, -11, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1))`;

        const rows: any[] = await prisma.$queryRawUnsafe(`
            SELECT
                Ano   = YEAR(p.dtaCriacao),
                Mes   = MONTH(p.dtaCriacao),
                Total = COUNT(*),
                Valor = SUM(ISNULL(p.TotalValor, 0))
            FROM CRM_Proposta p WITH (NOLOCK)
            ${repJoin}
            WHERE ${periodoCond} ${statusCond}
            GROUP BY YEAR(p.dtaCriacao), MONTH(p.dtaCriacao)
            ORDER BY Ano, Mes
        `);
        return conv(rows);
    }, {
        query: t.Object(filterQuerySchema),
        detail: {
            summary: "Obter propostas agrupadas por mês",
            description: "Retorna a quantidade e o valor total de propostas por mês. Sem dataInicio/dataFim, usa os últimos 12 meses (padrão). Aceita os mesmos filtros de idStatus e idRepresentante do overview.",
        },
    })

    // ── GET /dashboard-stats/representantes ───────────────────────────────────
    .get("/representantes", async ({ request, query }) => {
        const filters = readFilters(request, query as Record<string, string | undefined>);
        const repCond = filters.representantes ? `AND c.idRepresentante IN (${filters.representantes.join(",")})` : "";
        const propWhere = propostaWhere(filters, "p");

        const rows: any[] = await prisma.$queryRawUnsafe(`
            SELECT TOP 10
                u.idUsuario,
                Representante = ISNULL(u.Nome, 'N/D'),
                Total         = COUNT(p.idProposta),
                Valor         = SUM(ISNULL(p.TotalValor, 0))
            FROM CRM_Proposta p WITH (NOLOCK)
            JOIN CRM_Contato c WITH (NOLOCK) ON p.idContato = c.idContato
            JOIN CRM_Usuario u WITH (NOLOCK) ON c.idRepresentante = u.idUsuario
            WHERE 1=1 ${repCond} ${propWhere}
            GROUP BY u.idUsuario, u.Nome
            ORDER BY SUM(ISNULL(p.TotalValor, 0)) DESC
        `);
        return conv(rows);
    }, {
        query: t.Object(filterQuerySchema),
        detail: {
            summary: "Ranking de representantes por valor de propostas",
            description: "Retorna o top 10 representantes com maior valor total de propostas. Aceita os mesmos filtros de período, status e representante do overview.",
        },
    })

    // ── GET /dashboard-stats/filter-options ───────────────────────────────────
    .get("/filter-options", async ({ request }) => {
        const { isAdmin } = getUserContext(request);
        const [representantes, statuses] = await Promise.all([
            isAdmin
                ? prisma.$queryRawUnsafe(`
                    SELECT DISTINCT u.idUsuario as id, UPPER(u.Nome) as nome
                    FROM CRM_Proposta p WITH (NOLOCK)
                    JOIN CRM_Contato c WITH (NOLOCK) ON p.idContato = c.idContato
                    JOIN CRM_Usuario u WITH (NOLOCK) ON c.idRepresentante = u.idUsuario
                    ORDER BY nome
                `)
                : Promise.resolve([]),
            prisma.$queryRawUnsafe(`SELECT idStatus, Status, CorHTML FROM CRM_Proposta_Status WITH (NOLOCK) ORDER BY Status`),
        ]);
        return { representantes: conv(representantes as any[]), statuses: conv(statuses as any[]) };
    }, {
        detail: {
            summary: "Listar opções de filtro do dashboard",
            description: "Retorna as listas de representantes (apenas para admins) e status de proposta para popular os seletores de filtro do dashboard administrativo.",
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
