# Enhanced Database Error Handling Documentation

## Overview
This document outlines the comprehensive database error handling enhancements made to the Automerge Repo Sync Server API, including detailed API documentation updates.

## 🚀 Implementation Summary

### Enhanced Error Response Types
We've implemented 5 specialized error response schemas in the API documentation:

1. **`Error`** - Base error schema with optional `code` and `details` fields
2. **`DatabaseError`** - For database connection issues and server errors
3. **`ValidationError`** - For missing required fields and input validation
4. **`ConflictError`** - For resource conflicts (e.g., duplicate names)
5. **`AuthenticationError`** - For authentication and authorization errors

### Database Error Handling Categories

#### 🔌 Connection Errors (503 Service Unavailable)
- **`ECONNREFUSED`** - Database connection refused
- **`ENOTFOUND`** - Database host not found
- **Response**: `{"error": "Database connection unavailable"}`

#### 🏗️ Schema Errors (503 Service Unavailable)
- **`42P01`** - Relation does not exist (table missing)
- **Response**: `{"error": "Database schema not properly initialized"}`

#### ⚠️ Constraint Violations
- **`23505`** - Unique constraint violation (409 Conflict)
- **`23503`** - Foreign key constraint violation (400 Bad Request)
- **Response**: Specific constraint error messages

#### 🔤 Data Type Errors (500 Internal Server Error)
- **`22P02`** - Invalid UUID format
- **Response**: `{"error": "Failed to retrieve project", "details": "invalid input syntax for type uuid..."}`

### API Endpoints Enhanced

#### Projects API
- **`GET /api/projects`** - 4 error response types documented
- **`POST /api/projects`** - 6 error response types documented
- **`GET /api/project/{projectId}`** - 5 error response types documented
- **`DELETE /api/project/{projectId}`** - 5 error response types documented

#### Project Documents API
- **`GET /api/project/{projectId}/documents`** - 5 error response types documented
- **`POST /api/project/{projectId}/documents`** - 6 error response types documented

#### Authentication API
- **`POST /auth/login`** - 4 error response types documented

### HTTP Status Code Mapping

| Status Code | Error Type | Description |
|-------------|------------|-------------|
| `400` | ValidationError | Missing required fields, invalid input |
| `401` | AuthenticationError | Invalid/missing token, bad credentials |
| `403` | Error | Insufficient permissions |
| `404` | Error | Resource not found or access denied |
| `409` | ConflictError | Resource conflicts (duplicate names) |
| `500` | DatabaseError | Internal server errors, invalid UUIDs |
| `503` | DatabaseError | Database unavailable, schema issues |

### Environment-Aware Error Details
- **Development Mode**: Includes technical `details` field with database error specifics
- **Production Mode**: Hides technical details for security

### Example Error Responses

#### Authentication Error
```json
{
  "error": "Access token required",
  "code": "MISSING_TOKEN"
}
```

#### Database Connection Error
```json
{
  "error": "Database connection unavailable"
}
```

#### Validation Error
```json
{
  "error": "Project name is required"
}
```

#### Conflict Error
```json
{
  "error": "A project with this name already exists"
}
```

#### Database Error with Details (Development)
```json
{
  "error": "Failed to retrieve project",
  "details": "invalid input syntax for type uuid: \"invalid-uuid-format\""
}
```

## 📊 Testing Results

### Error Handling Test Results ✅
- ✅ Authentication errors (401) - Proper error messages with codes
- ✅ Validation errors (400) - Clear messages for missing required fields  
- ✅ Not found errors (404) - Appropriate 404 responses for non-existent resources
- ✅ Database errors (500) - Detailed error messages in development mode
- ✅ UUID format errors - Specific database error details shown
- ✅ Conflict errors (409) - Proper duplicate detection

### API Documentation Test Results ✅
- ✅ 5 enhanced error schemas properly defined
- ✅ All project endpoints reference appropriate error schemas
- ✅ Authentication endpoint properly documented
- ✅ Error response examples included
- ✅ Swagger UI accessible with enhanced documentation

## 🔗 Access Points

- **Swagger UI**: http://localhost:3030/api-docs/
- **JSON API Docs**: http://localhost:3030/api-docs.json
- **Server Status**: http://localhost:3030/

## 🛡️ Security Considerations

- Technical error details only shown in development mode
- Production mode hides database-specific error information
- Authentication errors provide appropriate feedback without leaking system details
- UUID validation prevents potential injection attempts

## 🎯 Benefits

1. **Better Developer Experience**: Clear, specific error messages
2. **Improved Debugging**: Technical details in development mode
3. **Production Security**: Sanitized error responses in production
4. **API Documentation**: Comprehensive error response documentation
5. **Client Error Handling**: Predictable error response format
6. **Database Resilience**: Graceful handling of connection and schema issues

This implementation ensures that when database errors occur during project API requests, **detailed and appropriate error responses are sent back to the client** with proper HTTP status codes, helpful error messages, and comprehensive API documentation.
