import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, RefreshCw, X } from 'lucide-react';

/**
 * Read a QR code from the device camera.
 *
 * Mounting it asks the browser for the camera, which shows the permission
 * prompt the first time: on a phone it opens the back camera, on a laptop the
 * webcam (hold the code up to it). Frames are decoded with the browser's own
 * `BarcodeDetector` where it reads QR codes (Chrome on Android and macOS) and
 * with jsQR everywhere else, Windows Chrome included, which has none. The
 * stream is stopped the moment a code is read, on cancel, and on unmount, so
 * the camera light never stays on behind the page.
 */

interface QrScannerProps {
  /** The decoded text of the first code read. */
  onResult: (text: string) => void;
  onCancel: () => void;
  /** Shown under the video, e.g. what to point the camera at. */
  hint?: string;
  /**
   * Barcode formats to read where the browser's detector supports them
   * (medicine labels are usually Code 128 or Data Matrix). QR only by default;
   * the fallback decoder reads QR only.
   */
  formats?: readonly string[];
}

interface DetectedBarcode {
  rawValue: string;
}
interface NativeDetector {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
interface NativeDetectorConstructor {
  new (options?: { formats: string[] }): NativeDetector;
  getSupportedFormats?: () => Promise<string[]>;
}

const SCAN_INTERVAL_MS = 250;

/** A sentence a person can act on, for each way opening the camera fails. */
export function cameraErrorMessage(error: unknown): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera permission was refused. Allow the camera for this site (tap the icon beside the web address, then Permissions or Site settings), then try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device.';
    case 'NotSupportedError':
      return 'This browser cannot use a camera here. Open the page in Chrome or Safari, or enter the code by hand.';
    case 'NotReadableError':
    case 'AbortError':
      return 'The camera is in use by another app or tab. Close it there and try again.';
    default:
      return 'The camera could not be opened. Enter the code by hand instead.';
  }
}

async function nativeQrDetector(wanted: readonly string[] = ['qr_code']): Promise<NativeDetector | null> {
  const Detector = (window as Window & { BarcodeDetector?: NativeDetectorConstructor }).BarcodeDetector;
  if (!Detector) return null;
  try {
    const supported = (await Detector.getSupportedFormats?.()) ?? [];
    const formats = wanted.filter((f) => supported.includes(f));
    return formats.length > 0 ? new Detector({ formats }) : null;
  } catch {
    return null;
  }
}

/** Decode one video frame, or `null` when no QR code is in it. */
async function readFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  native: NativeDetector | null
): Promise<string | null> {
  if (native) {
    const found = await native.detect(video);
    return found[0]?.rawValue ?? null;
  }
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(video, 0, 0, width, height);
  const frame = context.getImageData(0, 0, width, height);
  return jsQR(frame.data, width, height, { inversionAttempts: 'dontInvert' })?.data ?? null;
}

export function QrScanner({ onResult, onCancel, hint, formats }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  // Read once when the camera starts; changing formats mid-scan restarts nothing.
  const formatsRef = useRef(formats);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraIndex, setCameraIndex] = useState<number | null>(null);
  // Bumped by "Try again" after a refusal, to ask for the camera once more.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let stopped = false;
    const stop = () => {
      stopped = true;
      window.clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };

    async function start() {
      setStarting(true);
      setError(null);
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('This browser cannot open the camera here. Use Chrome or Safari on an https:// address, or enter the code by hand.');
        setStarting(false);
        return;
      }
      const chosen = cameraIndex === null ? undefined : cameras[cameraIndex]?.deviceId;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: chosen ? { deviceId: { exact: chosen } } : { facingMode: { ideal: 'environment' } },
        });
      } catch (err) {
        if (!stopped) setError(cameraErrorMessage(err));
        setStarting(false);
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      setStarting(false);
      // Labels and the full camera list are only readable once permission is given.
      navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => {
          if (!stopped) setCameras(devices.filter((device) => device.kind === 'videoinput'));
        })
        .catch(() => undefined);

      const native = await nativeQrDetector(formatsRef.current);
      let busy = false;
      timer = window.setInterval(() => {
        if (busy || stopped || video.readyState < 2) return;
        busy = true;
        readFrame(video, canvas, native)
          .then((text) => {
            if (text && !stopped) {
              stop();
              onResultRef.current(text);
            }
          })
          .catch(() => undefined)
          .finally(() => {
            busy = false;
          });
      }, SCAN_INTERVAL_MS);
    }

    void start();
    return stop;
    // `cameras` is read only to pick the device the index names.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraIndex, attempt]);

  return (
    <div className="space-y-3" data-testid="qr-scanner">
      <div className="relative overflow-hidden rounded-lg bg-black aspect-square sm:aspect-video">
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          playsInline
          muted
          autoPlay
          aria-label="Camera view for scanning a QR code"
        />
        <div className="pointer-events-none absolute inset-8 rounded-lg border-4 border-white/80" aria-hidden="true" />
        {starting && !error && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-white">
            <Camera className="mr-2 h-5 w-5" aria-hidden="true" /> Opening the camera...
          </p>
        )}
      </div>
      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
      {error ? (
        <p role="alert" className="rounded-lg border border-critical bg-critical-subtle p-3 text-sm text-critical-subtle-fg">
          {error}
        </p>
      ) : (
        <p className="text-sm text-content-muted">{hint ?? 'Hold the QR code inside the frame. It is read automatically.'}</p>
      )}
      <div className="flex gap-2">
        {cameras.length > 1 && (
          <button
            type="button"
            onClick={() => setCameraIndex(((cameraIndex ?? 0) + 1) % cameras.length)}
            className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg bg-surface-sunken px-4 py-2 text-sm font-medium text-content-secondary"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Switch camera
          </button>
        )}
        {error && (
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-fg"
          >
            <Camera className="h-4 w-4" aria-hidden="true" /> Try again
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg bg-surface-sunken px-4 py-2 text-sm font-medium text-content-secondary"
        >
          <X className="h-4 w-4" aria-hidden="true" /> Cancel
        </button>
      </div>
    </div>
  );
}
