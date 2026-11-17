# Mantem o AchoFiliado ligado: sobe o servidor e, se ele cair, sobe de novo.
# Roda escondido ao ligar o Windows (atalho na pasta Inicializar). Log em data\robo.log.
$ErrorActionPreference = 'Continue'
# O Node escreve em UTF-8; sem isso os acentos saem trocados no log.
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Set-Location -LiteralPath $PSScriptRoot

# Nunca dois robos ao mesmo tempo (o WhatsApp derrubaria um deles).
$mutex = New-Object System.Threading.Mutex($false, 'Local\AchoFiliadoRobo')
if (-not $mutex.WaitOne(0)) { exit 0 }

$node = Join-Path $env:ProgramFiles 'nodejs\node.exe'
$data = Join-Path $PSScriptRoot 'data'
$log = Join-Path $data 'robo.log'
New-Item -ItemType Directory -Force -Path $data | Out-Null

# Abre, escreve e fecha a cada linha: o log continua legivel enquanto o robo roda.
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Add-LogLine($line) { [System.IO.File]::AppendAllText($log, "$line`r`n", $utf8) }
function Write-Log($msg) { Add-LogLine "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg" }

while ($true) {
    # Log com no maximo ~5 MB (guarda o anterior como robo.old.log)
    if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 5MB) {
        Move-Item -LiteralPath $log -Destination (Join-Path $data 'robo.old.log') -Force
    }
    Write-Log 'Iniciando o servidor'
    & $node (Join-Path $PSScriptRoot 'server.js') 2>&1 | ForEach-Object { Add-LogLine "$_" }
    Write-Log "Servidor parou (codigo $LASTEXITCODE). Reiniciando em 10 segundos."
    Start-Sleep -Seconds 10
}
