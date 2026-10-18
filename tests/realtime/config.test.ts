import { describe, expect, it } from "vitest";
import { realtimeMode, webConfig } from "@/lib/realtime/config";

const FB = { FIREBASE_PROJECT_ID: "proj-1", FIREBASE_WEB_API_KEY: "key-1", FIREBASE_WEB_APP_ID: "1:2:web:3" };

describe("realtimeMode", () => {
  it("is always mock under vitest, whatever else is set", () => {
    expect(realtimeMode()).toBe("mock");
    expect(realtimeMode({ VITEST: "true", REALTIME_BACKEND: "off", ...FB })).toBe("mock");
    expect(realtimeMode({ VITEST: "true", REALTIME_BACKEND: "firestore" })).toBe("mock");
  });

  it("REALTIME_BACKEND wins when it is valid", () => {
    expect(realtimeMode({ REALTIME_BACKEND: "off", ...FB })).toBe("off");
    expect(realtimeMode({ REALTIME_BACKEND: "mock", ...FB })).toBe("mock");
    expect(realtimeMode({ REALTIME_BACKEND: "firestore" })).toBe("firestore");
    expect(realtimeMode({ REALTIME_BACKEND: " Off ", DATA_BACKEND: "mock" })).toBe("off");
  });

  it("ignores a blank or unknown REALTIME_BACKEND", () => {
    expect(realtimeMode({ REALTIME_BACKEND: "", ...FB })).toBe("firestore");
    expect(realtimeMode({ REALTIME_BACKEND: "banana", ...FB })).toBe("firestore");
    expect(realtimeMode({ REALTIME_BACKEND: "banana" })).toBe("off");
  });

  it("is firestore only when the project id, web API key and web app id are all set", () => {
    expect(realtimeMode({ ...FB })).toBe("firestore");
    expect(realtimeMode({ ...FB, FIREBASE_WEB_API_KEY: "" })).toBe("off");
    expect(realtimeMode({ ...FB, FIREBASE_WEB_APP_ID: "  " })).toBe("off");
    expect(realtimeMode({ ...FB, FIREBASE_PROJECT_ID: undefined })).toBe("off");
  });

  it("is mock for the local mock backend when Firebase is not configured", () => {
    expect(realtimeMode({ DATA_BACKEND: "mock" })).toBe("mock");
    expect(realtimeMode({ DATA_BACKEND: "mock", ...FB })).toBe("firestore");
  });

  it("is off otherwise", () => {
    expect(realtimeMode({})).toBe("off");
    expect(realtimeMode({ DATA_BACKEND: "supabase" })).toBe("off");
  });
});

describe("webConfig", () => {
  it("is null until the project id, API key and app id are set", () => {
    expect(webConfig({})).toBeNull();
    expect(webConfig({ ...FB, FIREBASE_WEB_API_KEY: "" })).toBeNull();
  });

  it("defaults the auth domain from the project id", () => {
    expect(webConfig({ ...FB })).toEqual({ apiKey: "key-1", authDomain: "proj-1.firebaseapp.com", projectId: "proj-1", appId: "1:2:web:3" });
  });

  it("uses FIREBASE_AUTH_DOMAIN when given", () => {
    expect(webConfig({ ...FB, FIREBASE_AUTH_DOMAIN: "login.example.com" })?.authDomain).toBe("login.example.com");
  });
});
