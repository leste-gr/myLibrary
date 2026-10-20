import { canonicalIsbn } from "./isbn";

type Controls = { stop(): void };
type CameraAdapter = {
  getStream(): Promise<MediaStream>;
  decode(stream: MediaStream, video: HTMLVideoElement, onCode: (code: string) => void): Promise<Controls>;
};
const camera: CameraAdapter = {
  getStream: () => navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } }),
  async decode(stream, video, onCode) {
    const { BrowserMultiFormatReader } = await import("@zxing/browser");
    const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 250, delayBetweenScanSuccess: 500 });
    return reader.decodeFromStream(stream, video, result => { if (result) onCode(result.getText()); });
  },
};

// Camera frames stay in the browser. Abort also handles permission prompts and
// decoder startup resolving after navigation, cancellation, or a successful scan.
export async function startIsbnCamera(video: HTMLVideoElement, onIsbn: (isbn: string) => void,
  signal: AbortSignal, adapter: CameraAdapter = camera): Promise<void> {
  let stream: MediaStream | undefined;
  let controls: Controls | undefined;
  let detected = false;
  const stop = () => {
    controls?.stop();
    stream?.getTracks().forEach(track => track.stop());
    if (video.srcObject === stream) video.srcObject = null;
  };
  if (signal.aborted) return;
  signal.addEventListener("abort", stop, { once: true });
  try {
    stream = await adapter.getStream();
    if (signal.aborted) { stop(); return; }
    controls = await adapter.decode(stream, video, code => {
      if (signal.aborted || detected || !/^(?:[0-9]{13}|[0-9]{9}[0-9X])$/i.test(code)) return;
      const isbn = canonicalIsbn(code);
      if (!isbn) return;
      detected = true;
      stop();
      onIsbn(isbn);
    });
    if (signal.aborted || detected) stop();
  } catch (error) {
    signal.removeEventListener("abort", stop);
    stop();
    if (!signal.aborted) throw error;
  }
}
