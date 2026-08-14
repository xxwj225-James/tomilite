#!/bin/bash
# TomiLite — One-command startup
set -e

echo "Starting TomiLite..."

# 1. Setup database
echo "[1/3] Setting up database..."
cd packages/database
npx prisma db push --skip-generate 2>/dev/null || npx prisma db push --skip-generate
npx prisma generate
npx tsx src/seed.ts 2>/dev/null || echo "Seed skipped (data exists)"
cd ../..

# 2. Start API server (background)
echo "[2/3] Starting API server on :3001..."
npx tsx apps/api/src/server.ts &
API_PID=$!
sleep 2

# 3. Start web frontend
echo "[3/3] Starting web frontend on :3002..."
cd apps/web
npx vite --port 3002 &
WEB_PID=$!
cd ../..

echo ""
echo "TomiLite is running!"
echo "   Web:    http://localhost:3002"
echo "   API:    http://localhost:3001/api"
echo ""
echo "Press Ctrl+C to stop all services."

trap "kill $API_PID $WEB_PID 2>/dev/null; exit" INT TERM
wait
