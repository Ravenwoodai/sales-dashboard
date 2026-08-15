param(
  [Parameter(Mandatory = $true)]
  [string]$Recipient,

  [Parameter(Mandatory = $true)]
  [string]$Subject,

  [Parameter(Mandatory = $true)]
  [string]$Body,

  [Parameter(Mandatory = $true)]
  [string]$Attachments
)

$ErrorActionPreference = 'Stop'
$attachmentPaths = @($Attachments -split ';' | Where-Object { $_.Trim() } | ForEach-Object {
  [System.IO.Path]::GetFullPath($_.Trim())
})

if ($attachmentPaths.Count -eq 0) {
  throw 'At least one attachment is required.'
}

foreach ($attachmentPath in $attachmentPaths) {
  if (-not (Test-Path -LiteralPath $attachmentPath -PathType Leaf)) {
    throw "Email attachment is missing: $attachmentPath"
  }
}

$outlook = New-Object -ComObject Outlook.Application
$mail = $outlook.CreateItem(0)
$mail.To = $Recipient
$mail.Subject = $Subject
$mail.Body = $Body
foreach ($attachmentPath in $attachmentPaths) {
  [void]$mail.Attachments.Add($attachmentPath)
}
$mail.Send()

[pscustomobject]@{
  Status = 'sent'
  Recipient = $Recipient
  Attachments = $attachmentPaths.Count
} | ConvertTo-Json -Compress
