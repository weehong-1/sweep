# Draws the Sweep icon (a broom on a teal tile) at each size the manifests need.
param([string]$OutDir = (Join-Path $PSScriptRoot '..\src\icons'))

Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force $OutDir | Out-Null

foreach ($size in 16, 32, 48, 128) {
    $bmp = [System.Drawing.Bitmap]::new($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.Clear([System.Drawing.Color]::Transparent)

    # Rounded tile
    $r = [single]($size * 0.22)
    $d = $r * 2
    $max = [single]($size - $d)
    $tile = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $tile.AddArc(0, 0, $d, $d, 180, 90)
    $tile.AddArc($max, 0, $d, $d, 270, 90)
    $tile.AddArc($max, $max, $d, $d, 0, 90)
    $tile.AddArc(0, $max, $d, $d, 90, 90)
    $tile.CloseFigure()
    $teal = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(15, 118, 110))
    $g.FillPath($teal, $tile)

    # Broom handle
    $white = [System.Drawing.Color]::White
    $pen = [System.Drawing.Pen]::new($white, [single]($size * 0.1))
    $pen.StartCap = 'Round'
    $pen.EndCap = 'Round'
    $g.DrawLine($pen, [single]($size * 0.74), [single]($size * 0.18), [single]($size * 0.50), [single]($size * 0.50))

    # Broom head
    $head = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new($size * 0.36, $size * 0.40),
        [System.Drawing.PointF]::new($size * 0.62, $size * 0.60),
        [System.Drawing.PointF]::new($size * 0.46, $size * 0.86),
        [System.Drawing.PointF]::new($size * 0.14, $size * 0.62)
    )
    $g.FillPolygon([System.Drawing.SolidBrush]::new($white), $head)

    $g.Dispose()
    $bmp.Save((Join-Path $OutDir "$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}
"Icons written to $OutDir"
