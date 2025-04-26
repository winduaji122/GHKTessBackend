@echo off
echo Running backend in production mode locally...
set NODE_ENV=production
set PORT=5000
node start.js
