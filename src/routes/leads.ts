import { Elysia, t } from 'elysia';
import {prisma} from "../lib/prisma";


function convertBigInt(obj: any): any {
    if (typeof obj === "bigint") {
        return obj.toString();
    }
    if (Array.isArray(obj)) {
        return obj.map(convertBigInt);
    }
    if (obj !== null && typeof obj === "object") {
        return Object.fromEntries(
            Object.entries(obj).map(([key, value]) => [key, convertBigInt(value)])
        );
    }
    return obj;
}

export const leadsRoutes = new Elysia({ prefix: "/leads" })
    // GET - Listar leads com filtros
    .get("/", async ({ query }) => {
        const representanteIds = (query.representantes as string)
            ?.split(",")
            .map(Number)
            .filter(Boolean) || [];

        const search = (query.search as string) || "";
        const pageSize = parseInt((query.pageSize as string) || "10");
        const page = parseInt((query.page as string) || "1");

        const where: any = {};

        if (representanteIds.length > 0) {
            where.idRepresentante = { in: representanteIds };
        }

        if (search) {
            where.OR = [
                { nomContato: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { CNPJ: { contains: search, mode: 'insensitive' } },
            ];
        }

        try {
            const [total, leads] = await Promise.all([
                prisma.cRM_Contato.count({ where }),
                prisma.cRM_Contato.findMany({
                    where,
                    skip: (page - 1) * pageSize,
                    take: pageSize,
                    orderBy: { dtaCadastro: 'desc' },
                }),
            ]);

            return {
                data: convertBigInt(leads),
                total,
                page,
                pageSize,
                totalPages: Math.ceil(total / pageSize),
            };
        } catch (error) {
            console.error("Erro ao buscar leads:", error);
            return {
                data: [],
                total: 0,
                error: error,
            };
        }
    })

    // PATCH - Atualizar status
    .patch("/:id", async ({ params, body }) => {
        const { idStatus, idOrigem, idRepresentante } = body as {
            idStatus?: number;
            idOrigem?: number;
            idRepresentante?: number;
        };

        try {
            const updateData: any = {};

            if (idStatus !== undefined) updateData.IdStatus = idStatus;
            if (idOrigem !== undefined) updateData.IdOrigem = idOrigem;
            if (idRepresentante !== undefined) updateData.idRepresentante = idRepresentante;

            const updated = await prisma.cRM_Contato.update({
                where: { idContato: parseInt(params.id) },
                data: updateData,
            });

            return {
                status: 200,
                data: convertBigInt(updated),
            };
        } catch (error) {
            console.error("Erro ao atualizar lead:", error);
            return {
                status: 400,
                error: error,
            };
        }
    })

    // DELETE - Deletar lead
    .delete("/:id", async ({ params }) => {
        try {
            await prisma.cRM_Contato.delete({
                where: { idContato: parseInt(params.id) },
            });

            return { status: 200, message: "Lead deletado com sucesso" };
        } catch (error) {
            console.error("Erro ao deletar lead:", error);
            return { status: 400, error: error };
        }
    });

// Representantes
export const representativesRoutes = new Elysia({ prefix: "/representatives" })
    .get("/", async () => {
        try {
            const representantes = await prisma.cRM_Usuario.findMany({
                where: { flaAtivo: true },
                select: {
                    idUsuario: true,
                    Nome: true,
                    Email: true,
                    Imagem: true,
                    Telefone: true,
                },
                orderBy: { Nome: 'asc' },
            });

            return {
                status: 200,
                data: convertBigInt(representantes),
            };
        } catch (error) {
            console.error("Erro ao buscar representantes:", error);
            return {
                status: 400,
                data: [],
                error: error,
            };
        }
    });

// Status
export const statusRoutes = new Elysia({ prefix: "/status" })
    .get("/", async () => {
        try {
            const status = await prisma.$queryRaw`
                SELECT 
                    idStatus,
                    Status,
                    CorHTML
                FROM CRM_Status
                ORDER BY Status
            `;

            return {
                status: 200,
                data: convertBigInt(status),
            };
        } catch (error) {
            console.error("Erro ao buscar status:", error);
            return {
                status: 400,
                data: [],
                error: error,
            };
        }
    });

// Origem
export const origemRoutes = new Elysia({ prefix: "/origem" })
    .get("/", async () => {
        try {
            const origem = await prisma.$queryRaw`
                SELECT 
                    idOrigem,
                    Origem,
                    CorHTML
                FROM CRM_Origem
                ORDER BY Origem
            `;

            return {
                status: 200,
                data: convertBigInt(origem),
            };
        } catch (error) {
            console.error("Erro ao buscar origem:", error);
            return {
                status: 400,
                data: [],
                error: error,
            };
        }
    });