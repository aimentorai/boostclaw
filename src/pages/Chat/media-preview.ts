import { createAuthenticatedHostApiUrl } from '@/lib/host-api';

export async function filePathToHostedMediaSrc(
  filePath?: string | null,
  mimeType?: string | null,
): Promise<string | null> {
  if (!filePath) return null;
  if (/^(?:data|blob|https?):/i.test(filePath)) return filePath;

  const path = `/api/files/media?path=${encodeURIComponent(filePath)}${
    mimeType ? `&mimeType=${encodeURIComponent(mimeType)}` : ''
  }`;
  return createAuthenticatedHostApiUrl(path);
}

export function mediaLabel(fileName: string, fileSize: number, formatFileSize: (bytes: number) => string): string {
  return fileSize > 0 ? `${fileName} · ${formatFileSize(fileSize)}` : fileName;
}

export function revealVideoPreviewFrame(video: HTMLVideoElement): void {
  if (video.dataset.previewFrameSeeked === '1') return;
  video.dataset.previewFrameSeeked = '1';

  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const previewTime = duration > 0 ? Math.min(0.1, duration / 2) : 0.1;

  try {
    video.currentTime = previewTime;
  } catch {
    // Some codecs/containers do not allow seeking before playback. In that case
    // the native controls still work; this only improves the static preview.
  }
}

export function getVideoAspectRatio(video: HTMLVideoElement): string | null {
  const { videoWidth, videoHeight } = video;
  if (!videoWidth || !videoHeight) return null;
  return `${videoWidth} / ${videoHeight}`;
}
