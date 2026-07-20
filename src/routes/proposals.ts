import { Elysia, t } from "elysia";
import { prisma } from "../lib/prisma";

function convertBigIntToNumber(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'bigint') return Number(obj);
    if (obj instanceof Date) return obj.toISOString();
    // Prisma Decimal — has toNumber() method
    if (typeof obj === 'object' && typeof obj.toNumber === 'function') return obj.toNumber();
    if (typeof obj === 'object') {
        if (Array.isArray(obj)) return obj.map(item => convertBigIntToNumber(item));
        const converted: any = {};
        for (const key of Object.keys(obj)) {
            converted[key] = convertBigIntToNumber(obj[key]);
        }
        return converted;
    }
    return obj;
}

export const proposalsRoutes = new Elysia({ detail: { tags: ["Propostas"] }, prefix: "/proposals" })
    .get("/contact/:id", async ({ params }) => {
        const contactId = parseInt(params.id);

        const rows: any[] = await prisma.$queryRawUnsafe(`
            SELECT
                p.idProposta,
                p.PropostaNo,
                UF            = ISNULL(d.UF, ''),
                p.CalculaDifal,
                p.Desconto,
                p.TotalKg,
                p.TotalValor,
                p.idStatus,
                Status        = ISNULL(s.Status, 'N/D'),
                CorHTML       = ISNULL(s.CorHTML, '#999999'),
                dtaCriacao    = CASE WHEN p.dtaCriacao IS NULL THEN '' ELSE FORMAT(p.dtaCriacao, 'dd/MM/yyyy') END
            FROM CRM_Proposta AS p WITH (NOLOCK)
            LEFT JOIN CRM_Proposta_Difal   AS d WITH (NOLOCK) ON p.idDifal   = d.idDifal
            LEFT JOIN CRM_Proposta_Status  AS s WITH (NOLOCK) ON p.idStatus  = s.idStatus
            WHERE p.idContato = ${contactId}
            ORDER BY p.dtaCriacao DESC
        `);

        return convertBigIntToNumber(rows);
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
    .delete("/:id", async ({ params, request, set }) => {
        const id = parseInt(params.id);
        const userGroup = Number(request.headers.get("x-user-group") || 0);
        const CHECAGEM_GROUPS = new Set([1, 2, 3, 4, 5, 7]);

        const rows: any[] = await prisma.$queryRawUnsafe(
            `SELECT idStatus FROM CRM_Proposta WHERE idProposta = ${id}`
        );
        if (rows.length && Number(rows[0].idStatus) >= 2 && !CHECAGEM_GROUPS.has(userGroup)) {
            set.status = 403;
            return { error: "Proposta em checagem. Apenas usuários com permissão de checagem podem excluir." };
        }

        await prisma.cRM_Proposta.delete({
            where: { idProposta: id }
        });
        return { success: true };
    });
