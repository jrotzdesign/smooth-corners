@echo off
REM Removes the Smooth Corners panel. Leaves PlayerDebugMode alone.
if exist "%APPDATA%\Adobe\CEP\extensions\com.jro.smoothcorners" rmdir /s /q "%APPDATA%\Adobe\CEP\extensions\com.jro.smoothcorners"
echo Smooth Corners removed. Restart Illustrator.
pause
