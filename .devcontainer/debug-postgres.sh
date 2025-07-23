#!/bin/bash

# Debug script for PostgreSQL in devcontainer
echo "🔍 PostgreSQL Debug Script"
echo "========================="

echo ""
echo "1. Container Network Info:"
echo "   Hostname: $(hostname)"
echo "   Network interfaces:"
ip addr show | grep -E "inet |UP"

echo ""
echo "2. DNS Resolution:"
echo "   Resolving 'postgres' hostname:"
if nslookup postgres; then
    echo "   ✅ DNS resolution successful"
else
    echo "   ❌ DNS resolution failed"
fi

echo ""
echo "3. Network Connectivity:"
echo "   Testing connection to postgres:5432:"
if nc -z postgres 5432; then
    echo "   ✅ Port 5432 is reachable"
else
    echo "   ❌ Port 5432 is not reachable"
fi

echo ""
echo "4. Docker Compose Status:"
echo "   Checking if this is in a Docker Compose environment:"
if [ -n "$COMPOSE_PROJECT_NAME" ]; then
    echo "   ✅ Running in Docker Compose: $COMPOSE_PROJECT_NAME"
else
    echo "   ⚠️  COMPOSE_PROJECT_NAME not set"
fi

echo ""
echo "5. Environment Variables:"
echo "   DATABASE_URL: ${DATABASE_URL:-'Not set'}"
echo "   DB_HOST: ${DB_HOST:-'Not set'}"
echo "   DB_PORT: ${DB_PORT:-'Not set'}"

echo ""
echo "6. PostgreSQL Client Test:"
if command -v pg_isready >/dev/null 2>&1; then
    echo "   PostgreSQL client tools available"
    echo "   Testing connection with pg_isready:"
    if pg_isready -h postgres -p 5432 -U postgres; then
        echo "   ✅ PostgreSQL is ready"
    else
        echo "   ❌ PostgreSQL is not ready"
    fi
else
    echo "   ❌ PostgreSQL client tools not available"
fi

echo ""
echo "7. Alternative Connection Test:"
echo "   Trying direct connection with psql:"
if echo "SELECT version();" | psql "postgresql://postgres:postgres@postgres:5432/automerge_sync" 2>/dev/null; then
    echo "   ✅ Direct connection successful"
else
    echo "   ❌ Direct connection failed"
fi

echo ""
echo "8. Process List:"
echo "   Checking for PostgreSQL processes:"
ps aux | grep -v grep | grep postgres || echo "   No PostgreSQL processes found"

echo ""
echo "🏁 Debug complete. If PostgreSQL is not working:"
echo "   1. Make sure you're using 'Dev Containers: Rebuild Container'"
echo "   2. Check Docker Compose logs with: docker-compose logs postgres"
echo "   3. Try restarting the containers"
