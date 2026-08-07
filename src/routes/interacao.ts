import { Elysia } from 'elysia';
import { prisma } from "../lib/prisma";
import { uploadToS3, getSignedDownloadUrl, getSignedViewUrl, deleteFromS3 } from "../lib/s3";

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

// ── Atividade Tipo ───────────────────────────────────────────────────────────
export const atividadeTipoRoutes = new Elysia({ detail: { tags: ["Contatos"] }, prefix: "/atividadeTipo" })
    .get("/", async () => {
        try {
            const tipos = await prisma.$queryRaw`
                SELECT id, AtividadeTipo FROM CRM_AtividadeTipo ORDER BY AtividadeTipo
            `;
            return { status: 200, data: conv(tipos) };
        } catch (error) {
            console.error("Erro ao buscar tipos de atividade:", error);
            return { status: 400, data: [], error };
        }
    }, {
        detail: {
            summary: "Listar tipos de atividade",
            description: "Retorna todos os tipos de atividade (CRM_AtividadeTipo) cadastrados, ordenados alfabeticamente, usados para classificar interações registradas em um contato."
        }
    });

// ── Atividade Status ─────────────────────────────────────────────────────────
export const atividadeStatusRoutes = new Elysia({ detail: { tags: ["Contatos"] }, prefix: "/atividadeStatus" })
    .get("/", async ({ query }) => {
        const idTipo = query.idTipo as string;
        try {
            const status = await prisma.$queryRaw`
                SELECT id, AtividadeStatus, idAtividadeTipo
                FROM CRM_AtividadeStatus
                WHERE idAtividadeTipo = ${parseInt(idTipo)}
                ORDER BY AtividadeStatus
            `;
            return { status: 200, data: conv(status) };
        } catch (error) {
            console.error("Erro ao buscar status de atividade:", error);
            return { status: 400, data: [], error };
        }
    }, {
        detail: {
            summary: "Listar status de atividade por tipo",
            description: "Retorna os status de atividade (CRM_AtividadeStatus) filtrados pelo idTipo informado na query, ordenados alfabeticamente. Usado para popular o campo de status conforme o tipo de atividade selecionado."
        }
    });

