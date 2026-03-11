@echo off
echo Iniciando Sistema del Campeonato...

node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ADVERTENCIA] Node.js no esta instalado o no se encuentra en el PATH.
    echo Intentando abrir el sitio directamente...
    start index.html
    echo Pulsa cualquier tecla para salir.
    pause >nul
    exit
)

echo Iniciando servidor local...
start http://localhost:3000
node server.js
pause
