# PostgreSQL Database Setup

The automerge-repo-sync-server now supports PostgreSQL for production-ready user management and authentication. If PostgreSQL is not available, it will automatically fall back to file-based user storage.

## Quick Start

### 1. Install PostgreSQL
```bash
# Ubuntu/Debian
sudo apt update && sudo apt install postgresql postgresql-contrib

# macOS (using Homebrew)
brew install postgresql

# Windows
# Download and install from https://www.postgresql.org/download/windows/
```

### 2. Create Database
```bash
# Start PostgreSQL service
sudo systemctl start postgresql  # Linux
brew services start postgresql   # macOS

# Create database and user
sudo -u postgres psql
```

```sql
-- In PostgreSQL console
CREATE DATABASE automerge_sync;
CREATE USER automerge_user WITH PASSWORD 'secure_password_here';
GRANT ALL PRIVILEGES ON DATABASE automerge_sync TO automerge_user;
\q
```

### 3. Configure Environment
Update your `.env.local` file:

```bash
# Database Configuration
DATABASE_URL=postgresql://automerge_user:secure_password_here@localhost:5432/automerge_sync
DB_HOST=localhost
DB_PORT=5432
DB_NAME=automerge_sync
DB_USER=automerge_user
DB_PASSWORD=secure_password_here
```

### 4. Start the Server
```bash
npm start
```

The server will automatically:
- Connect to PostgreSQL if available
- Create necessary tables using `database/schema.sql`
- Create a default admin user if no users exist
- Fall back to file-based storage if database connection fails

## Database Schema

The server creates these tables automatically:

- **users** - User accounts with profiles and permissions
- **refresh_tokens** - JWT refresh token management
- **blacklisted_tokens** - Revoked JWT tokens
- **user_sessions** - Active user session tracking
- **auth_audit_log** - Security event logging

## Production Deployment

### Docker with PostgreSQL
```yaml
version: '3.8'
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: automerge_sync
      POSTGRES_USER: automerge_user
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  automerge-server:
    build: .
    environment:
      DATABASE_URL: postgresql://automerge_user:${DB_PASSWORD}@postgres:5432/automerge_sync
      JWT_SECRET: ${JWT_SECRET}
      NODE_ENV: production
    ports:
      - "3030:3030"
    depends_on:
      - postgres

volumes:
  postgres_data:
```

### Environment Variables for Production
```bash
# Required
DATABASE_URL=postgresql://user:password@host:port/database
JWT_SECRET=your-super-secure-secret-key-here
NODE_ENV=production

# Optional database settings
DB_HOST=localhost
DB_PORT=5432
DB_NAME=automerge_sync
DB_USER=automerge_user
DB_PASSWORD=secure_password_here
```

## Features

### Automatic Fallback
- If PostgreSQL is unavailable, automatically uses file-based storage
- No code changes required - transparent switching
- Graceful error handling and logging

### Security Features
- PBKDF2 password hashing with salt
- JWT token blacklisting
- Refresh token rotation
- Authentication audit logging
- Session tracking

### User Management
- Create, read, update, delete users
- Role-based permissions (admin, read, write, delete)
- User profiles with custom data
- Password change with validation

### Performance
- Connection pooling
- Database indexes for performance
- Automatic cleanup of expired tokens
- Health checks and monitoring

## Testing

Test the database integration:
```bash
node test-database-integration.js
```

Check server health with database status:
```bash
curl http://localhost:3030/health
```

## Troubleshooting

### Common Issues

1. **Connection refused (ECONNREFUSED)**
   - PostgreSQL is not running
   - Check: `sudo systemctl status postgresql`
   - Start: `sudo systemctl start postgresql`

2. **Authentication failed**
   - Wrong credentials in DATABASE_URL
   - Check user exists: `sudo -u postgres psql -c "\du"`

3. **Database does not exist**
   - Create database: `sudo -u postgres createdb automerge_sync`

4. **Permission denied**
   - Grant permissions to user:
     ```sql
     GRANT ALL PRIVILEGES ON DATABASE automerge_sync TO automerge_user;
     ```

### Logs
- Server logs show database connection status
- Authentication events are logged to `auth_audit_log` table
- Use `LOG_LEVEL=debug` for detailed database logs

### Migration from File-based Storage
The server will automatically create a default admin user when switching to database storage. You may need to manually migrate existing users or recreate them in the database.

## API Endpoints

All existing authentication endpoints work with both storage backends:

- `POST /auth/login` - User authentication
- `POST /auth/refresh` - Token refresh
- `POST /auth/change-password` - Password change
- `POST /users` - Create user (admin only)
- `GET /health` - Health check with database status

The API behavior is identical regardless of whether PostgreSQL or file-based storage is used.
