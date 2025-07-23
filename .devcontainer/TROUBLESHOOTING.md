# PostgreSQL Devcontainer Troubleshooting Guide

If you're seeing "PostgreSQL not available" in the devcontainer, here are the steps to diagnose and fix the issue.

## Quick Fixes

### Option 1: Rebuild Container (Recommended)
1. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
2. Select "Dev Containers: Rebuild Container"
3. Wait for the rebuild to complete

### Option 2: Use Simple Configuration
If the Docker Compose setup continues to have issues:
1. Rename `.devcontainer/devcontainer.json` to `.devcontainer/devcontainer-compose.json`
2. Rename `.devcontainer/devcontainer-simple.json` to `.devcontainer/devcontainer.json`
3. Rebuild the container

## Debugging Steps

### 1. Check Container Status
Run the debug script:
```bash
bash .devcontainer/debug-postgres.sh
```

### 2. Manual PostgreSQL Check
```bash
# Check if PostgreSQL hostname resolves
nslookup postgres

# Check if port is open
nc -z postgres 5432

# Test PostgreSQL readiness
pg_isready -h postgres -p 5432 -U postgres

# Try direct connection
psql "postgresql://postgres:postgres@postgres:5432/automerge_sync"
```

### 3. Check Docker Compose Logs
If using the Docker Compose configuration:
```bash
# From outside the container, check logs
docker-compose -f .devcontainer/docker-compose.yml logs postgres
```

### 4. Manual Database Setup
If PostgreSQL is running but not set up:
```bash
# Wait for PostgreSQL to be ready
npm run setup:db:wait

# Or try immediate setup
npm run setup:db

# Check health
npm run health
```

## Common Issues and Solutions

### Issue: "Connection refused to postgres:5432"
**Cause**: PostgreSQL container not started or not healthy
**Solution**: 
1. Rebuild container with "Dev Containers: Rebuild Container"
2. Check Docker Compose configuration
3. Verify `depends_on` is working properly

### Issue: "Database initialization failed"
**Cause**: PostgreSQL not ready when setup script runs
**Solution**:
1. The setup script should handle this gracefully
2. Try manual setup: `npm run setup:db:wait`
3. Server will fall back to file-based storage

### Issue: "Cannot resolve hostname 'postgres'"
**Cause**: Not running in Docker Compose network
**Solution**:
1. Ensure using Docker Compose devcontainer configuration
2. Check `docker-compose.yml` network configuration
3. Try rebuilding container

### Issue: "pg_isready command not found"
**Cause**: PostgreSQL client tools not installed
**Solution**:
1. Check devcontainer features include `postgresql-client`
2. Rebuild container to install features

## Environment Verification

Check these environment variables are set correctly:
```bash
echo "DATABASE_URL: $DATABASE_URL"
echo "DB_HOST: $DB_HOST"
echo "DB_PORT: $DB_PORT"
echo "DB_NAME: $DB_NAME"
echo "DB_USER: $DB_USER"
```

Expected values:
- `DATABASE_URL`: `postgresql://postgres:postgres@postgres:5432/automerge_sync`
- `DB_HOST`: `postgres`
- `DB_PORT`: `5432`
- `DB_NAME`: `automerge_sync`
- `DB_USER`: `postgres`

## Fallback Behavior

The server is designed to work even without PostgreSQL:

1. **With PostgreSQL**: Full user management with database storage
2. **Without PostgreSQL**: Automatic fallback to file-based user storage

Both modes provide the same functionality, but database storage is recommended for production.

## Manual Recovery Steps

If all else fails, you can still use the server:

1. **Skip Database Setup**:
   ```bash
   # Just start the server - it will use file-based storage
   npm start
   ```

2. **Check Server Health**:
   ```bash
   # This will show which storage backend is being used
   curl http://localhost:3030/health
   ```

3. **Test Authentication**:
   ```bash
   # Login with default file-based admin user
   curl -X POST http://localhost:3030/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"admin","password":"admin123"}'
   ```

## Alternative Configurations

If Docker Compose continues to have issues, you can try:

1. **Simple Single-Container Setup**: Use `devcontainer-simple.json`
2. **External PostgreSQL**: Connect to external PostgreSQL instance
3. **File-Based Only**: Remove database configuration entirely

The server architecture supports all these scenarios gracefully.
