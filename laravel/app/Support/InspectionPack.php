<?php

declare(strict_types=1);

namespace App\Support;

use RuntimeException;
use ZipArchive;

/**
 * The controlled archive handed to an inspector, mirroring
 * server/services/inspectionPack.ts.
 *
 * A ZIP of approved quality reviews, their reviewed evidence and released
 * printable reports, with a PDF index in front of it. Two properties matter.
 * The index lists what is inside and deliberately reproduces none of the
 * narrative, because the index travels more widely than the bundle. And every
 * file is re-hashed as it is read: a source whose bytes no longer match the
 * hash recorded against them does not go into a pack presented as evidence.
 */
final class InspectionPack
{
    private const MAX_FILES = 250;

    private const MAX_PACK_BYTES = 104857600;

    private const MARGIN = 48.0;

    private const INK = [0.075, 0.09, 0.13];

    private const MUTED = [0.36, 0.4, 0.47];

    private const BLUE = [0.1, 0.32, 0.74];

    private const EDGE = [0.82, 0.85, 0.89];

    public static function fileName(int $jobId, int $generatedAt): string
    {
        return "inspection-pack-$jobId-" . gmdate('Y-m-d', intdiv($generatedAt, 1000)) . '.zip';
    }

    public static function contentHash(string $bytes): string
    {
        return hash('sha256', $bytes);
    }

    /**
     * @param array<int, array<string, mixed>> $reviews
     * @param array<int, array<string, mixed>> $files
     */
    public static function renderIndex(string $entityName, ?string $propertyName, int $generatedAt, array $reviews, array $files): string
    {
        $pdf = new Pdf();
        $right = Pdf::WIDTH - self::MARGIN;
        $width = $right - self::MARGIN;
        $y = 0.0;
        $pages = 1;

        $header = static function () use ($pdf, $entityName, &$y): void {
            $pdf->rect(0, Pdf::HEIGHT - 38, Pdf::WIDTH, 38, self::BLUE);
            $pdf->text(mb_substr($entityName, 0, 70), self::MARGIN, Pdf::HEIGHT - 24, 11, [1, 1, 1], true);
            $y = Pdf::HEIGHT - 62;
        };

        $newPage = static function () use ($pdf, $header, &$pages): void {
            $pdf->addPage();
            $pages++;
            $header();
        };

        $ensure = static function (float $height) use ($newPage, &$y): void {
            if ($y - $height < 66) {
                $newPage();
            }
        };

        $line = static function (string $value, float $size = 9, bool $bold = false, array $colour = self::INK) use ($pdf, &$y): void {
            $pdf->text($value, self::MARGIN, $y, $size, $colour, $bold);
            $y -= $size + 4;
        };

        $paragraph = static function (string $value, float $size = 9, bool $bold = false, array $colour = self::INK) use ($ensure, $line, $width): void {
            foreach (Pdf::wrap($value, (int) floor($width / ($size * 0.5))) as $part) {
                $ensure($size + 6);
                $line($part, $size, $bold, $colour);
            }
        };

        $section = static function (string $title) use ($pdf, $ensure, $width, &$y): void {
            $ensure(28);
            $pdf->rect(self::MARGIN, $y - 18, $width, 18, self::INK);
            $pdf->text(mb_strtoupper($title), self::MARGIN + 9, $y - 12, 7.7, [1, 1, 1], true);
            $y -= 27;
        };

        $header();
        $line('INSPECTION PACK INDEX', 18, true);
        $y -= 2;
        $paragraph('Controlled archive index for approved quality reviews, their reviewed evidence files, and released printable reports. The accompanying ZIP is the authoritative bundle; this index does not reproduce protected narratives.', 9.4, false, self::MUTED);
        $y -= 4;
        $pdf->rect(self::MARGIN, $y - 62, $width, 60, [0.9, 0.94, 1]);
        $y -= 15;
        $line('Scope: ' . ($propertyName ?? 'Authorised entity-wide inspection archive'), 8.5, true);
        $line('Created: ' . gmdate('d/m/Y, H:i:s', intdiv($generatedAt, 1000)) . ' UTC', 8.5);
        $line(sprintf('Included: %d approved quality review(s) · %d controlled file(s)', count($reviews), count($files)), 8.5);
        $y -= 8;

        $section('Approved quality reviews');
        if ($reviews === []) {
            $paragraph('No approved quality review report matched the selected authorised scope.', 8.7, false, self::MUTED);
        }
        foreach ($reviews as $review) {
            $ensure(38);
            $paragraph(sprintf('QSR-%d · %s · %s', $review['id'], $review['title'], $review['propertyName'] ?? 'Entity-wide'), 8.7, true);
            $paragraph(sprintf(
                '%s–%s · approved %s · %d reviewed evidence item(s)',
                Pdf::date($review['periodStart']),
                Pdf::date($review['periodEnd']),
                $review['approvedAt'] === null ? 'recorded approval' : Pdf::date($review['approvedAt']),
                $review['evidenceCount'],
            ), 8.2, false, self::MUTED);
            $y -= 3;
        }

        $section('Bundled files');
        if ($files === []) {
            $paragraph('No report or evidence file matched the selected authorised scope.', 8.7, false, self::MUTED);
        }
        foreach ($files as $file) {
            $ensure(32);
            $paragraph(str_replace('_', ' ', (string) $file['source']) . ' · ' . $file['title'], 8.6, true);
            $paragraph(sprintf(
                '%s · %s · %s%s',
                $file['fileName'],
                $file['mimeType'] ?? 'unknown type',
                $file['sizeBytes'] ? (int) ceil($file['sizeBytes'] / 1024) . ' KB' : 'size unavailable',
                $file['contentHash'] ? ' · SHA-256 ' . mb_substr((string) $file['contentHash'], 0, 16) . '…' : '',
            ), 7.8, false, self::MUTED);
            $y -= 2;
        }

        $ensure(22);
        $paragraph('Fictional TEST platform record. Access, generation and download are audited. Do not treat this bundle as real operational evidence.', 7.4, false, self::MUTED);

        // ponytail: the footer is drawn on the last page only. pdf-lib can go
        // back over finished pages to stamp "Page n of m"; FPDF cannot without
        // a page-alias pass, and an index is read as one document anyway.
        $pdf->line(self::MARGIN, 51, $right, 51, 0.5, self::EDGE);
        $pdf->text('Inspection pack index · controlled archive', self::MARGIN, 36, 7.2, self::MUTED);
        $pdf->text("Page $pages of $pages", $right - 52, 36, 7.2, self::MUTED);

        return $pdf->output();
    }

