const USER_AGENT = 'japan-2027-trip-planner-cli/0.1 (personal, non-commercial trip planning)';

export class HttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(url: string, status: number, body: string) {
    super(`HTTP ${status} from ${new URL(url).host}: ${body.slice(0, 300)}`);
    this.status = status;
    this.body = body;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Spaces calls at least `intervalMs` apart, however many are waiting.
 *
 * One per service, so the CLI stays inside each provider's published rate however its own loops
 * happen to be shaped.
 */
export const createThrottle = (intervalMs: number) => {
  let next = 0;
  return async (): Promise<void> => {
    const now = Date.now();
    const wait = Math.max(0, next - now);
    next = Math.max(now, next) + intervalMs;
    if (wait > 0) await sleep(wait);
  };
};

interface RequestOptions {
  init?: RequestInit;
  throttle?: () => Promise<void>;
  /** Retries on 429, 5xx and network failures, backing off each time. */
  retries?: number;
  /** Statuses returned to the caller as a response instead of thrown, e.g. a tile's 404. */
  acceptStatuses?: number[];
}

export const request = async (url: string, options: RequestOptions = {}): Promise<Response> => {
  const { init, throttle, retries = 4, acceptStatuses = [] } = options;
  for (let attempt = 0; ; attempt++) {
    await throttle?.();
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: { 'User-Agent': USER_AGENT, ...init?.headers },
      });
    } catch (error) {
      if (attempt >= retries) throw error;
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (response.ok || acceptStatuses.includes(response.status)) return response;
    const body = await response.text();
    // A per-minute limit clears by waiting; a daily or monthly one does not, so it fails at once.
    const retryable =
      (response.status === 429 && !/daily|hourly|monthly/i.test(body)) || response.status >= 500;
    if (!retryable || attempt >= retries) throw new HttpError(url, response.status, body);
    await sleep(response.status === 429 ? 30000 * (attempt + 1) : 1000 * 2 ** attempt);
  }
};

export const requestJson = async <T>(url: string, options: RequestOptions = {}): Promise<T> =>
  (await request(url, options)).json() as Promise<T>;

/** Runs `worker` over `items` with at most `concurrency` in flight. */
export const mapConcurrent = async <T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const run = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
};
