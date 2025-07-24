#!/usr/bin/env node

/**
 * PostgreSQL Database Check Script
 * Verifies if user data is being stored in PostgreSQL
 */

import pkg from 'pg'
const { Client } = pkg

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@postgres:5432/automerge_sync'

async function checkDatabase() {
  console.log('🔍 Checking PostgreSQL database for user data...\n')
  
  const client = new Client({
    connectionString: DATABASE_URL
  })

  try {
    await client.connect()
    console.log('✅ Connected to PostgreSQL database')
    
    // Check if tables exist
    console.log('\n📋 Checking database tables...')
    const tablesResult = await client.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY tablename
    `)
    
    if (tablesResult.rows.length === 0) {
      console.log('❌ No tables found in database')
      return
    }
    
    console.log('✅ Found tables:')
    tablesResult.rows.forEach(row => {
      console.log(`   - ${row.tablename}`)
    })
    
    // Check users table
    console.log('\n👥 Checking users table...')
    try {
      const usersResult = await client.query('SELECT COUNT(*) as count FROM users')
      const userCount = parseInt(usersResult.rows[0].count)
      console.log(`✅ Users table exists with ${userCount} users`)
      
      if (userCount > 0) {
        // Get some user details (without sensitive data)
        const usersData = await client.query(`
          SELECT id, username, email, permissions, is_active, created_at, last_login 
          FROM users 
          ORDER BY created_at DESC 
          LIMIT 5
        `)
        
        console.log('\n📊 Recent users:')
        usersData.rows.forEach(user => {
          console.log(`   - ${user.username} (${user.email || 'no email'}) - Active: ${user.is_active}`)
          console.log(`     Created: ${user.created_at}`)
          console.log(`     Last Login: ${user.last_login || 'Never'}`)
          console.log(`     Permissions: [${user.permissions.join(', ')}]`)
          console.log()
        })
      }
    } catch (error) {
      console.log('❌ Users table does not exist or has issues:', error.message)
    }
    
    // Check refresh_tokens table
    console.log('\n🔑 Checking refresh_tokens table...')
    try {
      const tokensResult = await client.query('SELECT COUNT(*) as count FROM refresh_tokens')
      const tokenCount = parseInt(tokensResult.rows[0].count)
      console.log(`✅ Refresh tokens table exists with ${tokenCount} tokens`)
      
      if (tokenCount > 0) {
        const activeTokens = await client.query(`
          SELECT COUNT(*) as count 
          FROM refresh_tokens 
          WHERE expires_at > NOW() AND revoked_at IS NULL
        `)
        console.log(`   - Active tokens: ${activeTokens.rows[0].count}`)
      }
    } catch (error) {
      console.log('❌ Refresh tokens table does not exist:', error.message)
    }
    
    // Check auth_audit_log table
    console.log('\n📝 Checking auth_audit_log table...')
    try {
      const auditResult = await client.query('SELECT COUNT(*) as count FROM auth_audit_log')
      const auditCount = parseInt(auditResult.rows[0].count)
      console.log(`✅ Auth audit log table exists with ${auditCount} entries`)
      
      if (auditCount > 0) {
        const recentAudit = await client.query(`
          SELECT action, success, username, ip_address, created_at 
          FROM auth_audit_log 
          ORDER BY created_at DESC 
          LIMIT 5
        `)
        
        console.log('\n📋 Recent authentication events:')
        recentAudit.rows.forEach(event => {
          const status = event.success ? '✅' : '❌'
          console.log(`   ${status} ${event.action} - ${event.username || 'unknown'} (${event.ip_address || 'no IP'})`)
          console.log(`      ${event.created_at}`)
        })
      }
    } catch (error) {
      console.log('❌ Auth audit log table does not exist:', error.message)
    }
    
  } catch (error) {
    console.error('❌ Database connection failed:', error.message)
  } finally {
    await client.end()
  }
}

checkDatabase()
  .then(() => {
    console.log('\n🏁 Database check completed')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n💥 Database check failed:', error.message)
    process.exit(1)
  })
