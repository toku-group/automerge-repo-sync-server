# Legacy Test Files

This directory contains the original test files that have been consolidated into the new test structure.

## Migration Mapping

- `test-basic.js` → `test-suite.js (basic category)`
- `test-auth.js` → `tests/auth.test.js`
- `test-auth-extended.js` → `tests/auth.test.js`
- `test-websocket-auth.js` → `tests/auth.test.js`
- `test-database-integration.js` → `tests/database.test.js`
- `test-user-creation.js` → `tests/database.test.js`
- `test-user-management.js` → `tests/database.test.js`
- `check-database.js` → `tests/database.test.js`
- `check-projects.js` → `tests/database.test.js`
- `test-r2.js` → `tests/storage.test.js`
- `test-automerge-sync.js` → `tests/storage.test.js`
- `test-api-docs.js` → `tests/api.test.js`
- `test-error-handling.js` → `tests/api.test.js`
- `test-curl-errors.sh` → `tests/api.test.js`
- `health-check.js` → `test-suite.js (basic category)`

## New Test Structure

The new test structure provides:
- Unified command-line interface
- Consistent output formatting
- Better organization and categorization
- Improved error handling and reporting

See `tests/README.md` for detailed documentation on the new test structure.

## Running Legacy Tests

These files are preserved for reference but should not be used for regular testing.
Use the new test structure instead:

```bash
npm run test:all        # Run all tests
npm run test:auth       # Run authentication tests  
npm run test:db         # Run database tests
npm run test:storage    # Run storage tests
npm run test:api        # Run API tests
```

## Date Archived

2025-07-24T15:17:30.293Z
