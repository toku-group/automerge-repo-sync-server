#!/bin/bash

# Devcontainer setup script
# This script runs after the container starts and waits for PostgreSQL to be ready

echo "🚀 Starting devcontainer setup..."
echo "🔧 Debug info:"
echo "   Current working directory: $(pwd)"
echo "   Node.js version: $(node --version)"
echo "   NPM version: $(npm --version)"

# Function to check if PostgreSQL is ready
check_postgres() {
    # Try multiple connection methods
    if command -v pg_isready >/dev/null 2>&1; then
        pg_isready -h postgres -p 5432 -U postgres -d automerge_sync >/dev/null 2>&1
    else
        # Fallback: try connecting with psql
        echo "SELECT 1;" | psql "postgresql://postgres:postgres@postgres:5432/automerge_sync" >/dev/null 2>&1
    fi
}

# Function to debug PostgreSQL connection
debug_postgres() {
    echo "🔍 PostgreSQL debugging:"
    echo "   Checking if PostgreSQL container is running..."
    
    # Check if we can resolve the postgres hostname
    if nslookup postgres >/dev/null 2>&1; then
        echo "   ✅ Hostname 'postgres' resolves"
    else
        echo "   ❌ Cannot resolve hostname 'postgres'"
        echo "   This suggests the PostgreSQL container is not running"
        return 1
    fi
    
    # Check if port 5432 is open
    if nc -z postgres 5432 >/dev/null 2>&1; then
        echo "   ✅ Port 5432 is open on postgres"
    else
        echo "   ❌ Port 5432 is not open on postgres"
        return 1
    fi
    
    # Check if PostgreSQL is ready
    if check_postgres; then
        echo "   ✅ PostgreSQL is ready to accept connections"
        return 0
    else
        echo "   ❌ PostgreSQL is not ready"
        return 1
    fi
}

# Function to wait for PostgreSQL with timeout
wait_for_postgres() {
    echo "⏳ Waiting for PostgreSQL to be ready..."
    local timeout=120  # Increased timeout
    local counter=0
    
    while ! check_postgres; do
        if [ $counter -ge $timeout ]; then
            echo "❌ PostgreSQL not ready after ${timeout} seconds"
            echo "🔍 Running diagnostics..."
            debug_postgres
            echo "ℹ️  The server will fall back to file-based storage"
            return 1
        fi
        
        # Show progress every 10 seconds
        if [ $((counter % 10)) -eq 0 ]; then
            echo "   Waiting for PostgreSQL... (${counter}/${timeout}s)"
            if [ $counter -gt 30 ]; then
                debug_postgres
            fi
        fi
        
        sleep 2
        counter=$((counter + 2))
    done
    
    echo "✅ PostgreSQL is ready!"
    return 0
}

# Function to setup database
setup_database() {
    echo "🔧 Setting up database..."
    
    # Try to run the database setup script
    if node scripts/setup-database.js; then
        echo "✅ Database setup completed successfully"
        return 0
    else
        echo "⚠️  Database setup failed, but this is okay"
        echo "   The server will automatically initialize the database on first run"
        return 1
    fi
}

# Function to test the setup
test_setup() {
    echo "🧪 Testing database integration..."
    
    if node test-database-integration.js; then
        echo "✅ Database integration test passed"
    else
        echo "ℹ️  Database integration test failed (expected if PostgreSQL not ready)"
        echo "   The server will work with file-based storage as fallback"
    fi
}

# Main setup process
main() {
    # Wait for PostgreSQL to be ready
    if wait_for_postgres; then
        # PostgreSQL is ready, set up the database
        if setup_database; then
            echo "🎉 Full PostgreSQL setup completed!"
        else
            echo "⚠️  Database setup had issues, but continuing..."
        fi
        
        # Run a quick test
        test_setup
    else
        echo "ℹ️  PostgreSQL not available, will use file-based storage"
    fi
    
    echo ""
    echo "🏁 Devcontainer setup complete!"
    echo ""
    echo "📝 Next steps:"
    echo "   1. Run 'npm start' to start the server"
    echo "   2. Access API docs at http://localhost:3030/api-docs"
    echo "   3. Check health at http://localhost:3030/health"
    echo ""
    
    if check_postgres; then
        echo "💾 Database credentials:"
        echo "   Admin: admin / admin123"
        echo "   Test:  testuser / test123"
        echo ""
        echo "🔗 PostgreSQL connection:"
        echo "   psql \$DATABASE_URL"
    else
        echo "📁 Using file-based storage (no PostgreSQL)"
        echo "   Default admin user will be created on first run"
    fi
    
    echo ""
}

# Run the main setup
main
