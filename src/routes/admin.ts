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
        detail: {
            summary: "Transferir carteira de contatos entre representantes",
            description: "Move em lote os contatos informados em idContatos do representante de origem (idRepresentanteOrigem) para o representante de destino (idRepresentanteDestino), atualizando idRepresentante e dtaAlteracao na tabela CRM_Contato. A transferência só é aplicada aos contatos que efetivamente pertenciam ao representante de origem. Registra a operação na tabela CRM_Log com a quantidade de contatos transferidos.",
        },
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
        detail: {
            summary: "Listar carteira de contatos de um representante",
            description: "Retorna os contatos ativos (flaAtivo = 1 ou nulo) vinculados ao representante identificado por :idRepresentante, incluindo nome comercial, CNPJ, telefone, e-mail e data de cadastro, ordenados por nome comercial.",
        },
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
    }, {
        detail: {
            summary: "Listar representantes ativos",
            description: "Retorna todos os usuários ativos (flaAtivo = 1) da tabela CRM_Usuario, incluindo nome, e-mail, grupo e a contagem de contatos (CarteiraCont) vinculados a cada um, ordenados por nome.",
        },
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
        detail: {
            summary: "Criar convite de ativação de usuário",
            description: "Gera um convite de ativação para um novo usuário, criando um registro em CRM_UsuarioAtivacao com e-mail, nível de acesso (idGrupo), usuário responsável pelo cadastro (idUsuarioCadastro) e um GUID único (GUIDUsuario) usado posteriormente para validar a ativação da conta.",
        },
    })

    .get("/convites", async () => {
        const rows = await prisma.$queryRawUnsafe(`
            SELECT a.*, u.Nome as NomeCadastro
            FROM CRM_UsuarioAtivacao a WITH (NOLOCK)
            LEFT JOIN CRM_Usuario u WITH (NOLOCK) ON a.idUsuarioCadastro = u.idUsuario
            ORDER BY a.dtaCadastro DESC
        `);
        return conv(rows);
    }, {
        detail: {
            summary: "Listar convites de ativação enviados",
            description: "Retorna todos os convites de ativação de usuário (CRM_UsuarioAtivacao) já cadastrados, incluindo o nome do usuário que realizou o cadastro (join com CRM_Usuario), ordenados do mais recente para o mais antigo.",
        },
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
    }, {
        detail: {
            summary: "Listar log de atividades administrativas",
            description: "Retorna, com paginação (query params page e limit), os registros da tabela CRM_Log incluindo o nome do usuário responsável (join com CRM_Usuario), ordenados da atividade mais recente para a mais antiga. Permite filtrar por idUsuario e por busca textual (search) nos campos Atividade e Ocorrencia. Retorna também metadados de paginação (total de registros e indicador hasMore).",
        },
    });
