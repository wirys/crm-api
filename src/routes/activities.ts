import { Elysia, t } from "elysia";
import { prisma } from "../lib/prisma";
export const activitiesRoutes = new Elysia({ prefix: '/atividades' })
    .get("/", async ({ query }) => {
        try {
            // Parse filter parameters
            const idStatusAtividade = query.idStatusAtividade?.split(',').filter(id => id !== '0').map(Number) || [];
            const idContato = query.idContato?.split(',').filter(id => id !== '0').map(Number) || [];
            const idOrigem = query.idOrigem?.split(',').filter(id => id !== '0').map(Number) || [];
            const idTipoAtividade = query.idTipoAtividade?.split(',').filter(id => id !== '0').map(Number) || [];
            const idRepresentanteGerou = query.idRepresentanteGerou?.split(',').filter(id => id !== '0').map(Number) || [];
            const idRepresentante = query.idRepresentante?.split(',').filter(id => id !== '0').map(Number) || [];
            const idStatus = query.idStatus?.split(',').filter(id => id !== '0').map(Number) || [];
            const dtaInicio = query.dtaInicio || null;
            const dtaFim = query.dtaFim || null;

            // Build Prisma where clause
            const whereClause: any = {};

            // Filter by activity status
            if (idStatusAtividade.length > 0) {
                whereClause.idAtividadeStatus = { in: idStatusAtividade };
            }

            // Filter by contact
            if (idContato.length > 0) {
                whereClause.idContato = { in: idContato };
            }

            // Filter by activity type
            if (idTipoAtividade.length > 0) {
                whereClause.idAtividadeTipo = { in: idTipoAtividade };
            }

            // Filter by representative who created
            if (idRepresentanteGerou.length > 0) {
                whereClause.idUsuario = { in: idRepresentanteGerou };
            }

            // Filter by date range for next contact date
            if (dtaInicio && dtaFim) {
                whereClause.dtaProximoContato = {
                    gte: new Date(dtaInicio),
                    lte: new Date(dtaFim)
                };
            }

            // Complex OR condition for representative and status/origin through Contact
            const contactWhere: any = {};
            let contactIdsFromFilter: number[] | null = null;

            if (idRepresentante.length > 0) {
                contactWhere.idRepresentante = { in: idRepresentante };
            }

            if (idStatus.length > 0) {
                contactWhere.IdStatus = { in: idStatus }; // Note: Schema uses 'IdStatus'
            }

            if (idOrigem.length > 0) {
                contactWhere.IdOrigem = { in: idOrigem }; // Note: Schema uses 'IdOrigem'
            }

            if (Object.keys(contactWhere).length > 0) {
                const filteredContacts = await prisma.cRM_Contato.findMany({
                    where: contactWhere,
                    select: { idContato: true }
                });
                contactIdsFromFilter = filteredContacts.map(c => c.idContato);
            }

            // Main query using Prisma models
            if (contactIdsFromFilter !== null) {
                // If we filtered by contact attributes, intersect with existing idContato filter if any
                if (whereClause.idContato) {
                    const existingIn = whereClause.idContato.in;
                    whereClause.idContato = { in: existingIn.filter((id: number) => contactIdsFromFilter!.includes(id)) };
                } else {
                    whereClause.idContato = { in: contactIdsFromFilter };
                }
            }

            const activities = await prisma.cRM_ContatoUpdate.findMany({
                where: whereClause,
                orderBy: {
                    dtaProximoContato: 'desc'
                }
            });

            if (activities.length === 0) {
                return [];
            }

            // Fetch related data manually
            const contactIds = [...new Set(activities.map(a => a.idContato).filter((id): id is number => id !== null))];
            const statusIds = [...new Set(activities.map(a => a.idAtividadeStatus).filter((id): id is number => id !== null))];
            const typeIds = [...new Set(activities.map(a => a.idAtividadeTipo).filter((id): id is number => id !== null))];
            const userIds = [...new Set(activities.map(a => a.idUsuario).filter((id): id is number => id !== null))];

            const [contacts, atividadeStatuses, atividadeTipos, users] = await Promise.all([
                prisma.cRM_Contato.findMany({
                    where: { idContato: { in: contactIds } }
                }),
                prisma.cRM_ContatoUpdateStatus.findMany({
                    where: { idStatusAtividade: { in: statusIds } }
                }),
                prisma.cRM_AtividadeTipo.findMany({
                    where: { id: { in: typeIds } }
                }),
                prisma.cRM_Usuario.findMany({
                    where: { idUsuario: { in: userIds } }
                })
            ]);

            // For deeper relations (Status and Origin of Contact), we need another step
            const contactStatusIds = [...new Set(contacts.map(c => c.IdStatus).filter((id): id is number => id !== null))];
            const contactOrigemIds = [...new Set(contacts.map(c => c.IdOrigem).filter((id): id is number => id !== null))];
            const contactRepIds = [...new Set(contacts.map(c => c.idRepresentante).filter((id): id is number => id !== null))];

            const [contactStatuses, contactOrigens, contactReps] = await Promise.all([
                prisma.cRM_Status.findMany({
                    where: { idStatus: { in: contactStatusIds } }
                }),
                prisma.cRM_Origem.findMany({
                    where: { idOrigem: { in: contactOrigemIds } }
                }),
                prisma.cRM_Usuario.findMany({
                    where: { idUsuario: { in: contactRepIds } }
                })
            ]);

            // Create lookup maps
            const contactMap = new Map(contacts.map(c => [c.idContato, c]));
            const atividadeStatusMap = new Map(atividadeStatuses.map(s => [s.idStatusAtividade, s]));
            const atividadeTipoMap = new Map(atividadeTipos.map(t => [t.id, t]));
            // const userMap = new Map(users.map(u => [u.idUsuario, u]));
            const contactStatusMap = new Map(contactStatuses.map(s => [s.idStatus, s]));
            const contactOrigemMap = new Map(contactOrigens.map(o => [o.idOrigem, o]));
            const contactRepMap = new Map(contactReps.map(r => [r.idUsuario, r]));

            // Map results to match the expected format
            const formattedActivities = activities.map(activity => {
                const contact = activity.idContato ? contactMap.get(activity.idContato) : null;
                const cStatus = contact?.IdStatus ? contactStatusMap.get(contact.IdStatus) : null;
                const cOrigem = contact?.IdOrigem ? contactOrigemMap.get(contact.IdOrigem) : null;
                const cRep = contact?.idRepresentante ? contactRepMap.get(contact.idRepresentante) : null;
                const aStatus = activity.idAtividadeStatus ? atividadeStatusMap.get(activity.idAtividadeStatus) : null;
                const aTipo = activity.idAtividadeTipo ? atividadeTipoMap.get(activity.idAtividadeTipo) : null;

                return {
                    idContatoUpdate: activity.idContatoUpdate,
                    idContato: activity.idContato,
                    nomContato: contact?.nomComercial || contact?.nomContato || '',
                    Status: cStatus?.Status || '',
                    StatusCorContato: cStatus?.CorHTML || '',
                    Origem: cOrigem?.Origem || '',
                    OrigemCorContato: cOrigem?.corHTML || '',
                    dataCadastro: activity.CreatedAt, // Note: Schema uses 'CreatedAt'
                    dtaProximoContato: activity.dtaProximoContato,
                    AtividadeTipo: aTipo?.AtividadeTipo || '',
                    AtividadeStatus: aStatus?.StatusAtividade || '',
                    StatusCorAtividade: aStatus?.corHTML || '',
                    Representante: cRep?.Nome || '',
                    idRepresentante: contact?.idRepresentante
                };
            });

            return formattedActivities;
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
        })
    });
