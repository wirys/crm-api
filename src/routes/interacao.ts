import { Elysia, t } from 'elysia';
import { join } from 'path';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { existsSync } from 'fs';
import {prisma} from "../lib/prisma";

function convertBigInt(obj: any): any {
    if (typeof obj === "bigint") {
        return obj.toString();
    }
    if (Array.isArray(obj)) {
        return obj.map(convertBigInt);
    }
    if (obj !== null && typeof obj === "object") {
        return Object.fromEntries(
            Object.entries(obj).map(([key, value]) => [key, convertBigInt(value)])
        );
    }
    return obj;
}

// Rotas de Atividade Tipo
export const atividadeTipoRoutes = new Elysia({ prefix: "/atividadeTipo" })
    .get("/", async () => {
        try {
            const tipos = await prisma.$queryRaw`
                SELECT id, AtividadeTipo 
                FROM CRM_AtividadeTipo 
                ORDER BY AtividadeTipo
            `;

            return {
                status: 200,
                data: convertBigInt(tipos),
            };
        } catch (error) {
            console.error("Erro ao buscar tipos de atividade:", error);
            return { status: 400, data: [], error };
        }
    });

// Rotas de Atividade Status
export const atividadeStatusRoutes = new Elysia({ prefix: "/atividadeStatus" })
    .get("/", async ({ query }) => {
        const idTipo = query.idTipo as string;

        try {
            const status = await prisma.$queryRaw`
                SELECT id, AtividadeStatus, idAtividadeTipo
                FROM CRM_AtividadeStatus 
                WHERE idAtividadeTipo = ${parseInt(idTipo)}
                ORDER BY AtividadeStatus
            `;

            return {
                status: 200,
                data: convertBigInt(status),
            };
        } catch (error) {
            console.error("Erro ao buscar status de atividade:", error);
            return { status: 400, data: [], error };
        }
    });

// Rotas de Interação
export const interacaoRoutes = new Elysia({ prefix: "/interacao" })
    // GET - Listar interações
    .get("/", async ({ query }) => {
        const idContato = query.idContato as string;

        try {
            const interacoes = await prisma.$queryRaw`
                SELECT 
                    t1.idContatoUpdate,
                    t1.UpdateContent,
                    t1.Valor,
                    t1.CreatedAt,
                    usuario = ISNULL(t1.[User], ''),
                    AtividadeTipo = ISNULL(t3.AtividadeTipo, ''),
                    AtividadeStatus = ISNULL(t2.AtividadeStatus, ''),
                    dtaProximoContato = CASE 
                        WHEN t1.dtaProximoContato <= '1901-01-01' THEN 'Não cadastrado'
                        ELSE CONVERT(varchar, t1.dtaProximoContato, 106) + ' ' + CONVERT(varchar, t1.dtaProximoContato, 108)
                    END
                FROM CRM_ContatoUpdate t1
                LEFT JOIN CRM_AtividadeStatus t2 ON t1.idAtividadeStatus = t2.id
                LEFT JOIN CRM_AtividadeTipo t3 ON t1.idAtividadeTipo = t3.id
                WHERE t1.idContato = ${parseInt(idContato)}
                ORDER BY t1.CreatedAt DESC
            `;

            return {
                status: 200,
                data: convertBigInt(interacoes),
            };
        } catch (error) {
            console.error("Erro ao buscar interações:", error);
            return { status: 400, data: [], error };
        }
    })

    // POST - Criar interação
    .post("/", async ({ body }) => {
        const {
            idContato,
            idAtividadeTipo,
            idAtividadeStatus,
            conteudo,
            prazo,
            horario,
            valor,
        } = body as {
            idContato: number;
            idAtividadeTipo: number;
            idAtividadeStatus: number;
            conteudo: string;
            prazo?: string;
            horario?: string;
            valor?: number;
        };

        try {
            // Buscar nome do contato
            const contato = await prisma.cRM_Contato.findUnique({
                where: { idContato },
                select: { nomContato: true },
            });

            if (!contato) {
                return { status: 404, error: "Contato não encontrado" };
            }

            // Construir data/hora
            let dtaProximoContato = null;
            if (prazo && horario) {
                dtaProximoContato = new Date(`${prazo}T${horario}`);
            }

            // Criar interação
            const interacao = await prisma.$executeRaw`
                INSERT INTO CRM_ContatoUpdate (
                    idContato,
                    CreatedAt,
                    UpdateContent,
                    dtaProximoContato,
                    ItemName,
                    [User],
                    idUsuario,
                    idAtividadeStatus,
                    idAtividadeTipo,
                    Valor
                ) VALUES (
                    ${idContato},
                    GETDATE(),
                    ${conteudo},
                    ${dtaProximoContato},
                    ${contato.nomContato},
                    'User',
                    1,
                    ${idAtividadeStatus},
                    ${idAtividadeTipo},
                    ${valor || null}
                )
            `;

            return {
                status: 201,
                data: { success: true },
            };
        } catch (error) {
            console.error("Erro ao criar interação:", error);
            return { status: 400, error };
        }
    })

    // DELETE - Deletar interação
    .delete("/:id", async ({ params }) => {
        try {
            await prisma.$executeRaw`
                DELETE FROM CRM_ContatoUpdate 
                WHERE idContatoUpdate = ${parseInt(params.id)}
            `;

            return { status: 200, message: "Interação deletada com sucesso" };
        } catch (error) {
            console.error("Erro ao deletar interação:", error);
            return { status: 400, error };
        }
    });

