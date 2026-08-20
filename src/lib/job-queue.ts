import { prisma } from "./prisma";
import { withCircuitBreaker, CircuitOpenError } from "./circuit-breaker";

export type ReportProgress = (etapa: string, atual: number, total: number) => Promise<void>;
export type JobHandler = (idReferencia: number | null, payload: any, reportProgress: ReportProgress) => Promise<any>;

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

// App roda em ambiente serverless (Railway): nada de setInterval/poll contínuo, que
// mantém o processo artificialmente vivo. O worker só é acionado em dois momentos:
//   1. Logo após enfileirar um job novo (enqueueJob dispara o drain, sem bloquear a resposta HTTP).
//   2. Na subida do processo (recoverPendingJobs), pra retomar jobs que ficaram
//      pendentes/órfãos de uma instância anterior que reiniciou/crashou.
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

    // Dispara o processamento sem aguardar (fire-and-forget) — quem chamou enqueueJob
    // já tem o jobId pra fazer polling de status, não precisa esperar o job rodar aqui.
    void drainQueue();

    return job.id;
}

// Se o processo do worker morrer no meio de um job (crash, deploy, restart), o job fica
// preso em PROCESSANDO para sempre. Qualquer job "PROCESSANDO" há mais que este limite
// é considerado órfão e devolvido para a fila (conta como tentativa, respeitando maxTentativas).
const JOB_STALE_TIMEOUT_MS = 10 * 60 * 1000;

async function reclaimStaleJobs() {
    const limite = new Date(Date.now() - JOB_STALE_TIMEOUT_MS).toISOString();
    await prisma.$executeRawUnsafe(`
        UPDATE tbJob
        SET status = CASE WHEN tentativas + 1 >= maxTentativas THEN 'ERRO' ELSE 'PENDENTE' END,
            tentativas = tentativas + 1,
            erro = 'Job órfão: worker não concluiu dentro do tempo limite (possível crash/restart).',
            dtaFim = CASE WHEN tentativas + 1 >= maxTentativas THEN SYSUTCDATETIME() ELSE NULL END
        WHERE status = 'PROCESSANDO' AND dtaInicio <= '${limite}'
    `);
}

async function claimNextJob() {
    // SQL Server não tem "SKIP LOCKED" simples via Prisma; como o worker roda em
    // processo único (drain sequencial), um UPDATE...OUTPUT com filtro por status
    // já evita corrida entre dois drains concorrentes.
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

    console.log(`[job-queue] job #${job.id} (${job.tipo}, idReferencia=${job.idReferencia}) iniciado`);

    const reportProgress: ReportProgress = async (etapa, atual, total) => {
        await prisma.tbJob.update({
            where: { id: job.id },
            data: { progresso: JSON.stringify({ etapa, atual, total }) },
        }).catch((e) => console.error(`[job-queue] falha ao gravar progresso do job #${job.id}:`, e));
    };

    try {
        const resultado = await withCircuitBreaker(
            job.tipo,
            {
                failureThreshold: config.circuitFailureThreshold,
                resetTimeoutMs: config.circuitResetTimeoutMs,
            },
            () => config.handler(job.idReferencia, payload, reportProgress)
        );

        console.log(`[job-queue] job #${job.id} (${job.tipo}) concluído:`, resultado);

        await prisma.tbJob.update({
            where: { id: job.id },
            data: {
                status: "CONCLUIDO",
                resultado: resultado !== undefined ? JSON.stringify(resultado) : null,
                progresso: null,
                dtaFim: new Date(),
            },
        });
    } catch (err: any) {
        const tentativas = job.tentativas + 1;

        console.error(
            `[job-queue] job #${job.id} (${job.tipo}, idReferencia=${job.idReferencia}) falhou na tentativa ${tentativas}/${job.maxTentativas}:`,
            err
        );

        if (err instanceof CircuitOpenError) {
            // Circuito aberto: não conta como tentativa "gasta", só reagenda mais à frente.
            // Como não há mais poll contínuo, esse reagendamento só é retomado no próximo
            // enqueueJob (de qualquer tipo) ou no próximo restart do processo.
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

let draining = false;

async function drainQueue() {
    if (draining) return;
    draining = true;
    try {
        let job = await claimNextJob();
        while (job) {
            await processJob(job);
            job = await claimNextJob();
        }
    } catch (err) {
        console.error("Erro ao processar fila de jobs:", err);
    } finally {
        draining = false;
    }
}

// Chamado uma vez na subida do processo: recupera jobs órfãos de uma instância anterior
// (crash/restart/deploy) e retoma qualquer job pendente. Não agenda nada recorrente.
export async function recoverPendingJobs() {
    try {
        await reclaimStaleJobs();
    } catch (err) {
        console.error("Erro ao recuperar jobs órfãos:", err);
    }
    void drainQueue();
}
