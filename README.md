# CIDNest

[![CI](https://github.com/centxyz/CIDNest/actions/workflows/ci.yml/badge.svg)](https://github.com/centxyz/CIDNest/actions/workflows/ci.yml)

CIDNest is a lightweight content-addressed storage service. It stores objects by their SHA-256 content identifier (CID), verifies integrity on every read, exposes an HTTP API, and can replicate objects to other CIDNest instances or recover missing objects from them.

This is real peer-to-peer storage at the application layer. It does not use a blockchain, token, or global consensus protocol.

## Features

- Persistent file-backed object storage
- SHA-256 content addressing and read-time integrity verification
- Automatic deduplication
- HTTP upload, download, listing, deletion, and health endpoints
- Best-effort replication to configured peers
- Peer fallback and local caching when an object is missing
- CLI for local use and running a network node
- Upload-size limits and atomic object/index writes

## Requirements

- Node.js 18 or newer

## Install

```bash
git clone https://github.com/centxyz/CIDNest.git
cd CIDNest
npm install
npm test
```

## CLI

```bash
# Store a file
npm start -- put ./photo.png --data ./node-data

# List objects
npm start -- list --data ./node-data

# Retrieve an object
npm start -- get sha256:CID --output ./restored.png --data ./node-data

# Delete an object
npm start -- delete sha256:CID --data ./node-data

# Run an HTTP node
npm start -- serve --host 127.0.0.1 --port 8787 --data ./node-data
```

Add one or more peers with repeated `--peer` flags:

```bash
npm start -- serve --port 8788 --data ./second-node \
  --peer http://127.0.0.1:8787
```

New uploads are replicated to configured peers. A missing local object is requested from peers, verified against its CID, and cached locally.

## HTTP API

- `GET /health`
- `GET /v1/objects`
- `POST /v1/objects` with raw request bytes
- `GET /v1/objects/:cid`
- `PUT /v1/objects/:cid` with raw bytes whose hash must match `:cid`
- `DELETE /v1/objects/:cid`

Uploads default to a 10 MiB limit. Send `Content-Type` and optional `X-CIDNest-Name` headers to preserve metadata.

## Test

```bash
npm test
```

The suite verifies persistence, integrity enforcement, deduplication, deletion, HTTP peer replication, and peer recovery.

## License

MIT

## Current limitations

- Replication is best-effort between explicitly configured peers; there is no global discovery or consensus layer.
- SHA-256 identifiers verify content integrity but do not provide confidentiality or access control.
- Operators remain responsible for authentication, transport security, backups, and storage capacity.
