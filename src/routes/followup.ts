import { Elysia } from "elysia";
import { prisma } from "../lib/prisma";

function conv(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === "bigint") return Number(obj);
    if (obj instanceof Date) return obj.toISOString();
    if (Array.isArray(obj)) return obj.map(conv);
    if (typeof obj === "object") {
        if (typeof obj.toNumber === "function") return obj.toNumber();
        const out: any = {};
        for (const k in obj) out[k] = conv(obj[k]);
        return out;
    }
    return obj;
}

const baseQuery = `
    SELECT
        a.id,
        a.idContato,
        c.nomComercial AS contatoNome,
        a.idRepresentante,
        u.Nome AS representanteNome,
        t.AtividadeTipo,
        a.dataProximoContato,
        a.Observacao,
        a.Valor
    FROM CRM_AtividadeRelatorio a WITH (NOLOCK)
    INNER JOIN CRM_Contato c WITH (NOLOCK) ON c.idContato = a.idContato
    INNER JOIN CRM_Usuario u WITH (NOLOCK) ON u.idUsuario = a.idRepresentante
    LEFT JOIN CRM_AtividadeTipo t WITH (NOLOCK) ON t.id = a.idAtividadeTipo
    WHERE a.dataProximoContato IS NOT NULL
`;

export const followupRoutes = new Elysia({ detail: { tags: ["Follow-up"] }, prefix: "/followup" })

    .get("/alertas", async () => {
        const vencidas = await prisma.$queryRawUnsafe(`
            ${baseQuery}
              AND CAST(a.dataProximoContato AS DATE) < CAST(GETDATE() AS DATE)
            ORDER BY a.dataProximoContato ASC
        `);

        const hoje = await prisma.$queryRawUnsafe(`
            ${baseQuery}
              AND CAST(a.dataProximoContato AS DATE) = CAST(GETDATE() AS DATE)
            ORDER BY a.dataProximoContato ASC
        `);

        const proximas = await prisma.$queryRawUnsafe(`
            ${baseQuery}
              AND CAST(a.dataProximoContato AS DATE) > CAST(GETDATE() AS DATE)
              AND CAST(a.dataProximoContato AS DATE) <= DATEADD(DAY, 7, CAST(GETDATE() AS DATE))
            ORDER BY a.dataProximoContato ASC
        `);

        return {
            vencidas: conv(vencidas),
            hoje: conv(hoje),
            proximas: conv(proximas),
        };
    })

    .get("/alertas/count", async () => {
        const rows: any[] = await prisma.$queryRawUnsafe(`
            SELECT
                SUM(CASE WHEN CAST(a.dataProximoContato AS DATE) < CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) AS vencidas,
                SUM(CASE WHEN CAST(a.dataProximoContato AS DATE) = CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) AS hoje,
                SUM(CASE WHEN CAST(a.dataProximoContato AS DATE) > CAST(GETDATE() AS DATE)
                          AND CAST(a.dataProximoContato AS DATE) <= DATEADD(DAY, 7, CAST(GETDATE() AS DATE)) THEN 1 ELSE 0 END) AS proximas
            FROM CRM_AtividadeRelatorio a WITH (NOLOCK)
            WHERE a.dataProximoContato IS NOT NULL
        `);

        const r = conv(rows[0]) || { vencidas: 0, hoje: 0, proximas: 0 };
        return {
            vencidas: r.vencidas ?? 0,
            hoje: r.hoje ?? 0,
            proximas: r.proximas ?? 0,
            total: (r.vencidas ?? 0) + (r.hoje ?? 0) + (r.proximas ?? 0),
        };
    })

    .get("/por-representante", async () => {
        const rows = await prisma.$queryRawUnsafe(`
            SELECT
                u.idUsuario AS idRepresentante,
                u.Nome AS representanteNome,
                MAX(a.dataCadastro) AS ultimaAtividade,
                MIN(CASE WHEN CAST(a.dataProximoContato AS DATE) >= CAST(GETDATE() AS DATE)
                         THEN a.dataProximoContato END) AS proximoFollowup,
                SUM(CASE WHEN a.dataProximoContato IS NOT NULL
                          AND CAST(a.dataProximoContato AS DATE) <= DATEADD(DAY, 7, CAST(GETDATE() AS DATE))
                         THEN 1 ELSE 0 END) AS pendentes
            FROM CRM_Usuario u WITH (NOLOCK)
            INNER JOIN CRM_AtividadeRelatorio a WITH (NOLOCK) ON a.idRepresentante = u.idUsuario
            WHERE u.flaAtivo = 1
            GROUP BY u.idUsuario, u.Nome
            ORDER BY u.Nome
        `);
        return conv(rows);
    });
