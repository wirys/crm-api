
import { jwt } from "@elysiajs/jwt";
import { prisma } from "../lib/prisma";
import { createHash } from "crypto";
import { Elysia, t } from "elysia";


export const authRoutes = new Elysia({ prefix: "/auth", detail: { tags: ["Auth"] } })
    .use(
        jwt({
            name: "jwt",
            secret: process.env.JWT_SECRET || "secret-crm-eltech-2024",
        })
    )
    .post(
        "/login",
        async ({ body, jwt, set }) => {
            const emailRaw = (body.email || "").trim();
            const password = body.password || "";

            if (!emailRaw || !password) {
                set.status = 400;
                return { message: "Email e senha são obrigatórios" };
            }

            // SHA256 base64 — legacy VB.NET parity
            const hashedPassword = createHash("sha256")
                .update(password, "utf8")
                .digest("base64");

            // Use raw SQL with LTRIM/RTRIM (legacy char(N) columns are space-padded
            // on MSSQL and a strict equality match fails). Email is matched
            // case-insensitively (default MSSQL collation usually is, but be safe).
            // We fetch by email FIRST so we can distinguish "user not found" from
            // "wrong password" in the server logs without leaking to the client.
            const users = await prisma.$queryRawUnsafe<any[]>(`
                SELECT TOP 1
                    idUsuario,
                    idGrupo,
                    LTRIM(RTRIM(Nome)) AS Nome,
                    LTRIM(RTRIM(Email)) AS Email,
                    LTRIM(RTRIM(Senha)) AS Senha,
                    LTRIM(RTRIM(ISNULL(Imagem, ''))) AS Imagem,
                    flaAtivo
                FROM CRM_Usuario WITH (NOLOCK)
                WHERE LTRIM(RTRIM(LOWER(Email))) = LOWER(@P1)
            `, emailRaw);

            const user = users?.[0];

            if (!user) {
                console.warn(`[auth] login failed: email not found "${emailRaw}"`);
                set.status = 401;
                return { message: "Usuário/Senha não está cadastrado" };
            }

            if (user.flaAtivo === false || user.flaAtivo === 0) {
                console.warn(`[auth] login failed: user inactive idUsuario=${user.idUsuario}`);
                set.status = 401;
                return { message: "Usuário inativo. Contate o administrador." };
            }

            const storedHash = (user.Senha || "").trim();
            if (storedHash !== hashedPassword) {
                console.warn(
                    `[auth] login failed: wrong password idUsuario=${user.idUsuario}` +
                    ` (stored len=${storedHash.length}, sent len=${hashedPassword.length})`
                );
                set.status = 401;
                return { message: "Usuário/Senha não está cadastrado" };
            }

            const idGrupo = Number(user.idGrupo || 0);
            const authorizedLevel = [1, 2, 5, 7].includes(idGrupo) ? 1 : 2;

            // Fetch Group Name
            let groupName = "";
            try {
                const group = await prisma.cRM_Grupo.findUnique({
                    where: { idGrupo },
                });
                groupName = group?.Grupo?.trim() || "";
            } catch (e) {
                console.error("[auth] failed to load group", e);
            }

            // Update Last Login (non-blocking)
            try {
                await prisma.cRM_Usuario.update({
                    where: { idUsuario: Number(user.idUsuario) },
                    data: { DataUltimoLogin: new Date() },
                });
            } catch (e) {
                console.error("[auth] failed to update last login", e);
            }

            const token = await jwt.sign({
                idUsuario: Number(user.idUsuario),
                idGrupo,
                UsuarioNome: user.Nome || "",
                UsuarioGrupo: groupName,
                UsuarioImagem: user.Imagem || "images/avatar/avatar.png",
                email: user.Email,
                Autorizado: authorizedLevel,
            });

            console.log(`[auth] login ok idUsuario=${user.idUsuario} email=${user.Email}`);

            return {
                token,
                user: {
                    id: Number(user.idUsuario),
                    idGrupo,
                    name: user.Nome,
                    email: user.Email,
                    avatar: user.Imagem,
                    group: groupName,
                    authorized: authorizedLevel,
                },
            };
        },
        {
            body: t.Object({
                email: t.String(),
                password: t.String(),
            }),
        }
    );
