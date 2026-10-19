import type {IncomingMessage} from 'node:http';
import {AnalysisError} from '../shared/mockAnalysis';

// A service-wide bound, independent of identities, cookies and proxy headers.
export const bodyPolicy = {readers: 32, reservedBytes: 40 * 1024 * 1024, timeoutMs: 10_000} as const;
export class JsonBodyReader {
    private readers = 0;
    private reservedBytes = 0;
    constructor(private policy: {readers: number; reservedBytes: number; timeoutMs: number} = bodyPolicy) {}
    async read(request: IncomingMessage, bodyLimit = 64 * 1024, signal?: AbortSignal): Promise<unknown> {
        if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json')
            throw new AnalysisError('UNSUPPORTED_MEDIA_TYPE', '請使用 JSON（文字資料格式）送出資料。', 415);
        const declared = request.headers['content-length'];
        const length = declared === undefined ? null : Number(declared);
        if (length !== null && (!Number.isSafeInteger(length) || length < 0 || length > bodyLimit))
            throw new AnalysisError('BODY_TOO_LARGE', '請求內容超過此介面的大小限制。', 413);
        const reservation = length ?? bodyLimit;
        if (this.readers >= this.policy.readers || this.reservedBytes + reservation > this.policy.reservedBytes)
            throw new AnalysisError('BODY_BUSY', '正在接收的資料過多，請稍後重試。', 429);
        if (signal?.aborted || request.aborted)
            throw new AnalysisError('REQUEST_ABORTED', '請求已中止，未套用操作。', 400);
        this.readers++;
        this.reservedBytes += reservation;
        try {
            return await new Promise<unknown>((resolve, reject) => {
                const chunks: Buffer[] = [];
                let size = 0, settled = false;
                const cleanup = () => {
                    clearTimeout(timer);
                    request.off('data', data); request.off('end', end);
                    request.off('error', error); request.off('aborted', aborted);
                    signal?.removeEventListener('abort', aborted);
                };
                const fail = (value: Error) => {
                    if (settled) return;
                    settled = true; cleanup(); chunks.length = 0;
                    request.pause(); reject(value);
                };
                const aborted = () => fail(new AnalysisError('REQUEST_ABORTED', '請求已中止，未套用操作。', 400));
                const error = () => aborted();
                const data = (chunk: Buffer) => {
                    size += chunk.length;
                    if (size > bodyLimit || length !== null && size > length) {
                        fail(new AnalysisError('BODY_TOO_LARGE', '請求內容超過此介面的大小限制。', 413)); return;
                    }
                    chunks.push(chunk);
                };
                const end = () => {
                    if (settled) return;
                    settled = true; cleanup();
                    try {
                        resolve(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks))));
                    } catch {
                        reject(new AnalysisError('INVALID_JSON', '請求不是有效的 UTF-8 JSON（中文文字編碼的資料格式）。', 400));
                    } finally { chunks.length = 0; }
                };
                const timer = setTimeout(() => fail(new AnalysisError('BODY_TIMEOUT', '接收資料逾時，未套用操作；請重新送出。', 408)), this.policy.timeoutMs);
                timer.unref();
                request.on('data', data); request.once('end', end);
                request.once('error', error); request.once('aborted', aborted);
                signal?.addEventListener('abort', aborted, {once: true});
            });
        } finally {
            this.readers--; this.reservedBytes -= reservation;
        }
    }
}
