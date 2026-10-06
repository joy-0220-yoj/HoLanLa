param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot "..\web\icons")
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

# Original colour-swatch motif. Coordinates use a 512px canvas; its essential
# shapes remain inside the central 80% diameter maskable safe zone.
$iconColours = @("#91b4d8", "#f2d3a7", "#b6aad0", "#e8a692")
$iconPositions = @(@(112, 112), @(264, 112), @(112, 264), @(264, 264))
$iconStar = @(@(256, 192), @(272, 240), @(320, 256), @(272, 272),
    @(256, 320), @(240, 272), @(192, 256), @(240, 240))

function New-RoundedPath {
    param([single]$X, [single]$Y, [single]$Width, [single]$Height, [single]$Radius)
    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $diameter = $Radius * 2
    $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
    $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
    $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

function Write-PwaIcon {
    param([int]$Size)

    # Render larger, then downsample so small icons retain smooth edges.
    $renderSize = $Size * 4
    $bitmap = [System.Drawing.Bitmap]::new($renderSize, $renderSize)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $background = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
            [System.Drawing.Point]::new(0, 0), [System.Drawing.Point]::new($renderSize, $renderSize),
            [System.Drawing.ColorTranslator]::FromHtml("#1c438f"),
            [System.Drawing.ColorTranslator]::FromHtml("#122547")
        )
        try {
            $graphics.FillRectangle($background, 0, 0, $renderSize, $renderSize)
        } finally {
            $background.Dispose()
        }
        $scale = $renderSize / 512.0
        $graphics.ScaleTransform($scale, $scale)
        for ($index = 0; $index -lt $iconColours.Count; $index++) {
            $position = $iconPositions[$index]
            $shape = New-RoundedPath $position[0] $position[1] 136 136 40
            $brush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($iconColours[$index]))
            try {
                $graphics.FillPath($brush, $shape)
            } finally {
                $brush.Dispose()
                $shape.Dispose()
            }
        }
        $starPoints = [System.Drawing.PointF[]]@($iconStar | ForEach-Object {
            [System.Drawing.PointF]::new($_[0], $_[1])
        })
        $starBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
        try {
            $graphics.FillPolygon($starBrush, $starPoints)
        } finally {
            $starBrush.Dispose()
        }
        $output = [System.Drawing.Bitmap]::new($Size, $Size)
        $outputGraphics = [System.Drawing.Graphics]::FromImage($output)
        try {
            $outputGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $outputGraphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $outputGraphics.DrawImage($bitmap, 0, 0, $Size, $Size)
            $output.Save((Join-Path $OutputDirectory "icon-$Size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $outputGraphics.Dispose()
            $output.Dispose()
        }
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

$svgRects = for ($index = 0; $index -lt $iconColours.Count; $index++) {
    $position = $iconPositions[$index]
    "  <rect x=`"$($position[0])`" y=`"$($position[1])`" width=`"136`" height=`"136`" rx=`"40`" fill=`"$($iconColours[$index])`"/>"
}
$svgPoints = ($iconStar | ForEach-Object { "$_".Replace(" ", ",") }) -join " "
$svg = @"
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#1c438f"/>
      <stop offset="1" stop-color="#122547"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#background)"/>
$($svgRects -join "`n")
  <polygon points="$svgPoints" fill="#ffffff"/>
</svg>
"@
[System.IO.File]::WriteAllText((Join-Path $OutputDirectory "icon.svg"), $svg + "`n", [System.Text.UTF8Encoding]::new($false))
180, 192, 512 | ForEach-Object { Write-PwaIcon -Size $_ }
