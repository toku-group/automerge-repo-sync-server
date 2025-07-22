# Automerge Repo Sync Server

A collaborative document sync server using Automerge CRDT with REST API for project management and WebSocket for real-time synchronization. It pairs with the
websocket client protocol found in
`@automerge/automerge-repo-network-websocket`.

The server is an [Express](https://expressjs.com/) app with CORS support and comprehensive API documentation.

## API Documentation

The server includes comprehensive OpenAPI 3.0 documentation with Swagger UI:

- **Swagger UI**: `http://localhost:3030/api-docs`
- **OpenAPI Spec**: `http://localhost:3030/api-docs.json`

### Available Endpoints

- `GET /api/projects` - List all projects
- `POST /api/projects` - Create a new project  
- `GET /api/project/:projectId` - Get specific project
- WebSocket `/` - Real-time document synchronization

## Running the sync server

`npx @automerge/automerge-repo-sync-server`

The server is configured with environment variables.

### Configuration Options

#### Basic Configuration
- `PORT` - the port to listen for websocket connections on (default: 3030)
- `NODE_ENV` - environment mode (development/production)

#### CORS Configuration
- `ALLOWED_ORIGINS` - comma-separated list of allowed origins for CORS

#### WebSocket Resource Management
- `MAX_CONNECTIONS` - maximum number of concurrent WebSocket connections (default: 100)
- `HEARTBEAT_INTERVAL` - WebSocket heartbeat interval in milliseconds (default: 30000)

### Storage Options

The server supports two storage backends:

#### 1. Filesystem Storage (Default)
- `PORT` - the port to listen for websocket connections on
- `DATA_DIR` - the directory to store saved documents in

#### 2. Cloudflare R2 Storage
To use Cloudflare R2 for storage, set the following environment variables:

- `USE_R2_STORAGE=true` - Enable R2 storage
- `R2_ACCOUNT_ID` - Your Cloudflare account ID
- `R2_ACCESS_KEY_ID` - R2 access key ID
- `R2_SECRET_ACCESS_KEY` - R2 secret access key
- `R2_BUCKET_NAME` - R2 bucket name
- `R2_PREFIX` - Optional prefix for all storage keys (default: "automerge-repo")

Example R2 configuration:
```bash
USE_R2_STORAGE=true
R2_ACCOUNT_ID=your-cloudflare-account-id
R2_ACCESS_KEY_ID=your-r2-access-key-id
R2_SECRET_ACCESS_KEY=your-r2-secret-access-key
R2_BUCKET_NAME=your-r2-bucket-name
R2_PREFIX=automerge-repo
```

### Setting up Cloudflare R2

1. Create a Cloudflare account and go to the R2 dashboard
2. Create a new R2 bucket
3. Generate R2 API tokens:
   - Go to "Manage R2 API tokens"
   - Create a new token with "Object Read & Write" permissions
   - Note down the Access Key ID and Secret Access Key
4. Set the environment variables as shown above

## Running in Docker

Run in docker using image hosted by GitHub container registry:

```bash
docker run -d --name syncserver -p 3030:3030 ghcr.io/automerge/automerge-repo-sync-server:main
```

cleanup after:

```bash
docker stop syncserver
docker rm syncserver
```

## Contributors

Originally written by @pvh.

## License

- Original code: MIT License © 2019-2023 Ink & Switch LLC (see LICENSE)
- Additional modifications: MIT License © 2025 TOKU GROUP (see NOTICE)
