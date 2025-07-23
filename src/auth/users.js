import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

/**
 * Simple user management system for JWT authentication
 * In production, this should be replaced with a proper database
 */

const USERS_FILE = process.env.USERS_FILE || './data/users.json'
const DEFAULT_ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123'

// Ensure users directory exists
const usersDir = path.dirname(USERS_FILE)
if (!fs.existsSync(usersDir)) {
  fs.mkdirSync(usersDir, { recursive: true })
}

/**
 * Hash a password with salt
 * @param {string} password - Plain text password
 * @returns {Object} Hash and salt
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(32).toString('hex')
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex')
  return { hash, salt }
}

/**
 * Verify a password against hash and salt
 * @param {string} password - Plain text password
 * @param {string} hash - Stored hash
 * @param {string} salt - Stored salt
 * @returns {boolean} True if password matches
 */
function verifyPassword(password, hash, salt) {
  const verifyHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex')
  return hash === verifyHash
}

/**
 * Load users from file
 * @returns {Object} Users object
 */
function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = fs.readFileSync(USERS_FILE, 'utf8')
      return JSON.parse(data)
    }
  } catch (error) {
    console.warn('Error loading users file:', error.message)
  }
  
  return {}
}

/**
 * Save users to file
 * @param {Object} users - Users object
 */
function saveUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2))
  } catch (error) {
    console.error('Error saving users file:', error.message)
    throw error
  }
}

/**
 * Initialize user system with default admin user
 */
export function initializeUsers() {
  const users = loadUsers()
  
  // Create default admin user if no users exist
  if (Object.keys(users).length === 0) {
    console.log('No users found. Creating default admin user...')
    
    const { hash, salt } = hashPassword(DEFAULT_ADMIN_PASSWORD)
    
    users.admin = {
      id: 'admin',
      username: 'admin',
      passwordHash: hash,
      passwordSalt: salt,
      permissions: ['admin', 'read', 'write', 'delete'],
      createdAt: new Date().toISOString(),
      lastLogin: null
    }
    
    saveUsers(users)
    
    console.log('✅ Default admin user created')
    console.log(`Username: admin`)
    console.log(`Password: ${DEFAULT_ADMIN_PASSWORD}`)
    console.log('⚠️  Please change the default password after first login!')
  }
  
  return users
}

/**
 * Authenticate user with username and password
 * @param {string} username - Username
 * @param {string} password - Password
 * @returns {Object|null} User object (without password) or null if authentication fails
 */
export function authenticateUser(username, password) {
  const users = loadUsers()
  const user = users[username]
  
  if (!user) {
    return null
  }
  
  if (!verifyPassword(password, user.passwordHash, user.passwordSalt)) {
    return null
  }
  
  // Update last login
  user.lastLogin = new Date().toISOString()
  saveUsers(users)
  
  // Return user without password info
  const { passwordHash, passwordSalt, ...userInfo } = user
  return userInfo
}

/**
 * Create a new user
 * @param {Object} userData - User data
 * @param {string} userData.username - Username
 * @param {string} userData.password - Password
 * @param {string[]} [userData.permissions] - User permissions
 * @returns {Object} Created user (without password)
 */
export function createUser({ username, password, permissions = ['read', 'write'] }) {
  const users = loadUsers()
  
  if (users[username]) {
    throw new Error('User already exists')
  }
  
  if (!username || username.length < 3) {
    throw new Error('Username must be at least 3 characters long')
  }
  
  if (!password || password.length < 6) {
    throw new Error('Password must be at least 6 characters long')
  }
  
  const { hash, salt } = hashPassword(password)
  
  const user = {
    id: username,
    username,
    passwordHash: hash,
    passwordSalt: salt,
    permissions,
    createdAt: new Date().toISOString(),
    lastLogin: null
  }
  
  users[username] = user
  saveUsers(users)
  
  // Return user without password info
  const { passwordHash, passwordSalt, ...userInfo } = user
  return userInfo
}

/**
 * Get user by username
 * @param {string} username - Username
 * @returns {Object|null} User object (without password) or null if not found
 */
export function getUser(username) {
  const users = loadUsers()
  const user = users[username]
  
  if (!user) {
    return null
  }
  
  const { passwordHash, passwordSalt, ...userInfo } = user
  return userInfo
}

/**
 * Get all users
 * @returns {Object[]} Array of user objects (without passwords)
 */
export function getAllUsers() {
  const users = loadUsers()
  
  return Object.values(users).map(user => {
    const { passwordHash, passwordSalt, ...userInfo } = user
    return userInfo
  })
}

/**
 * Update user password
 * @param {string} username - Username
 * @param {string} currentPassword - Current password
 * @param {string} newPassword - New password
 * @returns {boolean} True if password updated successfully
 */
export function updatePassword(username, currentPassword, newPassword) {
  const users = loadUsers()
  const user = users[username]
  
  if (!user) {
    return false
  }
  
  if (!verifyPassword(currentPassword, user.passwordHash, user.passwordSalt)) {
    return false
  }
  
  if (!newPassword || newPassword.length < 6) {
    throw new Error('New password must be at least 6 characters long')
  }
  
  const { hash, salt } = hashPassword(newPassword)
  user.passwordHash = hash
  user.passwordSalt = salt
  
  saveUsers(users)
  return true
}

/**
 * Delete user
 * @param {string} username - Username to delete
 * @returns {boolean} True if user deleted successfully
 */
export function deleteUser(username) {
  if (username === 'admin') {
    throw new Error('Cannot delete admin user')
  }
  
  const users = loadUsers()
  
  if (!users[username]) {
    return false
  }
  
  delete users[username]
  saveUsers(users)
  return true
}
