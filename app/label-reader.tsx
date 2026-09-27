"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { FoodServing } from "@/lib/food-lookup";
import { readNutritionLabel, type LabelReading, type OcrLine } from "@/lib/nutrition-label";
import { OCR_CORE_DIR, OCR_LANG_DIR, OCR_WORKER_DIR } from "@/lib/ocr-assets";

/** Photos from a phone are far larger than text recognition needs, and slower to read. */
const MAX_SIDE = 2000;

async function downscale(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const { promise, resolve, reject } = Promise.withResolvers<Blob>();
  canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't read the photo"))));
  return promise;
}

/** Text recognition runs in this browser; the photo is never uploaded. */
async function readPhoto(file: File, onProgress: (progress: number) => void) {
  const [{ createWorker }, image] = await Promise.all([import("tesseract.js"), downscale(file)]);
  const origin = window.location.origin;
  const worker = await createWorker("eng", 1, {
    workerPath: `${origin}${OCR_WORKER_DIR}/worker.min.js`,
    corePath: `${origin}${OCR_CORE_DIR}`,
    langPath: `${origin}${OCR_LANG_DIR}`,
    workerBlobURL: false,
    // The browser caches the files; nothing is kept in IndexedDB.
    cacheMethod: "none",
    // lib/ocr-assets.ts serves the gzipped data without ".gz"; Tesseract still unpacks it.
    gzip: false,
    logger: (m) => {
      if (m.status === "recognizing text") onProgress(m.progress);
    },
  });
  try {
    const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
    const lines: OcrLine[] = (data.blocks ?? []).flatMap((block) =>
      block.paragraphs.flatMap((p) =>
        p.lines.map((l) => ({ text: l.text, confidence: l.confidence })),
      ),
    );
    return { reading: readNutritionLabel(lines), text: data.text.trim() };
  } finally {
    await worker.terminate();
  }
}

/** What to put in the new-food fields: carbs, and the serving they are for when it was read. */
export type LabelFill = { carbs: number; serving: FoodServing | null; uncertain: boolean };

type Status =
  | { stage: "reading"; progress: number }
  | { stage: "done"; reading: LabelReading; text: string }
  | { stage: "failed" };

function ReaderView({
  photo,
  onUse,
  onRetake,
}: {
  photo: { file: File; url: string };
  onUse: (fill: LabelFill) => void;
  onRetake: () => void;
}) {
  const [status, setStatus] = useState<Status>({ stage: "reading", progress: 0 });

  useEffect(() => {
    let current = true;
    readPhoto(photo.file, (progress) => current && setStatus({ stage: "reading", progress }))
      .then((result) => current && setStatus({ stage: "done", ...result }))
      .catch(() => current && setStatus({ stage: "failed" }));
    return () => {
      current = false;
    };
  }, [photo.file]);

  const reading = status.stage === "done" ? status.reading : null;
  const uncertain = !!(reading?.serving?.uncertain || reading?.carbs?.uncertain);
  return (
    <div className="label-reader">
      {/* oxlint-disable-next-line nextjs/no-img-element -- a local blob URL, nothing to optimize */}
      <img src={photo.url} alt="The nutrition label to read" className="label-reader-photo" />
      <div className="label-reader-result">
        {status.stage === "reading" && (
          <p className="helper" role="status">
            <Loader2 size={15} className="spin" aria-hidden="true" />
            Reading the label… {Math.round(status.progress * 100)}%
          </p>
        )}
        {status.stage === "failed" && (
          <p className="helper" role="status">
            The label couldn’t be read. Try another photo, or type the values from the label.
          </p>
        )}
        {reading && (
          <>
            <dl className="label-reader-values">
              <div className={reading.serving?.uncertain ? "is-uncertain" : undefined}>
                <dt>Serving size</dt>
                <dd>{reading.serving?.read ?? "Not found"}</dd>
              </div>
              <div className={reading.carbs?.uncertain ? "is-uncertain" : undefined}>
                <dt>Total carbohydrate</dt>
                <dd>
                  {reading.carbs?.grams != null ? `${reading.carbs.grams} g` : "Not found"}
                  {reading.carbs && <small>Read as “{reading.carbs.read}”</small>}
                </dd>
              </div>
            </dl>
            {uncertain && (
              <p className="label-reader-warning" role="status">
                <AlertTriangle size={15} aria-hidden="true" />
                The highlighted values were hard to read. Compare them with the photo.
              </p>
            )}
            {reading.servings.length ? (
              <div className="food-picker-chip-row">
                {reading.servings.map((serving) => (
                  <span className="food-picker-chip" key={serving.label}>
                    <button
                      type="button"
                      onClick={() => onUse({ carbs: serving.carbs, serving, uncertain })}
                    >
                      {serving.carbs} g carbs <small>per {serving.label}</small>
                    </button>
                  </span>
                ))}
              </div>
            ) : reading.carbs?.grams != null ? (
              <>
                <p className="helper" role="status">
                  The photo doesn’t show clearly what amount of food these carbs are for.
                </p>
                <div className="food-picker-chip-row">
                  <span className="food-picker-chip">
                    {/* Only the carbs; the user enters the serving they are for. */}
                    <button
                      type="button"
                      onClick={() =>
                        onUse({ carbs: reading.carbs?.grams ?? 0, serving: null, uncertain: true })
                      }
                    >
                      Use {reading.carbs.grams} g carbs <small>enter the serving yourself</small>
                    </button>
                  </span>
                </div>
              </>
            ) : (
              <p className="helper" role="status">
                The carbs couldn’t be read from this photo. Try a closer photo, straight on and in
                good light, or type the values from the label.
              </p>
            )}
            {status.stage === "done" && status.text && (
              <details className="label-reader-text">
                <summary>Text read from the photo</summary>
                <pre>{status.text}</pre>
              </details>
            )}
          </>
        )}
        {status.stage !== "reading" && (
          <div className="label-reader-actions">
            <button type="button" className="button outline" onClick={onRetake}>
              Take another photo
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function LabelReader({
  photo,
  onClose,
  onUse,
  onRetake,
}: {
  photo: { file: File; url: string } | null;
  onClose: () => void;
  onUse: (fill: LabelFill) => void;
  onRetake: () => void;
}) {
  return (
    <Dialog open={photo !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="care-dialog label-reader-dialog">
        <DialogHeader>
          <DialogTitle>Read a nutrition label</DialogTitle>
          <DialogDescription>
            The photo is read on this device and never leaves it. The first time, reading downloads
            about 7 MB.
          </DialogDescription>
        </DialogHeader>
        {photo && <ReaderView key={photo.url} photo={photo} onUse={onUse} onRetake={onRetake} />}
      </DialogContent>
    </Dialog>
  );
}
