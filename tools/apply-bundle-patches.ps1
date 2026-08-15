# apply-bundle-patches.ps1
#
# Applies (or re-applies after a DeepSeek Harness update) the companion
# patches to the INSTALLED @deepseek-ai/dsh-client-ui-conversation client
# bundle that dsh-cost-meter needs:
#
#   B. ContextMeter accepts `renderSlot` from InputBar.
#   C. ContextMeter's click-open panel renders a new child slot
#      `conversation.context.detail` (where dsh-cost-meter puts the session
#      detail: stats, token buckets, CNY cost).
#   D. InputBar passes `renderSlot` into ContextMeter.
#   E. InputBar's registration declares the `conversation.context.detail`
#      child slot.
#   (A. also reverts the obsolete `rightItems` reordering from an earlier
#      iteration, if present.)
#
# The bundle is located through the profile node_modules junction under
# %DSH_HOME% (falls back to %USERPROFILE%\.dsh), so no hardcoded install
# path is needed. Idempotent: patches already present are skipped; a changed
# bundle shape fails loud with "pattern not found".
#
# Usage: powershell -File apply-bundle-patches.ps1

$ErrorActionPreference = "Stop"

$homeDir = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE ".dsh" }
$f = Join-Path $homeDir "profiles\node_modules\@deepseek-ai\dsh-client-ui-conversation\lib\client.js"
if (-not (Test-Path $f)) {
  # Direct host install fallback (exact path contains CJK on this machine).
  $candidate = "D:\常用工具\DeepSeek Harness\resources\host\node_modules\@deepseek-ai\dsh-client-ui-conversation\lib\client.js"
  if (Test-Path $candidate) { $f = $candidate } else { Write-Error "bundle not found (tried $homeDir and the host install)"; exit 1 }
}

$raw = [System.IO.File]::ReadAllText($f)
$tab = [string][char]9; $lf = [string][char]10
$t4 = $tab * 4; $t5 = $tab * 5; $t6 = $tab * 6; $t10 = $tab * 10
$changed = $false

# ── A) revert the obsolete rightItems reorder (if present) ──────────────────
$A_old = $t10 + 'renderSlot("conversation.input.model", { locked: modelSeatLocked }),' + $lf + 'rightItems,' + $lf + $t10 + '(0, react_jsx_runtime.jsx)(ContextMeter, {'
$A_new = $t10 + 'rightItems,' + $lf + $t10 + 'renderSlot("conversation.input.model", { locked: modelSeatLocked }),' + $lf + $t10 + '(0, react_jsx_runtime.jsx)(ContextMeter, {'
if ($raw.Contains($A_old)) { $raw = $raw.Replace($A_old, $A_new); $changed = $true; Write-Output "A) reverted obsolete rightItems reorder" }

# ── B) ContextMeter signature ───────────────────────────────────────────────
$B = 'function ContextMeter({ useProjection, t }) {'
if ($raw.Contains($B)) {
  $raw = $raw.Replace($B, 'function ContextMeter({ renderSlot, useProjection, t }) {'); $changed = $true; Write-Output "B) ContextMeter signature patched"
} elseif (-not $raw.Contains('function ContextMeter({ renderSlot, useProjection, t }) {')) { Write-Output "B) pattern not found"; exit 1 }

# ── C) panel close: insert the detail slot render ───────────────────────────
$reC = [regex]'\}, row\.key\)\)[ \t]*\r?\n[ \t]*\}\)[ \t]*\r?\n([ \t]*)\]'
if (-not $raw.Contains('renderSlot("conversation.context.detail", {})')) {
  $mC = $reC.Matches($raw)
  if ($mC.Count -ne 1) { Write-Output "C) pattern not found ($($mC.Count) matches)"; exit 1 }
  $indC = $mC[0].Groups[1].Value
  $raw = $reC.Replace($raw, {
    param($m)
    $m.Value.Replace('})' + $lf + $indC + ']', '}),' + $lf + $indC + 'renderSlot("conversation.context.detail", {})' + $lf + $indC + ']')
  }, 1)
  $changed = $true; Write-Output "C) context.detail slot render inserted"
}

# ── D) InputBar call site passes renderSlot into ContextMeter ───────────────
if (-not ($raw -match 'ContextMeter, \{\r?\n[ \t]*useProjection,\r?\n[ \t]*renderSlot,\r?\n[ \t]*t')) {
  $reD = [regex]'(\(0, react_jsx_runtime\.jsx\)\(ContextMeter, \{\r?\n[ \t]*)useProjection,(\r?\n[ \t]*)t(\r?\n[ \t]*\}\)),'
  $mD = $reD.Matches($raw)
  if ($mD.Count -ne 1) { Write-Output "D) pattern not found ($($mD.Count) matches)"; exit 1 }
  $raw = $reD.Replace($raw, {
    param($m)
    $m.Groups[1].Value + 'useProjection,' + $m.Groups[2].Value + 'renderSlot,' + $m.Groups[2].Value + 't' + $m.Groups[3].Value + ','
  }, 1)
  $changed = $true; Write-Output "D) InputBar call site patched"
}

# ── E) InputBar registration declares the detail child slot ─────────────────
$eOld = $t5 + '"conversation.input.model": {' + $lf + $t6 + 'kind: "single",' + $lf + $t6 + 'scope: "session"' + $lf + $t5 + '}' + $lf + $t4 + '},'
$eNew = $t5 + '"conversation.input.model": {' + $lf + $t6 + 'kind: "single",' + $lf + $t6 + 'scope: "session"' + $lf + $t5 + '},' + $lf + $t5 + '"conversation.context.detail": {' + $lf + $t6 + 'kind: "single",' + $lf + $t6 + 'scope: "session"' + $lf + $t5 + '}' + $lf + $t4 + '},'
if ($raw.Contains($eOld)) {
  $raw = $raw.Replace($eOld, $eNew); $changed = $true; Write-Output "E) context.detail child slot declared"
} elseif (-not $raw.Contains('"conversation.context.detail": {')) { Write-Output "E) pattern not found"; exit 1 }

if ($changed) {
  [System.IO.File]::WriteAllText($f, $raw, (New-Object System.Text.UTF8Encoding($false)))
  Write-Output "bundle patched"
} else {
  Write-Output "all patches already applied - nothing to do"
}
node --check $f
if ($LASTEXITCODE -eq 0) { Write-Output "syntax OK" }
