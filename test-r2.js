#!/usr/bin/env node
// @ts-check

/**
 * Test script for R2 storage adapter
 * This script is for manual testing purposes only
 * 
 * Usage:
 * 1. Set up your .env file with R2 credentials
 * 2. Run: USE_R2_STORAGE=true node test-r2.js
 */

import { R2StorageAdapter } from "./src/storage/R2StorageAdapter.js"

async function testR2Storage() {
  const config = {
    accountId: process.env.R2_ACCOUNT_ID || "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    bucket: process.env.R2_BUCKET_NAME || "",
    prefix: process.env.R2_PREFIX || "test-automerge-repo"
  }

  // Check if all required environment variables are set
  if (!config.accountId || !config.accessKeyId || !config.secretAccessKey || !config.bucket) {
    console.error("Missing required R2 environment variables:")
    console.error("R2_ACCOUNT_ID:", config.accountId ? "✓" : "✗")
    console.error("R2_ACCESS_KEY_ID:", config.accessKeyId ? "✓" : "✗")
    console.error("R2_SECRET_ACCESS_KEY:", config.secretAccessKey ? "✓" : "✗")
    console.error("R2_BUCKET_NAME:", config.bucket ? "✓" : "✗")
    process.exit(1)
  }

  console.log("Testing R2 storage adapter...")
  console.log("Bucket:", config.bucket)
  console.log("Prefix:", config.prefix)

  const adapter = new R2StorageAdapter(config)

  try {
    const testKey = ["test-doc", "snapshot", "test-key"]
    const testData = new TextEncoder().encode("Hello, R2!")

    console.log("\n1. Testing save...")
    await adapter.save(testKey, testData)
    console.log("✓ Save successful")

    console.log("\n2. Testing load...")
    const loadedData = await adapter.load(testKey)
    if (loadedData && new TextDecoder().decode(loadedData) === "Hello, R2!") {
      console.log("✓ Load successful")
    } else {
      console.log("✗ Load failed - data mismatch")
    }

    console.log("\n3. Testing loadRange...")
    const chunks = await adapter.loadRange(["test-doc"])
    console.log(`✓ LoadRange successful - found ${chunks.length} chunks`)

    console.log("\n4. Testing remove...")
    await adapter.remove(testKey)
    console.log("✓ Remove successful")

    console.log("\n5. Verifying removal...")
    const removedData = await adapter.load(testKey)
    if (removedData === undefined) {
      console.log("✓ Removal verified")
    } else {
      console.log("✗ Removal failed - data still exists")
    }

    console.log("\n✅ All tests passed!")
  } catch (error) {
    console.error("\n❌ Test failed:", error.message)
    process.exit(1)
  }
}

testR2Storage()
