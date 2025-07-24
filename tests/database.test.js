#!/usr/bin/env node

/**
 * Database Integration Tests
 * 
 * Consolidates database testing functionality including:
 * - Database connectivity
 * - Project management operations
 * - User management
 * - Schema validation
 */

import { DatabaseService } from '../src/database/DatabaseService.js'
import { ProjectService } from '../src/database/ProjectService.js'
import { DatabaseUserService } from '../src/auth/DatabaseUserService.js'

class DatabaseTests {
  constructor() {
    this.db = new DatabaseService()
    this.projectService = new ProjectService()
    this.userService = new DatabaseUserService()
    this.results = { passed: 0, failed: 0, tests: [] }
  }

  log(message, level = 'info') {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0]
    const prefix = {
      'info': '📋',
      'success': '✅',
      'error': '❌',
      'warning': '⚠️'
    }[level] || '📋'
    console.log(`${prefix} [${timestamp}] ${message}`)
  }

  async runTest(testName, testFunction) {
    this.log(`Running ${testName}...`, 'info')
    const startTime = Date.now()
    
    try {
      await testFunction()
      const duration = Date.now() - startTime
      this.log(`${testName} passed (${duration}ms)`, 'success')
      this.results.passed++
      this.results.tests.push({ name: testName, status: 'passed', duration })
    } catch (error) {
      const duration = Date.now() - startTime
      this.log(`${testName} failed: ${error.message}`, 'error')
      this.results.failed++
      this.results.tests.push({ name: testName, status: 'failed', duration, error: error.message })
    }
  }

  // ==================== DATABASE CONNECTIVITY TESTS ====================

  async testDatabaseConnection() {
    const client = await this.db.pool.connect()
    await client.query('SELECT NOW()')
    client.release()
  }

  async testDatabaseSchema() {
    const client = await this.db.pool.connect()
    
    // Check if required tables exist
    const tables = ['users', 'projects', 'project_documents', 'project_collaborators', 'project_activity']
    
    for (const table of tables) {
      const result = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = $1
        )
      `, [table])
      
      if (!result.rows[0].exists) {
        throw new Error(`Required table '${table}' does not exist`)
      }
    }
    
    client.release()
  }

  // ==================== PROJECT MANAGEMENT TESTS ====================

  async testProjectCreation() {
    const testProject = {
      name: `Test Project ${Date.now()}`,
      description: 'Test project for database integration',
      userId: 'test-user-id'
    }

    const project = await this.projectService.createProject(testProject)
    
    if (!project.id || !project.name || !project.created_at) {
      throw new Error('Project creation returned incomplete data')
    }

    // Clean up
    await this.projectService.deleteProject(project.id, testProject.userId)
  }

  async testProjectRetrieval() {
    const userId = 'test-user-id'
    
    // Create a test project
    const testProject = await this.projectService.createProject({
      name: `Test Retrieval ${Date.now()}`,
      description: 'Test project for retrieval',
      userId
    })

    // Test getting user projects
    const userProjects = await this.projectService.getUserProjects(userId)
    const foundProject = userProjects.find(p => p.id === testProject.id)
    
    if (!foundProject) {
      throw new Error('Created project not found in user projects list')
    }

    // Test getting specific project
    const specificProject = await this.projectService.getProject(testProject.id, userId)
    
    if (specificProject.id !== testProject.id) {
      throw new Error('Retrieved project ID does not match')
    }

    // Clean up
    await this.projectService.deleteProject(testProject.id, userId)
  }

  async testProjectDeletion() {
    const userId = 'test-user-id'
    
    // Create a test project
    const testProject = await this.projectService.createProject({
      name: `Test Deletion ${Date.now()}`,
      description: 'Test project for deletion',
      userId
    })

    // Delete the project
    await this.projectService.deleteProject(testProject.id, userId)

    // Verify deletion
    try {
      await this.projectService.getProject(testProject.id, userId)
      throw new Error('Project still exists after deletion')
    } catch (error) {
      if (!error.message.includes('not found')) {
        throw error
      }
      // Expected error - project should not be found
    }
  }

  async testProjectPermissions() {
    const userId1 = 'test-user-1'
    const userId2 = 'test-user-2'
    
    // Create project as user 1
    const testProject = await this.projectService.createProject({
      name: `Test Permissions ${Date.now()}`,
      description: 'Test project for permissions',
      userId: userId1
    })

    // Try to access as user 2 (should fail)
    try {
      await this.projectService.getProject(testProject.id, userId2)
      throw new Error('User 2 should not have access to user 1 project')
    } catch (error) {
      if (!error.message.includes('not found')) {
        throw error
      }
      // Expected error
    }

    // Clean up
    await this.projectService.deleteProject(testProject.id, userId1)
  }

  // ==================== USER MANAGEMENT TESTS ====================

  async testUserOperations() {
    const testUser = {
      username: `testuser_${Date.now()}`,
      password: 'testpassword123',
      email: `test_${Date.now()}@example.com`
    }

    try {
      // Create user
      const createdUser = await this.userService.createUser(testUser)
      
      if (!createdUser.id || createdUser.username !== testUser.username) {
        throw new Error('User creation failed or returned invalid data')
      }

      // Verify user exists
      const foundUser = await this.userService.findByUsername(testUser.username)
      
      if (foundUser.username !== testUser.username) {
        throw new Error('Created user not found by username')
      }

      // Test password verification
      const isValid = await this.userService.verifyPassword(testUser.username, testUser.password)
      
      if (!isValid) {
        throw new Error('Password verification failed for created user')
      }

      // Clean up - delete user
      await this.userService.deleteUser(createdUser.id)

    } catch (error) {
      // Try to clean up in case of partial creation
      try {
        const user = await this.userService.findByUsername(testUser.username)
        if (user) {
          await this.userService.deleteUser(user.id)
        }
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
      throw error
    }
  }

  // ==================== ERROR HANDLING TESTS ====================

  async testDatabaseErrorHandling() {
    // Test invalid SQL query
    try {
      const client = await this.db.pool.connect()
      await client.query('SELECT * FROM nonexistent_table')
      client.release()
      throw new Error('Query should have failed')
    } catch (error) {
      if (!error.message.includes('relation "nonexistent_table" does not exist')) {
        throw new Error(`Unexpected error: ${error.message}`)
      }
      // Expected error
    }

    // Test duplicate project name (if enforced)
    const userId = 'test-user-id'
    const projectName = `Duplicate Test ${Date.now()}`
    
    const project1 = await this.projectService.createProject({
      name: projectName,
      description: 'First project',
      userId
    })

    try {
      // This might or might not fail depending on constraints
      await this.projectService.createProject({
        name: projectName,
        description: 'Second project',
        userId
      })
      this.log('Duplicate project names allowed', 'warning')
    } catch (error) {
      this.log('Duplicate project names properly rejected', 'info')
    }

    // Clean up
    await this.projectService.deleteProject(project1.id, userId)
  }

  // ==================== MAIN TEST RUNNER ====================

  async run() {
    this.log('Starting Database Integration Tests', 'info')
    
    try {
      // Basic connectivity tests
      await this.runTest('Database Connection', () => this.testDatabaseConnection())
      await this.runTest('Database Schema', () => this.testDatabaseSchema())
      
      // Project management tests
      await this.runTest('Project Creation', () => this.testProjectCreation())
      await this.runTest('Project Retrieval', () => this.testProjectRetrieval())
      await this.runTest('Project Deletion', () => this.testProjectDeletion())
      await this.runTest('Project Permissions', () => this.testProjectPermissions())
      
      // User management tests
      await this.runTest('User Operations', () => this.testUserOperations())
      
      // Error handling tests
      await this.runTest('Database Error Handling', () => this.testDatabaseErrorHandling())
      
    } catch (error) {
      this.log(`Test suite failed: ${error.message}`, 'error')
    }

    this.printResults()
  }

  printResults() {
    console.log('\n' + '='.repeat(50))
    console.log('📊 DATABASE TEST RESULTS')
    console.log('='.repeat(50))
    console.log(`✅ Passed: ${this.results.passed}`)
    console.log(`❌ Failed: ${this.results.failed}`)
    console.log('')

    if (this.results.tests.length > 0) {
      this.results.tests.forEach(test => {
        const status = test.status === 'passed' ? '✅' : '❌'
        console.log(`  ${status} ${test.name} (${test.duration}ms)`)
        if (test.error) {
          console.log(`      Error: ${test.error}`)
        }
      })
    }

    if (this.results.failed > 0) {
      process.exit(1)
    }
  }
}

// Check if this file is being run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tests = new DatabaseTests()
  tests.run().catch(error => {
    console.error('❌ Database tests failed:', error.message)
    process.exit(1)
  })
}

export { DatabaseTests }
