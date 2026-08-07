import { Elysia, t } from "elysia";
import { Prisma } from "../generated/prisma/client";
import { prisma } from "../lib/prisma";
import { getUserContext } from "../lib/user-context";
export const activitiesRoutes = new Elysia({ detail: { tags: ["Atividades"] }, prefix: '/atividades' })
    .get("/", async ({ query, request }) => {
        try {
            const { userId, isAdmin } = getUserContext(request);

            // Parse filter parameters
            const idStatusAtividade = query.idStatusAtividade?.split(',').filter(id => id !== '0').map(Number) || [];
            const idContato = query.idContato?.split(',').filter(id => id !== '0').map(Number) || [];
            const idOrigem = query.idOrigem?.split(',').filter(id => id !== '0').map(Number) || [];
            const idTipoAtividade = query.idTipoAtividade?.split(',').filter(id => id !== '0').map(Number) || [];
            const idRepresentanteGerou = query.idRepresentanteGerou?.split(',').filter(id => id !== '0').map(Number) || [];
            let idRepresentante = query.idRepresentante?.split(',').filter(id => id !== '0').map(Number) || [];
            const idStatus = query.idStatus?.split(',').filter(id => id !== '0').map(Number) || [];
            const dtaInicio = query.dtaInicio || null;
            const dtaFim = query.dtaFim || null;

            if (!isAdmin && userId > 0) {
                idRepresentante = [userId];
            }

            // Build Raw SQL conditions
            const conditions: Prisma.Sql[] = [];

            if (idStatusAtividade.length > 0) {
                conditions.push(Prisma.sql`a.idAtividadeStatus IN (${Prisma.join(idStatusAtividade)})`);
            }

            if (idContato.length > 0) {
                conditions.push(Prisma.sql`a.idContato IN (${Prisma.join(idContato)})`);
            }

            if (idTipoAtividade.length > 0) {
                conditions.push(Prisma.sql`a.idAtividadeTipo IN (${Prisma.join(idTipoAtividade)})`);
            }

            if (idRepresentanteGerou.length > 0) {
                conditions.push(Prisma.sql`a.idUsuario IN (${Prisma.join(idRepresentanteGerou)})`);
            }

            if (dtaInicio && dtaFim) {
                conditions.push(Prisma.sql`a.dtaProximoContato >= ${new Date(dtaInicio)} AND a.dtaProximoContato <= ${new Date(dtaFim)}`);
            }

            if (idRepresentante.length > 0) {
                conditions.push(Prisma.sql`c.idRepresentante IN (${Prisma.join(idRepresentante)})`);
            }

            if (idStatus.length > 0) {
                conditions.push(Prisma.sql`c.IdStatus IN (${Prisma.join(idStatus)})`);
            }

            if (idOrigem.length > 0) {
                conditions.push(Prisma.sql`c.IdOrigem IN (${Prisma.join(idOrigem)})`);
            }

            const whereClause = conditions.length > 0
                ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
                : Prisma.empty;

            // Execute optimized raw SQL query
            const activities = await prisma.$queryRaw<any[]>(Prisma.sql`
                SELECT 
                    a.idContatoUpdate,
                    a.idContato,
                    c.nomComercial,
                    c.nomContato,
                    cs.Status AS Status,
                    cs.CorHTML AS StatusCorContato,
                    co.Origem AS Origem,
                    co.corHTML AS OrigemCorContato,
                    a.CreatedAt AS dataCadastro,
                    a.dtaProximoContato,
                    at.AtividadeTipo,
                    ass.StatusAtividade AS AtividadeStatus,
                    ass.corHTML AS StatusCorAtividade,
                    u.Nome AS Representante,
                    c.idRepresentante
                FROM CRM_ContatoUpdate a
                LEFT JOIN CRM_Contato c ON a.idContato = c.idContato
                LEFT JOIN CRM_Status cs ON c.IdStatus = cs.idStatus
                LEFT JOIN CRM_Origem co ON c.IdOrigem = co.idOrigem
                LEFT JOIN CRM_Usuario u ON c.idRepresentante = u.idUsuario
                LEFT JOIN CRM_AtividadeTipo at ON a.idAtividadeTipo = at.id
                LEFT JOIN CRM_ContatoUpdateStatus ass ON a.idAtividadeStatus = ass.idStatusAtividade
                ${whereClause}
                ORDER BY a.dtaProximoContato DESC
            `);

            return activities.map(activity => ({
                idContatoUpdate: activity.idContatoUpdate,
                idContato: activity.idContato,
                nomContato: activity.nomComercial || activity.nomContato || '',
                Status: activity.Status || '',
                StatusCorContato: activity.StatusCorContato || '',
                Origem: activity.Origem || '',
                OrigemCorContato: activity.OrigemCorContato || '',
                dataCadastro: activity.dataCadastro,
                dtaProximoContato: activity.dtaProximoContato,
                AtividadeTipo: activity.AtividadeTipo || '',
                AtividadeStatus: activity.AtividadeStatus || '',
                StatusCorAtividade: activity.StatusCorAtividade || '',
                Representante: activity.Representante || '',
                idRepresentante: activity.idRepresentante
            }));
        } catch (error) {
            console.error("Error fetching activities:", error);
            return { error: "Failed to fetch activities data" };
        }
    }, {
        query: t.Object({
            idStatusAtividade: t.Optional(t.String()),
            idContato: t.Optional(t.String()),
            idOrigem: t.Optional(t.String()),
            idTipoAtividade: t.Optional(t.String()),
            idRepresentanteGerou: t.Optional(t.String()),
            idRepresentante: t.Optional(t.String()),
            idStatus: t.Optional(t.String()),
            dtaInicio: t.Optional(t.String()),
            dtaFim: t.Optional(t.String())
        }),
        detail: {
            summary: "Listar atividades (CRM_ContatoUpdate)",
            description: "Retorna atividades de contato com dados de status, origem, tipo de atividade e representante, via consulta SQL otimizada com joins. Aceita filtros por listas separadas por vírgula de idStatusAtividade, idContato, idOrigem, idTipoAtividade, idRepresentanteGerou, idRepresentante e idStatus, além de intervalo de datas (dtaInicio/dtaFim) para a próxima data de contato. Se o usuário autenticado não for admin, o filtro de representante é forçado ao próprio usuário, ignorando o valor enviado.",
        },
    })
    .get("/test-pipeline", async () => {
        try {
            const pipelines = await prisma.cRM_Contato.findMany({
                select: { Pipeline: true },
                distinct: ['Pipeline']
            });
            return pipelines.map(p => p.Pipeline).filter(Boolean);
        } catch (error) {
            console.error(error);
            return { error: "Failed" };
        }
    }, {
        detail: {
            summary: "Listar pipelines distintos de contatos",
            description: "Retorna a lista de valores distintos do campo Pipeline presentes nos contatos cadastrados, removendo valores vazios/nulos. Usada como rota auxiliar de teste/depuração para o pipeline de contatos.",
        },
    })
    .get("/filter-options", async () => {
        try {
            const [contacts, statuses, origens, activityTypes, activityStatuses, representatives] = await Promise.all([
                prisma.cRM_Contato.findMany({ select: { idContato: true, nomComercial: true, nomContato: true }, orderBy: { nomComercial: 'asc' } }),
                prisma.cRM_Status.findMany({ select: { idStatus: true, Status: true }, orderBy: { Status: 'asc' } }),
                prisma.cRM_Origem.findMany({ select: { idOrigem: true, Origem: true }, orderBy: { Origem: 'asc' } }),
                prisma.cRM_AtividadeTipo.findMany({ select: { id: true, AtividadeTipo: true }, orderBy: { AtividadeTipo: 'asc' } }),
                prisma.cRM_ContatoUpdateStatus.findMany({ select: { idStatusAtividade: true, StatusAtividade: true }, orderBy: { StatusAtividade: 'asc' } }),
                prisma.cRM_Usuario.findMany({ select: { idUsuario: true, Nome: true }, orderBy: { Nome: 'asc' } })
            ]);

            return {
                contacts: contacts.map(c => ({ value: c.idContato.toString(), label: c.nomComercial || c.nomContato || '' })),
                statuses: statuses.map(s => ({ value: s.idStatus.toString(), label: s.Status || '' })),
                origens: origens.map(o => ({ value: o.idOrigem.toString(), label: o.Origem || '' })),
                activityTypes: activityTypes.map(t => ({ value: t.id.toString(), label: t.AtividadeTipo || '' })),
                activityStatuses: activityStatuses.map(s => ({ value: s.idStatusAtividade.toString(), label: s.StatusAtividade || '' })),
                representatives: representatives.map(r => ({ value: r.idUsuario.toString(), label: r.Nome || '' }))
            };
        } catch (error) {
            console.error("Error fetching filter options:", error);
            return { error: "Failed to fetch filter options" };
        }
    }, {
        detail: {
            summary: "Obter opções de filtro para atividades",
            description: "Retorna listas de opções (valor/rótulo) para popular os filtros da tela de atividades: contatos, status de contato, origens, tipos de atividade, status de atividade e representantes (usuários), cada uma ordenada alfabeticamente pelo respectivo nome/descrição.",
        },
    });
