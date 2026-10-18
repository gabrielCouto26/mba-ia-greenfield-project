---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.4
target_file: nestjs-project/test/videos-upload-management.e2e-spec.ts
---

# Upload Management (presign-part + abort) Test Plan

## Application Overview

These endpoints manage an in-progress multipart upload: presign-part generates a presigned URL for uploading a specific part to S3, and abort cancels the upload and clears the upload_id. Both require authentication and channel ownership. State validation ensures the video is in `draft` status with an active upload.

## Test Scenarios

### 1. Presign Part — Success

**Setup:** Clean video table; create user with channel; initiate upload (POST /videos) to get a draft video with upload_id.

#### 1.1. presign-part-returns-url

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-16T21:57:20Z

**Steps:**
  1. POST /videos/:publicId/upload/presign-part with { part_number: 1 } and owner Bearer token
    - expect: 200 status
    - expect: response body contains `presigned_url` as a non-empty string

### 2. Presign Part — State Validation

**Setup:** Create a video and transition its status to `processing` (or clear upload_id) to simulate non-draft state.

#### 2.1. presign-part-rejects-non-draft-video

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-16T21:57:20Z

**Steps:**
  1. POST /videos/:publicId/upload/presign-part with { part_number: 1 } for a video with status ≠ draft
    - expect: 409 status
    - expect: response body errorCode equals `"UPLOAD_NOT_IN_PROGRESS"`

### 3. Abort Upload

**Setup:** Same as group 1 — draft video with active upload.

#### 3.1. abort-upload-clears-upload-id

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-16T21:57:20Z

**Steps:**
  1. POST /videos/:publicId/upload/abort with owner Bearer token
    - expect: 204 status
  2. Query DB for the video record
    - expect: upload_id is null

### 4. Authorization Failures

**Setup:** Two users, each with a channel; draft video belongs to user A.

#### 4.1. presign-part-rejects-non-owner

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-16T21:57:20Z

**Steps:**
  1. POST /videos/:publicId/upload/presign-part with user B's token
    - expect: 403 status
    - expect: response body errorCode equals `"NOT_CHANNEL_OWNER"`

#### 4.2. abort-rejects-non-owner

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-16T21:57:20Z

**Steps:**
  1. POST /videos/:publicId/upload/abort with user B's token
    - expect: 403 status
    - expect: response body errorCode equals `"NOT_CHANNEL_OWNER"`

### 5. Not Found

**Setup:** No video with the given publicId.

#### 5.1. presign-part-returns-404-for-missing-video

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-16T21:57:20Z

**Steps:**
  1. POST /videos/nonexistent1/upload/presign-part with { part_number: 1 }
    - expect: 404 status
    - expect: response body errorCode equals `"VIDEO_NOT_FOUND"`

#### 5.2. abort-returns-404-for-missing-video

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-16T21:57:20Z

**Steps:**
  1. POST /videos/nonexistent1/upload/abort
    - expect: 404 status
    - expect: response body errorCode equals `"VIDEO_NOT_FOUND"`
