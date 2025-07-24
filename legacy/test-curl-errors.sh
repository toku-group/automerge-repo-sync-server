#!/bin/bash

echo "🧪 Testing enhanced database error handling with curl..."

# Get authentication token
echo "Getting authentication token..."
TOKEN_RESPONSE=$(curl -s -X POST "http://localhost:3030/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin234"}')

TOKEN=$(echo $TOKEN_RESPONSE | jq -r '.accessToken')

if [ "$TOKEN" = "null" ] || [ -z "$TOKEN" ]; then
  echo "❌ Failed to get authentication token"
  echo "Response: $TOKEN_RESPONSE"
  exit 1
fi

echo "✅ Got authentication token"
echo ""

# Test 1: Create a valid project
echo "Test 1: Create valid project"
RESPONSE1=$(curl -s -X POST "http://localhost:3030/api/projects" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Curl Test Project", "description": "Testing with curl"}' \
  -w "\nHTTP_CODE:%{http_code}")

HTTP_CODE1=$(echo "$RESPONSE1" | tail -1 | cut -d: -f2)
BODY1=$(echo "$RESPONSE1" | head -n -1)

echo "Status: $HTTP_CODE1"
echo "Response: $BODY1"
echo ""

# Test 2: Create duplicate project (should fail with 409)
echo "Test 2: Create duplicate project (should get 409 conflict)"
RESPONSE2=$(curl -s -X POST "http://localhost:3030/api/projects" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Curl Test Project", "description": "Duplicate project"}' \
  -w "\nHTTP_CODE:%{http_code}")

HTTP_CODE2=$(echo "$RESPONSE2" | tail -1 | cut -d: -f2)
BODY2=$(echo "$RESPONSE2" | head -n -1)

echo "Status: $HTTP_CODE2"
echo "Response: $BODY2"
echo ""

# Test 3: Get non-existent project (should get 404)
echo "Test 3: Get non-existent project (should get 404)"
RESPONSE3=$(curl -s -X GET "http://localhost:3030/api/project/00000000-0000-0000-0000-000000000000" \
  -H "Authorization: Bearer $TOKEN" \
  -w "\nHTTP_CODE:%{http_code}")

HTTP_CODE3=$(echo "$RESPONSE3" | tail -1 | cut -d: -f2)
BODY3=$(echo "$RESPONSE3" | head -n -1)

echo "Status: $HTTP_CODE3"
echo "Response: $BODY3"
echo ""

# Test 4: Invalid UUID format (should get 500 with database error details)
echo "Test 4: Invalid UUID format (should get 500 with error details)"
RESPONSE4=$(curl -s -X GET "http://localhost:3030/api/project/invalid-uuid" \
  -H "Authorization: Bearer $TOKEN" \
  -w "\nHTTP_CODE:%{http_code}")

HTTP_CODE4=$(echo "$RESPONSE4" | tail -1 | cut -d: -f2)
BODY4=$(echo "$RESPONSE4" | head -n -1)

echo "Status: $HTTP_CODE4"
echo "Response: $BODY4"
echo ""

# Test 5: Missing authentication (should get 401)
echo "Test 5: Missing authentication (should get 401)"
RESPONSE5=$(curl -s -X GET "http://localhost:3030/api/projects" \
  -w "\nHTTP_CODE:%{http_code}")

HTTP_CODE5=$(echo "$RESPONSE5" | tail -1 | cut -d: -f2)
BODY5=$(echo "$RESPONSE5" | head -n -1)

echo "Status: $HTTP_CODE5"
echo "Response: $BODY5"
echo ""

echo "✅ Enhanced error handling test completed!"

# Summary
echo ""
echo "📊 Test Summary:"
echo "  Test 1 (Create project): $HTTP_CODE1 (expected: 201)"
echo "  Test 2 (Duplicate): $HTTP_CODE2 (expected: 409)"
echo "  Test 3 (Not found): $HTTP_CODE3 (expected: 404)"
echo "  Test 4 (Invalid UUID): $HTTP_CODE4 (expected: 500 with details)"
echo "  Test 5 (No auth): $HTTP_CODE5 (expected: 401)"
