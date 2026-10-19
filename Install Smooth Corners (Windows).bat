@echo off
REM Smooth Corners - Windows installer for Illustrator 2024 / 2025 / 2026
setlocal
set EXT_ID=com.jro.smoothcorners
set DEST=%APPDATA%\Adobe\CEP\extensions
echo.
echo   Smooth Corners - installer
echo.
if not exist "%DEST%" mkdir "%DEST%"
if exist "%DEST%\%EXT_ID%" rmdir /s /q "%DEST%\%EXT_ID%"
xcopy /e /i /y "%~dp0cep\%EXT_ID%" "%DEST%\%EXT_ID%" >nul
echo   Panel installed to %DEST%\%EXT_ID%
for %%v in (9 10 11 12 13 14) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
echo   PlayerDebugMode enabled
echo.
echo   Restart Illustrator, then Window ^> Extensions ^> Smooth Corners.
echo   The dialog version: File ^> Scripts ^> Other Script... ^> SmoothCorners.jsx
pause
