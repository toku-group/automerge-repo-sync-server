# Development Container Setup

This directory contains the configuration for a complete development environment using VS Code devcontainers with PostgreSQL database integration.

## What's Included

### Services
- **Node.js Container** - Main development environment with Node.js 22
- **PostgreSQL Container** - Database server with automatic initialization
- **Network** - Isolated Docker network for service communication

### Features
- PostgreSQL client tools pre-installed
- VS Code extensions for development
- Automatic database schema creation
- Default admin and test users
- Health checks and monitoring

## Quick Start

1. **Open in Dev Container**
   - Open VS Code in this repository
   - Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
   - Select "Dev Containers: Reopen in Container"
   - Wait for containers to build and start

2. **Verify Setup**
   ```bash
   # Check database connection
   psql $DATABASE_URL -c "SELECT db_ready();"
   
   # Test authentication system
   npm run test:db
   
   # Start the server
   npm start
   ```

3. **Access Services**
   - **Server**: http://localhost:3030
   - **API Docs**: http://localhost:3030/api-docs
   - **Health Check**: http://localhost:3030/health
   - **PostgreSQL**: localhost:5432

## Configuration

### Environment Variables
The devcontainer uses `.devcontainer/.env` for configuration:
- Database connection to PostgreSQL container
- Development-optimized settings
- CORS configured for common development ports

### Database
- **Host**: postgres (container name)
- **Database**: automerge_sync
- **User**: postgres
- **Password**: postgres
- **Port**: 5432

### Default Users
Created automatically on first setup:
- **Admin**: username `admin`, password `admin123`
- **Test User**: username `testuser`, password `test123`

## Scripts

### Database Management
```bash
# Setup database (runs automatically)
npm run setup:db

# Test database integration
npm run test:db

# Connect to PostgreSQL
psql $DATABASE_URL
```

### Development
```bash
# Start server with hot reload
npm run dev

# Run tests
npm test

# Format code
npm run prettier
```

## File Structure

```
.devcontainer/
├── devcontainer.json     # VS Code devcontainer configuration
├── docker-compose.yml    # Multi-container setup
├── .env                  # Environment variables
├── init-db.sql          # PostgreSQL initialization
└── README.md            # This file
```

## Customization

### Adding Extensions
Edit `.devcontainer/devcontainer.json`:
```json
"customizations": {
  "vscode": {
    "extensions": [
      "your-extension-id"
    ]
  }
}
```

### Database Configuration
Modify `.devcontainer/.env` or `docker-compose.yml` to change:
- Database credentials
- Connection settings
- Environment variables

### PostgreSQL Version
Update the PostgreSQL image in `docker-compose.yml`:
```yaml
postgres:
  image: postgres:16-alpine  # Change version here
```

## Troubleshooting

### Container Won't Start
```bash
# Rebuild containers
docker-compose down -v
docker-compose build --no-cache
```

### Database Connection Issues
```bash
# Check PostgreSQL container logs
docker-compose logs postgres

# Verify database is ready
docker-compose exec postgres pg_isready -U postgres
```

### Permission Issues
```bash
# Reset volumes and restart
docker-compose down -v
docker-compose up
```

## Production Differences

The devcontainer setup differs from production:
- Uses local PostgreSQL container vs managed database
- Includes development tools and extensions
- Has debug logging enabled
- Uses development JWT secrets
- Allows cross-origin requests from common dev ports

For production deployment, see the main README.md and `docs/POSTGRESQL_SETUP.md`.
