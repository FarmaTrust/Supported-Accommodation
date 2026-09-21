<?php

declare(strict_types=1);

namespace App\Support;

use FPDF;

/**
 * A thin layer over FPDF that takes pdf-lib's coordinates.
 *
 * The Node renderers place everything by absolute position with the origin at
 * the bottom-left of the page. FPDF puts its origin at the top-left. Rather
 * than recompute every coordinate by hand — which is exactly how a total ends
 * up printed over a line on an invoice sent to a local authority — the flip
 * happens here, once, and the layout code stays readable beside the original.
 *
 * Page size is A4 in points, which is the 595.28 x 841.89 the Node side uses.
 */
final class Pdf
{
    public const WIDTH = 595.28;
    public const HEIGHT = 841.89;

    private FPDF $pdf;

    public function __construct()
    {
        $this->pdf = new FPDF('P', 'pt', 'A4');
        $this->pdf->SetAutoPageBreak(false);
        $this->pdf->SetMargins(0, 0, 0);
        $this->addPage();
    }

    public function addPage(): void
    {
        $this->pdf->AddPage();
    }

    /**
     * @param array{0: float, 1: float, 2: float} $colour 0..1 per channel, as pdf-lib's rgb()
     */
    public function text(string $value, float $x, float $y, float $size = 10, array $colour = [0.08, 0.1, 0.13], bool $bold = false): void
    {
        $this->pdf->SetFont('Helvetica', $bold ? 'B' : '', $size);
        $this->pdf->SetTextColor(...self::toBytes($colour));
        // pdf-lib's y is the text baseline, and so is FPDF's Text().
        $this->pdf->Text($x, self::HEIGHT - $y, self::latin($value));
    }

    /** @param array{0: float, 1: float, 2: float} $colour */
    public function rect(float $x, float $y, float $width, float $height, array $colour): void
    {
        $this->pdf->SetFillColor(...self::toBytes($colour));
        // pdf-lib grows a rectangle upward from (x, y); FPDF draws down from its
        // top edge, so the top is y + height flipped.
        $this->pdf->Rect($x, self::HEIGHT - ($y + $height), $width, $height, 'F');
    }

    /** @param array{0: float, 1: float, 2: float} $colour */
    public function line(float $x1, float $y1, float $x2, float $y2, float $thickness, array $colour): void
    {
        $this->pdf->SetLineWidth($thickness);
        $this->pdf->SetDrawColor(...self::toBytes($colour));
        $this->pdf->Line($x1, self::HEIGHT - $y1, $x2, self::HEIGHT - $y2);
    }

    public function output(): string
    {
        return $this->pdf->Output('S');
    }

    /** Wraps on whole words to a character width, as the Node renderer does. */
    public static function wrap(string $value, int $width = 72): array
    {
        $lines = [];
        $current = '';

        foreach (preg_split('/\s+/', trim($value)) ?: [] as $word) {
            if ($word === '') {
                continue;
            }
            if (strlen(trim("$current $word")) > $width) {
                if ($current !== '') {
                    $lines[] = $current;
                }
                $current = $word;
            } else {
                $current = trim("$current $word");
            }
        }

        if ($current !== '') {
            $lines[] = $current;
        }

        return $lines;
    }

    public static function money(float $value): string
    {
        return '£' . number_format($value, 2, '.', '');
    }

    public static function date(?int $millis): string
    {
        if ($millis === null) {
            return '—';
        }

        return (Dates::fromMillis($millis)?->format('d/m/Y')) ?? '—';
    }

    /**
     * FPDF's core fonts are single-byte, so the text is converted rather than
     * dropped. A pound sign and an em dash both appear in these documents.
     */
    private static function latin(string $value): string
    {
        $converted = @iconv('UTF-8', 'windows-1252//TRANSLIT', $value);

        return $converted === false ? $value : $converted;
    }

    /**
     * @param array{0: float, 1: float, 2: float} $colour
     * @return array{0: int, 1: int, 2: int}
     */
    private static function toBytes(array $colour): array
    {
        return [
            (int) round($colour[0] * 255),
            (int) round($colour[1] * 255),
            (int) round($colour[2] * 255),
        ];
    }
}
