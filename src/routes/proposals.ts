import { Elysia, t } from "elysia";
import { prisma } from "../lib/prisma";

function convertBigIntToNumber(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'bigint') return Number(obj);
    if (obj instanceof Date) return obj;
    if (typeof obj === 'object') {
        if (Array.isArray(obj)) return obj.map(item => convertBigIntToNumber(item));
        const converted: any = {};
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                converted[key] = convertBigIntToNumber(obj[key]);
            }
        }
        return converted;
    }
    return obj;
}

export const proposalsRoutes = new Elysia({ prefix: "/proposals" })
    .get("/contact/:id", async ({ params }) => {
        const contactId = parseInt(params.id);

        const proposals = await prisma.cRM_Proposta.findMany({
            where: { idContato: contactId },
            orderBy: { dtaCriacao: "desc" },
        });

        // The legacy code showed specific status colors.
        // We might want to include the status name in the return
        const statusMap: Record<number, string> = {
            1: "Pendente",
            2: "Em Análise",
            3: "Aprovado",
            4: "Concluído",
            5: "Faturado",
            6: "Reprovado"
        };

        const result = proposals.map(p => ({
            ...p,
            Status: statusMap[p.idStatus || 1] || "Desconhecido"
        }));

        return convertBigIntToNumber(result);
    })
    .get("/contact-info/:id", async ({ params }) => {
        const contactId = parseInt(params.id);
        const contact = await prisma.cRM_Contato.findUnique({
            where: { idContato: contactId }
        });

        if (!contact) return null;

        const address = await prisma.cRM_Contato_Endereco.findFirst({
            where: { idContato: contactId, flaPrincipal: true }
        });

        return convertBigIntToNumber({ ...contact, address });
    })
    .post("/", async ({ body }) => {
        const { idContato, idUsuario, UF } = body;

        const difal = await prisma.cRM_Proposta_Difal.findFirst({
            where: { UF: UF }
        });

        const idDifal = difal?.idDifal || 0;

        const newProposal = await prisma.cRM_Proposta.create({
            data: {
                idContato,
                idDifal,
                CalculaDifal: 0,
                Desconto: 0,
                dtaCriacao: new Date(),
                idUsuario,
                TotalKg: 0,
                TotalValor: 0,
                Observacao: "Frete",
                Valor: 0,
                idStatus: 1,
                id: crypto.randomUUID(),
                FundoPobreza: 0,
                ObsChecagem: ""
            }
        });

        return newProposal;
    }, {
        body: t.Object({
            idContato: t.Number(),
            idUsuario: t.Number(),
            UF: t.String()
        })
    })
    .delete("/:id", async ({ params }) => {
        const id = parseInt(params.id);
        await prisma.cRM_Proposta.delete({
            where: { idProposta: id }
        });
        return { success: true };
    });
