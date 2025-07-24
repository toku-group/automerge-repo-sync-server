#!/usr/bin/env node

/**
 * Test Migration Script
 * 
 * This script helps migrate from the old scattered test files to the new consolidated test structure.
 * It can archive old test files or help identify which tests have been migrated.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { execSync } from 'child_process'

const LEGACY_TESTS = [
  'test-basic.js',
  'test-auth.js', 
  'test-auth-extended.js',
  'test-database-integration.js',
  'test-r2.js',
  'test-api-docs.js',
  'test-error-handling.js',
  'test-user-creation.js',
  'test-user-management.js',
  'test-websocket-auth.js',
  'test-automerge-sync.js',
  'test-curl-errors.sh',
  'check-database.js',
  'check-projects.js',
  'health-check.js'
]

const NEW_TEST_STRUCTURE = {
  'test-basic.js': 'test-suite.js (basic category)',
  'test-auth.js': 'tests/auth.test.js',
  'test-auth-extended.js': 'tests/auth.test.js',
  'test-websocket-auth.js': 'tests/auth.test.js',
  'test-database-integration.js': 'tests/database.test.js',
  'test-user-creation.js': 'tests/database.test.js',
  'test-user-management.js': 'tests/database.test.js',
  'check-database.js': 'tests/database.test.js',
  'check-projects.js': 'tests/database.test.js',
  'test-r2.js': 'tests/storage.test.js',
  'test-automerge-sync.js': 'tests/storage.test.js',
  'test-api-docs.js': 'tests/api.test.js',
  'test-error-handling.js': 'tests/api.test.js',
  'test-curl-errors.sh': 'tests/api.test.js',
  'health-check.js': 'test-suite.js (basic category)'
}

function log(message, level = 'info') {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0]
  const prefix = {
    'info': '📋',
    'success': '✅',
    'error': '❌',
    'warning': '⚠️'
  }[level] || '📋'
  console.log(`${prefix} [${timestamp}] ${message}`)
}

function printUsage() {
  console.log(`
Test Migration Script

Usage: node migrate-tests.js [command]

Commands:
  status    Show migration status of legacy test files
  archive   Move legacy test files to legacy/ directory
  help      Show this help message

Examples:
  node migrate-tests.js status     # Check which tests have been migrated
  node migrate-tests.js archive    # Archive old test files
`)
}

function checkMigrationStatus() {
  log('Checking migration status of legacy test files...', 'info')
  console.log('')
  
  let migratedCount = 0
  let totalCount = 0
  
  for (const legacyFile of LEGACY_TESTS) {
    totalCount++
    const exists = existsSync(legacyFile)
    const newLocation = NEW_TEST_STRUCTURE[legacyFile] || 'Not migrated'
    
    if (exists) {
      console.log(`❗ ${legacyFile} → ${newLocation}`)
    } else {
      console.log(`✅ ${legacyFile} → ${newLocation} (archived)`)
      migratedCount++
    }
  }
  
  console.log('')
  console.log(`Migration Status: ${migratedCount}/${totalCount} files archived`)
  
  if (migratedCount < totalCount) {
    console.log('')
    log('Run "node migrate-tests.js archive" to archive remaining legacy files', 'info')
  } else {
    log('All legacy test files have been archived!', 'success')
  }
}

function archiveLegacyTests() {
  log('Starting archive process...', 'info')
  
  // Create legacy directory if it doesn't exist
  if (!existsSync('legacy')) {
    mkdirSync('legacy')
    log('Created legacy/ directory', 'info')
  }
  
  let archivedCount = 0
  
  for (const legacyFile of LEGACY_TESTS) {
    if (existsSync(legacyFile)) {
      try {
        // Move file to legacy directory
        execSync(`mv "${legacyFile}" "legacy/${legacyFile}"`)
        log(`Archived ${legacyFile}`, 'success')
        archivedCount++
      } catch (error) {
        log(`Failed to archive ${legacyFile}: ${error.message}`, 'error')
      }
    }
  }
  
  if (archivedCount > 0) {
    // Create README in legacy directory
    const legacyReadme = `# Legacy Test Files

This directory contains the original test files that have been consolidated into the new test structure.

## Migration Mapping

${Object.entries(NEW_TEST_STRUCTURE).map(([old, newLoc]) => `- \`${old}\` → \`${newLoc}\``).join('\n')}

## New Test Structure

The new test structure provides:
- Unified command-line interface
- Consistent output formatting
- Better organization and categorization
- Improved error handling and reporting

See \`tests/README.md\` for detailed documentation on the new test structure.

## Running Legacy Tests

These files are preserved for reference but should not be used for regular testing.
Use the new test structure instead:

\`\`\`bash
npm run test:all        # Run all tests
npm run test:auth       # Run authentication tests  
npm run test:db         # Run database tests
npm run test:storage    # Run storage tests
npm run test:api        # Run API tests
\`\`\`

## Date Archived

${new Date().toISOString()}
`
    
    writeFileSync('legacy/README.md', legacyReadme)
    log('Created legacy/README.md', 'info')
    
    log(`Successfully archived ${archivedCount} legacy test files`, 'success')
  } else {
    log('No legacy test files found to archive', 'info')
  }
}

// Parse command line arguments
const command = process.argv[2] || 'help'

switch (command) {
  case 'status':
    checkMigrationStatus()
    break
    
  case 'archive':
    archiveLegacyTests()
    break
    
  case 'help':
  default:
    printUsage()
    break
}
