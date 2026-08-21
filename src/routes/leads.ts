import { Elysia, t } from 'elysia';
import { prisma } from "../lib/prisma";

function convertBigInt(obj: any): any {
    if (typeof obj === "bigint") return Number(obj);
    if (Array.isArray(obj)) return obj.map(convertBigInt);
    if (obj !== null && typeof obj === "object") {
        return Object.fromEntries(
            Object.entries(obj).map(([k, v]) => [k, convertBigInt(v)])
        );
    }
    return obj;
}

export const leadsRoutes = new Elysia({ detail: { tags: ["Pipeline"] }, prefix: "/leads" })

    // GET /leads — lista com joins (equivalente ao sp_contatos_lista)
    .get("/", async ({ query }) => {
        const representanteIds = (query.representantes as string)
            ?.split(",").map(Number).filter(n => !isNaN(n) && n > 0) || [];

        const statusIds = (query.status as string)
            ?.split(",").map(Number).filter(n => !isNaN(n) && n > 0) || [];

        const origemIds = (query.origem as string)
            ?.split(",").map(Number).filter(n => !isNaN(n) && n > 0) || [];

        const search      = ((query.search    as string) || "").trim();
        const userId      = Number(query.userId    || 0);
        const userGroup   = Number(query.userGroup || 0);
        const isAdmin     = [1, 2, 3, 5, 7].includes(userGroup);

        const conditions: string[] = [];

        if (representanteIds.length > 0) {
            const ids = representanteIds.join(",");
            conditions.push(`t1.idRepresentante IN (${ids})`);
        } else if (!isAdmin && userId > 0) {
            conditions.push(`t1.idRepresentante = ${userId}`);
        }

        if (statusIds.length > 0) {
            conditions.push(`t1.IdStatus IN (${statusIds.join(",")})`);
        }

        if (origemIds.length > 0) {
            conditions.push(`t1.IdOrigem IN (${origemIds.join(",")})`);
        }

        if (search) {
            const s = search.replace(/'/g, "''");
            conditions.push(`(
                t1.nomContato    LIKE '%${s}%'
                OR t1.nomComercial LIKE '%${s}%'
                OR t1.CNPJ         LIKE '%${s}%'
                OR t1.CodCliente   LIKE '%${s}%'
                OR t1.email        LIKE '%${s}%'
                OR t1.Telefone     LIKE '%${s}%'
            )`);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

        const sql = `
            SELECT
                t1.idContato,
                NomContato      = LTRIM(RTRIM(ISNULL(t1.nomContato, ''))),
                NomComercial    = LTRIM(RTRIM(ISNULL(NULLIF(t1.nomComercial,''), t1.nomContato))),
                CodCliente      = LTRIM(RTRIM(ISNULL(t1.CodCliente, ''))),
                CNPJ            = LTRIM(RTRIM(ISNULL(t1.CNPJ, ''))),
                CPF             = LTRIM(RTRIM(ISNULL(t1.CPF, ''))),
                TipoPessoa      = LTRIM(RTRIM(ISNULL(t1.TipoPessoa, ''))),
                ContatoEmpresa  = LTRIM(RTRIM(ISNULL(t1.ContatoEmpresa, ''))),
                Segmento        = LTRIM(RTRIM(ISNULL(t1.Segmento, ''))),
                SegmentoAtuacao = LTRIM(RTRIM(ISNULL(t1.SegmentoAtuacao, ''))),
                Cidade          = LTRIM(RTRIM(ISNULL(t6.Cidade, ''))),
                UF              = LTRIM(RTRIM(ISNULL(t6.UF, ''))),
                Telefone        = LTRIM(RTRIM(ISNULL(t1.Telefone, ''))),
                Email           = LTRIM(RTRIM(ISNULL(t1.email, ''))),
                t1.IdStatus,
                t1.IdOrigem,
                t1.idRepresentante,
                Status          = LTRIM(RTRIM(ISNULL(t3.Status, 'N/D'))),
                CorStatus       = ISNULL(t3.CorHTML, '#999999'),
                Origem          = LTRIM(RTRIM(ISNULL(t4.Origem, 'N/D'))),
                CorOrigem       = ISNULL(t4.CorHTML, '#999999'),
                Representante   = LTRIM(RTRIM(ISNULL(t5.Nome, 'N/D'))),
                RepImagem       = ISNULL(t5.Imagem, ''),
                intProposta     = (SELECT COUNT(*) FROM CRM_Proposta WITH (NOLOCK) WHERE idContato = t1.idContato),
                ProximaAtividade = ISNULL(CONVERT(varchar(16), t7.ProximaAtividade, 120), ''),
                dtaCadastro      = ISNULL(CONVERT(varchar(10), t1.dtaCadastro, 23), '')
            FROM CRM_Contato AS t1 WITH (NOLOCK)
            LEFT JOIN CRM_Status  AS t3 WITH (NOLOCK) ON t1.IdStatus        = t3.idStatus
            LEFT JOIN CRM_Origem  AS t4 WITH (NOLOCK) ON t1.IdOrigem        = t4.idOrigem
            LEFT JOIN CRM_Usuario AS t5 WITH (NOLOCK) ON t1.idRepresentante = t5.idUsuario
            LEFT JOIN (
                SELECT idContato, UF, Cidade
                FROM CRM_Contato_Endereco WITH (NOLOCK)
                WHERE flaPrincipal = 1 AND flaAtivo = 1
            ) AS t6 ON t1.idContato = t6.idContato
            LEFT JOIN (
                SELECT idContato,
                       ProximaAtividade = MIN(DataInicio)
                FROM CRM_Agenda WITH (NOLOCK)
                WHERE DataInicio >= GETDATE()
                GROUP BY idContato
            ) AS t7 ON t1.idContato = t7.idContato
            ${whereClause}
            ORDER BY t1.idContato DESC
        `;

        try {
            const rows: any[] = await prisma.$queryRawUnsafe(sql);
            return { data: convertBigInt(rows), total: rows.length };
        } catch (error) {
            console.error("[leads] query error:", error);
            return { data: [], total: 0, error: String(error) };
        }
    }, {
        query: t.Object({
            representantes: t.Optional(t.String()),
            status:         t.Optional(t.String()),
            origem:         t.Optional(t.String()),
            search:         t.Optional(t.String()),
            userId:         t.Optional(t.String()),
            userGroup:      t.Optional(t.String()),
        }),
        detail: {
            summary: "Listar leads/contatos do pipeline",
            description: "Retorna a lista de contatos (leads) com joins de status, origem, representante, endereço principal, contagem de propostas e próxima atividade agendada. Permite filtrar por representantes, status e origem (listas separadas por vírgula), além de busca textual em nome, nome comercial, CNPJ, código de cliente, e-mail e telefone. Se o usuário não for admin (grupo 1, 2, 3, 5 ou 7) e nenhum filtro de representante for informado, restringe automaticamente os resultados à carteira do próprio usuário (userId).",
        },
    })

    // PATCH /leads/:id
    .patch("/:id", async ({ params, body }) => {
        const id = parseInt(params.id);
        const { idStatus, idOrigem, idRepresentante } = body as {
            idStatus?: number; idOrigem?: number; idRepresentante?: number;
        };
        const data: any = {};
        if (idStatus        !== undefined) data.IdStatus        = idStatus;
        if (idOrigem        !== undefined) data.IdOrigem        = idOrigem;
        if (idRepresentante !== undefined) data.idRepresentante = idRepresentante;
        if (!Object.keys(data).length) return { status: 400, error: "Nenhum campo" };
        try {
            await prisma.cRM_Contato.update({ where: { idContato: id }, data });
            return { status: 200 };
        } catch (error) {
            console.error("[leads] patch error:", error);
            return { status: 400, error: String(error) };
        }
    }, {
        detail: {
            summary: "Atualizar status, origem ou representante de um lead",
            description: "Atualiza parcialmente um contato (lead) identificado por :id, alterando status (idStatus), origem (idOrigem) e/ou representante responsável (idRepresentante). Apenas os campos enviados no corpo da requisição são atualizados. Retorna erro 400 caso nenhum campo válido seja informado.",
        },
    })

    // DELETE /leads/:id
    .delete("/:id", async ({ params }) => {
        try {
            await prisma.cRM_Contato.delete({ where: { idContato: parseInt(params.id) } });
            return { status: 200 };
        } catch (error) {
            return { status: 400, error: String(error) };
        }
    }, {
        detail: {
            summary: "Excluir lead/contato",
            description: "Remove definitivamente um contato (lead) do banco de dados a partir do :id informado na URL. Não realiza soft delete; a exclusão é física na tabela CRM_Contato.",
        },
    });

// ─── Representantes ─────────────────────────────────────────────────────────
export const representativesRoutes = new Elysia({ detail: { tags: ["Pipeline"] }, prefix: "/representatives" })
    .get("/", async () => {
        try {
            const rows: any[] = await prisma.$queryRawUnsafe(`
                SELECT
                    t1.idUsuario,
                    Nome   = LTRIM(RTRIM(t1.Nome)),
                    Imagem = ISNULL(t1.Imagem, ''),
                    Email  = LTRIM(RTRIM(ISNULL(t1.Email, ''))),
                    Total  = COUNT(t2.idContato)
                FROM CRM_Usuario AS t1 WITH (NOLOCK)
                LEFT JOIN CRM_Contato AS t2 WITH (NOLOCK) ON t1.idUsuario = t2.idRepresentante
                WHERE t1.flaAtivo = 1
                GROUP BY t1.idUsuario, t1.Nome, t1.Imagem, t1.Email
                ORDER BY t1.Nome
            `);
            return convertBigInt(rows);
        } catch (error) {
            console.error("[representatives] error:", error);
            return [];
        }
    }, {
        detail: {
            summary: "Listar representantes com total de contatos",
            description: "Retorna todos os usuários ativos (flaAtivo = 1) que atuam como representantes, incluindo nome, imagem, e-mail e a contagem total de contatos (leads) vinculados a cada um, ordenados por nome.",
        },
    });

// ─── Status ─────────────────────────────────────────────────────────────────
export const statusRoutes = new Elysia({ detail: { tags: ["Pipeline"] }, prefix: "/status" })
    .get("/", async () => {
        try {
            const rows: any[] = await prisma.$queryRawUnsafe(
                `SELECT idStatus, Status = LTRIM(RTRIM(Status)), CorHTML FROM CRM_Status WITH (NOLOCK) ORDER BY Status`
            );
            return { status: 200, data: convertBigInt(rows) };
        } catch (error) {
            console.error("[status] error:", error);
            return { status: 400, data: [] };
        }
    }, {
        detail: {
            summary: "Listar status do pipeline",
            description: "Retorna todos os status cadastrados (CRM_Status), incluindo nome e cor (CorHTML), ordenados alfabeticamente, para uso em filtros e badges do pipeline de leads.",
        },
    });

// ─── Origem ─────────────────────────────────────────────────────────────────
export const origemRoutes = new Elysia({ detail: { tags: ["Pipeline"] }, prefix: "/origem" })
    .get("/", async () => {
        try {
            const rows: any[] = await prisma.$queryRawUnsafe(
                `SELECT idOrigem, Origem = LTRIM(RTRIM(Origem)), CorHTML FROM CRM_Origem WITH (NOLOCK) ORDER BY Origem`
            );
            return { status: 200, data: convertBigInt(rows) };
        } catch (error) {
            console.error("[origem] error:", error);
            return { status: 400, data: [] };
        }
    }, {
        detail: {
            summary: "Listar origens do pipeline",
            description: "Retorna todas as origens de lead cadastradas (CRM_Origem), incluindo nome e cor (CorHTML), ordenadas alfabeticamente, para uso em filtros e badges do pipeline de leads.",
        },
    });
