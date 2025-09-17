import type { Plugin } from 'vite';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Agent } from 'undici';

// Aceita certificados self-signed (apenas DEV!)
const httpsAgent = new Agent({ connect: { rejectUnauthorized: false } });

function readBody(req: IncomingMessage): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : null));
  });
}

export default function universalProxy(): Plugin {
  return {
    name: 'universal-proxy',
    configureServer(server) {
      server.middlewares.use('/proxy', async (req: IncomingMessage, res: ServerResponse) => {
        try {
          const url = new URL(req.url || '', 'http://localhost');
          const target = url.searchParams.get('target'); // ex.: https://10.2.1.69/api
          const path = url.searchParams.get('path') || ''; // ex.: /v3/login
          if (!target) {
            res.statusCode = 400;
            res.end('Missing target param');
            return;
          }

          const base = target.replace(/\/+$/, '');
          const pathname = path.startsWith('/') ? path : `/${path}`;

          // Copia qs extras (sem target/path)
          const forwardQS = new URLSearchParams(url.searchParams);
          forwardQS.delete('target');
          forwardQS.delete('path');
          const qsStr = forwardQS.toString();
          const finalUrl = `${base}${pathname}${qsStr ? `?${qsStr}` : ''}`;

          const method = (req.method || 'GET').toUpperCase();
          const body = (method === 'GET' || method === 'HEAD') ? undefined : await readBody(req);

          // Repassa headers "seguros"
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(req.headers)) {
            if (typeof v === 'string') headers[k] = v;
          }
          delete headers['host'];
          delete headers['origin'];
          delete headers['referer'];
          delete headers['content-length'];
          delete headers['accept-encoding'];

          const resp = await fetch(finalUrl, {
            method,
            headers,
            body,
            // 👇 permite self-signed em DEV
            dispatcher: httpsAgent,
          });

          res.statusCode = resp.status;
          resp.headers.forEach((v, k) => {
            if (['content-security-policy', 'transfer-encoding'].includes(k)) return;
            res.setHeader(k, v);
          });

          const buf = Buffer.from(await resp.arrayBuffer());
          res.end(buf);
        } catch (e: any) {
          res.statusCode = 502;
          res.end(`Proxy error: ${e?.message || 'unknown error'}`);
        }
      });
    },
  };
}
