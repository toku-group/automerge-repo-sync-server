#!/usr/bin/env node
// Simple test to check if server starts without .env
import { Server } from "./src/server.js"

// Clear environment variables that might cause issues
delete process.env.USE_R2_STORAGE
delete process.env.R2_ACCOUNT_ID
delete process.env.R2_ACCESS_KEY_ID
delete process.env.R2_SECRET_ACCESS_KEY
delete process.env.R2_BUCKET_NAME
delete process.env.R2_PREFIX

process.env.PORT = "3031"
process.env.DATA_DIR = "./test-data"

const server = new Server()

await server.ready()
console.log("Server started successfully!")

server.close()
console.log("Server closed successfully!")
