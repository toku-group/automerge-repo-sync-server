# User Management API Endpoints

The automerge-repo-sync-server now includes comprehensive user management API endpoints that allow administrators to list and delete users.

## 🔐 Authentication Required

All user management endpoints require:
- Valid JWT token in the `Authorization` header: `Bearer YOUR_JWT_TOKEN`
- Admin permissions (`admin` role required)

## 📋 List Users

**Endpoint:** `GET /auth/users`

**Description:** Retrieve a paginated list of all users in the system.

**Query Parameters:**
- `limit` (optional): Maximum number of users to return (1-100, default: 50)
- `offset` (optional): Number of users to skip for pagination (default: 0)

**Example Request:**
```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  "http://localhost:3030/auth/users?limit=10&offset=0"
```

**Example Response:**
```json
{
  "users": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "username": "admin",
      "email": null,
      "permissions": ["admin", "read", "write", "delete"],
      "is_active": true,
      "created_at": "2025-07-23T03:29:23.000Z",
      "last_login": "2025-07-23T15:51:04.000Z"
    },
    {
      "id": "789e0123-e89b-12d3-a456-426614174001",
      "username": "testuser",
      "email": "test@example.com",
      "permissions": ["read", "write"],
      "is_active": true,
      "created_at": "2025-07-23T12:55:46.000Z",
      "last_login": "2025-07-23T12:55:46.000Z"
    }
  ],
  "pagination": {
    "limit": 10,
    "offset": 0,
    "total": 2
  }
}
```

**Response Status Codes:**
- `200`: Success
- `401`: Unauthorized (invalid/missing token)
- `403`: Forbidden (insufficient permissions)
- `500`: Internal server error

## 🗑️ Delete User

**Endpoint:** `DELETE /auth/users/{userId}`

**Description:** Permanently delete a user from the system. This action is irreversible and will delete all associated data including tokens, sessions, and audit logs.

**Path Parameters:**
- `userId` (required): The UUID of the user to delete

**Example Request:**
```bash
curl -X DELETE \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  "http://localhost:3030/auth/users/789e0123-e89b-12d3-a456-426614174001"
```

**Example Response:**
```json
{
  "message": "User deleted successfully",
  "userId": "789e0123-e89b-12d3-a456-426614174001"
}
```

**Response Status Codes:**
- `200`: User deleted successfully
- `400`: Bad request (invalid user ID or attempting to delete own account)
- `401`: Unauthorized (invalid/missing token)
- `403`: Forbidden (insufficient permissions)
- `404`: User not found
- `500`: Internal server error

## ⚠️ Important Security Notes

1. **Admin Only**: Both endpoints require admin permissions
2. **Self-Deletion Prevention**: Users cannot delete their own accounts
3. **Irreversible Action**: User deletion permanently removes all user data
4. **Audit Trail**: All deletions are logged in the auth audit log
5. **Transaction Safety**: Deletions use database transactions to ensure data consistency

## 🧪 Testing

A comprehensive test script is available at `test-user-management.js` that demonstrates:
- User listing functionality
- User deletion with verification
- Permission enforcement
- Edge case handling
- Error response validation

Run the test with:
```bash
node test-user-management.js
```

## 📚 API Documentation

Complete API documentation is available in the Swagger UI at:
- **Local Development:** http://localhost:3030/api-docs/
- **JSON Schema:** http://localhost:3030/api-docs.json

## 🔧 Implementation Details

The user management system includes:

1. **Database Integration**: Uses PostgreSQL with proper foreign key handling
2. **Transaction Support**: Ensures data consistency during deletions
3. **Audit Logging**: Tracks all user management actions
4. **Permission Validation**: Enforces role-based access control
5. **Error Handling**: Comprehensive error responses and logging

### Database Operations During User Deletion

When a user is deleted, the system removes data in this order:
1. Refresh tokens
2. Auth audit logs
3. User sessions
4. User record

This order respects foreign key constraints and ensures complete cleanup.
