import { Elysia, t } from "elysia";
import { prisma } from "../lib/prisma";

function conv(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === "bigint") return Number(obj);
    if (obj instanceof Date) return obj;
    if (Array.isArray(obj)) return obj.map(conv);
    if (typeof obj === "object") {
        if (typeof obj.toNumber === "function") return obj.toNumber();
        const out: any = {};
        for (const k in obj) out[k] = conv(obj[k]);
        return out;
    }
    return obj;
}

export const agendaRoutes = new Elysia({ prefix: "/agenda" })

    // ── GET /agenda ───────────────────────────────────────────────────────────
    .get("/", async ({ query }) => {
        const { idUsuario, idContato, dtaInicio, dtaFim, idStatus } = query as Record<string, string | undefined>;

        const where: any = {};
        if (idUsuario) where.idUsuario = Number(idUsuario);
        if (idContato) where.idContato = Number(idContato);
        if (idStatus)  where.idAgendaStatus = Number(idStatus);
        if (dtaInicio || dtaFim) {
            where.DataInicio = {};
            if (dtaInicio) where.DataInicio.gte = new Date(dtaInicio);
            if (dtaFim)    where.DataInicio.lte = new Date(`${dtaFim}T23:59:59`);
        }

        const rows = await (prisma as any).cRM_Agenda.findMany({
            where,
            include: {
                cRM_AgendaStatus:  true,
                cRM_AgendaTitulo:  true,
            },
            orderBy: { DataInicio: "asc" },
        });

        return conv(rows);
    }, {
        query: t.Object({
            idUsuario:  t.Optional(t.String()),
            idContato:  t.Optional(t.String()),
            dtaInicio:  t.Optional(t.String()),
            dtaFim:     t.Optional(t.String()),
            idStatus:   t.Optional(t.String()),
        }),
    })

    // ── GET /agenda/meta ──────────────────────────────────────────────────────
    .get("/meta", async () => {
        const [statuses, titulos] = await Promise.all([
            (prisma as any).cRM_AgendaStatus.findMany({ orderBy: { id: "asc" } }),
            (prisma as any).cRM_AgendaTitulo.findMany({ where: { flaAtivo: true }, orderBy: { Titulo: "asc" } }),
        ]);
        return { statuses: conv(statuses), titulos: conv(titulos) };
    })

    // ── POST /agenda ──────────────────────────────────────────────────────────
    .post("/", async ({ body, set }) => {
        try {
            const record = await (prisma as any).cRM_Agenda.create({
                data: {
                    idAgendaTitulo:  body.idAgendaTitulo,
                    Descricao:       body.Descricao,
                    DataInicio:      new Date(body.DataInicio),
                    DataFim:         new Date(body.DataFim),
                    idAgendaStatus:  body.idAgendaStatus,
                    idUsuario:       body.idUsuario,
                    idContato:       body.idContato ?? null,
                    DataAlteracao:   new Date(),
                },
            });
            return conv(record);
        } catch (e) {
            console.error(e);
            set.status = 500;
            return { error: "Erro ao criar agenda" };
        }
    }, {
        body: t.Object({
            idAgendaTitulo: t.Number(),
            Descricao:      t.String(),
            DataInicio:     t.String(),
            DataFim:        t.String(),
            idAgendaStatus: t.Number(),
            idUsuario:      t.Number(),
            idContato:      t.Optional(t.Number()),
        }),
    })

    // ── PATCH /agenda/:id ─────────────────────────────────────────────────────
    .patch("/:id", async ({ params, body, set }) => {
        const id = Number(params.id);
        const data: any = { DataAlteracao: new Date() };

        if (body.idAgendaTitulo !== undefined) data.idAgendaTitulo = body.idAgendaTitulo;
        if (body.Descricao      !== undefined) data.Descricao      = body.Descricao;
        if (body.DataInicio     !== undefined) data.DataInicio     = new Date(body.DataInicio);
        if (body.DataFim        !== undefined) data.DataFim        = new Date(body.DataFim);
        if (body.idAgendaStatus !== undefined) data.idAgendaStatus = body.idAgendaStatus;

        try {
            const record = await (prisma as any).cRM_Agenda.update({
                where: { id },
                data,
            });
            return conv(record);
        } catch (e) {
            console.error(e);
            set.status = 500;
            return { error: "Erro ao atualizar agenda" };
        }
    }, {
        params: t.Object({ id: t.String() }),
        body: t.Object({
            idAgendaTitulo: t.Optional(t.Number()),
            Descricao:      t.Optional(t.String()),
            DataInicio:     t.Optional(t.String()),
            DataFim:        t.Optional(t.String()),
            idAgendaStatus: t.Optional(t.Number()),
        }),
    })

    // ── DELETE /agenda/:id ────────────────────────────────────────────────────
    .delete("/:id", async ({ params, set }) => {
        const id = Number(params.id);
        try {
            await (prisma as any).cRM_Agenda.delete({ where: { id } });
            return { success: true };
        } catch (e) {
            console.error(e);
            set.status = 500;
            return { error: "Erro ao excluir agenda" };
        }
    }, {
        params: t.Object({ id: t.String() }),
    });