// ── Interações ───────────────────────────────────────────────────────────────
export const interacaoRoutes = new Elysia({ detail: { tags: ["Contatos"] }, prefix: "/interacao" })
    .get("/", async ({ query }) => {
        const idContato = query.idContato as string;
        try {
            const interacoes = await prisma.$queryRaw`
                SELECT
                    t1.idContatoUpdate,
                    t1.UpdateContent,
                    t1.Valor,
                    t1.CreatedAt,
                    t1.idAtividadeTipo,
                    t1.idAtividadeStatus,
                    usuario     = ISNULL(t1.[User], ''),
                    idUsuario   = ISNULL(t1.idUsuario, 0),
                    AtividadeTipo   = ISNULL(t3.AtividadeTipo, ''),
                    AtividadeStatus = ISNULL(t2.AtividadeStatus, ''),
                    dtaProximoContato = CASE
                        WHEN t1.dtaProximoContato IS NULL OR t1.dtaProximoContato <= '1901-01-01' THEN NULL
                        ELSE t1.dtaProximoContato
                    END
                FROM CRM_ContatoUpdate t1
                LEFT JOIN CRM_AtividadeStatus t2 ON t1.idAtividadeStatus = t2.id
                LEFT JOIN CRM_AtividadeTipo t3 ON t1.idAtividadeTipo = t3.id
                WHERE t1.idContato = ${parseInt(idContato)}
                ORDER BY t1.CreatedAt DESC
            `;
            return { status: 200, data: conv(interacoes) };
        } catch (error) {
            console.error("Erro ao buscar interações:", error);
            return { status: 400, data: [], error };
        }
    }, {
        detail: {
            summary: "Listar interações de um contato",
            description: "Retorna o histórico de interações (CRM_ContatoUpdate) de um contato específico (idContato via query), incluindo tipo, status, usuário responsável e próximo contato agendado, ordenado da mais recente para a mais antiga. Datas de próximo contato menores ou iguais a 1901-01-01 são tratadas como nulas."
        }
    })

    .post("/", async ({ body, request, set }) => {
        const { idContato, idAtividadeTipo, idAtividadeStatus, conteudo, prazo, horario, valor } = body as any;
        const uid = Number(request.headers.get("x-user-id") || 1);
        try {
            const contato: any[] = await prisma.$queryRawUnsafe(
                `SELECT nomContato FROM CRM_Contato WHERE idContato = ${Number(idContato)}`
            );
            if (!contato.length) { set.status = 404; return { error: "Contato não encontrado" }; }

            const userRow: any[] = await prisma.$queryRawUnsafe(
                `SELECT Nome FROM CRM_Usuario WHERE idUsuario = ${uid}`
            );
            const userName = userRow.length ? String(userRow[0].Nome || 'User').replace(/'/g, "''") : 'User';

            let dtaProximo = "NULL";
            if (prazo) {
                const h = horario || "00:00";
                dtaProximo = `'${prazo} ${h}:00'`;
            }

            const content = String(conteudo || '').replace(/'/g, "''");
            const vl = valor ? Number(valor) : "NULL";

            await prisma.$queryRawUnsafe(`
                INSERT INTO CRM_ContatoUpdate (idContato, CreatedAt, UpdateContent, dtaProximoContato, ItemName, [User], idUsuario, idAtividadeStatus, idAtividadeTipo, Valor)
                VALUES (${Number(idContato)}, GETDATE(), '${content}', ${dtaProximo}, '${String(contato[0].nomContato).replace(/'/g, "''")}', '${userName}', ${uid}, ${Number(idAtividadeStatus)}, ${Number(idAtividadeTipo)}, ${vl})
            `);

            set.status = 201;
            return { data: { success: true } };
        } catch (error) {
            console.error("Erro ao criar interação:", error);
            set.status = 400;
            return { error: String(error) };
        }
    }, {
        detail: {
            summary: "Criar interação em um contato",
            description: "Registra uma nova interação (CRM_ContatoUpdate) para o contato informado, com tipo, status, conteúdo, valor opcional e próximo contato (prazo + horário). Busca o nome do contato e do usuário autenticado (via header x-user-id, default 1) para compor o registro. Retorna 404 se o contato não existir."
        }
    })

    .delete("/:id", async ({ params, set }) => {
        try {
            await prisma.$executeRaw`DELETE FROM CRM_ContatoUpdate WHERE idContatoUpdate = ${parseInt(params.id)}`;
            return { message: "Interação deletada" };
        } catch (error) {
            console.error("Erro ao deletar interação:", error);
            set.status = 400;
            return { error };
        }
    }, {
        detail: {
            summary: "Excluir interação",
            description: "Remove definitivamente uma interação (CRM_ContatoUpdate) pelo id informado na URL."
        }
    });

// ── Arquivos (S3) ────────────────────────────────────────────────────────────
export const arquivosRoutes = new Elysia({ detail: { tags: ["Contatos"] }, prefix: "/arquivos" })
    .get("/", async ({ query }) => {
        const idContato = query.idContato as string;
        try {
            const arquivos: any[] = await prisma.$queryRaw`
                SELECT id, idContato, ArquivoNome, ArquivoTipo, CaminhoArquivo, dtaCriacao, idUsuario
                FROM CRM_ContatoArquivo
                WHERE idContato = ${parseInt(idContato)}
                ORDER BY dtaCriacao DESC
            `;

            const result = [];
            for (const arq of conv(arquivos)) {
                const key = arq.CaminhoArquivo || '';
                const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(arq.ArquivoNome || '');
                let thumbnailUrl = null;
                let viewUrl = null;

                try {
                    if (isImage && key) {
                        thumbnailUrl = await getSignedViewUrl(key, arq.ArquivoTipo || 'image/jpeg');
                        viewUrl = thumbnailUrl;
                    }
                } catch { /* S3 key may not exist yet */ }

                result.push({
                    ...arq,
                    isImage,
                    thumbnailUrl,
                    viewUrl,
                });
            }

            return { status: 200, data: result };
        } catch (error) {
            console.error("Erro ao buscar arquivos:", error);
            return { status: 400, data: [], error };
        }
    }, {
        detail: {
            summary: "Listar arquivos de um contato",
            description: "Retorna os arquivos anexados a um contato (CRM_ContatoArquivo) filtrados por idContato via query, ordenados do mais recente para o mais antigo. Para arquivos de imagem, gera uma URL assinada de visualização/miniatura via S3 (ignorando erro caso a chave não exista mais no bucket)."
        }
    })

    .post("/upload", async ({ body, set, request }) => {
        try {
            const formData = body as any;
            const idContato = Number(formData.idContato);
            const idUsuario = Number(request.headers.get("x-user-id") || formData.idUsuario || 1);
            const files = formData.files;

            if (!idContato || !files) {
                set.status = 400;
                return { error: "idContato e files são obrigatórios" };
            }

            const fileList = Array.isArray(files) ? files : [files];
            const uploaded = [];

            for (const file of fileList) {
                const originalName = file.name || 'arquivo';
                const contentType = file.type || 'application/octet-stream';
                const ext = originalName.includes('.') ? '.' + originalName.split('.').pop() : '';
                const s3Key = `contatos/${idContato}/${crypto.randomUUID()}${ext}`;

                const arrayBuffer = await file.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

                await uploadToS3(s3Key, buffer, contentType);

                await prisma.$queryRawUnsafe(`
                    INSERT INTO CRM_ContatoArquivo (idContato, ArquivoNome, ArquivoTipo, CaminhoArquivo, dtaCriacao, idUsuario)
                    VALUES (${idContato}, '${originalName.replace(/'/g, "''")}', '${contentType}', '${s3Key}', GETDATE(), ${idUsuario})
                `);

                uploaded.push({ name: originalName, key: s3Key });
            }

            set.status = 201;
            return { data: { uploaded } };
        } catch (error) {
            console.error("Erro ao fazer upload:", error);
            set.status = 400;
            return { error: String(error) };
        }
    }, {
        detail: {
            summary: "Enviar arquivos para um contato",
            description: "Faz upload de um ou mais arquivos (multipart/form-data) para o bucket S3 sob a chave contatos/{idContato}/{uuid}, e registra cada arquivo em CRM_ContatoArquivo com nome, tipo e usuário responsável (header x-user-id ou idUsuario do form, default 1). Requer idContato e files; retorna 400 se ausentes."
        }
    })

    .post("/upload-image", async ({ body, set }) => {
        try {
            const formData = body as any;
            const file = formData.file;
            if (!file) { set.status = 400; return { error: "file é obrigatório" }; }

            const originalName = file.name || "image.png";
            const contentType = file.type || "image/png";
            const ext = originalName.includes(".") ? "." + originalName.split(".").pop() : ".png";
            const s3Key = `interacao-images/${crypto.randomUUID()}${ext}`;

            const arrayBuffer = await file.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            await uploadToS3(s3Key, buffer, contentType);

            const url = await getSignedViewUrl(s3Key, contentType);
            return { url, key: s3Key };
        } catch (error) {
            console.error("Erro ao fazer upload de imagem:", error);
            set.status = 400;
            return { error: String(error) };
        }
    }, {
        detail: {
            summary: "Enviar imagem para interação",
            description: "Faz upload de uma única imagem (multipart/form-data) para o bucket S3 sob a chave interacao-images/{uuid}, retornando a URL assinada de visualização e a chave gerada. Usado para inserir imagens dentro do conteúdo de uma interação. Retorna 400 se o arquivo não for informado."
        }
    })

    .get("/download/:id", async ({ params, set }) => {
        try {
            const arquivo: any[] = await prisma.$queryRaw`
                SELECT ArquivoNome, CaminhoArquivo, ArquivoTipo
                FROM CRM_ContatoArquivo
                WHERE id = ${parseInt(params.id)}
            `;
            if (!arquivo.length) { set.status = 404; return { error: "Arquivo não encontrado" }; }

            const f = arquivo[0] as any;
            const url = await getSignedDownloadUrl(f.CaminhoArquivo, f.ArquivoNome);
            return { url };
        } catch (error) {
            console.error("Erro ao gerar download:", error);
            set.status = 400;
            return { error: String(error) };
        }
    }, {
        detail: {
            summary: "Gerar link de download de arquivo",
            description: "Busca o arquivo (CRM_ContatoArquivo) pelo id na URL e retorna uma URL assinada de download do S3. Retorna 404 caso o arquivo não seja encontrado."
        }
    })

    .delete("/:id", async ({ params, set }) => {
        try {
            const arquivo: any[] = await prisma.$queryRaw`
                SELECT CaminhoArquivo FROM CRM_ContatoArquivo WHERE id = ${parseInt(params.id)}
            `;
            if (arquivo.length) {
                const key = (arquivo[0] as any).CaminhoArquivo;
                if (key) {
                    try { await deleteFromS3(key); } catch { /* file may not exist in S3 */ }
                }
            }

            await prisma.$executeRaw`DELETE FROM CRM_ContatoArquivo WHERE id = ${parseInt(params.id)}`;
            return { message: "Arquivo deletado" };
        } catch (error) {
            console.error("Erro ao deletar arquivo:", error);
            set.status = 400;
            return { error };
        }
    }, {
        detail: {
            summary: "Excluir arquivo",
            description: "Remove um arquivo pelo id: exclui o objeto correspondente do bucket S3 (ignorando erro se já não existir) e em seguida remove o registro em CRM_ContatoArquivo."
        }
    });
