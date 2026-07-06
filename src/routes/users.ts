import { Elysia, t } from "elysia";
import { prisma } from "../lib/prisma";

export const usersRoutes = new Elysia({ detail: { tags: ["Usuarios"] }, prefix: "/users" })
    .get("/", async () => {
        try {
            const users = await prisma.$queryRaw`
        Select 
            t1.idUsuario, 
            t1.Nome, 
            t2.Grupo, 
            t1.Email, 
            t1.Imagem, 
            t1.Telefone, 
            t1.DataUltimoLogin, 
            t1.flaAtivo, 
            (Select Count(*) From CRM_Contato Where idRepresentante=t1.idUsuario) as FreqPortifolio
        From CRM_Usuario as t1 
        left outer join CRM_Grupo as t2 on t1.idGrupo=t2.idGrupo 
        Order by t1.flaAtivo Desc
      `;
            return users;
        } catch (e) {
            console.error(e);
            return [];
        }
    })
    .get("/grupos", async () => {
        try {
            const grupos = await prisma.cRM_Grupo.findMany({ orderBy: { Grupo: "asc" } });
            return grupos;
        } catch { return []; }
    })
    .post("/", async ({ body, set }) => {
        try {
            const data: any = {
                Nome: body.Nome,
                Email: body.Email,
                Telefone: body.Telefone || null,
                WS: body.WS || null,
                Endereco: body.Endereco || null,
                Titulo: body.Titulo || null,
                flaAtivo: true,
            };
            if (body.idGrupo) data.idGrupo = body.idGrupo;
            if (body.Senha) {
                const encoder = new TextEncoder();
                const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(body.Senha));
                data.Senha = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
            }
            const user = await prisma.cRM_Usuario.create({ data });
            return user;
        } catch (e: any) {
            console.error(e);
            set.status = 500;
            return { error: e.message };
        }
    }, {
        body: t.Object({
            Nome: t.String(),
            Email: t.String(),
            Telefone: t.Optional(t.String()),
            WS: t.Optional(t.String()),
            Endereco: t.Optional(t.String()),
            Titulo: t.Optional(t.String()),
            Senha: t.Optional(t.String()),
            idGrupo: t.Optional(t.Number()),
        }),
    })
    .put(
        "/:id",
        async ({ params: { id }, body, set }) => {
            try {
                const data: any = {};
                if (body.Nome !== undefined) data.Nome = body.Nome;
                if (body.Email !== undefined) data.Email = body.Email;
                if (body.Telefone !== undefined) data.Telefone = body.Telefone;
                if (body.flaAtivo !== undefined) data.flaAtivo = body.flaAtivo;
                if (body.Grupo !== undefined) {
                    const grupo = await prisma.cRM_Grupo.findFirst({ where: { Grupo: body.Grupo } });
                    if (grupo) data.idGrupo = grupo.idGrupo;
                }
                const updated = await prisma.cRM_Usuario.update({
                    where: { idUsuario: parseInt(id) },
                    data,
                });
                return updated;
            } catch (e) {
                console.error(e);
                set.status = 500;
                return { error: "Erro ao atualizar usuário" };
            }
        },
        {
            body: t.Object({
                Nome: t.Optional(t.String()),
                Email: t.Optional(t.String()),
                Telefone: t.Optional(t.String()),
                Grupo: t.Optional(t.String()),
                flaAtivo: t.Optional(t.Boolean()),
            }),
        }
    )
    .put(
        "/:id/status",
        async ({ params: { id }, body }) => {
            try {
                const updatedUser = await prisma.cRM_Usuario.update({
                    where: { idUsuario: parseInt(id) },
                    data: { flaAtivo: body.flaAtivo },
                });
                return updatedUser;
            } catch (e) {
                console.error(e);
                throw new Error("Failed to update user status");
            }
        },
        {
            body: t.Object({
                flaAtivo: t.Boolean(),
            }),
        }
    )
    .delete("/:id", async ({ params: { id }, set }) => {
        const userId = parseInt(id);

        // Check dependencies
        const propostaCount = await prisma.cRM_Proposta.count({
            where: { idUsuario: userId },
        });

        const contatoCount = await prisma.cRM_Contato.count({
            where: { idRepresentante: userId },
        });

        if (propostaCount > 0 || contatoCount > 0) {
            set.status = 400;
            return {
                message: "Não é possível excluir usuário com propostas ou contatos vinculados.",
            };
        }

        try {
            await prisma.cRM_Usuario.delete({
                where: { idUsuario: userId },
            });
            return { message: "Usuário excluído com sucesso" };
        } catch (e) {
            console.error(e);
            set.status = 500;
            return { message: "Erro ao excluir usuário" };
        }
    });
