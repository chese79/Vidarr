# Run in an elevated PowerShell. Keep access limited to the host's private LAN.
$ErrorActionPreference='Stop'
$name='Vidarr-LAN-3434-Private'
$rule=Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue
if(!$rule){
  $rule=New-NetFirewallRule -Name $name -DisplayName 'Vidarr LAN TCP 3434 (Private)' -Direction Inbound -Action Allow -Enabled True -Profile Private -Protocol TCP -LocalAddress 192.168.0.8 -LocalPort 3434 -RemoteAddress LocalSubnet -InterfaceAlias Ethernet -EdgeTraversalPolicy Block
}
$address=$rule | Get-NetFirewallAddressFilter
$port=$rule | Get-NetFirewallPortFilter
$interface=$rule | Get-NetFirewallInterfaceFilter
if([string]$rule.Profile -ne 'Private' -or [string]$rule.Direction -ne 'Inbound' -or [string]$rule.Action -ne 'Allow' -or [string]$rule.Enabled -ne 'True' -or [string]$address.LocalAddress -ne '192.168.0.8' -or [string]$address.RemoteAddress -ne 'LocalSubnet' -or [string]$port.LocalPort -ne '3434' -or [string]$port.Protocol -ne 'TCP' -or [string]$interface.InterfaceAlias -ne 'Ethernet'){
  throw 'Existing named firewall rule has unexpected scope; review it before continuing'
}
[pscustomobject]@{verified=$true;name=$name;profile=[string]$rule.Profile;localAddress=$address.LocalAddress;remoteAddress=$address.RemoteAddress;localPort=$port.LocalPort;interface=$interface.InterfaceAlias}|ConvertTo-Json -Compress
