const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { CIDNest } = require('../src/cidnest');
const { createServer } = require('../src/server');

describe('CIDNest', () => {
    let directories = [];

    async function temporaryDirectory() {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cidnest-'));
        directories.push(directory);
        return directory;
    }

    afterEach(async () => {
        await Promise.all(directories.map(directory => fs.rm(directory, { recursive: true, force: true })));
        directories = [];
    });

    test('stores, addresses, and retrieves content with integrity metadata', async () => {
        const node = await new CIDNest({ dataDir: await temporaryDirectory() }).init();
        const stored = await node.put(Buffer.from('decentralized data'), { name: 'example.txt' });
        const object = await node.get(stored.cid);

        expect(stored.cid).toMatch(/^sha256:[a-f0-9]{64}$/);
        expect(object.data.toString()).toBe('decentralized data');
        expect(object.metadata.name).toBe('example.txt');
        expect((await node.list())).toHaveLength(1);
    });

    test('deduplicates identical content', async () => {
        const node = await new CIDNest({ dataDir: await temporaryDirectory() }).init();
        const first = await node.put('same');
        const second = await node.put('same');
        expect(second.cid).toBe(first.cid);
        expect((await node.status()).objectCount).toBe(1);
    });

    test('rejects content that does not match an expected CID', async () => {
        const node = await new CIDNest({ dataDir: await temporaryDirectory() }).init();
        await expect(node.put('tampered', { expectedCid: CIDNest.cidFor('original') }))
            .rejects.toThrow('integrity mismatch');
    });

    test('removes stored content', async () => {
        const node = await new CIDNest({ dataDir: await temporaryDirectory() }).init();
        const stored = await node.put('temporary');
        expect(await node.remove(stored.cid)).toBe(true);
        await expect(node.get(stored.cid, { fetchPeers: false })).rejects.toThrow('not found');
    });

    test('replicates to and recovers from a peer node', async () => {
        const first = await new CIDNest({ dataDir: await temporaryDirectory() }).init();
        const second = await new CIDNest({ dataDir: await temporaryDirectory() }).init();
        const peerServer = createServer(second);
        await new Promise((resolve, reject) => peerServer.once('error', reject).listen(0, '127.0.0.1', resolve));
        const peerUrl = `http://127.0.0.1:${peerServer.address().port}`;

        try {
            first.peers = [peerUrl];
            const stored = await first.put('replicated object');
            expect(stored.replication.succeeded).toBe(1);
            await first.remove(stored.cid);
            const recovered = await first.get(stored.cid);
            expect(recovered.data.toString()).toBe('replicated object');
            expect(recovered.source).toBe(peerUrl);
        } finally {
            await new Promise(resolve => peerServer.close(resolve));
        }
    });
});
