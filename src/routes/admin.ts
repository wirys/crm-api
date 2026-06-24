import { Elysia, t } from "elysia";
import { prisma } from "../lib/prisma";

function conv(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === "bigint") return Number(obj);
    if (obj instanceof Date) return obj.toISOString();
    if (Array.isArray(obj)) return obj.map(conv);
    if (typeof obj === "object") {
        if (typeof obj.toNumber === "function") return obj.toNumber();
        const out: any = {};
        for (const k in obj) out[k] = conv(obj[k]);
        return out;
    }
    return obj;
}

export const adminRoutes = new Elysia({ detail: { tags: ["Admin"] }, prefix: "/admin" })

    .post("/transferir-carteira", async ({ body, set }) => {
        const { idRepresentanteOrigem, idRepresentanteDestino, idContatos } = body;

        if (!idContatos || idContatos.length === 0) {
            set.status = 400;
            return { error: "Nenhum contato selecionado" };
        }

        try {
            const ids = idContatos.map(Number).join(",");
            await prisma.$queryRawUnsafe(`
                UPDATE CRM_Contato
                SET idRepresentante = ${Number(idRepresentanteDestino)},
                    dtaAlteracao = GETDATE()
                WHERE idContato IN (${ids})
                  AND idRepresentante = ${Number(idRepresentanteOrigem)}
            `);

            await prisma.$queryRawUnsafe(`
                INSERT INTO CRM_Log (idUsuario, Data, Atividade, Ocorrencia)
                VALUES (${Number(idRepresentanteDestino)}, GETDATE(), 'Transferência de Carteira',
                    'Transferidos ${idContatos.length} contatos de rep ${idRepresentanteOrigem} para rep ${idRepresentanteDestino}')
            `);

            return { success: true, transferidos: idContatos.length };
        } catch (e: any) {
            console.error(e);
            set.status = 500;
            return { error: e.message };
        }
    }, {
        body: t.Object({
            idRepresentanteOrigem: t.Number(),
            idRepresentanteDestino: t.Number(),
            idContatos: t.Array(t.Number()),
        }),
    })

    .get("/carteira/:idRepresentante", async ({ params }) => {
        const id = Number(params.idRepresentante);
        const rows = await prisma.$queryRawUnsafe(`
            SELECT idContato, nomComercial, CNPJ, Telefone, email, dtaCadastro
            FROM CRM_Contato WITH (NOLOCK)
            WHERE idRepresentante = ${id} AND (flaAtivo = 1 OR flaAtivo IS NULL)
            ORDER BY nomComercial
        `);
        return conv(rows);
    }, {
        params: t.Object({ idRepresentante: t.String() }),
    })

    .get("/representantes", async () => {
        const rows = await prisma.$queryRawUnsafe(`
            SELECT u.idUsuario, u.Nome, u.Email, u.flaAtivo, u.idGrupo,
                   CarteiraCont = (SELECT COUNT(*) FROM CRM_Contato c WITH (NOLOCK) WHERE c.idRepresentante = u.idUsuario)
            FROM CRM_Usuario u WITH (NOLOCK)
            WHERE u.flaAtivo = 1
            ORDER BY u.Nome
        `);
        return conv(rows);
    })

    .post("/convite", async ({ body, set }) => {
        const { email, idGrupo, idUsuarioCadastro } = body;

        try {
            const guid = crypto.randomUUID();
            await prisma.cRM_UsuarioAtivacao.create({
                data: {
                    email,
                    nivel: idGrupo,
                    idUsuarioCadastro,
                    GUIDUsuario: guid,
                    dtaCadastro: new Date(),
                },
            });

            return { success: true, guid, email };
        } catch (e: any) {
            console.error(e);
            set.status = 500;
            return { error: e.message };
        }
    }, {
        body: t.Object({
            email: t.String(),
            idGrupo: t.Number(),
            idUsuarioCadastro: t.Number(),
        }),
    })

    .get("/convites", async () => {
        const rows = await prisma.$queryRawUnsafe(`
            SELECT a.*, u.Nome as NomeCadastro
            FROM CRM_UsuarioAtivacao a WITH (NOLOCK)
            LEFT JOIN CRM_Usuario u WITH (NOLOCK) ON a.idUsuarioCadastro = u.idUsuario
            ORDER BY a.dtaCadastro DESC
        `);
        return conv(rows);
    })

    .get("/log", async ({ query }) => {
        const { page, limit, idUsuario, search } = query as Record<string, string | undefined>;
        const pageNum = Math.max(1, Number(page ?? 1));
        const limitNum = Math.max(1, Number(limit ?? 50));
        const offset = (pageNum - 1) * limitNum;

        const conds: string[] = [];
        if (idUsuario) conds.push(`l.idUsuario = ${Number(idUsuario)}`);
        if (search) {
            const s = search.replace(/'/g, "''");
            conds.push(`(l.Atividade LIKE '%${s}%' OR l.Ocorrencia LIKE '%${s}%')`);
        }
        const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";

        const [rows, countRows] = await Promise.all([
            prisma.$queryRawUnsafe(`
                SELECT l.*, u.Nome as NomeUsuario
                FROM CRM_Log l WITH (NOLOCK)
                LEFT JOIN CRM_Usuario u WITH (NOLOCK) ON l.idUsuario = u.idUsuario
                ${where}
                ORDER BY l.Data DESC
                OFFSET ${offset} ROWS FETCH NEXT ${limitNum} ROWS ONLY
            `),
            prisma.$queryRawUnsafe(`SELECT Total = COUNT(*) FROM CRM_Log l WITH (NOLOCK) ${where}`),
        ]);

        const total = conv(countRows)[0]?.Total ?? 0;
        return { data: conv(rows), meta: { page: pageNum, limit: limitNum, total, hasMore: offset + limitNum < total } };
    });
