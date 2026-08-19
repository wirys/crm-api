import { prisma } from "./prisma";
import { withCircuitBreaker, CircuitOpenError } from "./circuit-breaker";

export type JobHandler = (idReferencia: number | null, payload: any) => Promise<any>;

interface JobTypeConfig {
    handler: JobHandler;
    maxTentativas: number;
    circuitFailureThreshold: number;
    circuitResetTimeoutMs: number;
    /** backoff exponencial entre tentativas (ms), aplicado a partir da 1a falha */
    retryBackoffMs: (tentativa: number) => number;
}

const registry = new Map<string, JobTypeConfig>();

export function registerJobType(tipo: string, config: JobTypeConfig) {
    registry.set(tipo, config);
}

export async function enqueueJob(tipo: string, idReferencia: number | null, payload?: any) {
    if (!registry.has(tipo)) {
        throw new Error(`Tipo de job desconhecido: ${tipo}`);
    }
    const config = registry.get(tipo)!;
    const job = await prisma.tbJob.create({
        data: {
            tipo,
            idReferencia,
            status: "PENDENTE",
            maxTentativas: config.maxTentativas,
            payload: payload !== undefined ? JSON.stringify(payload) : null,
        },
    });
    return job.id;
}

// Se o processo do worker morrer no meio de um job (crash, deploy, OOM), o job fica
// preso em PROCESSANDO para sempre. Qualquer job "PROCESSANDO" há mais que este limite
// é considerado órfão e devolvido para a fila (conta como tentativa, respeitando maxTentativas).
const JOB_STALE_TIMEOUT_MS = 10 * 60 * 1000;

async function reclaimStaleJobs() {
    const limite = new Date(Date.now() - JOB_STALE_TIMEOUT_MS).toISOString();
    await prisma.$executeRawUnsafe(`
        UPDATE tbJob
        SET status = CASE WHEN tentativas + 1 >= maxTentativas THEN 'ERRO' ELSE 'PENDENTE' END,
            tentativas = tentativas + 1,
            erro = 'Job órfão: worker não concluiu dentro do tempo limite (possível crash).',
            dtaFim = CASE WHEN tentativas + 1 >= maxTentativas THEN SYSUTCDATETIME() ELSE NULL END
        WHERE status = 'PROCESSANDO' AND dtaInicio <= '${limite}'
    `);
}

async function claimNextJob() {
    // SQL Server não tem "SKIP LOCKED" simples via Prisma; como o worker roda em
    // processo único (poll sequencial), um UPDATE...OUTPUT com filtro por status
    // já evita corrida entre duas execuções concorrentes do mesmo worker.
    await reclaimStaleJobs();
    const now = new Date();
    const rows: any = await prisma.$queryRawUnsafe(`
        UPDATE TOP (1) tbJob
        SET status = 'PROCESSANDO', dtaInicio = SYSUTCDATETIME()
        OUTPUT INSERTED.id, INSERTED.tipo, INSERTED.idReferencia, INSERTED.payload, INSERTED.tentativas, INSERTED.maxTentativas
        WHERE status = 'PENDENTE'
          AND (dtaProximaTentativa IS NULL OR dtaProximaTentativa <= '${now.toISOString()}')
    `);
    return rows?.[0] ?? null;
}

async function processJob(job: any) {
    const config = registry.get(job.tipo);
    if (!config) {
        await prisma.tbJob.update({
            where: { id: job.id },
            data: { status: "ERRO", erro: `Tipo de job desconhecido: ${job.tipo}`, dtaFim: new Date() },
        });
        return;
    }

    const payload = job.payload ? JSON.parse(job.payload) : undefined;

    try {
        const resultado = await withCircuitBreaker(
            job.tipo,
            {
                failureThreshold: config.circuitFailureThreshold,
                resetTimeoutMs: config.circuitResetTimeoutMs,
            },
            () => config.handler(job.idReferencia, payload)
        );

        await prisma.tbJob.update({
            where: { id: job.id },
            data: {
                status: "CONCLUIDO",
                resultado: resultado !== undefined ? JSON.stringify(resultado) : null,
                dtaFim: new Date(),
            },
        });
    } catch (err: any) {
        const tentativas = job.tentativas + 1;

        if (err instanceof CircuitOpenError) {
            // Circuito aberto: não conta como tentativa "gasta", só reagenda mais à frente.
            await prisma.tbJob.update({
                where: { id: job.id },
                data: {
                    status: "PENDENTE",
                    erro: err.message,
                    dtaProximaTentativa: new Date(Date.now() + config.circuitResetTimeoutMs),
                },
            });
            return;
        }

        const esgotouTentativas = tentativas >= job.maxTentativas;
        await prisma.tbJob.update({
            where: { id: job.id },
            data: {
                tentativas,
                status: esgotouTentativas ? "ERRO" : "PENDENTE",
                erro: err.message ?? String(err),
                dtaFim: esgotouTentativas ? new Date() : null,
                dtaProximaTentativa: esgotouTentativas
                    ? null
                    : new Date(Date.now() + config.retryBackoffMs(tentativas)),
            },
        });
    }
}

let workerTimer: ReturnType<typeof setInterval> | null = null;
let processing = false;

export function startJobWorker(pollIntervalMs = 3000) {
    if (workerTimer) return;
    workerTimer = setInterval(async () => {
        if (processing) return;
        processing = true;
        try {
            let job = await claimNextJob();
            while (job) {
                await processJob(job);
                job = await claimNextJob();
            }
        } catch (err) {
            console.error("Erro no worker de jobs:", err);
        } finally {
            processing = false;
        }
    }, pollIntervalMs);
}

export function stopJobWorker() {
    if (workerTimer) {
        clearInterval(workerTimer);
        workerTimer = null;
    }
}
