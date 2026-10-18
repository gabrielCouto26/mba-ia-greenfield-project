---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.6
target_file: nestjs-project/test/videos-upload-complete.e2e-spec.ts
---

# Upload Complete (POST /videos/:publicId/upload/complete) Test Plan

## Application Overview

The upload complete endpoint finalizes the S3 multipart upload, transitions the video status from `draft` to `processing`, and enqueues a `video.process` job via BullMQ. It requires authentication and channel ownership, and validates that the video is in draft state with an active upload.

## Test Scenarios

### 1. Successful Completion

**Setup:** Clean video table; create user with channel; initiate upload (POST /videos) to get draft video with upload_id; upload at least one part to S3 to obtain a valid etag.

#### 1.1. complete-upload-transitions-to-processing

**Covers AC:** #1, #2
**Source:** auto
**Last sync:** 2026-10-16T21:57:20Z

**Steps:**
  1. POST /videos/:publicId/upload/complete with valid parts array [{ part_number: 1, etag: "<real-etag>" }] and owner Bearer token
    - expect: 200 status
    - expect: response body contains `status` equal to `"processing"`
  2. Query DB for the video record
    - expect: status equals `"processing"`

#### 1.2. complete-upload-enqueues-processing-job

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-16T21:57:20Z

**Steps:**
  1. POST /videos/:publicId/upload/complete with valid parts and owner token
    - expect: 200 status
  2. Inspect BullMQ queue `video-processing` for pending jobs
    - expect: a job with data containing `videoId` matching the video's id and `storageKey` matching the video's storage_key

### 2. State Validation

**Setup:** Create a video already in `processing` status (or with null upload_id).

#### 2.1. reject-complete-on-non-draft-video

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-16T21:57:20Z

**Steps:**
  1. POST /videos/:publicId/upload/complete with valid parts for a video with status ≠ draft
    - expect: 409 status
    - expect: response body errorCode equals `"UPLOAD_NOT_IN_PROGRESS"`

### 3. Authorization Failures

**Setup:** Two users with channels; draft video belongs to user A.

#### 3.1. reject-complete-by-non-owner

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-16T21:57:20Z

**Steps:**
  1. POST /videos/:publicId/upload/complete with user B's token
    - expect: 403 status
    - expect: response body errorCode equals `"NOT_CHANNEL_OWNER"`
