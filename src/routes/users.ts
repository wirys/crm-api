import { Elysia, t } from "elysia";
import { prisma } from "../lib/prisma";

export const usersRoutes = new Elysia({ prefix: "/users" })
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