    /**
     * @param array<string, mixed> $manifest
     * @param array<int, array<string, mixed>> $reviews
     * @param array<int, array<string, mixed>> $files
     */
    public static function createZip(array $manifest, string $entityName, ?string $propertyName, array $reviews, array $files): string
    {
        if (count($files) > self::MAX_FILES) {
            throw new RuntimeException('Inspection pack file limit exceeded');
        }

        $declaredTotal = 0;
        foreach ($files as $file) {
            $declaredTotal += max(0, (int) ($file['sizeBytes'] ?? 0));
        }
        if ($declaredTotal > self::MAX_PACK_BYTES) {
            throw new RuntimeException('Inspection pack size limit exceeded');
        }

        $index = self::renderIndex($entityName, $propertyName, (int) $manifest['generatedAt'], $reviews, $files);

        $path = tempnam(sys_get_temp_dir(), 'pack');
        if ($path === false) {
            throw new RuntimeException('Inspection pack could not be assembled');
        }

        try {
            $zip = new ZipArchive();
            if ($zip->open($path, ZipArchive::OVERWRITE) !== true) {
                throw new RuntimeException('Inspection pack could not be assembled');
            }

            $zip->addFromString('inspection-pack-index.pdf', $index);
            $zip->addFromString('inspection-pack-manifest.json', self::json($manifest));

            foreach (array_values($files) as $position => $file) {
                $bytes = self::readControlledFile($file);
                $folder = match ($file['source']) {
                    'quality_report' => 'quality-reviews/QSR-' . ($file['reviewId'] ?? $file['sourceId']),
                    'quality_evidence' => 'quality-reviews/QSR-' . ($file['reviewId'] ?? 'evidence') . '/evidence',
                    default => 'released-reports',
                };

                $zip->addFromString(
                    $folder . '/' . str_pad((string) ($position + 1), 3, '0', STR_PAD_LEFT) . '-' . self::safeSegment((string) $file['fileName']),
                    $bytes,
                );
            }

            $zip->close();

            $bytes = file_get_contents($path);
            if ($bytes === false) {
                throw new RuntimeException('Inspection pack could not be assembled');
            }

            return $bytes;
        } finally {
            @unlink($path);
        }
    }

    /**
     * A source file whose bytes no longer hash to what was recorded against
     * them is not evidence, so the pack fails rather than shipping it.
     *
     * @param array<string, mixed> $file
     */
    private static function readControlledFile(array $file): string
    {
        $bytes = EvidenceStorage::read((string) $file['fileKey']);
        if ($bytes === null) {
            throw new RuntimeException("Inspection pack source retrieval failed for {$file['source']}:{$file['sourceId']}");
        }

        if ($file['contentHash'] !== null && hash('sha256', $bytes) !== $file['contentHash']) {
            throw new RuntimeException("Inspection pack source hash mismatch for {$file['source']}:{$file['sourceId']}");
        }

        return $bytes;
    }

    private static function safeSegment(string $value): string
    {
        $cleaned = (string) preg_replace('/[^a-zA-Z0-9._ -]+/', '-', $value);
        $cleaned = (string) preg_replace('/\s+/', '-', $cleaned);
        $cleaned = (string) preg_replace('/-+/', '-', $cleaned);
        $cleaned = trim($cleaned, '-.');

        return mb_substr($cleaned === '' ? 'file' : $cleaned, 0, 120);
    }

    /** @param array<string, mixed> $value */
    public static function json(array $value): string
    {
        return json_encode($value, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }
}
