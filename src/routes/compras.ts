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

export const comprasRoutes = new Elysia({ prefix: "/compras" })

    .get("/", async ({ query }) => {
        const { search, page, limit } = query as Record<string, string | undefined>;
        const pageNum = Math.max(1, Number(page ?? 1));
        const limitNum = Math.max(1, Number(limit ?? 50));
        const offset = (pageNum - 1) * limitNum;

        const conds: string[] = [];
        if (search) {
            const s = search.replace(/'/g, "''");
            conds.push(`(m.nomMaterial LIKE '%${s}%' OR m.CodMaterial LIKE '%${s}%')`);
        }
        const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";

        const [rows, countRows] = await Promise.all([
            prisma.$queryRawUnsafe(`
                SELECT m.idMaterial, m.CodMaterial, m.nomMaterial, m.NCM, m.Unidade,
                       m.PesoEmbalagem, m.PrecoKg, m.PrecoKg07, m.PrecoKg12, m.PrecoKg18,
                       m.IPI, m.ST, m.flaAtivo, m.dtaAtualizacao,
                       g.nomGrupo
                FROM CRM_Produto_Material m WITH (NOLOCK)
                LEFT JOIN CRM_Produto_MaterialGrupo g WITH (NOLOCK) ON m.idMaterialGrupo = g.idMaterialGrupo
                ${where}
                ORDER BY m.nomMaterial
                OFFSET ${offset} ROWS FETCH NEXT ${limitNum} ROWS ONLY
            `),
            prisma.$queryRawUnsafe(`
                SELECT Total = COUNT(*)
                FROM CRM_Produto_Material m WITH (NOLOCK)
                ${where}
            `),
        ]);

        const total = conv(countRows)[0]?.Total ?? 0;
        return { data: conv(rows), meta: { page: pageNum, limit: limitNum, total, hasMore: offset + limitNum < total } };
    })

    .get("/grupos", async () => {
        const rows = await prisma.cRM_Produto_MaterialGrupo.findMany({ orderBy: { nomGrupo: "asc" } });
        return conv(rows);
    });

export const fornecedorRoutes = new Elysia({ prefix: "/fornecedores" })

    .get("/", async ({ query }) => {
        const { search, page, limit } = query as Record<string, string | undefined>;
        const pageNum = Math.max(1, Number(page ?? 1));
        const limitNum = Math.max(1, Number(limit ?? 50));
        const offset = (pageNum - 1) * limitNum;

        const conds: string[] = [];
        if (search) {
            const s = search.replace(/'/g, "''");
            conds.push(`(nomComercial LIKE '%${s}%' OR CNPJ LIKE '%${s}%' OR nomContato LIKE '%${s}%')`);
        }
        conds.push(`Tipo = 'Fornecedor'`);

        const where = `WHERE ${conds.join(" AND ")}`;

        const [rows, countRows] = await Promise.all([
            prisma.$queryRawUnsafe(`
                SELECT idContato, nomContato, nomComercial, CNPJ, ContatoEmpresa, Telefone, email,
                       Segmento, IdStatus, flaAtivo, dtaCadastro
                FROM CRM_Contato WITH (NOLOCK)
                ${where}
                ORDER BY nomComercial
                OFFSET ${offset} ROWS FETCH NEXT ${limitNum} ROWS ONLY
            `),
            prisma.$queryRawUnsafe(`
                SELECT Total = COUNT(*) FROM CRM_Contato WITH (NOLOCK) ${where}
            `),
        ]);

        const total = conv(countRows)[0]?.Total ?? 0;
        return { data: conv(rows), meta: { page: pageNum, limit: limitNum, total, hasMore: offset + limitNum < total } };
    })

    .post("/", async ({ body, set }) => {
        const { nomComercial, CNPJ, ContatoEmpresa, Telefone, email, Segmento } = body;
        try {
            const created = await prisma.cRM_Contato.create({
                data: {
                    nomComercial,
                    CNPJ,
                    ContatoEmpresa,
                    Telefone,
                    email,
                    Segmento,
                    Tipo: "Fornecedor",
                    flaAtivo: true,
                    dtaCadastro: new Date(),
                },
            });
            return conv({ success: true, id: created.idContato });
        } catch (e: any) {
            console.error(e);
            set.status = 500;
            return { error: e.message };
        }
    }, {
        body: t.Object({
            nomComercial: t.String(),
            CNPJ: t.Optional(t.String()),
            ContatoEmpresa: t.Optional(t.String()),
            Telefone: t.Optional(t.String()),
            email: t.Optional(t.String()),
            Segmento: t.Optional(t.String()),
        }),
    })

    .patch("/:id", async ({ params, body, set }) => {
        const id = Number(params.id);
        try {
            await prisma.cRM_Contato.update({
                where: { idContato: id },
                data: { ...body, dtaAlteracao: new Date() },
            });
            return { success: true };
        } catch (e: any) {
            console.error(e);
            set.status = 500;
            return { error: e.message };
        }
    }, {
        params: t.Object({ id: t.String() }),
        body: t.Object({
            nomComercial: t.Optional(t.String()),
            CNPJ: t.Optional(t.String()),
            ContatoEmpresa: t.Optional(t.String()),
            Telefone: t.Optional(t.String()),
            email: t.Optional(t.String()),
            Segmento: t.Optional(t.String()),
            flaAtivo: t.Optional(t.Boolean()),
        }),
    });
