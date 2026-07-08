import { Elysia, t } from "elysia";
import { prisma } from "../lib/prisma";
import { getUserContext } from "../lib/user-context";

function convertBigIntToNumber(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'bigint') return Number(obj);
    if (obj instanceof Date) return obj.toISOString();
    // Prisma Decimal — has toNumber() method
    if (typeof obj === 'object' && typeof obj.toNumber === 'function') return obj.toNumber();
    if (Array.isArray(obj)) return obj.map(item => convertBigIntToNumber(item));
    if (typeof obj === 'object') {
        const converted: any = {};
        for (const key of Object.keys(obj)) {
            converted[key] = convertBigIntToNumber(obj[key]);
        }
        return converted;
    }
    return obj;
}

export const contactsRoutes = new Elysia({ detail: { tags: ["Contatos"] }, prefix: "/contacts" })
    .get("/segments", async () => {
        return await prisma.cRM_SegmentoAtuacao.findMany({
            select: {
                id: true,
                Cod: true,
                SegmentoAtuacao: true,
            },
            orderBy: { Cod: "asc" },
        });
    })
    .get("/statuses", async () => {
        return await prisma.cRM_Status.findMany({
            select: {
                idStatus: true,
                Status: true,
                CorHTML: true,
            },
            orderBy: { Status: "asc" },
        });
    })
    .get("/origins", async () => {
        return await prisma.cRM_Origem.findMany({
            select: {
                idOrigem: true,
                Origem: true,
                corHTML: true,
            },
            orderBy: { Origem: "asc" },
        });
    })
    .get("/representatives", async () => {
        return await prisma.cRM_Usuario.findMany({
            select: {
                idUsuario: true,
                Nome: true,
            },
            orderBy: { Nome: "asc" },
        });
    })
    .get("/representatives-full", async () => {
        return await prisma.cRM_Usuario.findMany({
            select: {
                idUsuario: true,
                Nome: true,
                corHTML: true,
            },
            orderBy: { Nome: "asc" },
        });
    })
    .get("/", async ({ query, request }) => {
        const { userId, isAdmin } = getUserContext(request);
        const { representatives } = query;

        let repIds = representatives
            ? representatives.split(",").map((id: string) => parseInt(id)).filter((id: number) => !isNaN(id) && id > 0)
            : [];

        if (!isAdmin && userId > 0) {
            repIds = [userId];
        }

        const whereClause = repIds.length > 0
            ? `WHERE t1.idRepresentante IN (${repIds.join(",")})`
            : "";

        try {
            const rows: any[] = await prisma.$queryRawUnsafe(`
                SELECT
                    t1.idContato,
                    NomContato      = LTRIM(RTRIM(ISNULL(t1.nomContato, ''))),
                    NomComercial    = LTRIM(RTRIM(ISNULL(NULLIF(t1.nomComercial,''), t1.nomContato))),
                    CodCliente      = LTRIM(RTRIM(ISNULL(t1.CodCliente, ''))),
                    CNPJ            = LTRIM(RTRIM(ISNULL(t1.CNPJ, ''))),
                    Segmento        = LTRIM(RTRIM(ISNULL(t1.Segmento, ''))),
                    SegmentoAtuacao = LTRIM(RTRIM(ISNULL(t1.SegmentoAtuacao, ''))),
                    Telefone        = LTRIM(RTRIM(ISNULL(t1.Telefone, ''))),
                    Email           = LTRIM(RTRIM(ISNULL(t1.email, ''))),
                    t1.IdStatus,
                    t1.IdOrigem,
                    t1.idRepresentante,
                    Status          = LTRIM(RTRIM(ISNULL(t3.Status, 'N/D'))),
                    CorStatus       = ISNULL(t3.CorHTML, '#999999'),
                    Origem          = LTRIM(RTRIM(ISNULL(t4.Origem, 'N/D'))),
                    CorOrigem       = ISNULL(t4.CorHTML, '#999999'),
                    Representante   = LTRIM(RTRIM(ISNULL(t5.Nome, 'N/D'))),
                    RepImagem       = ISNULL(t5.Imagem, ''),
                    intProposta     = (SELECT COUNT(*) FROM CRM_Proposta WITH (NOLOCK) WHERE idContato = t1.idContato),
                    proximaAtividade = ISNULL(CONVERT(varchar(16), t7.ProximaAtividade, 120), ''),
                    dtaCadastro      = ISNULL(CONVERT(varchar(10), t1.dtaCadastro, 23), '')
                FROM CRM_Contato AS t1 WITH (NOLOCK)
                LEFT JOIN CRM_Status  AS t3 WITH (NOLOCK) ON t1.IdStatus        = t3.idStatus
                LEFT JOIN CRM_Origem  AS t4 WITH (NOLOCK) ON t1.IdOrigem        = t4.idOrigem
                LEFT JOIN CRM_Usuario AS t5 WITH (NOLOCK) ON t1.idRepresentante = t5.idUsuario
                LEFT JOIN (
                    SELECT idContato, ProximaAtividade = MIN(DataInicio)
                    FROM CRM_Agenda WITH (NOLOCK)
                    WHERE DataInicio >= GETDATE()
                    GROUP BY idContato
                ) AS t7 ON t1.idContato = t7.idContato
                ${whereClause}
                ORDER BY t1.idContato DESC
            `);

            return convertBigIntToNumber(rows);
        } catch (error) {
            console.error("[contacts] GET / error:", error);
            return [];
        }
    }, {
        query: t.Object({
            representatives: t.Optional(t.String())
        })
    })
    .get("/:id", async ({ params, set }) => {
        try {
            const contactId = parseInt(params.id);
            const contact = await prisma.cRM_Contato.findUnique({
                where: { idContato: contactId },
            });
            if (!contact) {
                set.status = 404;
                return { message: "Contato não encontrado." };
            }
            const address = await prisma.cRM_Contato_Endereco.findFirst({
                where: { idContato: contactId, flaPrincipal: true },
            });
            return convertBigIntToNumber({ contact, address: address ?? {} });
        } catch (e) {
            console.error(e);
            set.status = 500;
            return { message: "Erro ao buscar contato." };
        }
    }, {
        params: t.Object({ id: t.String() })
    })
    .put(
        "/:id",
        async ({ params, body, set }) => {
            try {
                const contactId = parseInt(params.id);
                const { contact, address } = body;

                const { flaAtivo, idBotConversa, dtaAbertura, dtaNascimento, dtaCadastro, idRepresentante, IdOrigem, ...rest } = contact;
                await prisma.cRM_Contato.update({
                    where: { idContato: contactId },
                    data: {
                        ...rest,
                        flaAtivo: flaAtivo === "1",
                        idBotConversa: idBotConversa ? parseInt(idBotConversa) : undefined,
                        idRepresentante: idRepresentante ? Number(idRepresentante) : undefined,
                        IdOrigem: IdOrigem ? Number(IdOrigem) : undefined,
                        dtaAbertura: dtaAbertura ? new Date(dtaAbertura) : undefined,
                        dtaAlteracao: new Date(),
                    },
                });

                if (address && Object.keys(address).length > 0) {
                    const existing = await prisma.cRM_Contato_Endereco.findFirst({
                        where: { idContato: contactId, flaPrincipal: true },
                    });
                    if (existing) {
                        await prisma.cRM_Contato_Endereco.update({
                            where: { IdContatoEndereco: existing.IdContatoEndereco },
                            data: address,
                        });
                    } else {
                        await prisma.cRM_Contato_Endereco.create({
                            data: {
                                ...address,
                                idContato: contactId,
                                flaPrincipal: true,
                                flaAtivo: true,
                                dtaCadastro: new Date(),
                            },
                        });
                    }
                }

                return { message: "Contato atualizado com sucesso!" };
            } catch (e) {
                console.error(e);
                set.status = 500;
                return { message: "Erro ao atualizar contato." };
            }
        },
        {
            params: t.Object({ id: t.String() }),
            body: t.Object({
                contact: t.Object({
                    nomContato: t.Optional(t.String()),
                    nomComercial: t.Optional(t.String()),
                    TipoPessoa: t.String(),
                    CNPJ: t.Optional(t.String()),
                    CPF: t.Optional(t.String()),
                    idRepresentante: t.Optional(t.Number()),
                    IdOrigem: t.Optional(t.Number()),
                    SegmentoAtuacao: t.Optional(t.String()),
                    Telefone: t.Optional(t.String()),
                    TelefoneWS: t.Optional(t.String()),
                    email: t.Optional(t.String()),
                    idBotConversa: t.Optional(t.String()),
                    flaAtivo: t.String(),
                    dtaAbertura: t.Optional(t.String()),
                    Situacao: t.Optional(t.String()),
                    Porte: t.Optional(t.String()),
                    NaturezaJuridica: t.Optional(t.String()),
                    AtividadePrincipal: t.Optional(t.String()),
                }),
                address: t.Object({
                    CEP: t.Optional(t.String()),
                    UF: t.Optional(t.String()),
                    Cidade: t.Optional(t.String()),
                    Bairro: t.Optional(t.String()),
                    Endereco: t.Optional(t.String()),
                    Numero: t.Optional(t.String()),
                    Complemento: t.Optional(t.String()),
                }),
            }),
        }
    )
    .post(
        "/",
        async ({ body, set }) => {
            try {
                const { contact, address } = body;

                // Check for existing CPF/CNPJ
                if (contact.TipoPessoa === "0" && contact.CPF) {
                    const exists = await prisma.cRM_Contato.count({
                        where: { CPF: contact.CPF },
                    });
                    if (exists > 0) {
                        set.status = 400;
                        return { message: "CPF já cadastrado." };
                    }
                } else if (contact.TipoPessoa === "1" && contact.CNPJ) {
                    const exists = await prisma.cRM_Contato.count({
                        where: { CNPJ: contact.CNPJ },
                    });
                    if (exists > 0) {
                        set.status = 400;
                        return { message: "CNPJ já cadastrado." };
                    }
                }

                // Create contact
                const newContact = await prisma.cRM_Contato.create({
                    data: {
                        ...contact,
                        idBotConversa: contact.idBotConversa ? parseInt(contact.idBotConversa) : undefined,
                        dtaAbertura: contact.dtaAbertura ? new Date(contact.dtaAbertura) : undefined,
                        dtaCadastro: new Date(),
                        flaAtivo: contact.flaAtivo === "1",
                    },
                });

                // Create address
                await prisma.cRM_Contato_Endereco.create({
                    data: {
                        ...address,
                        idContato: newContact.idContato,
                        flaPrincipal: true,
                        flaAtivo: true,
                        dtaCadastro: new Date(),
                    },
                });

                return { idContato: newContact.idContato, message: "Contato cadastrado com sucesso!" };
            } catch (e) {
                console.error(e);
                set.status = 500;
                return { message: "Erro ao cadastrar contato." };
            }
        },
        {
            body: t.Object({
                contact: t.Object({
                    nomContato: t.Optional(t.String()),
                    nomComercial: t.Optional(t.String()),
                    TipoPessoa: t.String(),
                    CNPJ: t.Optional(t.String()),
                    CPF: t.Optional(t.String()),
                    idRepresentante: t.Optional(t.Number()),
                    IdOrigem: t.Optional(t.Number()),
                    SegmentoAtuacao: t.Optional(t.String()),
                    Telefone: t.Optional(t.String()),
                    TelefoneWS: t.Optional(t.String()),
                    email: t.Optional(t.String()),
                    idBotConversa: t.Optional(t.String()),
                    CodCliente: t.Optional(t.String()),
                    fContato: t.Optional(t.String()),
                    fTelefone: t.Optional(t.String()),
                    fEmail: t.Optional(t.String()),
                    CategoriaFinanceira: t.Optional(t.String()),
                    flaAtivo: t.String(),
                    idUsuarioAt: t.Optional(t.Number()),
                    dtaAbertura: t.Optional(t.String()),
                    Situacao: t.Optional(t.String()),
                    Porte: t.Optional(t.String()),
                    NaturezaJuridica: t.Optional(t.String()),
                    AtividadePrincipal: t.Optional(t.String()),
                    Tipo: t.Optional(t.String()),
                    ContatoEmpresa: t.Optional(t.String()),
                    Segmento: t.Optional(t.String()),
                }),
                address: t.Object({
                    CEP: t.Optional(t.String()),
                    UF: t.Optional(t.String()),
                    Cidade: t.Optional(t.String()),
                    Bairro: t.Optional(t.String()),
                    Endereco: t.Optional(t.String()),
                    Numero: t.Optional(t.String()),
                    Complemento: t.Optional(t.String()),
                    idUsuario: t.Optional(t.Number()),
                }),
            }),
        }
    )
    .patch(
        "/:id",
        async ({ params, body, set }) => {
            try {
                const contactId = parseInt(params.id);

                await prisma.cRM_Contato.update({
                    where: { idContato: contactId },
                    data: body as any
                });

                return { message: "Contato atualizado com sucesso!" };
            } catch (e) {
                console.error(e);
                set.status = 500;
                return { message: "Erro ao atualizar contato." };
            }
        },
        {
            params: t.Object({
                id: t.String()
            }),
            body: t.Object({
                IdStatus: t.Optional(t.Number()),
                IdOrigem: t.Optional(t.Number()),
                idRepresentante: t.Optional(t.Number()),
            })
        }
    );
