import handler from './index.js';

export default {
    async fetch(request, env, ctx) {
        // 1. Mock 'res' object
        let statusCode = 200;
        let responseHeaders = new Headers({
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        });
        let responseBody = '';

        const res = {
            status: (s) => {
                statusCode = s;
                return res;
            },
            json: (data) => {
                responseBody = JSON.stringify(data);
                return res;
            },
            send: (data) => {
                responseBody = data;
                if (typeof data === 'string' && !responseHeaders.has('Content-Type')) {
                    responseHeaders.set('Content-Type', 'text/plain');
                }
                return res;
            }
        };

        // 2. Mock 'req' object
        const url = new URL(request.url);
        
        // Handle environment variables
        // We inject them into process.env so the existing index.js logic can find them
        if (typeof process === 'undefined') {
            globalThis.process = { env: {} };
        }
        Object.assign(process.env, env);

        let body = {};
        if (request.method === 'POST') {
            try {
                body = await request.json();
            } catch (e) {
                body = {};
            }
        }

        const req = {
            method: request.method,
            query: Object.fromEntries(url.searchParams),
            body: body,
            headers: Object.fromEntries(request.headers),
            url: request.url
        };

        try {
            // 3. Call the Vercel-style handler
            await handler(req, res);
            
            return new Response(responseBody, {
                status: statusCode,
                headers: responseHeaders
            });
        } catch (err) {
            return new Response(JSON.stringify({ error: err.message, stack: err.stack }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }
};
