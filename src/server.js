const http = require('node:http');

function sendJson(response, status, value) {
    const body = Buffer.from(JSON.stringify(value));
    response.writeHead(status, { 'content-type': 'application/json', 'content-length': body.length });
    response.end(body);
}

async function readBody(request, limit) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > limit) throw new Error(`Request exceeds ${limit} byte limit`);
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

function createServer(node, options = {}) {
    const maxObjectSize = options.maxObjectSize ?? 10 * 1024 * 1024;
    return http.createServer(async (request, response) => {
        try {
            const url = new URL(request.url, 'http://localhost');
            if (request.method === 'GET' && url.pathname === '/health') {
                return sendJson(response, 200, { status: 'healthy', ...(await node.status()) });
            }
            if (request.method === 'GET' && url.pathname === '/v1/objects') {
                return sendJson(response, 200, { objects: await node.list() });
            }

            const match = url.pathname.match(/^\/v1\/objects\/(.+)$/);
            if (match) {
                const cid = decodeURIComponent(match[1]);
                if (request.method === 'GET') {
                    const object = await node.get(cid);
                    response.writeHead(200, {
                        'content-type': object.metadata.contentType,
                        'content-length': object.data.length,
                        'x-web3node-cid': cid,
                        'x-web3node-name': object.metadata.name || ''
                    });
                    return response.end(object.data);
                }
                if (request.method === 'PUT') {
                    const data = await readBody(request, maxObjectSize);
                    const stored = await node.put(data, {
                        expectedCid: cid,
                        contentType: request.headers['content-type'],
                        name: request.headers['x-web3node-name'],
                        replicate: false
                    });
                    return sendJson(response, 201, stored);
                }
                if (request.method === 'DELETE') {
                    return sendJson(response, (await node.remove(cid)) ? 200 : 404, { cid });
                }
            }

            if (request.method === 'POST' && url.pathname === '/v1/objects') {
                const data = await readBody(request, maxObjectSize);
                const stored = await node.put(data, {
                    contentType: request.headers['content-type'],
                    name: request.headers['x-web3node-name']
                });
                return sendJson(response, 201, stored);
            }
            sendJson(response, 404, { error: 'Route not found' });
        } catch (error) {
            const status = /not found/i.test(error.message) ? 404 : 400;
            sendJson(response, status, { error: error.message });
        }
    });
}

module.exports = { createServer };
