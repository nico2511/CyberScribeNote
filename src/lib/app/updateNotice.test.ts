import { describe, expect, it } from "vitest";
import { shouldNotifyUpdate, stripVersionPrefix } from "./updateNotice";

const now = new Date("2026-09-26T12:00:00Z");

describe("stripVersionPrefix", () => {
  it("retire un seul préfixe v", () => {
    expect(stripVersionPrefix("v0.5.9")).toBe("0.5.9");
    expect(stripVersionPrefix("V0.5.9")).toBe("0.5.9");
    expect(stripVersionPrefix(" 0.5.8 ")).toBe("0.5.8");
  });
});

describe("shouldNotifyUpdate", () => {
  it("reste silencieux si la préférence est coupée ou s'il n'y a pas de mise à jour", () => {
    expect(
      shouldNotifyUpdate({
        checkOnStartup: false,
        updateAvailable: true,
        latest: "0.5.9",
        now,
      }),
    ).toBe(false);
    expect(
      shouldNotifyUpdate({
        checkOnStartup: true,
        updateAvailable: false,
        latest: "0.5.8",
        now,
      }),
    ).toBe(false);
  });

  it("affiche l'avis quand une version plus récente n'est pas reportée", () => {
    expect(
      shouldNotifyUpdate({
        checkOnStartup: true,
        updateAvailable: true,
        latest: "v0.5.9",
        now,
      }),
    ).toBe(true);
  });

  it("respecte un report de 7 jours pour la même version", () => {
    expect(
      shouldNotifyUpdate({
        checkOnStartup: true,
        updateAvailable: true,
        latest: "0.5.9",
        snoozeVersion: "v0.5.9",
        snoozeUntil: "2026-10-03T12:00:00Z",
        now,
      }),
    ).toBe(false);
  });

  it("réaffiche après expiration, pour une autre version, ou si la date est illisible", () => {
    expect(
      shouldNotifyUpdate({
        checkOnStartup: true,
        updateAvailable: true,
        latest: "0.5.9",
        snoozeVersion: "0.5.9",
        snoozeUntil: "2026-09-26T12:00:00Z",
        now,
      }),
    ).toBe(true);
    expect(
      shouldNotifyUpdate({
        checkOnStartup: true,
        updateAvailable: true,
        latest: "0.6.0",
        snoozeVersion: "0.5.9",
        snoozeUntil: "2026-10-03T12:00:00Z",
        now,
      }),
    ).toBe(true);
    expect(
      shouldNotifyUpdate({
        checkOnStartup: true,
        updateAvailable: true,
        latest: "0.5.9",
        snoozeVersion: "0.5.9",
        snoozeUntil: "pas-une-date",
        now,
      }),
    ).toBe(true);
  });
});
