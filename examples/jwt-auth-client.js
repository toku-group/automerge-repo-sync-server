#!/usr/bin/env node

/**
 * Example JWT Authentication Client for Automerge Sync Server
 * 
 * This script demonstrates how to:
 * 1. Login and get JWT tokens
 * 2. Use tokens to access protected API endpoints
 * 3. Refresh tokens when they expire
 * 4. Connect to WebSocket with authentication
 */

import fetch from 'node-fetch'
import WebSocket from 'ws'

const BASE_URL = process.env.SERVER_URL || 'http://localhost:3030'

class AuthClient {
  constructor(baseUrl = BASE_URL) {
    this.baseUrl = baseUrl
    this.accessToken = null
    this.refreshToken = null
    this.user = null
  }

  /**
   * Login with username and password
   */
  async login(username, password) {
    try {
      const response = await fetch(`${this.baseUrl}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Login failed')
      }

      const data = await response.json()
      this.accessToken = data.accessToken
      this.refreshToken = data.refreshToken
      this.user = data.user

      console.log('✅ Login successful')
      console.log(`User: ${this.user.username}`)
      console.log(`Permissions: ${this.user.permissions.join(', ')}`)
      
      return data
    } catch (error) {
      console.error('❌ Login failed:', error.message)
      throw error
    }
  }

  /**
   * Refresh access token
   */
  async refreshAccessToken() {
    if (!this.refreshToken) {
      throw new Error('No refresh token available')
    }

    try {
      const response = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ refreshToken: this.refreshToken })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Token refresh failed')
      }

      const data = await response.json()
      this.accessToken = data.accessToken

      console.log('✅ Token refreshed successfully')
      return data
    } catch (error) {
      console.error('❌ Token refresh failed:', error.message)
      throw error
    }
  }

  /**
   * Make authenticated API request
   */
  async apiRequest(endpoint, options = {}) {
    if (!this.accessToken) {
      throw new Error('Not authenticated. Call login() first.')
    }

    const url = `${this.baseUrl}${endpoint}`
    const headers = {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers
      })

      // Try to refresh token if it's expired
      if (response.status === 401 && this.refreshToken) {
        console.log('Token expired, attempting refresh...')
        await this.refreshAccessToken()
        
        // Retry the request with new token
        headers['Authorization'] = `Bearer ${this.accessToken}`
        const retryResponse = await fetch(url, {
          ...options,
          headers
        })
        
        if (!retryResponse.ok) {
          const error = await retryResponse.json()
          throw new Error(error.error || 'API request failed')
        }
        
        return await retryResponse.json()
      }

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'API request failed')
      }

      return await response.json()
    } catch (error) {
      console.error(`❌ API request failed (${endpoint}):`, error.message)
      throw error
    }
  }

  /**
   * Get current user info
   */
  async getCurrentUser() {
    return await this.apiRequest('/auth/me')
  }

  /**
   * List all projects
   */
  async getProjects() {
    return await this.apiRequest('/api/projects')
  }

  /**
   * Create a new project
   */
  async createProject(name, description) {
    return await this.apiRequest('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name, description })
    })
  }

  /**
   * Get specific project
   */
  async getProject(projectId) {
    return await this.apiRequest(`/api/project/${projectId}`)
  }

  /**
   * Delete a project
   */
  async deleteProject(projectId) {
    return await this.apiRequest(`/api/project/${projectId}`, {
      method: 'DELETE'
    })
  }

  /**
   * Connect to WebSocket with authentication
   */
  connectWebSocket() {
    if (!this.accessToken) {
      throw new Error('Not authenticated. Call login() first.')
    }

    const wsUrl = this.baseUrl.replace('http', 'ws')
    const ws = new WebSocket(`${wsUrl}?token=${this.accessToken}`)

    ws.on('open', () => {
      console.log('✅ WebSocket connected with authentication')
    })

    ws.on('message', (data) => {
      console.log('📨 WebSocket message:', data.toString())
    })

    ws.on('error', (error) => {
      console.error('❌ WebSocket error:', error.message)
    })

    ws.on('close', (code, reason) => {
      console.log(`🔌 WebSocket closed: ${code} ${reason}`)
    })

    return ws
  }
}

/**
 * Example usage
 */
async function example() {
  console.log('🚀 JWT Authentication Example\n')

  const client = new AuthClient()

  try {
    // 1. Login
    console.log('1. Logging in...')
    await client.login('admin', 'admin123')
    console.log()

    // 2. Get current user
    console.log('2. Getting current user info...')
    const user = await client.getCurrentUser()
    console.log('User info:', user)
    console.log()

    // 3. List projects
    console.log('3. Listing projects...')
    const projects = await client.getProjects()
    console.log(`Found ${projects.projects.length} projects`)
    console.log()

    // 4. Create a new project
    console.log('4. Creating a new project...')
    const newProject = await client.createProject('Test Project', 'Created via JWT API')
    console.log('Created project:', newProject.projectId)
    console.log()

    // 5. Get the created project
    console.log('5. Retrieving the created project...')
    const project = await client.getProject(newProject.projectId)
    console.log('Project name:', project.document.name)
    console.log()

    // 6. Connect to WebSocket
    console.log('6. Connecting to WebSocket...')
    const ws = client.connectWebSocket()
    
    // Close WebSocket after 2 seconds
    setTimeout(() => {
      ws.close()
      console.log()
      
      // 7. Clean up - delete the test project
      console.log('7. Cleaning up - deleting test project...')
      client.deleteProject(newProject.projectId)
        .then(() => {
          console.log('✅ Test project deleted')
          console.log('\n🎉 Example completed successfully!')
        })
        .catch(error => {
          console.error('❌ Failed to delete test project:', error.message)
        })
    }, 2000)

  } catch (error) {
    console.error('❌ Example failed:', error.message)
    process.exit(1)
  }
}

// Run example if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  example().catch(console.error)
}

export { AuthClient }
