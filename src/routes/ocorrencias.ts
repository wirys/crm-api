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

export const ocorrenciasRoutes = new Elysia({ prefix: "/ocorrencias" })

    .get("/", async ({ query }) => {
        const { tipo, search, status, dtaInicio, dtaFim, page, limit } = query as Record<string, string | undefined>;
        const pageNum = Math.max(1, Number(page ?? 1));
        const limitNum = Math.max(1, Number(limit ?? 50));
        const offset = (pageNum - 1) * limitNum;

        const conds: string[] = [];
        if (tipo) conds.push(`o.Tipo = '${tipo.replace(/'/g, "''")}'`);
        if (status) conds.push(`o.Status = '${status.replace(/'/g, "''")}'`);
        if (dtaInicio) conds.push(`o.dtaCriacao >= '${dtaInicio}'`);
        if (dtaFim) conds.push(`o.dtaCriacao <= '${dtaFim} 23:59:59'`);
        if (search) {
            const s = search.replace(/'/g, "''");
            conds.push(`(o.Titulo LIKE '%${s}%' OR o.Descricao LIKE '%${s}%' OR c.nomComercial LIKE '%${s}%')`);
        }

        const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";

        const [rows, countRows] = await Promise.all([
            prisma.$queryRawUnsafe(`
                SELECT o.*, c.nomComercial, u.Nome as NomeUsuario
                FROM CRM_Ocorrencia o WITH (NOLOCK)
                LEFT JOIN CRM_Contato c WITH (NOLOCK) ON o.idContato = c.idContato
                LEFT JOIN CRM_Usuario u WITH (NOLOCK) ON o.idUsuario = u.idUsuario
                ${where}
                ORDER BY o.dtaCriacao DESC
                OFFSET ${offset} ROWS FETCH NEXT ${limitNum} ROWS ONLY
            `),
            prisma.$queryRawUnsafe(`
                SELECT Total = COUNT(*)
                FROM CRM_Ocorrencia o WITH (NOLOCK)
                LEFT JOIN CRM_Contato c WITH (NOLOCK) ON o.idContato = c.idContato
                ${where}
            `),
        ]);

        const total = conv(countRows)[0]?.Total ?? 0;
        return { data: conv(rows), meta: { page: pageNum, limit: limitNum, total, hasMore: offset + limitNum < total } };
    })

    .post("/", async ({ body, set }) => {
        const { Tipo, Titulo, Descricao, idContato, idUsuario, Prioridade } = body;
        try {
            await prisma.$queryRawUnsafe(`
                INSERT INTO CRM_Ocorrencia (Tipo, Titulo, Descricao, idContato, idUsuario, Prioridade, Status, dtaCriacao)
                VALUES (
                    '${(Tipo || '').replace(/'/g, "''")}',
                    '${(Titulo || '').replace(/'/g, "''")}',
                    '${(Descricao || '').replace(/'/g, "''")}',
                    ${idContato ? Number(idContato) : 'NULL'},
                    ${Number(idUsuario)},
                    '${(Prioridade || 'Normal').replace(/'/g, "''")}',
                    'Aberta',
                    GETDATE()
                )
            `);
            return { success: true };
        } catch (e: any) {
            if (e.message?.includes("Invalid object name 'CRM_Ocorrencia'")) {
                await prisma.$queryRawUnsafe(`
                    CREATE TABLE CRM_Ocorrencia (
                        id INT IDENTITY(1,1) PRIMARY KEY,
                        Tipo VARCHAR(50),
                        Titulo VARCHAR(500),
                        Descricao VARCHAR(4000),
                        idContato INT,
                        idUsuario INT,
                        Prioridade VARCHAR(50) DEFAULT 'Normal',
                        Status VARCHAR(50) DEFAULT 'Aberta',
                        Resolucao VARCHAR(4000),
                        dtaCriacao DATETIME,
                        dtaResolucao DATETIME,
                        dtaAlteracao DATETIME
                    )
                `);
                await prisma.$queryRawUnsafe(`
                    INSERT INTO CRM_Ocorrencia (Tipo, Titulo, Descricao, idContato, idUsuario, Prioridade, Status, dtaCriacao)
                    VALUES (
                        '${(Tipo || '').replace(/'/g, "''")}',
                        '${(Titulo || '').replace(/'/g, "''")}',
                        '${(Descricao || '').replace(/'/g, "''")}',
                        ${idContato ? Number(idContato) : 'NULL'},
                        ${Number(idUsuario)},
                        '${(Prioridade || 'Normal').replace(/'/g, "''")}',
                        'Aberta',
                        GETDATE()
                    )
                `);
                return { success: true };
            }
            console.error(e);
            set.status = 500;
            return { error: e.message };
        }
    }, {
        body: t.Object({
            Tipo: t.String(),
            Titulo: t.String(),
            Descricao: t.Optional(t.String()),
            idContato: t.Optional(t.Number()),
            idUsuario: t.Number(),
            Prioridade: t.Optional(t.String()),
        }),
    })

    .patch("/:id", async ({ params, body, set }) => {
        const id = Number(params.id);
        const updates: string[] = [];

        if (body.Status) updates.push(`Status = '${body.Status.replace(/'/g, "''")}'`);
        if (body.Resolucao) updates.push(`Resolucao = '${body.Resolucao.replace(/'/g, "''")}'`);
        if (body.Prioridade) updates.push(`Prioridade = '${body.Prioridade.replace(/'/g, "''")}'`);
        if (body.Status === "Resolvida" || body.Status === "Fechada") updates.push(`dtaResolucao = GETDATE()`);
        updates.push(`dtaAlteracao = GETDATE()`);

        try {
            await prisma.$queryRawUnsafe(`UPDATE CRM_Ocorrencia SET ${updates.join(", ")} WHERE id = ${id}`);
            return { success: true };
        } catch (e: any) {
            console.error(e);
            set.status = 500;
            return { error: e.message };
        }
    }, {
        params: t.Object({ id: t.String() }),
        body: t.Object({
            Status: t.Optional(t.String()),
            Resolucao: t.Optional(t.String()),
            Prioridade: t.Optional(t.String()),
        }),
    })

    .delete("/:id", async ({ params, set }) => {
        const id = Number(params.id);
        try {
            await prisma.$queryRawUnsafe(`DELETE FROM CRM_Ocorrencia WHERE id = ${id}`);
            return { success: true };
        } catch (e: any) {
            console.error(e);
            set.status = 500;
            return { error: e.message };
        }
    }, {
        params: t.Object({ id: t.String() }),
    });
