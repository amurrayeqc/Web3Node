#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');
const minimist = require('minimist');
const { CIDNest } = require('./cidnest');
const { createServer } = require('./server');

function usage() {
    console.log(`CIDNest — content-addressed peer storage

Usage:
  cidnest put <file> [--data <dir>] [--peer <url>]
  cidnest get <cid> [--output <file>] [--data <dir>] [--peer <url>]
  cidnest list [--data <dir>]
  cidnest delete <cid> [--data <dir>]
  cidnest status [--data <dir>]
  cidnest serve [--host 127.0.0.1] [--port 8787] [--data <dir>] [--peer <url>]
`);
}

async function main(argv = process.argv.slice(2)) {
    const args = minimist(argv, {
        string: ['data', 'peer', 'output', 'host', 'port'],
        boolean: ['verbose', 'help'],
        alias: { h: 'help', v: 'verbose', o: 'output' },
        default: { host: '127.0.0.1', port: '8787' }
    });
    if (args.help || !args._[0]) { usage(); return args.help ? 0 : 1; }

    const peers = args.peer ? (Array.isArray(args.peer) ? args.peer : [args.peer]) : [];
    const node = await new CIDNest({ dataDir: args.data, peers, verbose: args.verbose }).init();
    const [command, target] = args._;

    if (command === 'put') {
        if (!target) throw new Error('put requires a file path');
        const data = target === '-' ? await readStdin() : await fs.readFile(target);
        console.log(JSON.stringify(await node.put(data, { name: target === '-' ? null : path.basename(target) }), null, 2));
        return 0;
    }
    if (command === 'get') {
        if (!target) throw new Error('get requires a CID');
        const object = await node.get(target);
        if (args.output) await fs.writeFile(args.output, object.data);
        else process.stdout.write(object.data);
        return 0;
    }
    if (command === 'list') { console.log(JSON.stringify(await node.list(), null, 2)); return 0; }
    if (command === 'status') { console.log(JSON.stringify(await node.status(), null, 2)); return 0; }
    if (command === 'delete') {
        if (!target) throw new Error('delete requires a CID');
        console.log(JSON.stringify({ cid: target, deleted: await node.remove(target) }));
        return 0;
    }
    if (command === 'serve') {
        const port = Number(args.port);
        if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('port must be between 0 and 65535');
        const server = createServer(node);
        await new Promise((resolve, reject) => server.once('error', reject).listen(port, args.host, resolve));
        console.log(`CIDNest listening on http://${args.host}:${server.address().port}`);
        return new Promise(() => {});
    }
    throw new Error(`Unknown command: ${command}`);
}

async function readStdin() {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks);
}

if (require.main === module) {
    main().then(code => { process.exitCode = code; }).catch(error => {
        console.error(`CIDNest: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = { main };
