# Test Suite Documentation

This document describes the consolidated test structure for the automerge-repo-sync-server project.

## Overview

The test suite has been reorganized from scattered individual test files into a unified, consistent structure that provides better organization, standardized output, and easier maintenance.

## Test Categories

### 1. Basic Tests (`test:basic`)
Tests fundamental server functionality:
- Server health check
- WebSocket info endpoint
- Swagger UI accessibility
- API documentation availability

### 2. Authentication Tests (`test:auth`)
Tests authentication and authorization:
- Login with valid/invalid credentials
- JWT token validation
- Protected endpoint access
- Token refresh functionality
- Logout functionality

### 3. API Tests (`test:api`)
Tests API endpoints and documentation:
- Swagger documentation completeness
- Error response formats
- Project CRUD operations
- Input validation
- Rate limiting
- CORS headers

### 4. Database Tests (`test:db`)
Tests database integration:
- Database connectivity
- Project management operations
- User management
- Schema validation
- Permission checking

### 5. Storage Tests (`test:storage`)
Tests R2 storage and Automerge sync:
- R2 storage operations
- Document storage/retrieval
- Automerge sync endpoints
- WebSocket functionality
- Large document handling

### 6. Mocha Tests (`test:mocha`)
Runs the existing Mocha test suite:
- Legacy unit tests
- Integration tests

## Usage

### Running All Tests
```bash
npm run test:all
```

### Running Specific Test Categories
```bash
npm run test:basic      # Basic server tests
npm run test:auth       # Authentication tests
npm run test:api        # API endpoint tests
npm run test:db         # Database integration tests
npm run test:storage    # Storage and sync tests
npm run test:mocha      # Mocha test suite
```

### Running Individual Test Files
```bash
node tests/auth.test.js       # Authentication tests only
node tests/database.test.js   # Database tests only
node tests/storage.test.js    # Storage tests only
node tests/api.test.js        # API tests only
```

### Verbose Output
```bash
npm run test:all -- --verbose
node test-suite.js auth --verbose
```

## Test Structure

### Main Test Suite (`test-suite.js`)
The main test runner that orchestrates all test categories. It provides:
- Unified command-line interface
- Consistent logging and output formatting
- Test categorization and filtering
- Summary reporting
- Exit code handling

### Individual Test Modules (`tests/*.test.js`)
Specialized test modules for different functionality areas:
- `tests/auth.test.js` - Authentication and JWT tests
- `tests/database.test.js` - Database integration tests
- `tests/storage.test.js` - R2 storage and sync tests
- `tests/api.test.js` - API endpoint and documentation tests

### Legacy Test Files
Original test files are preserved for backward compatibility:
- Available via `npm run test:legacy:*` commands
- Maintained for reference and specific edge cases

## Environment Requirements

### Basic Tests
- Server running on `http://localhost:3030` (default)
- No additional configuration required

### Authentication Tests
- Server running with authentication enabled
- Default admin credentials (`admin` / `admin234`)

### Database Tests
- PostgreSQL database connection configured
- Database schema initialized
- Environment variables set for database connection

### Storage Tests
- R2 credentials configured (optional - tests will skip if not available):
  - `CLOUDFLARE_ACCOUNT_ID`
  - `CLOUDFLARE_ACCESS_KEY_ID`
  - `CLOUDFLARE_SECRET_ACCESS_KEY`
  - `R2_BUCKET_NAME`

## Test Output Format

All tests use a consistent output format:
```
📋 [timestamp] Test description...
✅ [timestamp] Test passed (duration)
❌ [timestamp] Test failed: error message

📊 TEST RESULTS SUMMARY
=================================
✅ Passed: X
❌ Failed: Y
⏭️  Skipped: Z
⏱️  Total Time: Xms
```

## Error Handling

Tests validate proper error responses including:
- HTTP status codes
- Error message structure
- Error codes (e.g., `VALIDATION_ERROR`, `DATABASE_ERROR`)
- Environment-appropriate error details

## Development

### Adding New Tests

1. **For new test categories**: Add to `test-suite.js`
2. **For existing categories**: Add to appropriate `tests/*.test.js` file
3. **For specialized functionality**: Create new test module in `tests/`

### Test Structure Guidelines

```javascript
async testSomething() {
  // Arrange
  const testData = { ... }
  
  // Act
  const response = await this.makeRequest('/endpoint', { ... })
  
  // Assert
  if (!response.ok) {
    throw new Error(`Expected success, got ${response.status}`)
  }
  
  if (!response.data.expectedField) {
    throw new Error('Missing expected field in response')
  }
}
```

### Best Practices

1. **Test Isolation**: Each test should be independent
2. **Cleanup**: Tests should clean up any created resources
3. **Error Messages**: Provide descriptive error messages
4. **Assertions**: Use specific assertions rather than generic checks
5. **Environment**: Handle missing environment gracefully (skip vs fail)

## Migration from Legacy Tests

The old test files have been consolidated as follows:

| Legacy File | New Location | Notes |
|-------------|-------------|-------|
| `test-basic.js` | `test-suite.js` (basic) | Basic server tests |
| `test-auth.js` | `tests/auth.test.js` | Enhanced authentication tests |
| `test-database-integration.js` | `tests/database.test.js` | Database integration tests |
| `test-r2.js` | `tests/storage.test.js` | R2 storage tests |
| `test-api-docs.js` | `tests/api.test.js` | API documentation tests |
| `test-error-handling.js` | `tests/api.test.js` | Error response validation |
| `test/Server.test.js` | Unchanged | Mocha test suite |

Legacy tests remain available via `npm run test:legacy:*` commands for backward compatibility.

## Troubleshooting

### Common Issues

1. **Server not accessible**: Ensure server is running on the expected port
2. **Authentication failures**: Check default credentials and JWT configuration
3. **Database connection errors**: Verify PostgreSQL connection and schema
4. **R2 tests skipped**: Set R2 environment variables or run tests without storage category

### Debug Mode

Use `--verbose` flag for detailed error information:
```bash
npm run test:auth -- --verbose
```

### Manual Testing

Individual endpoints can be tested manually:
```bash
curl -X GET http://localhost:3030/
curl -X POST http://localhost:3030/auth/login -d '{"username":"admin","password":"admin234"}' -H "Content-Type: application/json"
```
