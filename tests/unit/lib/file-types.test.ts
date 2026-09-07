import assert from "node:assert/strict";
import { test } from "bun:test";

async function loadSubject() {
  return import("../../../lib/file-types.ts");
}

test("detects image, audio, and document preview paths", async () => {
  const {
    getAudioMime,
    getDocumentMime,
    getImageMime,
    isAudioPath,
    isDocumentPreviewPath,
    isImagePath,
  } = await loadSubject();

  assert.equal(getImageMime("/tmp/screenshot.PNG"), "image/png");
  assert.equal(getAudioMime("C:\\Users\\me\\voice.OPUS"), "audio/ogg");
  assert.equal(
    getDocumentMime("/tmp/report.docx"),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  assert.equal(isImagePath("/tmp/screenshot.PNG"), true);
  assert.equal(isAudioPath("C:\\Users\\me\\voice.OPUS"), true);
  assert.equal(isDocumentPreviewPath("/tmp/report.pdf"), true);
  assert.equal(isDocumentPreviewPath("/tmp/report.txt"), false);
});

test("extracts extensions from mixed path styles", async () => {
  const { documentPreviewKind, getFileExt } = await loadSubject();

  assert.equal(getFileExt("/tmp/archive.tar.gz"), "gz");
  assert.equal(getFileExt("C:\\Users\\me\\photo.AVIF"), "avif");
  assert.equal(documentPreviewKind("/tmp/manual.PDF"), "pdf");
  assert.equal(documentPreviewKind("/tmp/manual.md"), null);
});

test("classifies video extensions and keeps webm out of audio", async () => {
  const { getAudioMime, getVideoMime, isVideoPath } = await loadSubject();

  // webm 自 0.9.0 移植起归为视频，不再误分类为音频
  assert.equal(getVideoMime("/tmp/demo.webm"), "video/webm");
  assert.equal(getAudioMime("/tmp/demo.webm"), null);
  assert.equal(getVideoMime("/tmp/demo.MP4"), "video/mp4");
  assert.equal(getVideoMime("C:\\Users\\me\\clip.m4v"), "video/mp4");
  assert.equal(getVideoMime("/tmp/camera.mov"), "video/quicktime");
  assert.equal(getVideoMime("/tmp/clip.ogv"), "video/ogg");
  assert.equal(getVideoMime("/tmp/not-video.txt"), null);
  // weba 仍属于音频
  assert.equal(getAudioMime("/tmp/voice.weba"), "audio/webm");
  assert.equal(isVideoPath("/tmp/demo.webm"), true);
  assert.equal(isVideoPath("/tmp/voice.opus"), false);
});
