@echo off
echo Starting backend server in production mode locally...
echo Using database: 127.0.0.1:3306/mydatabase
echo Using port: 5000

set NODE_ENV=production
set PORT=5000
node start.js

pause
