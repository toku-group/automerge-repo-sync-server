# JWT Authentication for Automerge Sync Server

This document describes the JWT (JSON Web Token) authentication system implemented for the Automerge Sync Server.

## Overview

The server now uses JWT-based authentication to secure API endpoints and WebSocket connections. This provides:

- **Stateless authentication** - No server-side session storage required
- **Scalable** - Works across multiple server instances
- **Secure** - Industry-standard token-based authentication
- **Flexible** - Role-based permissions system

## Features

- ✅ JWT access and refresh tokens
- ✅ Role-based permissions (read, write, delete, admin)
- ✅ User management system
- ✅ Protected API endpoints
- ✅ WebSocket authentication
- ✅ Token refresh mechanism
- ✅ OpenAPI documentation with security schemas

## Environment Configuration

Add these variables to your `.env` file:

```bash
# JWT Configuration
JWT_SECRET=your-super-secret-jwt-signing-key-change-this-in-production
JWT_EXPIRY=24h
JWT_REFRESH_EXPIRY=7d

# User Management
DEFAULT_ADMIN_PASSWORD=admin123
USERS_FILE=./data/users.json

# WebSocket Authentication (optional)
REQUIRE_WS_AUTH=false  # Set to 'true' to require auth for WebSocket
```

⚠️ **Important:** Generate a secure JWT secret for production:
```bash
openssl rand -hex 64
```

## Default User

On first startup, a default admin user is created:
- **Username:** `admin`
- **Password:** `admin123` (or value of `DEFAULT_ADMIN_PASSWORD`)
- **Permissions:** `["admin", "read", "write", "delete"]`

⚠️ **Change the default password immediately in production!**

## Permission System

| Permission | Description |
|------------|-------------|
| `read` | View projects and user info |
| `write` | Create and modify projects |
| `delete` | Delete projects |
| `admin` | User management, all permissions |

## API Authentication

### 1. Login

```bash
curl -X POST http://localhost:3030/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin123"}'
```

Response:
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "admin",
    "username": "admin",
    "permissions": ["admin", "read", "write", "delete"]
  },
  "expiresIn": "24h"
}
```

### 2. Use Access Token

Include the access token in the `Authorization` header:

```bash
curl -X GET http://localhost:3030/api/projects \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### 3. Refresh Token

When the access token expires, use the refresh token:

```bash
curl -X POST http://localhost:3030/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."}'
```

## WebSocket Authentication

### Method 1: Query Parameter

```javascript
const ws = new WebSocket('ws://localhost:3030?token=YOUR_ACCESS_TOKEN');
```

### Method 2: Authorization Header

```javascript
const ws = new WebSocket('ws://localhost:3030', [], {
  headers: {
    'Authorization': 'Bearer YOUR_ACCESS_TOKEN'
  }
});
```

## API Endpoints

### Authentication Routes

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/auth/login` | Login with credentials | No |
| POST | `/auth/refresh` | Refresh access token | No |
| GET | `/auth/me` | Get current user info | Yes |
| POST | `/auth/change-password` | Change password | Yes |

### User Management (Admin Only)

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|------------|
| GET | `/users` | List all users | admin |
| POST | `/users` | Create new user | admin |
| DELETE | `/users/{username}` | Delete user | admin |

### Project Management

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|------------|
| GET | `/api/projects` | List projects | read |
| GET | `/api/project/{id}` | Get project | read |
| POST | `/api/projects` | Create project | write |
| DELETE | `/api/project/{id}` | Delete project | delete |

## Client Examples

### Node.js with fetch

```javascript
import fetch from 'node-fetch';

// Login
const loginResponse = await fetch('http://localhost:3030/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'admin123' })
});

const { accessToken } = await loginResponse.json();

// Use token for API calls
const projectsResponse = await fetch('http://localhost:3030/api/projects', {
  headers: { 'Authorization': `Bearer ${accessToken}` }
});

const projects = await projectsResponse.json();
```

### JavaScript (Browser)

```javascript
// Login
const response = await fetch('/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'admin123' })
});

const { accessToken } = await response.json();

// Store token (consider using secure storage)
localStorage.setItem('accessToken', accessToken);

// WebSocket with auth
const ws = new WebSocket(`ws://localhost:3030?token=${accessToken}`);
```

### cURL Examples

```bash
# Login
TOKEN=$(curl -s -X POST http://localhost:3030/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' \
  | jq -r '.accessToken')

# List projects
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3030/api/projects

# Create project
curl -X POST http://localhost:3030/api/projects \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"New Project","description":"Created via API"}'
```

## Security Best Practices

### Production Setup

1. **Secure JWT Secret**
   ```bash
   # Generate secure secret
   export JWT_SECRET=$(openssl rand -hex 64)
   ```

2. **Change Default Password**
   ```bash
   export DEFAULT_ADMIN_PASSWORD="your-secure-password"
   ```

3. **Enable WebSocket Auth**
   ```bash
   export REQUIRE_WS_AUTH=true
   ```

4. **Use HTTPS**
   - Always use HTTPS in production
   - JWT tokens contain sensitive information

5. **Token Management**
   - Store tokens securely (not in localStorage for sensitive apps)
   - Implement proper token refresh logic
   - Set appropriate expiration times

### User Management

1. **Create Users with Minimal Permissions**
   ```bash
   curl -X POST http://localhost:3030/users \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"username":"viewer","password":"secure123","permissions":["read"]}'
   ```

2. **Regular Permission Audits**
   - Review user permissions regularly
   - Remove unused accounts
   - Use principle of least privilege

## Troubleshooting

### Common Issues

1. **Token Expired**
   - Error: `Invalid or expired token`
   - Solution: Use refresh token to get new access token

2. **Insufficient Permissions**
   - Error: `Permission 'write' required`
   - Solution: Check user permissions, contact admin

3. **WebSocket Auth Failed**
   - Error: `Authentication failed`
   - Solution: Check token validity, ensure proper header/query format

4. **Invalid JWT Secret**
   - Error: `JWT verification failed`
   - Solution: Ensure JWT_SECRET is consistent across restarts

### Debug Mode

Set environment variable for detailed auth logs:
```bash
export DEBUG=auth:*
```

## Migration from Shared Secret

If migrating from the previous shared secret system:

1. Existing API calls will fail with 401 errors
2. Update clients to use JWT authentication
3. Remove `SHARED_SECRET` from environment
4. Use the example client code as reference

## OpenAPI Documentation

Visit `http://localhost:3030/api-docs` to see the interactive API documentation with:
- Authentication examples
- Try-it-out functionality
- Security schema definitions
- Complete API reference

The JWT authentication is fully documented in the OpenAPI spec with examples and security requirements for each endpoint.
