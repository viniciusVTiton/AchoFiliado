# Desliga o AchoFiliado (o guardiao e o servidor). Ele volta a ligar no proximo login do Windows.
$here = $PSScriptRoot
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -like '*robo.ps1*' -and $_.CommandLine -notlike '*parar-robo*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like "*$here\server.js*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Host 'AchoFiliado desligado.'
