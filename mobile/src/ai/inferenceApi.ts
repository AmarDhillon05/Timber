// Single client for the /inference FastAPI service. EVERY backend route is
// reached through here, so they share one base URL, one timeout, and one error
// model. When the service is down, slow, or a route returns an error, callers
// get a typed `InferenceError` they can branch on — never a raw network throw.
//
// Routes mirrored from inference/api.py:
//   GET  /health   -> liveness + available models   (getHealth)
//   GET  /terms    -> canonical blanket-term list    (getTerms)
//   POST /suggest  -> multipart upload, suggestions  (postSuggest)

const BASE_URL = process.env.EXPO_PUBLIC_INFERENCE_URL ?? 'http://localhost:8000';

/** Default model for /suggest; callers may override per request. */
export const INFERENCE_MODEL = process.env.EXPO_PUBLIC_INFERENCE_MODEL ?? 'clap';

/** Why a backend call failed — lets callers tailor the message/UX. */
export type InferenceErrorKind =
  | 'unreachable' // service down / DNS / CORS — fetch itself threw
  | 'timeout' // we aborted after waiting too long
  | 'http' // service answered with a non-2xx status
  | 'malformed'; // 2xx but the body wasn't the JSON we expected

export class InferenceError extends Error {
  readonly kind: InferenceErrorKind;
  /** HTTP status, present only for `kind === 'http'`. */
  readonly status?: number;

  constructor(kind: InferenceErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'InferenceError';
    this.kind = kind;
    this.status = status;
  }
}

interface RequestOpts {
  /** Abort and throw `timeout` after this many ms. */
  timeoutMs?: number;
}

// Core fetch wrapper: applies the timeout and normalizes every failure mode
// into an InferenceError. Returns the raw Response on success (2xx).
async function request(
  path: string,
  init: RequestInit,
  { timeoutMs = 15000 }: RequestOpts = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, { ...init, signal: controller.signal });
  } catch (e) {
    // fetch rejects on network failure (service down, DNS, CORS) or on abort.
    if (controller.signal.aborted) {
      throw new InferenceError('timeout', `Request to ${path} timed out after ${timeoutMs}ms.`);
    }
    throw new InferenceError(
      'unreachable',
      `Inference service unreachable at ${BASE_URL} (${(e as Error).message}).`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new InferenceError('http', `Inference API ${res.status}: ${body || res.statusText}`, res.status);
  }
  return res;
}

// Same as request() but parses a JSON body, mapping a bad body to `malformed`.
async function requestJson<T>(path: string, init: RequestInit, opts?: RequestOpts): Promise<T> {
  const res = await request(path, init, opts);
  try {
    return (await res.json()) as T;
  } catch {
    throw new InferenceError('malformed', `Inference API returned a non-JSON body from ${path}.`);
  }
}

// --- Routes ---------------------------------------------------------------

export interface HealthInfo {
  status: string;
  models: string[];
  default_model: string;
  device: string;
}

/** Liveness probe — short timeout, since "is it up?" shouldn't hang the app. */
export function getHealth(opts?: RequestOpts): Promise<HealthInfo> {
  return requestJson<HealthInfo>('/health', { method: 'GET' }, { timeoutMs: 4000, ...opts });
}

export interface TermsInfo {
  terms: string[];
}

export function getTerms(opts?: RequestOpts): Promise<TermsInfo> {
  return requestJson<TermsInfo>('/terms', { method: 'GET' }, opts);
}

export interface SuggestResponse {
  model: string;
  suggestions: { term: string; amount: number }[];
}

/** Inference can be slow (model load + decode), so allow a long timeout. */
export function postSuggest(
  form: FormData,
  model: string = INFERENCE_MODEL,
  opts?: RequestOpts,
): Promise<SuggestResponse> {
  return requestJson<SuggestResponse>(
    `/suggest?model=${encodeURIComponent(model)}`,
    { method: 'POST', body: form },
    { timeoutMs: 60000, ...opts },
  );
}
