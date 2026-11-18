@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [로컬 시뮬레이터 체험 전용 팝업 실행 — 실제 개인정보 입력 금지]
node scripts\open-popup-app.mjs --demo --with-mobile

