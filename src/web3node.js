const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

class Web3Node {
    constructor(config = {}) {
        this.dataDir = path.resolve(config.dataDir || '.web3node');
        this.objectsDir = path.join(this.dataDir, 'objects');
        this.indexPath = path.join(this.dataDir, 'index.json');
        this.peers = [...new Set(config.peers || [])].map(peer => peer.replace(/\/$/, ''));
        this.timeout = config.timeout ?? 10000;
        this.fetch = config.fetch || global.fetch;
        this.verbose = config.verbose || false;
        this.index = {};
        this.ready = false;
    }

    async init() {
        await fs.mkdir(this.objectsDir, { recursive: true });
        try {
            this.index = JSON.parse(await fs.readFile(this.indexPath, 'utf8'));
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            this.index = {};
            await this.saveIndex();
        }
        this.ready = true;
        return this;
    }

    async put(input, options = {}) {
        await this.ensureReady();
        const data = Buffer.isBuffer(input) ? input : Buffer.from(input);
        const cid = Web3Node.cidFor(data);
        const objectPath = this.pathFor(cid);

        if (options.expectedCid && options.expectedCid !== cid) {
            throw new Error(`Content integrity mismatch: expected ${options.expectedCid}, received ${cid}`);
        }

        try {
            await fs.access(objectPath);
        } catch {
            const temporaryPath = `${objectPath}.${process.pid}.tmp`;
            await fs.writeFile(temporaryPath, data);
            await fs.rename(temporaryPath, objectPath);
        }

        this.index[cid] = {
            cid,
            size: data.length,
            name: options.name || this.index[cid]?.name || null,
            contentType: options.contentType || this.index[cid]?.contentType || 'application/octet-stream',
            createdAt: this.index[cid]?.createdAt || new Date().toISOString()
        };
        await this.saveIndex();

        const replication = options.replicate === false
            ? { attempted: 0, succeeded: 0, failed: [] }
            : await this.replicate(cid, data);
        return { ...this.index[cid], replication };
    }

    async get(cid, options = {}) {
        await this.ensureReady();
        try {
            const data = await fs.readFile(this.pathFor(cid));
            this.assertIntegrity(cid, data);
            return { metadata: this.index[cid] || this.metadataFor(cid, data), data, source: 'local' };
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }

        if (options.fetchPeers === false) throw new Error(`Object not found: ${cid}`);
        return this.fetchFromPeers(cid);
    }

    async list() {
        await this.ensureReady();
        return Object.values(this.index).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }

    async remove(cid) {
        await this.ensureReady();
        try {
            await fs.unlink(this.pathFor(cid));
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        const existed = Boolean(this.index[cid]);
        delete this.index[cid];
        await this.saveIndex();
        return existed;
    }

    async status() {
        const objects = await this.list();
        return {
            dataDir: this.dataDir,
            objectCount: objects.length,
            storedBytes: objects.reduce((total, object) => total + object.size, 0),
            peers: this.peers
        };
    }

    async replicate(cid, data) {
        if (!this.peers.length) return { attempted: 0, succeeded: 0, failed: [] };
        const results = await Promise.all(this.peers.map(async peer => {
            try {
                const response = await this.request(`${peer}/v1/objects/${encodeURIComponent(cid)}`, {
                    method: 'PUT',
                    headers: { 'content-type': this.index[cid].contentType, 'x-web3node-name': this.index[cid].name || '' },
                    body: data
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return { peer, success: true };
            } catch (error) {
                return { peer, success: false, error: error.message };
            }
        }));
        const failed = results.filter(result => !result.success);
        return { attempted: results.length, succeeded: results.length - failed.length, failed };
    }

    async fetchFromPeers(cid) {
        for (const peer of this.peers) {
            try {
                const response = await this.request(`${peer}/v1/objects/${encodeURIComponent(cid)}`);
                if (!response.ok) continue;
                const data = Buffer.from(await response.arrayBuffer());
                this.assertIntegrity(cid, data);
                const stored = await this.put(data, {
                    expectedCid: cid,
                    contentType: response.headers.get('content-type') || 'application/octet-stream',
                    name: response.headers.get('x-web3node-name') || null,
                    replicate: false
                });
                return { metadata: stored, data, source: peer };
            } catch (error) {
                this.log(`Peer ${peer} failed: ${error.message}`);
            }
        }
        throw new Error(`Object not found locally or on configured peers: ${cid}`);
    }

    static cidFor(data) {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
        return `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`;
    }

    async ensureReady() {
        if (!this.ready) await this.init();
    }

    pathFor(cid) {
        if (!/^sha256:[a-f0-9]{64}$/.test(cid)) throw new Error(`Invalid CID: ${cid}`);
        return path.join(this.objectsDir, cid.slice(7));
    }

    assertIntegrity(cid, data) {
        const actual = Web3Node.cidFor(data);
        if (actual !== cid) throw new Error(`Stored content failed integrity check: expected ${cid}, received ${actual}`);
    }

    metadataFor(cid, data) {
        return { cid, size: data.length, name: null, contentType: 'application/octet-stream', createdAt: null };
    }

    async saveIndex() {
        const temporaryPath = `${this.indexPath}.${process.pid}.tmp`;
        await fs.writeFile(temporaryPath, `${JSON.stringify(this.index, null, 2)}\n`);
        await fs.rename(temporaryPath, this.indexPath);
    }

    async request(url, options = {}) {
        if (typeof this.fetch !== 'function') throw new Error('A fetch implementation is required');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        try {
            return await this.fetch(url, { ...options, signal: controller.signal });
        } finally {
            clearTimeout(timeoutId);
        }
    }

    log(message) {
        if (this.verbose) console.error(`[Web3Node] ${message}`);
    }
}

module.exports = { Web3Node };
