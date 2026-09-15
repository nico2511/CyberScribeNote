import { beforeEach, describe, expect, it } from "vitest";
import {
  enqueueVoiceTranscript,
  isVoiceBusy,
  voiceSession,
} from "./voiceSession.svelte";

describe("voiceSession", () => {
  beforeEach(() => {
    voiceSession.status.recording = false;
    voiceSession.status.transcribing = false;
  });

  it("isVoiceBusy when recording or transcribing", () => {
    expect(isVoiceBusy()).toBe(false);
    voiceSession.status.recording = true;
    expect(isVoiceBusy()).toBe(true);
    voiceSession.status.recording = false;
    voiceSession.status.transcribing = true;
    expect(isVoiceBusy()).toBe(true);
  });

  it("enqueueVoiceTranscript runs tasks in order", async () => {
    const order: number[] = [];
    const a = enqueueVoiceTranscript(async () => {
      order.push(1);
    });
    const b = enqueueVoiceTranscript(async () => {
      order.push(2);
    });
    await Promise.all([a, b]);
    expect(order).toEqual([1, 2]);
  });
});
