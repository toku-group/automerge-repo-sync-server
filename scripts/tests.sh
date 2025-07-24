#!/bin/bash

# Start the server in background
npm run start & background_pid=$!

# Wait for server to start
sleep 5

# Run the consolidated test suite
npm run test:all
return_value=$?

# Stop the background server
kill -SIGTERM $background_pid

exit $return_value
