#!/bin/bash

# Install PostgreSQL client tools in the devcontainer
# Run this script if you need psql or pg_isready commands

echo "🔧 Installing PostgreSQL client tools..."

# Update package list
sudo apt-get update

# Install PostgreSQL client
sudo apt-get install -y postgresql-client

# Clean up
sudo apt-get clean
sudo rm -rf /var/lib/apt/lists/*

echo "✅ PostgreSQL client tools installed successfully!"
echo "You can now use commands like: psql, pg_isready, pg_dump, etc."

# Test the installation
if command -v psql >/dev/null 2>&1; then
    echo "📊 psql version: $(psql --version)"
else
    echo "❌ Installation failed - psql command not found"
fi
