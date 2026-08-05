import { Elysia, t } from "elysia";
import { prisma } from "../lib/prisma";

function convertBigIntToNumber(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'bigint') return Number(obj);
    if (obj instanceof Date) return obj.toISOString();
    if (typeof obj === 'object' && typeof obj.toNumber === 'function') return obj.toNumber();
    if (typeof obj === 'object') {
        if (Array.isArray(obj)) return obj.map(item => convertBigIntToNumber(item));
        const converted: any = {};
        for (const key of Object.keys(obj)) {
            converted[key] = convertBigIntToNumber(obj[key]);
        }
        return converted;
    }
    return obj;
}

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;
const RATE_LIMIT_WINDOW = 60_000;
const RATE_LIMIT_MAX = 30;

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function isInternal(request: Request): boolean {
    const origin = request.headers.get("origin") || "";
    const referer = request.headers.get("referer") || "";
    return origin.includes("eltechquimica.com") || referer.includes("eltechquimica.com")
        || origin.includes("localhost") || referer.includes("localhost");
}

function getClientKey(request: Request): string {
    return request.headers.get("x-api-key")
        || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
        || request.headers.get("cf-connecting-ip")
        || "anonymous";
}

setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore) {
        if (entry.resetAt <= now) rateLimitStore.delete(key);
    }
}, 60_000);

export const publicProposalsRoutes = new Elysia({
    prefix: "/api/v1/proposals",
    detail: { tags: ["API Pública - Propostas"] },
})
    .onBeforeHandle(({ request, set }) => {
        const internal = isInternal(request);
        const apiKey = request.headers.get("x-api-key");

        if (!internal && !apiKey) {
            set.status = 401;
            return {
                error: "Não autorizado",
                message: "Header 'x-api-key' é obrigatório para acesso externo.",
            };
        }

        if (!internal) {
            const clientKey = getClientKey(request);
            const now = Date.now();
            let entry = rateLimitStore.get(clientKey);

            if (!entry || entry.resetAt <= now) {
                entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
                rateLimitStore.set(clientKey, entry);
            }

            entry.count++;
            const remaining = Math.max(0, RATE_LIMIT_MAX - entry.count);
            const resetSeconds = Math.ceil((entry.resetAt - now) / 1000);

            set.headers["x-ratelimit-limit"] = String(RATE_LIMIT_MAX);
            set.headers["x-ratelimit-remaining"] = String(remaining);
            set.headers["x-ratelimit-reset"] = String(resetSeconds);

            if (entry.count > RATE_LIMIT_MAX) {
                set.status = 429;
                return {
                    error: "Rate limit excedido",
                    message: `Limite de ${RATE_LIMIT_MAX} requisições por minuto. Tente novamente em ${resetSeconds}s.`,
                };
            }
        }
    })
    .get("/", async ({ query }) => {
        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(query.limit) || DEFAULT_PAGE_SIZE));
        const offset = (page - 1) * limit;

        const status = query.status ? Number(query.status) : null;
        const search = query.search?.trim() || null;

        const conditions: string[] = ["1=1"];
        if (status) conditions.push(`p.idStatus = ${status}`);
        if (search) {
            const safe = search.replace(/'/g, "''").substring(0, 100);
            conditions.push(`(p.PropostaNo LIKE '%${safe}%' OR c.nomContato LIKE '%${safe}%')`);
        }

        const where = conditions.join(" AND ");

        const [rows, countResult]: [any[], any[]] = await Promise.all([
            prisma.$queryRawUnsafe(`
                SELECT
                    p.idProposta,
                    p.PropostaNo,
                    ClienteNome   = ISNULL(c.nomContato, ''),
                    p.TotalKg,
                    p.TotalValor,
                    p.idStatus,
                    Status        = ISNULL(s.Status, 'N/D'),
                    CorHTML       = ISNULL(s.CorHTML, '#999999'),
                    dtaCriacao    = CASE WHEN p.dtaCriacao IS NULL THEN '' ELSE FORMAT(p.dtaCriacao, 'dd/MM/yyyy') END
                FROM CRM_Proposta AS p WITH (NOLOCK)
                LEFT JOIN CRM_Contato          AS c WITH (NOLOCK) ON p.idContato = c.idContato
                LEFT JOIN CRM_Proposta_Status  AS s WITH (NOLOCK) ON p.idStatus  = s.idStatus
                WHERE ${where}
                ORDER BY p.dtaCriacao DESC
                OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
            `),
            prisma.$queryRawUnsafe(`
                SELECT COUNT(*) as total
                FROM CRM_Proposta AS p WITH (NOLOCK)
                LEFT JOIN CRM_Contato AS c WITH (NOLOCK) ON p.idContato = c.idContato
                WHERE ${where}
            `),
        ]);

        const total = Number(countResult[0]?.total ?? 0);

        return {
            data: convertBigIntToNumber(rows),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }, {
        query: t.Object({
            page: t.Optional(t.String()),
            limit: t.Optional(t.String()),
            status: t.Optional(t.String()),
            search: t.Optional(t.String()),
        }),
        detail: {
            summary: "Listar propostas",
            description: [
                "Retorna lista paginada de propostas comerciais.",
                "",
                "**Rate limit:** 30 requisições/minuto para acesso externo (requests do frontend são isentas).",
                "",
                "**Autenticação:** Header `x-api-key` obrigatório para acesso externo.",
                "",
                "**Parâmetros de query:**",
                "- `page` — Página (default: 1)",
                "- `limit` — Itens por página (default: 20, máximo: 50)",
                "- `status` — Filtrar por idStatus",
                "- `search` — Busca por PropostaNo ou nome do cliente (máximo 100 caracteres)",
            ].join("\n"),
        },
    })
    .get("/:id", async ({ params, set }) => {
        const id = Number(params.id);
        if (isNaN(id) || id <= 0) {
            set.status = 400;
            return { error: "ID inválido" };
        }

        const rows: any[] = await prisma.$queryRawUnsafe(`
            SELECT TOP 1
                p.idProposta,
                p.PropostaNo,
                ClienteNome   = ISNULL(c.nomContato, ''),
                UF            = ISNULL(d.UF, ''),
                p.CalculaDifal,
                p.Desconto,
                p.TotalKg,
                p.TotalValor,
                p.idStatus,
                Status        = ISNULL(s.Status, 'N/D'),
                CorHTML       = ISNULL(s.CorHTML, '#999999'),
                dtaCriacao    = CASE WHEN p.dtaCriacao IS NULL THEN '' ELSE FORMAT(p.dtaCriacao, 'dd/MM/yyyy') END
            FROM CRM_Proposta AS p WITH (NOLOCK)
            LEFT JOIN CRM_Contato          AS c WITH (NOLOCK) ON p.idContato = c.idContato
            LEFT JOIN CRM_Proposta_Difal   AS d WITH (NOLOCK) ON p.idDifal   = d.idDifal
            LEFT JOIN CRM_Proposta_Status  AS s WITH (NOLOCK) ON p.idStatus  = s.idStatus
            WHERE p.idProposta = ${id}
        `);

        if (!rows.length) {
            set.status = 404;
            return { error: "Proposta não encontrada" };
        }

        return convertBigIntToNumber(rows[0]);
    }, {
        params: t.Object({ id: t.String() }),
        detail: {
            summary: "Buscar proposta por ID",
            description: "Retorna dados de uma proposta específica pelo ID.",
        },
    });
