@echo off
set PATH=C:\nvm4w\nodejs;%PATH%
cd /d C:\Users\ocura\Documents\Dev\life-os
call npm install
call npm run deploy
