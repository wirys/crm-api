
import { jwt } from "@elysiajs/jwt";
import { prisma } from "../lib/prisma";
import { createHash } from "crypto";
import { Elysia, t } from "elysia";



export const authRoutes = new Elysia({ prefix: "/auth" })
    .use(
        jwt({
            name: "jwt",
            secret: process.env.JWT_SECRET || "secret-crm-eltech-2024", // Fallback for dev, should be env var
        })
    )
    .post(
        "/login",
        async ({ body, jwt, set }) => {
            const { email, password } = body;

            // SHA256 Hash to match legacy VB.NET logic:
            // Dim bytes = Encoding.UTF8.GetBytes(password)
            // Dim hash = sha256.ComputeHash(bytes)
            // Return Convert.ToBase64String(hash)
            const hashedPassword = createHash("sha256")
                .update(password, "utf8")
                .digest("base64");

            // Query user
            const user = await prisma.cRM_Usuario.findFirst({
                where: {
                    Email: email,
                    Senha: hashedPassword,
                    flaAtivo: true,
                },
            });

            if (!user) {
                set.status = 401;
                return { message: "Usuário/Senha não está cadastrado" };
            }

            // Logic to determine Authorization level
            // If idGrupo = 1 Or idGrupo = 5 Or idGrupo = 7 Or idGrupo = 2 Then Session("Autorizado") = 1 Else Session("Autorizado") = 2
            const authorizedLevel = [1, 2, 5, 7].includes(user.idGrupo || 0) ? 1 : 2;

            // Fetch Group Name
            const group = await prisma.cRM_Grupo.findUnique({
                where: {
                    idGrupo: user.idGrupo || 0
                }
            });

            // Update Last Login
            try {
                await prisma.cRM_Usuario.update({
                    where: { idUsuario: user.idUsuario },
                    data: { DataUltimoLogin: new Date() }
                });
            } catch (e) {
                console.error("Failed to update last login", e);
            }

            const token = await jwt.sign({
                idUsuario: user.idUsuario,
                idGrupo: user.idGrupo,
                UsuarioNome: user.Nome || "",
                UsuarioGrupo: group?.Grupo || "",
                UsuarioImagem: user.Imagem || "images/avatar/avatar.png",
                email: user.Email,
                Autorizado: authorizedLevel,
            });

            return {
                token,
                user: {
                    id: user.idUsuario,
                    idGrupo: user.idGrupo,
                    name: user.Nome,
                    email: user.Email,
                    avatar: user.Imagem,
                    group: group?.Grupo,
                    authorized: authorizedLevel
                }
            };
        },
        {
            body: t.Object({
                email: t.String(),
                password: t.String(),
            }),
        }
    );