// Rotas de Arquivo
export const arquivosRoutes = new Elysia({ prefix: "/arquivos" })
    // GET - Listar arquivos
    .get("/", async ({ query }) => {
        const idContato = query.idContato as string;

        try {
            const arquivos = await prisma.$queryRaw`
                SELECT 
                    id,
                    ArquivoNome,
                    dtaCriacao
                FROM CRM_ContatoArquivo
                WHERE idContato = ${parseInt(idContato)}
                ORDER BY dtaCriacao DESC
            `;

            return {
                status: 200,
                data: convertBigInt(arquivos),
            };
        } catch (error) {
            console.error("Erro ao buscar arquivos:", error);
            return { status: 400, data: [], error };
        }
    })

    // POST - Upload de arquivo
    .post("/upload", async ({ body }) => {
        try {
            const { idContato, files } = body as any;

            // Criar diretório se não existir
            const uploadDir = join(process.cwd(), "public", "uploads", "contatos");
            if (!existsSync(uploadDir)) {
                mkdirSync(uploadDir, { recursive: true });
            }

            const uploadedFiles = [];

            for (const file of files) {
                // Gerar nome único
                const uniqueName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${file.name}`;
                const filePath = join(uploadDir, uniqueName);

                // Salvar arquivo
                writeFileSync(filePath, file.data);

                // Salvar no banco
                await prisma.$executeRaw`
                    INSERT INTO CRM_ContatoArquivo (
                        idContato,
                        ArquivoNome,
                        ArquivoTipo,
                        CaminhoArquivo,
                        dtaCriacao,
                        idUsuario
                    ) VALUES (
                        ${parseInt(idContato)},
                        ${file.name},
                        ${file.type},
                        ${uniqueName},
                        GETDATE(),
                        1
                    )
                `;

                uploadedFiles.push({
                    name: file.name,
                    path: uniqueName,
                });
            }

            return {
                status: 201,
                data: { uploadedFiles },
            };
        } catch (error) {
            console.error("Erro ao fazer upload:", error);
            return { status: 400, error };
        }
    })

    // GET - Download de arquivo
    .get("/download/:id", async ({ params }) => {
        try {
            const arquivo = await prisma.$queryRaw`
                SELECT ArquivoNome, CaminhoArquivo, ArquivoTipo
                FROM CRM_ContatoArquivo
                WHERE id = ${parseInt(params.id)}
            `;

            if (!arquivo || arquivo.length === 0) {
                return { status: 404, error: "Arquivo não encontrado" };
            }

            const file = arquivo[0] as any;
            const filePath = join(process.cwd(), "public", "uploads", "contatos", file.CaminhoArquivo);

            if (!existsSync(filePath)) {
                return { status: 404, error: "Arquivo não encontrado no servidor" };
            }

            const fileData = readFileSync(filePath);

            return new Response(fileData, {
                headers: {
                    "Content-Type": file.ArquivoTipo,
                    "Content-Disposition": `attachment; filename="${file.ArquivoNome}"`,
                },
            });
        } catch (error) {
            console.error("Erro ao fazer download:", error);
            return { status: 400, error };
        }
    })

    // DELETE - Deletar arquivo
    .delete("/:id", async ({ params }) => {
        try {
            const arquivo = await prisma.$queryRaw`
                SELECT CaminhoArquivo
                FROM CRM_ContatoArquivo
                WHERE id = ${parseInt(params.id)}
            `;

            if (arquivo && arquivo.length > 0) {
                const file = arquivo[0] as any;
                const filePath = join(process.cwd(), "public", "uploads", "contatos", file.CaminhoArquivo);

                if (existsSync(filePath)) {
                    // Deletar arquivo
                    // unlinkSync(filePath); // Comentado para não deletar arquivos
                }
            }

            // Deletar registro do banco
            await prisma.$executeRaw`
                DELETE FROM CRM_ContatoArquivo
                WHERE id = ${parseInt(params.id)}
            `;

            return { status: 200, message: "Arquivo deletado com sucesso" };
        } catch (error) {
            console.error("Erro ao deletar arquivo:", error);
            return { status: 400, error };
        }
    });