"use client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { BarcodeDetector as PonyfillDetector } from "barcode-detector/ponyfill";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { normalizeBarcode } from "@/lib/food-lookup";

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"] as const;
const SCAN_INTERVAL_MS = 200;

/**
 * The browser's own detector where it reads retail barcodes (Chrome, Android); elsewhere
 * (Safari, Firefox) a WASM decoder, loaded only now and served by Carby rather than a CDN.
 */
async function loadDetector(): Promise<typeof PonyfillDetector> {
  const native = (globalThis as { BarcodeDetector?: typeof PonyfillDetector }).BarcodeDetector;
  if (native && (await native.getSupportedFormats()).includes("ean_13")) return native;
  const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import("barcode-detector/ponyfill"),
    import("zxing-wasm/reader/zxing_reader.wasm?url"),
  ]);
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) =>
        path.endsWith(".wasm") ? wasmUrl : prefix + path,
    },
  });
  return BarcodeDetector;
}
// Set up once per page, so reopening the scanner doesn't load the decoder again.
let detectorClass: Promise<typeof PonyfillDetector> | null = null;

function cameraError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError")
    return "Camera access is blocked. Allow it in your browser settings, or type the barcode instead.";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "No camera was found. Type the barcode instead.";
  return "The camera couldn’t start. Type the barcode instead.";
}

/** Mounted only while the dialog is open, so closing it always releases the camera. */
function ScannerView({ onDetected }: { onDetected: (gtin: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"starting" | "scanning" | { error: string }>("starting");
  const detected = useEffectEvent((gtin: string) => onDetected(gtin));

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("No camera API");
        detectorClass ??= loadDetector().catch((error: unknown) => {
          detectorClass = null; // a failed download gets another try next time
          throw error;
        });
        const Detector = await detectorClass;
        const detector = new Detector({ formats: [...FORMATS] });
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        const element = video.current;
        // Closed while the permission prompt was up: the cleanup already ran, so stop it here.
        if (stopped || !element) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        element.srcObject = stream;
        await element.play();
        setStatus("scanning");
        while (!stopped) {
          const found = await detector.detect(element).catch(() => []);
          // A misread fails the check digit, so the first code that passes is the real one.
          const gtin = found.map((b) => normalizeBarcode(b.rawValue, b.format)).find(Boolean);
          if (gtin) {
            stopped = true;
            detected(gtin);
            return;
          }
          const { promise, resolve } = Promise.withResolvers<void>();
          setTimeout(resolve, SCAN_INTERVAL_MS);
          await promise;
        }
      } catch (error) {
        if (!stopped) setStatus({ error: cameraError(error) });
      }
    })();
    return () => {
      stopped = true;
      for (const track of stream?.getTracks() ?? []) track.stop();
    };
  }, []);

  return (
    <div className="barcode-scanner">
      <video ref={video} muted playsInline aria-label="Camera view for scanning a barcode" />
      <p role="status" className="helper">
        {typeof status === "object" ? (
          status.error
        ) : status === "starting" ? (
          <>
            <Loader2 size={15} className="spin" aria-hidden="true" /> Starting the camera…
          </>
        ) : (
          "Hold the barcode flat and fill the frame with it."
        )}
      </p>
    </div>
  );
}

export default function BarcodeScanner({
  open,
  onOpenChange,
  onDetected,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDetected: (gtin: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="care-dialog barcode-scanner-dialog">
        <DialogHeader>
          <DialogTitle>Scan a barcode</DialogTitle>
          <DialogDescription>
            Point the camera at the barcode on the package. Only the barcode number leaves Carby.
          </DialogDescription>
        </DialogHeader>
        {open && <ScannerView onDetected={onDetected} />}
      </DialogContent>
    </Dialog>
  );
}
