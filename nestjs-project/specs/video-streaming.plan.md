---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.8
target_file: nestjs-project/test/videos-streaming.e2e-spec.ts
---

# Streaming + Download Test Plan

## Application Overview

The streaming and download endpoints redirect to presigned S3 URLs for video playback and download respectively. Both are public (no auth required) but require the video to be in `ready` status. The download endpoint includes a Content-Disposition attachment header.

## Test Scenarios

### 1. Stream — Success

**Setup:** Clean video table; create a video with status `ready` and a valid storage_key pointing to an object in MinIO.

#### 1.1. stream-redirects-to-presigned-url

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-16T21:57:20Z

**Steps:**
  1. GET /videos/:publicId/stream (no auth required)
    - expect: 302 status
    - expect: response `Location` header contains a presigned URL pointing to MinIO

### 2. Download — Success

**Setup:** Same as group 1.

#### 2.1. download-redirects-with-content-disposition

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-16T21:57:20Z

**Steps:**
  1. GET /videos/:publicId/download (no auth required)
    - expect: 302 status
    - expect: response `Location` header contains a presigned URL with `response-content-disposition` parameter including `attachment`

### 3. Not Found

**Setup:** No video with given publicId.

#### 3.1. stream-returns-404-for-missing-video

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-16T21:57:20Z

**Steps:**
  1. GET /videos/nonexistent1/stream
    - expect: 404 status
    - expect: response body errorCode equals `"VIDEO_NOT_FOUND"`

#### 3.2. download-returns-404-for-missing-video

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-16T21:57:20Z

**Steps:**
  1. GET /videos/nonexistent1/download
    - expect: 404 status
    - expect: response body errorCode equals `"VIDEO_NOT_FOUND"`

### 4. Video Not Ready

**Setup:** Create a video with status `draft` or `processing`.

#### 4.1. stream-returns-409-for-non-ready-video

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-16T21:57:20Z

**Steps:**
  1. GET /videos/:publicId/stream for video with status `draft`
    - expect: 409 status
    - expect: response body errorCode equals `"VIDEO_NOT_READY"`

#### 4.2. download-returns-409-for-non-ready-video

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-16T21:57:20Z

**Steps:**
  1. GET /videos/:publicId/download for video with status `processing`
    - expect: 409 status
    - expect: response body errorCode equals `"VIDEO_NOT_READY"`
