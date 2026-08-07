
import { jwt } from "@elysiajs/jwt";
import { Elysia } from "elysia";
import { prisma } from "../lib/prisma";

export const dashboardRoutes = new Elysia({ detail: { tags: ["Dashboard"] }, prefix: "/dashboard" })
    .use(
        jwt({
            name: "jwt",
            secret: process.env.JWT_SECRET || "secret-crm-eltech-2024",
        })
    )
    .get("/stats", async ({ jwt, headers, set }) => {
        const authHeader = headers['authorization'];
        if (!authHeader) {
            set.status = 401;
            return { message: "Não autorizado" };
        }

        const token = authHeader.split(' ')[1];
        const payload = await jwt.verify(token);
        if (!payload) {
            set.status = 401;
            return { message: "Token inválido" };
        }

        const userId = payload.idUsuario as number;
        const authorized = payload.Autorizado as number; // 1: Admin, 2: Rep

        const userFilter: any = authorized === 1 ? {} : { idRepresentante: userId };
        const proposalUserFilter: any = authorized === 1 ? {} : { idUsuario: userId };

        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        // --- 1. CORE KPIs ---
        const wonProposals = await prisma.cRM_Proposta.findMany({
            where: {
                ...proposalUserFilter,
                idStatus: { in: [5, 9] }
            }
        });

        const totalWonValue = wonProposals.reduce((acc, p) => acc + Number(p.Valor || 0), 0);
        const wonCount = wonProposals.length;
        const avgTicket = wonCount > 0 ? totalWonValue / wonCount : 0;

        const totalClosedProposals = await prisma.cRM_Proposta.count({
            where: {
                ...proposalUserFilter,
                idStatus: { in: [5, 6, 7, 9] }
            }
        });
        const winRate = totalClosedProposals > 0 ? (wonCount / totalClosedProposals) * 100 : 0;

        const activeProposals = await prisma.cRM_Proposta.findMany({
            where: {
                ...proposalUserFilter,
                idStatus: { in: [1, 2, 3, 4, 8] } // Non-closed statuses
            }
        });
        const pipelineValue = activeProposals.reduce((acc, p) => acc + Number(p.Valor || 0), 0);

        // --- 2. MONTHLY EVOLUTION (Last 6 Months) ---
        const last6Months = [];
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const start = new Date(d.getFullYear(), d.getMonth(), 1);
            const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);

            const monthWon = await prisma.cRM_Proposta.findMany({
                where: {
                    ...proposalUserFilter,
                    idStatus: { in: [5, 9] },
                    dtaCriacao: { gte: start, lte: end }
                }
            });

            last6Months.push({
                month: d.toLocaleString('pt-BR', { month: 'short' }).toUpperCase(),
                value: monthWon.reduce((acc, p) => acc + Number(p.Valor || 0), 0)
            });
        }

        // --- 3. PERFORMANCE BY REPRESENTATIVE (Top Sellers) ---
        const repFilter = authorized === 1 ? "" : `AND c.idRepresentante = ${userId}`;
        const repRows: any[] = await prisma.$queryRawUnsafe(`
            SELECT TOP 5
                u.idUsuario,
                Nome = ISNULL(u.Nome, 'Desconhecido'),
                totalValor = SUM(ISNULL(p.Valor, 0)),
                totalCount = COUNT(*)
            FROM CRM_Proposta p WITH (NOLOCK)
            LEFT JOIN CRM_Contato c WITH (NOLOCK) ON p.idContato = c.idContato
            LEFT JOIN CRM_Usuario u WITH (NOLOCK) ON c.idRepresentante = u.idUsuario
            WHERE p.idStatus IN (5, 9) ${repFilter}
            GROUP BY u.idUsuario, u.Nome
            ORDER BY SUM(ISNULL(p.Valor, 0)) DESC
        `);
        const repRanking = repRows.map((r: any) => ({
            id: Number(r.idUsuario),
            name: r.Nome,
            value: Number(r.totalValor),
            count: Number(r.totalCount),
        }));

        // --- 4. BY SEGMENT ---
        const segFilter = authorized === 1 ? "" : `AND c.idRepresentante = ${userId}`;
        const segRows: any[] = await prisma.$queryRawUnsafe(`
            SELECT TOP 5
                Segmento = ISNULL(NULLIF(c.SegmentoAtuacao, ''), 'Outros'),
                totalValor = SUM(ISNULL(p.Valor, 0))
            FROM CRM_Proposta p WITH (NOLOCK)
            LEFT JOIN CRM_Contato c WITH (NOLOCK) ON p.idContato = c.idContato
            WHERE p.idStatus IN (5, 9) ${segFilter}
            GROUP BY c.SegmentoAtuacao
            ORDER BY SUM(ISNULL(p.Valor, 0)) DESC
        `);
        const segments = segRows.map((r: any) => ({
            name: r.Segmento,
            value: Number(r.totalValor),
        }));

        // --- 5. PIPELINE BY STATUS ---
        const pipelineByStatusRaw = await prisma.cRM_Proposta.groupBy({
            by: ['idStatus'],
            where: {
                ...proposalUserFilter,
                idStatus: { in: [1, 2, 3, 4, 8] }
            },
            _sum: { Valor: true },
            _count: true
        });

        // Map status IDs to names (hardcoded for brevity or fetch from DB)
        // From discovery: 1: Criação, 2: Checagem, 3: Validado, 4: Enviado, 8: Amostra Enviada
        const statusNames: Record<number, string> = {
            1: "Criação",
            2: "Checagem",
            3: "Validado",
            4: "Enviado",
            8: "Amostra"
        };

        const pipelineByStatus = pipelineByStatusRaw.map(p => ({
            status: statusNames[p.idStatus || 0] || "Outros",
            value: Number(p._sum.Valor || 0),
            count: p._count
        }));

        return {
            kpis: {
                totalRevenue: totalWonValue,
                wonCount,
                avgTicket,
                winRate: winRate.toFixed(2) + "%",
                pipelineValue
            },
            evolution: last6Months,
            repRanking,
            segments,
            pipelineByStatus
        };
    }, {
        detail: {
            summary: "Obter estatísticas do dashboard",
            description: "Retorna KPIs consolidados (faturamento ganho, ticket médio, taxa de conversão, valor em pipeline), evolução mensal dos últimos 6 meses, ranking dos 5 principais representantes, distribuição por segmento e pipeline por status. Exige token JWT válido no header Authorization. Se o usuário não for administrador (Autorizado !== 1), os dados são filtrados apenas para o próprio representante (idRepresentante/idUsuario).",
        },
    });
