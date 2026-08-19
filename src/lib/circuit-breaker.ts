/**
 * Circuit breaker genérico por chave (ex: um por tipo de job).
 * CLOSED: opera normalmente. Após `failureThreshold` falhas seguidas -> OPEN.
 * OPEN: rejeita chamadas imediatamente até `resetTimeoutMs` passar -> HALF_OPEN.
 * HALF_OPEN: permite uma tentativa; sucesso fecha o circuito, falha reabre (com backoff).
 */

type State = "CLOSED" | "OPEN" | "HALF_OPEN";

export class CircuitOpenError extends Error {
    constructor(key: string, retryAt: Date) {
        super(`Circuito aberto para "${key}". Próxima tentativa permitida às ${retryAt.toISOString()}.`);
        this.name = "CircuitOpenError";
    }
}

interface BreakerConfig {
    failureThreshold: number;
    resetTimeoutMs: number;
}

interface BreakerRecord {
    state: State;
    consecutiveFailures: number;
    openedAt: number | null;
}

const records = new Map<string, BreakerRecord>();

function getRecord(key: string): BreakerRecord {
    let r = records.get(key);
    if (!r) {
        r = { state: "CLOSED", consecutiveFailures: 0, openedAt: null };
        records.set(key, r);
    }
    return r;
}

export function getCircuitState(key: string): State {
    return getRecord(key).state;
}

/**
 * Executa `fn` protegida pelo circuit breaker `key`.
 * Lança CircuitOpenError sem chamar `fn` se o circuito estiver aberto.
 */
export async function withCircuitBreaker<T>(
    key: string,
    config: BreakerConfig,
    fn: () => Promise<T>
): Promise<T> {
    const record = getRecord(key);

    if (record.state === "OPEN") {
        const elapsed = Date.now() - (record.openedAt ?? 0);
        if (elapsed < config.resetTimeoutMs) {
            const retryAt = new Date((record.openedAt ?? 0) + config.resetTimeoutMs);
            throw new CircuitOpenError(key, retryAt);
        }
        record.state = "HALF_OPEN";
    }

    try {
        const result = await fn();
        record.state = "CLOSED";
        record.consecutiveFailures = 0;
        record.openedAt = null;
        return result;
    } catch (err) {
        record.consecutiveFailures += 1;
        if (record.state === "HALF_OPEN" || record.consecutiveFailures >= config.failureThreshold) {
            record.state = "OPEN";
            record.openedAt = Date.now();
        }
        throw err;
    }
}
