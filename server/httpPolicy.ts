import { createReadStream, lstatSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AnalysisError } from '../shared/mockAnalysis';
export function requestOrigin(request: IncomingMessage, origin?: string) {
    const target=request.url||'/';
    if(!target.startsWith('/')||target.startsWith('//')||target.includes('\\')||target.includes('#'))
        throw new AnalysisError('INVALID_REQUEST_TARGET','請求路徑格式不適用。',400);
    const host = request.headers.host || '';
    if (origin) {
        const expected = new URL(origin);
        if (host.toLowerCase() !== expected.host.toLowerCase())
            throw new AnalysisError('ORIGIN_REJECTED', '網站來源不適用。', 403);
        if (request.headers.origin && request.headers.origin !== expected.origin)
            throw new AnalysisError('ORIGIN_REJECTED', '網站來源不適用。', 403);
    }
    else {
        if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host))
            throw new AnalysisError('LOCAL_ONLY', '此示範服務只接受本機連線。', 403);
        if (request.headers.origin) {
            let value: URL;
            try {
                value = new URL(request.headers.origin);
            }
            catch {
                throw new AnalysisError('LOCAL_ONLY', '來源不適用。', 403);
            }
            if (!['http:', 'https:'].includes(value.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(value.hostname))
                throw new AnalysisError('LOCAL_ONLY', '此示範服務不接受外部網站請求。', 403);
        }
    }
    if (request.headers['sec-fetch-site'] === 'cross-site')
        throw new AnalysisError('LOCAL_ONLY', '此服務不接受跨站請求。', 403);
    try { return new URL(target, origin || 'http://' + host); }
    catch { throw new AnalysisError('INVALID_REQUEST_TARGET','請求路徑格式不適用。',400); }
}
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
export function staticResponse(request: IncomingMessage, response: ServerResponse, root: string, url: URL) {
    if (!['GET', 'HEAD'].includes(request.method || '')) {
        response.writeHead(405, { Allow: 'GET, HEAD' });
        response.end();
        return;
    }
    let relative: string;
    try {
        relative = decodeURIComponent(url.pathname);
    }
    catch {
        response.writeHead(400);
        response.end();
        return;
    }
    if (relative === '/' || relative === '/index.html')
        relative = '/index.html';
    const parts = relative.slice(1).split('/');
    if (parts.some(p => !p || p.startsWith('.') || p.includes('\\') || p.includes(':') || p.includes('\0')) || !mime[path.extname(relative)]) {
        response.writeHead(404);
        response.end();
        return;
    }
    const file = path.resolve(root, '.' + relative), base = realpathSync(root);
    try {
        if (!realpathSync(file).startsWith(base + path.sep) || lstatSync(file).isSymbolicLink() || !statSync(file).isFile())
            throw Error();
        const details = statSync(file);
        response.writeHead(200, { 'Content-Type': mime[path.extname(file)], 'Content-Length': details.size, 'Cache-Control': relative === '/index.html' ? 'no-store' : relative.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
        if (request.method === 'HEAD')
            response.end();
        else {
            const stream = createReadStream(file);
            response.on('close', () => stream.destroy());
            stream.on('error', () => response.destroy());
            stream.pipe(response);
        }
    }
    catch {
        response.writeHead(404);
        response.end();
    }
}
