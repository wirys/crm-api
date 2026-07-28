
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

            // Fetch Group Name + Permissions
            let groupName = "";
            let permissoes: Record<string, any> = {};
            try {
                const groups: any[] = await prisma.$queryRawUnsafe(
                    `SELECT Grupo, Permissoes FROM CRM_Grupo WHERE idGrupo = ${idGrupo}`
                );
                const g = groups?.[0];
                groupName = (g?.Grupo || "").trim();
                if (g?.Permissoes) {
                    permissoes = typeof g.Permissoes === "string"
                        ? JSON.parse(g.Permissoes)
                        : g.Permissoes;
                }
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

            prisma.$queryRawUnsafe(`
                INSERT INTO CRM_Log (idUsuario, Data, Atividade, Ocorrencia)
                VALUES (${Number(user.idUsuario)}, GETDATE(), 'Login', 'Login realizado - ${(user.Email || "").replace(/'/g, "''")}')
            `).catch(e => console.error("[action-logger] login log failed", e));

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
                    permissoes,
                },
            };
        },
        {
            body: t.Object({
                email: t.String(),
                password: t.String(),
            }),
        }
    )
    .post(
        "/impersonate",
        async ({ body, jwt, set, request }) => {
            const SUPER_ADMIN_GROUPS = new Set([1, 2, 3]);

            const adminId = Number(request.headers.get("x-user-id") || 0);
            const adminGroup = Number(request.headers.get("x-user-group") || 0);

            if (!adminId || !SUPER_ADMIN_GROUPS.has(adminGroup)) {
                set.status = 403;
                return { message: "Apenas super administradores podem usar esta função." };
            }

            const targetId = Number(body.idUsuario);
            if (!targetId || targetId === adminId) {
                set.status = 400;
                return { message: "ID de usuário inválido." };
            }

            const users = await prisma.$queryRawUnsafe<any[]>(`
                SELECT TOP 1
                    idUsuario, idGrupo,
                    LTRIM(RTRIM(Nome)) AS Nome,
                    LTRIM(RTRIM(Email)) AS Email,
                    LTRIM(RTRIM(ISNULL(Imagem, ''))) AS Imagem,
                    flaAtivo
                FROM CRM_Usuario WITH (NOLOCK)
                WHERE idUsuario = ${targetId}
            `);

            const user = users?.[0];
            if (!user) {
                set.status = 404;
                return { message: "Usuário não encontrado." };
            }

            const idGrupo = Number(user.idGrupo || 0);
            const authorizedLevel = [1, 2, 5, 7].includes(idGrupo) ? 1 : 2;

            let groupName = "";
            let permissoes: Record<string, any> = {};
            try {
                const groups: any[] = await prisma.$queryRawUnsafe(
                    `SELECT Grupo, Permissoes FROM CRM_Grupo WHERE idGrupo = ${idGrupo}`
                );
                const g = groups?.[0];
                groupName = (g?.Grupo || "").trim();
                if (g?.Permissoes) {
                    permissoes = typeof g.Permissoes === "string"
                        ? JSON.parse(g.Permissoes)
                        : g.Permissoes;
                }
            } catch {}

            const token = await jwt.sign({
                idUsuario: Number(user.idUsuario),
                idGrupo,
                UsuarioNome: user.Nome || "",
                UsuarioGrupo: groupName,
                UsuarioImagem: user.Imagem || "images/avatar/avatar.png",
                email: user.Email,
                Autorizado: authorizedLevel,
                impersonatedBy: adminId,
            });

            prisma.$queryRawUnsafe(`
                INSERT INTO CRM_Log (idUsuario, Data, Atividade, Ocorrencia)
                VALUES (${adminId}, GETDATE(), 'Impersonate', 'Admin ${adminId} logou como usuário ${targetId} - ${(user.Nome || "").replace(/'/g, "''")}')
            `).catch(e => console.error("[action-logger] impersonate log failed", e));

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
                    impersonatedBy: adminId,
                    permissoes,
                },
            };
        },
        {
            body: t.Object({
                idUsuario: t.Number(),
            }),
        }
    );
